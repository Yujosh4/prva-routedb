import { supabase } from "./supabase-client.js";
import { fetchAirportWeather } from "./weather.js";
import { buildDispatchUrl, generateViaPopup, summarizeOfp, aircraftOptionsFor } from "./simbrief.js";
import { renderChartGallery, extractCharts } from "./route-map.js";

const grid = document.getElementById("rnGrid");
const filterCount = document.getElementById("rnFilterCount");
const searchInput = document.getElementById("rnSearch");
const originSelect = document.getElementById("rnOriginFilter");
const destinationSelect = document.getElementById("rnDestinationFilter");
const aircraftSelect = document.getElementById("rnAircraftFilter");
const airlineSelect = document.getElementById("rnAirlineFilter");
const categorySelect = document.getElementById("rnCategoryFilter");
const modalOverlay = document.getElementById("rnModalOverlay");
const modalClose = document.getElementById("rnModalClose");
const modalBody = document.getElementById("rnModalBody");

let allRoutes = [];
let usingSampleData = false;

// Shown only when Supabase isn't configured yet, so the UI stays visually
// verifiable without a live project. Same shape the real Supabase query
// below returns, so nothing else needs to change once it's live.
const SAMPLE_ROUTES = [
  {
    id: "sample-1",
    flight_number: "PR103",
    distance_nm: 1339,
    flight_time_minutes: 195,
    aircraft_types: ["A321", "A320"],
    liveries: ["Philippine Airlines"],
    category: "current",
    active: true,
    origin: { icao: "RPLL", iata: "MNL", name: "Ninoy Aquino International", city: "Manila" },
    destination: { icao: "RPVM", iata: "CEB", name: "Mactan-Cebu International", city: "Cebu" },
    airline: { name: "Philippine Airlines", logo_url: null, is_mainline: true },
  },
  {
    id: "sample-2",
    flight_number: "PR501",
    distance_nm: 6923,
    flight_time_minutes: 855,
    aircraft_types: ["A350-900"],
    liveries: ["Philippine Airlines"],
    category: "current",
    active: true,
    origin: { icao: "RPLL", iata: "MNL", name: "Ninoy Aquino International", city: "Manila" },
    destination: { icao: "KLAX", iata: "LAX", name: "Los Angeles International", city: "Los Angeles" },
    airline: { name: "Philippine Airlines", logo_url: null, is_mainline: true },
  },
  {
    id: "sample-3",
    flight_number: "PR102H (A)",
    distance_nm: 2417,
    flight_time_minutes: 340,
    aircraft_types: ["MD-11", "DC-10"],
    liveries: ["Philippine Airlines", "Generic"],
    category: "historic",
    active: true,
    origin: { icao: "KSFO", iata: "SFO", name: "San Francisco International", city: "San Francisco" },
    destination: { icao: "PHNL", iata: "HNL", name: "Daniel K. Inouye International", city: "Honolulu" },
    airline: { name: "Philippine Airlines", logo_url: null, is_mainline: true },
  },
  {
    id: "sample-4",
    flight_number: "5J1234",
    distance_nm: 2417,
    flight_time_minutes: 320,
    aircraft_types: ["A330-300"],
    liveries: ["STARLUX Virtual Airlines"],
    category: "current",
    active: true,
    origin: { icao: "RPLL", iata: "MNL", name: "Ninoy Aquino International", city: "Manila" },
    destination: { icao: "RJTT", iata: "HND", name: "Tokyo Haneda", city: "Tokyo" },
    airline: { name: "STARLUX Virtual Airlines", logo_url: null, is_mainline: false },
  },
];

async function loadRoutes() {
  if (!supabase) {
    usingSampleData = true;
    return SAMPLE_ROUTES;
  }
  try {
    const { data, error } = await supabase
      .from("routes")
      .select(
        `id, flight_number, distance_nm, flight_time_minutes, aircraft_types, liveries, notes, active, category,
         origin:airports!routes_origin_icao_fkey(icao, iata, name, city),
         destination:airports!routes_destination_icao_fkey(icao, iata, name, city),
         airline:airlines(name, logo_url, is_mainline)`
      )
      .eq("active", true)
      .order("flight_number");
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error("RouteDB: failed to load routes", err);
    return null; // distinct from [] -- signals a real error, not just "no routes yet"
  }
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function populateFilterOptions(routes) {
  const origins = new Map();
  const destinations = new Map();
  const aircraft = new Set();
  const airlines = new Set();
  routes.forEach((r) => {
    if (r.origin) origins.set(r.origin.icao, r.origin);
    if (r.destination) destinations.set(r.destination.icao, r.destination);
    (r.aircraft_types || []).forEach((t) => aircraft.add(t));
    if (r.airline?.name) airlines.add(r.airline.name);
  });

  const fillSelect = (select, map, placeholder) => {
    const options = [`<option value="">${placeholder}</option>`];
    [...map.values()]
      .sort((a, b) => a.city.localeCompare(b.city))
      .forEach((a) => options.push(`<option value="${a.icao}">${escapeHtml(a.city)} (${a.icao})</option>`));
    select.innerHTML = options.join("");
  };

  fillSelect(originSelect, origins, "Any origin");
  fillSelect(destinationSelect, destinations, "Any destination");
  aircraftSelect.innerHTML = [
    `<option value="">Any aircraft</option>`,
    ...[...aircraft].sort().map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`),
  ].join("");
  airlineSelect.innerHTML = [
    `<option value="">Any airline</option>`,
    ...[...airlines].sort().map((a) => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`),
  ].join("");
}

function formatTime(minutes) {
  if (!minutes) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

function routeCardHtml(route) {
  const o = route.origin || {};
  const d = route.destination || {};
  const airline = route.airline;
  const isCodeshare = airline && !airline.is_mainline;
  return `
    <article class="rn-card" data-id="${escapeHtml(route.id)}">
      <div class="rn-card-top">
        <span class="rn-flight-num">
          ${airline?.logo_url ? `<img class="rn-airline-logo" src="${escapeHtml(airline.logo_url)}" alt="${escapeHtml(airline.name)}">` : ""}
          ${escapeHtml(route.flight_number)}
        </span>
        ${isCodeshare ? `<span class="rn-codeshare-badge">${escapeHtml(airline.name)}</span>` : ""}
        ${route.category === "historic" ? `<span class="rn-codeshare-badge">Historic</span>` : ""}
      </div>
      <div class="rn-route-line">
        <span class="rn-code">${escapeHtml(o.icao)}</span>
        <span class="rn-arrow">&#9992;</span>
        <span class="rn-code">${escapeHtml(d.icao)}</span>
      </div>
      <div class="rn-card-meta">
        <span class="rn-city">${escapeHtml(o.city)} &rarr; ${escapeHtml(d.city)}</span>
      </div>
      <div class="rn-card-meta">
        ${(route.aircraft_types || []).map((t) => `<span class="rn-tag">${escapeHtml(t)}</span>`).join("")}
        <span class="rn-tag">${formatTime(route.flight_time_minutes)}</span>
      </div>
      <div class="rn-card-actions">
        <button type="button" class="btn btn-outline" data-details="${escapeHtml(route.id)}">More Details</button>
      </div>
    </article>`;
}

function applyFilters() {
  const q = searchInput.value.trim().toLowerCase();
  const origin = originSelect.value;
  const destination = destinationSelect.value;
  const aircraft = aircraftSelect.value;
  const airline = airlineSelect.value;
  const category = categorySelect.value; // "current" (default) | "historic" | ""(all)

  const filtered = allRoutes.filter((r) => {
    if (category && r.category !== category) return false;
    if (origin && r.origin?.icao !== origin) return false;
    if (destination && r.destination?.icao !== destination) return false;
    if (aircraft && !(r.aircraft_types || []).includes(aircraft)) return false;
    if (airline && r.airline?.name !== airline) return false;
    if (q) {
      const hay = [
        r.flight_number, r.origin?.icao, r.origin?.city, r.destination?.icao, r.destination?.city,
      ].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  renderGrid(filtered);
  filterCount.textContent = `${filtered.length} route${filtered.length === 1 ? "" : "s"}`;
}

function renderGrid(routes) {
  if (routes === null) {
    grid.innerHTML = `<div class="rn-error">Couldn't load routes right now. Try refreshing in a moment.</div>`;
    return;
  }
  if (!routes.length) {
    grid.innerHTML = `<div class="rn-empty">No routes match those filters.</div>`;
    return;
  }
  grid.innerHTML = routes.map(routeCardHtml).join("");
}

function wxCardHtml(icao, label, wx, loading) {
  if (loading) return `<div class="rn-wx-card"><span class="rn-wx-code">${escapeHtml(icao)}</span><div class="rn-wx-loading">Loading weather…</div></div>`;
  const raw = wx?.metar?.rawOb || wx?.metar?.raw_text;
  return `
    <div class="rn-wx-card">
      <span class="rn-wx-code">${escapeHtml(icao)} <small>(${escapeHtml(label)})</small></span>
      ${raw ? `<div class="rn-wx-raw">${escapeHtml(raw)}</div>` : `<div class="rn-wx-error">No current METAR available.</div>`}
    </div>`;
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

    <div class="rn-modal-actions">
      <button type="button" class="btn btn-primary" data-fly="${escapeHtml(route.id)}">Fly This Route</button>
    </div>
    <div id="rnSbStep"></div>
  `;
  modalOverlay.classList.add("open");

  Promise.all([fetchAirportWeather(o.icao), fetchAirportWeather(d.icao)]).then(([ow, dw]) => {
    const wxGrid = document.getElementById("rnWxGrid");
    if (wxGrid) wxGrid.innerHTML = wxCardHtml(o.icao, "origin", ow) + wxCardHtml(d.icao, "destination", dw);
  });

  modalBody.querySelector("[data-fly]")?.addEventListener("click", () => openSimbriefStep(route));
}

function hms(str) {
  const m = String(str || "").match(/^(\d+):(\d{2}):\d{2}$/);
  return m ? `${m[1]}h ${m[2]}m` : null;
}

function fmtNum(n) {
  const num = Number(n);
  return isFinite(num) ? num.toLocaleString() : null;
}

function detailRow(label, value) {
  return value != null && value !== "" ? `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>` : "";
}

// All field names below (crew, weights, fuel, atc, params.units, etc.) are
// confirmed against a real generated OFP, not guessed.
// tlr.takeoff/landing each list every candidate runway at the airport, with
// v-speeds only populated for the ones actually viable in current wind --
// the one matching conditions.planned_runway is the one SimBrief actually
// used, confirmed against a real response (V1/VR/V2 present there, blank
// on non-viable runways).
function plannedRunway(phase) {
  const planned = phase?.conditions?.planned_runway;
  const runways = phase?.runway || [];
  return runways.find((r) => r.identifier === planned) || null;
}

function ofpResultHtml(ofp) {
  const aircraft = ofp?.aircraft?.icaocode || ofp?.aircraft?.name;
  const reg = ofp?.aircraft?.reg;
  const units = ofp?.params?.units === "lbs" ? "lb" : "kg";
  const w = ofp?.weights || {};
  const f = ofp?.fuel || {};
  const toRwy = plannedRunway(ofp?.tlr?.takeoff);
  const ldRwy = plannedRunway(ofp?.tlr?.landing);

  return `
    <div class="rn-modal-section">
      <h4>Flight Info</h4>
      <dl class="rn-detail-grid">
        ${detailRow("Callsign", ofp?.atc?.callsign)}
        ${detailRow("Aircraft", [aircraft, reg].filter(Boolean).join(" / "))}
        ${detailRow("Departure Rwy", ofp?.origin?.plan_rwy)}
        ${detailRow("Arrival Rwy", ofp?.destination?.plan_rwy)}
        ${detailRow("Cruise Altitude", ofp?.general?.initial_altitude ? `FL${Math.round(ofp.general.initial_altitude / 100)}` : null)}
        ${detailRow("Cruise Mach", ofp?.general?.cruise_mach)}
        ${detailRow("Distance", ofp?.general?.gc_distance ? `${fmtNum(ofp.general.gc_distance)} nm` : null)}
        ${detailRow("Passengers", ofp?.general?.passengers)}
      </dl>
    </div>

    <div class="rn-modal-section">
      <h4>Flight Plan Summary <span class="rn-recommended-badge">Recommended</span></h4>
      <p style="font-size:11px; color:var(--muted); margin-top:-6px; margin-bottom:10px;">No specific routing was forced -- SimBrief computed this route itself based on current winds aloft.</p>
      <dl class="rn-detail-grid">
        ${detailRow("Route", ofp?.general?.route)}
        ${detailRow("Block Time", hms(ofp?.times?.est_time_enroute))}
        ${detailRow("Ramp Fuel", f.plan_ramp ? `${fmtNum(f.plan_ramp)} ${units}` : null)}
        ${detailRow("Takeoff Fuel", f.plan_takeoff ? `${fmtNum(f.plan_takeoff)} ${units}` : null)}
        ${detailRow("Trip Fuel (burn)", f.enroute_burn ? `${fmtNum(f.enroute_burn)} ${units}` : null)}
      </dl>
    </div>

    <div class="rn-modal-section">
      <h4>Load Sheet</h4>
      <dl class="rn-detail-grid">
        ${detailRow("Zero Fuel Weight", w.est_zfw ? `${fmtNum(w.est_zfw)} / ${fmtNum(w.max_zfw)} ${units}` : null)}
        ${detailRow("Takeoff Weight", w.est_tow ? `${fmtNum(w.est_tow)} / ${fmtNum(w.max_tow)} ${units}` : null)}
        ${detailRow("Landing Weight", w.est_ldw ? `${fmtNum(w.est_ldw)} / ${fmtNum(w.max_ldw)} ${units}` : null)}
        ${detailRow("Payload", w.payload ? `${fmtNum(w.payload)} ${units}` : null)}
        ${detailRow("Cargo", w.cargo ? `${fmtNum(w.cargo)} ${units}` : null)}
        ${detailRow("Ramp Weight", w.est_ramp ? `${fmtNum(w.est_ramp)} ${units}` : null)}
      </dl>
      <p style="margin-top:10px; font-size:11px; color:var(--muted);">Est / Max shown where applicable.</p>
    </div>

    ${
      toRwy?.speeds_v1 || ldRwy
        ? `<div class="rn-modal-section">
            <h4>V-Speeds</h4>
            <dl class="rn-detail-grid">
              ${detailRow("Takeoff Runway", toRwy?.identifier)}
              ${detailRow("V1", toRwy?.speeds_v1 ? `${toRwy.speeds_v1} kts` : null)}
              ${detailRow("VR", toRwy?.speeds_vr ? `${toRwy.speeds_vr} kts` : null)}
              ${detailRow("V2", toRwy?.speeds_v2 ? `${toRwy.speeds_v2} kts` : null)}
              ${detailRow(toRwy?.speeds_other_id, toRwy?.speeds_other ? `${toRwy.speeds_other} kts` : null)}
              ${detailRow("Landing Runway", ldRwy?.identifier)}
              ${detailRow("Vref", ldRwy?.speeds_vref ? `${ldRwy.speeds_vref} kts` : null)}
            </dl>
            <p style="margin-top:10px; font-size:11px; color:var(--muted);">From SimBrief's takeoff/landing performance report for the planned runway.</p>
          </div>`
        : ""
    }

    <div class="rn-modal-section">
      <h4>Charts</h4>
      <div id="rnRouteMap"></div>
    </div>`;
}

function openSimbriefStep(route) {
  const options = aircraftOptionsFor(route.aircraft_types);
  const container = document.getElementById("rnSbStep");
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
      document.getElementById("rnOfpResult").innerHTML = ofpResultHtml(ofp);
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
  // Defensive: even summarized entries could theoretically add up. Drop the
  // oldest ones and retry rather than losing this write outright.
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

function closeModal() {
  modalOverlay.classList.remove("open");
  modalBody.innerHTML = "";
}

grid.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-details]");
  if (!btn) return;
  const route = allRoutes.find((r) => String(r.id) === btn.dataset.details);
  if (route) openModal(route);
});

modalClose.addEventListener("click", closeModal);
modalOverlay.addEventListener("click", (e) => { if (e.target === modalOverlay) closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

[searchInput, originSelect, destinationSelect, aircraftSelect, airlineSelect, categorySelect].forEach((el) =>
  el.addEventListener("input", applyFilters)
);

(async function init() {
  const routes = await loadRoutes();
  if (routes === null) {
    renderGrid(null);
    return;
  }
  allRoutes = routes;
  const banner = document.getElementById("rnSampleBanner");
  if (banner) banner.style.display = usingSampleData ? "block" : "none";
  populateFilterOptions(allRoutes);
  applyFilters();
})();
