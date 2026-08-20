// Shared route-details modal: weather, Flight Details, and the SimBrief
// filing flow (popup auto-generate + manual redirect). Used by both the
// main route browser and Career Mode so the two don't drift out of sync --
// this is the same lesson learned from ofp-detail.js: the Active Route page
// silently fell behind main.js once before because this logic lived in two
// places instead of one.
//
// Expects the standard modal markup to already be on the page with these
// exact ids: rnModalOverlay, rnModalClose, rnModalBody (and, inside the
// body template below, rnWxGrid / rnSbStep / rnOfpResult / rnRouteMap,
// which this module creates itself).
import { fetchAirportWeather } from "./weather.js";
import { buildDispatchUrl, generateViaPopup, summarizeOfp, aircraftOptionsFor } from "./simbrief.js";
import { renderChartGallery, extractCharts } from "./route-map.js";
import { ofpDetailHtml } from "./ofp-detail.js";
import { airportLocalDateKey } from "./career-time.js";
import { supabase } from "./supabase-client.js";
import { occasionalIcaoCodes, isAircraftAvailableToday, isDomesticRoute } from "./aircraft-rarity.js";
import { FIXED_RATES, SHOP_RATES, EVENT_RATES, tierPerkRateForRank, multiplierLabel } from "./crew-multipliers.js";

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function formatTime(minutes) {
  if (!minutes) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

function runwayNotesHtml(origin, destination) {
  const notes = [
    origin?.runway_notes ? { icao: origin.icao, text: origin.runway_notes } : null,
    destination?.runway_notes ? { icao: destination.icao, text: destination.runway_notes } : null,
  ].filter(Boolean);
  if (!notes.length) return "";
  return `
    <div class="rn-modal-section">
      <h4>Known Runway Notes</h4>
      ${notes.map((n) => `<p style="font-size:13px; color:var(--muted); margin-bottom:6px;"><strong>${escapeHtml(n.icao)}:</strong> ${escapeHtml(n.text)}</p>`).join("")}
    </div>`;
}

// Loads (or reloads, after a claim/release action) who -- if anyone --
// currently holds the claim for this specific schedule_id + flight_date,
// and renders the appropriate state: claim button, "you've claimed this"
// + release button, someone else's name (read-only), or a login prompt
// for a signed-out visitor. Re-fetches from the DB rather than trusting
// local state after every action, since the unique index on
// (schedule_id, flight_date) is what actually enforces one-pilot-per-
// flight -- a concurrent claim from another pilot needs to show up here,
// not just be assumed away.
async function refreshClaimSection(route) {
  const section = document.getElementById("rnClaimSection");
  if (!section || !supabase) return;
  const { scheduleId, flightDate, currentPilot } = route.claimContext;

  const { data: existing, error } = await supabase
    .from("flight_claims")
    .select("id, pilot_id, pilots(display_name)")
    .eq("schedule_id", scheduleId)
    .eq("flight_date", flightDate)
    .neq("status", "expired")
    .maybeSingle();

  if (error) {
    section.innerHTML = `<h4>Claim This Flight</h4><p class="rn-sb-status error" style="margin-top:0;">Couldn't load claim status.</p>`;
    return;
  }

  if (existing) {
    const isMine = currentPilot && existing.pilot_id === currentPilot.id;
    if (!isMine) {
      section.innerHTML = `
        <h4>Claim This Flight</h4>
        <p class="rn-sb-status" style="margin-top:0;">Claimed by ${escapeHtml(existing.pilots?.display_name || "another pilot")}.</p>
      `;
      return;
    }
    await renderMyClaim(route, existing);
    return;
  }

  if (!currentPilot) {
    section.innerHTML = `<h4>Claim This Flight</h4><p class="rn-sb-status" style="margin-top:0;">
      <a href="crew-auth.html" style="color:var(--red-600); text-decoration:underline;">Log in to Crew Center</a> to claim this flight.
    </p>`;
    return;
  }

  section.innerHTML = `
    <h4>Claim This Flight</h4>
    <button type="button" class="btn btn-primary" data-claim="${escapeHtml(scheduleId)}">Claim This Flight</button>
    <div class="rn-sb-status" id="rnClaimStatus"></div>
  `;
  section.querySelector("[data-claim]")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    const { error: insertErr } = await supabase.from("flight_claims").insert({
      pilot_id: currentPilot.id,
      schedule_id: scheduleId,
      flight_date: flightDate,
    });
    if (insertErr) {
      // Most likely the unique index -- someone else claimed it between
      // this modal opening and the click. Re-fetching shows the real
      // current state either way, not just this specific error message.
      const status = document.getElementById("rnClaimStatus");
      if (status) {
        status.textContent = "Couldn't claim this flight -- it may have just been claimed by someone else.";
        status.className = "rn-sb-status error";
      }
    }
    refreshClaimSection(route);
  });
}

// Renders the signed-in pilot's own claim: if a PIREP was already filed
// against it, shows its status (pending / approved / rejected) instead of
// the filing form -- one PIREP per claim for v1, matching the plan's
// claim_id link (a rejected PIREP needs staff to sort out, not a silent
// resubmit). Otherwise shows Release Claim + the filing form.
async function renderMyClaim(route, claim) {
  const section = document.getElementById("rnClaimSection");
  const { currentPilot } = route.claimContext;

  const { data: pirep } = await supabase
    .from("pireps")
    .select("*")
    .eq("claim_id", claim.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pirep) {
    section.innerHTML = pirepStatusHtml(pirep);
    return;
  }

  // Tier perk rate comes from the pilot's own rank, not a pilot choice --
  // and it's capped at once per calendar week, so check recent usage
  // before offering it as an option.
  const tierPerkRate = tierPerkRateForRank(currentPilot.rankName);
  let tierPerkUsedThisWeek = false;
  if (tierPerkRate) {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: recentTierUse } = await supabase
      .from("pireps")
      .select("id")
      .eq("pilot_id", currentPilot.id)
      .eq("multiplier_type", "tier_perk")
      .gte("created_at", weekAgo)
      .limit(1);
    tierPerkUsedThisWeek = !!recentTierUse?.length;
  }

  section.innerHTML = `
    <h4>Claim This Flight</h4>
    <p class="rn-sb-status" style="margin-top:0;">You've claimed this flight.</p>
    <button type="button" class="btn btn-outline" id="rnReleaseClaim" style="margin-bottom:18px;">Release Claim</button>
    <h4>File PIREP</h4>
    <div class="rn-sb-field">
      <label for="rnPirepMultiplier">Multiplier</label>
      <select id="rnPirepMultiplier">
        <option value="none">${escapeHtml(multiplierLabel("none", FIXED_RATES.none))}</option>
        <option value="rotw">${escapeHtml(multiplierLabel("rotw", FIXED_RATES.rotw))}</option>
        ${tierPerkRate ? `<option value="tier_perk" ${tierPerkUsedThisWeek ? "disabled" : ""}>${tierPerkUsedThisWeek ? "Rank perk (already used this week)" : escapeHtml(multiplierLabel("tier_perk", tierPerkRate))}</option>` : ""}
        ${SHOP_RATES.map((r) => `<option value="shop:${r}">${escapeHtml(multiplierLabel("shop", r))}</option>`).join("")}
        ${EVENT_RATES.map((r) => `<option value="event:${r}">${escapeHtml(multiplierLabel("event", r))}</option>`).join("")}
      </select>
    </div>
    <div class="rn-sb-field" id="rnPirepRemarksField" style="display:none;">
      <label for="rnPirepRemarks">Remarks (required for a bonus -- explain why)</label>
      <textarea id="rnPirepRemarks" rows="2"></textarea>
    </div>
    <button type="button" class="btn btn-primary" id="rnFilePirep">File PIREP</button>
    <div class="rn-sb-status" id="rnPirepStatus"></div>
  `;

  document.getElementById("rnReleaseClaim").addEventListener("click", async (e) => {
    e.target.disabled = true;
    await supabase.from("flight_claims").update({ status: "expired" }).eq("id", claim.id);
    refreshClaimSection(route);
  });

  const multiplierSelect = document.getElementById("rnPirepMultiplier");
  const remarksField = document.getElementById("rnPirepRemarksField");
  multiplierSelect.addEventListener("change", () => {
    remarksField.style.display = multiplierSelect.value === "none" ? "none" : "block";
  });

  document.getElementById("rnFilePirep").addEventListener("click", async (e) => {
    const fileStatus = document.getElementById("rnPirepStatus");
    const [type, rawValue] = multiplierSelect.value.split(":");
    const remarks = document.getElementById("rnPirepRemarks").value.trim();
    if (type !== "none" && !remarks) {
      fileStatus.textContent = "Explain your bonus claim in the remarks field.";
      fileStatus.className = "rn-sb-status error";
      return;
    }

    e.target.disabled = true;
    fileStatus.textContent = "Checking your Infinite Flight logbook…";
    fileStatus.className = "rn-sb-status";

    const multiplierValue = type === "none" ? FIXED_RATES.none
      : type === "rotw" ? FIXED_RATES.rotw
      : type === "tier_perk" ? tierPerkRate
      : Number(rawValue);

    let verification = { verified: false, matchedFlightId: null, loggedMinutes: null };
    if (currentPilot.infinite_flight_user_id) {
      try {
        const { data, error: verifyErr } = await supabase.functions.invoke("pirep-verify", {
          body: {
            infiniteFlightUserId: currentPilot.infinite_flight_user_id,
            originIcao: route.origin?.icao,
            destinationIcao: route.destination?.icao,
            flightDate: route.claimContext.flightDate,
          },
        });
        if (!verifyErr && data) verification = data;
      } catch (err) {
        console.error("[route-modal] pirep-verify failed", err);
      }
    }

    const { error: insertErr } = await supabase.from("pireps").insert({
      claim_id: claim.id,
      pilot_id: currentPilot.id,
      if_logbook_flight_id: verification.matchedFlightId,
      logged_flight_minutes: verification.loggedMinutes,
      verification_status: verification.verified ? "verified" : "unverified",
      multiplier_type: type,
      multiplier_value: multiplierValue,
      remarks: remarks || null,
    });

    if (insertErr) {
      fileStatus.textContent = "Couldn't file your PIREP -- try again in a moment.";
      fileStatus.className = "rn-sb-status error";
      e.target.disabled = false;
      return;
    }
    refreshClaimSection(route);
  });
}

function pirepStatusHtml(pirep) {
  const reviewLine = pirep.review_status === "approved"
    ? `<p class="rn-sb-status success" style="margin-top:0;">PIREP approved -- ${pirep.hours_awarded != null ? `${pirep.hours_awarded} hours awarded.` : "hours awarded."}</p>`
    : pirep.review_status === "rejected"
    ? `<p class="rn-sb-status error" style="margin-top:0;">PIREP rejected.</p>`
    : `<p class="rn-sb-status" style="margin-top:0;">PIREP filed -- pending staff review.</p>`;
  const verifyLine = pirep.verification_status === "verified"
    ? `<p style="font-size:12px; color:var(--muted); margin-top:4px;">Verified against your Infinite Flight logbook.</p>`
    : `<p style="font-size:12px; color:var(--muted); margin-top:4px;">No matching logbook entry found automatically -- staff will review manually.</p>`;
  const multiplierLine = pirep.multiplier_type !== "none"
    ? `<p style="font-size:12px; color:var(--muted); margin-top:4px;">Claimed: ${escapeHtml(multiplierLabel(pirep.multiplier_type, pirep.multiplier_value))}</p>`
    : "";
  return `<h4>Claim This Flight</h4>${reviewLine}${verifyLine}${multiplierLine}`;
}

function wxCardHtml(icao, label, wx, loading) {
  if (loading) return `<div class="rn-wx-card"><span class="rn-wx-code">${escapeHtml(icao)}</span><div class="rn-wx-loading">Loading weather…</div></div>`;
  // Live in-sim ATIS (a real controller currently staffing this airport)
  // takes priority when available -- otherwise this is real-world METAR.
  const isAtis = wx?.source === "atis" && wx?.atis;
  const raw = isAtis ? wx.atis : wx?.metar?.rawOb || wx?.metar?.raw_text;
  return `
    <div class="rn-wx-card">
      <span class="rn-wx-code">${escapeHtml(icao)} <small>(${escapeHtml(label)})</small></span>
      ${
        raw
          ? `${isAtis ? `<span class="rn-recommended-badge" style="margin-left:0; margin-bottom:6px; display:inline-block;">Live ATIS</span>` : ""}<div class="rn-wx-raw">${escapeHtml(raw)}</div>`
          : `<div class="rn-wx-error">No current METAR available.</div>`
      }
    </div>`;
}

function saveActiveRoute(simbriefId, route, ofp) {
  const key = "prva-routedb-active-routes";
  const existing = JSON.parse(localStorage.getItem(key) || "[]");
  existing.unshift({
    simbrief_id: simbriefId,
    route_id: route.id,
    flight_number: route.flight_number,
    origin: route.origin?.icao,
    destination: route.destination?.icao,
    committed_at: new Date().toISOString(),
    ofp: ofp || null, // expects the summarized shape from simbrief.js's summarizeOfp(), not the raw OFP
  });
  let toStore = existing.slice(0, 20);
  while (toStore.length > 0) {
    try {
      localStorage.setItem(key, JSON.stringify(toStore));
      return;
    } catch {
      toStore = toStore.slice(0, -1);
    }
  }
}

function openSimbriefStep(route) {
  const allOptions = aircraftOptionsFor(route.aircraft_types);

  // Career Mode only (route.careerInfo is only ever set by career.js), and
  // domestic routes only -- A350s are PAL's international flagship, so
  // seeing one internationally isn't the rare event; seeing one on a
  // domestic route is. Plain route browsing isn't tied to "today" either
  // way, so it's never restricted.
  let options = allOptions;
  let unavailableToday = [];
  if (route.careerInfo && isDomesticRoute(route.origin?.country, route.destination?.country)) {
    const dateKey = airportLocalDateKey(route.origin?.icao);
    const occasional = occasionalIcaoCodes(route.notes);
    options = allOptions.filter((o) => isAircraftAvailableToday(route.id, dateKey, o.icao, occasional));
    unavailableToday = allOptions.filter((o) => !options.includes(o));
  }

  const container = document.getElementById("rnSbStep");

  if (!options.length) {
    container.innerHTML = `
      <div class="rn-modal-section">
        <h4>Fly This Route via SimBrief</h4>
        <p class="rn-sb-status error">No aircraft is available for this route today -- check back another day.</p>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div class="rn-modal-section">
      <h4>Fly This Route via SimBrief</h4>
      ${
        options.length > 1
          ? `<div class="rn-sb-field">
               <label for="rnSbAircraft">Aircraft</label>
               <select id="rnSbAircraft">
                 ${options.map((o, i) => `<option value="${i}">${escapeHtml(o.sourceName)} (${escapeHtml(o.icao)} / ${escapeHtml(o.reg || "no reg")})</option>`).join("")}
               </select>
             </div>`
          : ""
      }
      ${
        unavailableToday.length
          ? `<p style="font-size:12px; color:var(--muted); margin-top:6px;">Not offered today: ${unavailableToday.map((o) => escapeHtml(o.sourceName)).join(", ")} (occasional on this route).</p>`
          : ""
      }
      <div class="rn-sb-field">
        <label for="rnSbId">Your SimBrief Username</label>
        <input type="text" id="rnSbId" placeholder="e.g. your SimBrief username">
      </div>
      <div class="rn-modal-actions">
        <button type="button" class="btn btn-primary" id="rnSbFile">File This Route</button>
        <button type="button" class="btn btn-outline" id="rnSbFileManual">File This Route Manually</button>
      </div>
      <div class="rn-sb-status" id="rnSbStatus"></div>
      <div id="rnOfpResult"></div>
    </div>`;

  const status = document.getElementById("rnSbStatus");
  const fileBtn = document.getElementById("rnSbFile");
  const manualBtn = document.getElementById("rnSbFileManual");
  const aircraftSelect = document.getElementById("rnSbAircraft");

  function requireUsername() {
    const sbId = document.getElementById("rnSbId").value.trim();
    if (!sbId) {
      status.textContent = "Enter your SimBrief username first.";
      status.className = "rn-sb-status error";
      return null;
    }
    return sbId;
  }

  function selectedAircraft() {
    if (!options.length) return { icao: null, reg: null };
    const idx = aircraftSelect ? Number(aircraftSelect.value) : 0;
    return options[idx] || options[0];
  }

  fileBtn.addEventListener("click", async () => {
    const sbId = requireUsername();
    if (!sbId) return;
    const { icao, reg } = selectedAircraft();
    fileBtn.disabled = true;
    status.textContent = "Opening SimBrief -- log in there if prompted, the plan will generate automatically…";
    status.className = "rn-sb-status";
    try {
      const ofp = await generateViaPopup(
        {
          origin: route.origin?.icao,
          destination: route.destination?.icao,
          aircraftIcao: icao,
          reg,
          flightNumber: route.flight_number,
        },
        sbId
      );
      saveActiveRoute(sbId, route, summarizeOfp(ofp));
      status.textContent = "Flight plan generated and filed -- also saved to your Active Route page.";
      status.className = "rn-sb-status success";
      document.getElementById("rnOfpResult").innerHTML = ofpDetailHtml(ofp, "rnRouteMap");
      renderChartGallery("rnRouteMap", extractCharts(ofp));
    } catch (err) {
      console.error("RouteDB: SimBrief popup generation failed", err);
      status.textContent = err.message || "Couldn't generate a flight plan. Try File This Route Manually instead.";
      status.className = "rn-sb-status error";
    } finally {
      fileBtn.disabled = false;
    }
  });

  manualBtn.addEventListener("click", () => {
    const sbId = requireUsername();
    if (!sbId) return;
    const { icao, reg } = selectedAircraft();
    const url = buildDispatchUrl({
      origin: route.origin?.icao,
      destination: route.destination?.icao,
      aircraftIcao: icao,
      reg,
      flightNumber: route.flight_number,
    });
    window.open(url, "_blank", "noopener");
    saveActiveRoute(sbId, route);
    status.textContent = "Opened SimBrief with this route pre-filled -- generate your plan there, then check your Active Route page for status.";
    status.className = "rn-sb-status success";
  });
}

// Call once per page. Returns { openModal(route) } for grid click handlers
// to call; also wires up the overlay's own close button/backdrop/Escape.
export function initRouteModal() {
  const modalOverlay = document.getElementById("rnModalOverlay");
  const modalClose = document.getElementById("rnModalClose");
  const modalBody = document.getElementById("rnModalBody");

  function closeModal() {
    modalOverlay.classList.remove("open");
    modalBody.innerHTML = "";
  }

  function openModal(route) {
    const o = route.origin || {};
    const d = route.destination || {};
    modalBody.innerHTML = `
      <h2>${escapeHtml(route.flight_number)}</h2>
      <p class="rn-modal-sub">${escapeHtml(o.city)} (${escapeHtml(o.icao)}) &rarr; ${escapeHtml(d.city)} (${escapeHtml(d.icao)})</p>

      <div class="rn-modal-section">
        <h4>Flight Details</h4>
        <dl class="rn-detail-grid">
          <div><dt>Aircraft</dt><dd>${escapeHtml((route.aircraft_types || []).join(", ") || "—")}</dd></div>
          <div><dt>Distance</dt><dd>${route.distance_nm ? `${Math.round(route.distance_nm)} nm` : "—"}</dd></div>
          <div><dt>Flight Time</dt><dd>${formatTime(route.flight_time_minutes)}</dd></div>
          <div><dt>Airline</dt><dd>
            ${route.airline?.logo_url ? `<img class="rn-airline-logo" src="${escapeHtml(route.airline.logo_url)}" alt="">` : ""}
            ${route.airline ? escapeHtml(route.airline.name) : "—"}
          </dd></div>
          <div><dt>Livery</dt><dd>${escapeHtml((route.liveries || []).join(", ") || "—")}</dd></div>
          <div><dt>Category</dt><dd>${route.category === "historic" ? "Historic" : "Current"}</dd></div>
          ${route.careerInfo || ""}
        </dl>
        ${route.notes ? `<p style="margin-top:12px; font-size:13px; color:var(--muted);">${escapeHtml(route.notes)}</p>` : ""}
      </div>

      <div class="rn-modal-section">
        <h4>Current Weather</h4>
        <div class="rn-wx-grid" id="rnWxGrid">
          ${wxCardHtml(o.icao, "origin", null, true)}
          ${wxCardHtml(d.icao, "destination", null, true)}
        </div>
      </div>

      ${runwayNotesHtml(o, d)}

      ${route.claimContext ? `<div class="rn-modal-section" id="rnClaimSection"><h4>Claim This Flight</h4><p class="rn-sb-status" style="margin-top:0;">Loading…</p></div>` : ""}

      ${
        route.unavailableReason
          ? `<div class="rn-modal-section"><p class="rn-sb-status" style="margin-top:0;">${escapeHtml(route.unavailableReason)}</p></div>`
          : `<div class="rn-modal-actions">
               <button type="button" class="btn btn-primary" data-fly="${escapeHtml(route.id)}">Fly This Route</button>
             </div>
             <div id="rnSbStep"></div>`
      }
    `;
    modalOverlay.classList.add("open");

    Promise.all([fetchAirportWeather(o.icao), fetchAirportWeather(d.icao)]).then(([ow, dw]) => {
      const wxGrid = document.getElementById("rnWxGrid");
      if (wxGrid) wxGrid.innerHTML = wxCardHtml(o.icao, "origin", ow) + wxCardHtml(d.icao, "destination", dw);
    });

    if (route.claimContext) refreshClaimSection(route);

    modalBody.querySelector("[data-fly]")?.addEventListener("click", () => openSimbriefStep(route));
  }

  modalClose.addEventListener("click", closeModal);
  modalOverlay.addEventListener("click", (e) => { if (e.target === modalOverlay) closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

  return { openModal, closeModal };
}
