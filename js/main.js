import { supabase } from "./supabase-client.js";
import { fetchAirportWeather } from "./weather.js";
import { buildDispatchUrl, generateViaPopup, summarizeOfp } from "./simbrief.js";
import { renderRouteMap, extractRoutePoints } from "./route-map.js";

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

function ofpResultHtml(ofp) {
  const aircraft = ofp?.aircraft?.icaocode || ofp?.aircraft?.name;
  const route = ofp?.general?.route;
  const block = ofp?.times?.est_time_enroute
    ? `${Math.floor(ofp.times.est_time_enroute / 3600)}h ${Math.round((ofp.times.est_time_enroute % 3600) / 60)}m`
    : null;
  return `
    <div class="rn-modal-section">
      <h4>Your Flight Plan</h4>
      <dl class="rn-detail-grid">
        ${aircraft ? `<div><dt>Aircraft</dt><dd>${escapeHtml(aircraft)}</dd></div>` : ""}
        ${route ? `<div><dt>Route</dt><dd>${escapeHtml(route)}</dd></div>` : ""}
        ${block ? `<div><dt>Block Time</dt><dd>${block}</dd></div>` : ""}
      </dl>
      <div id="rnRouteMap" class="rn-route-map" style="margin-top:12px;"></div>
      <details style="margin-top:10px;">
        <summary style="cursor:pointer; color:var(--muted); font-size:12px;">Raw OFP data</summary>
        <pre style="white-space:pre-wrap; word-break:break-word; font-size:11px; margin-top:6px;">${escapeHtml(JSON.stringify(ofp, null, 2))}</pre>
      </details>
    </div>`;
}

function openSimbriefStep(route) {
  const container = document.getElementById("rnSbStep");
  container.innerHTML = `
    <div class="rn-modal-section">
      <h4>Fly This Route via SimBrief</h4>
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

  function requireUsername() {
    const sbId = document.getElementById("rnSbId").value.trim();
    if (!sbId) {
      status.textContent = "Enter your SimBrief username first.";
      status.className = "rn-sb-status error";
      return null;
    }
    return sbId;
  }

  fileBtn.addEventListener("click", async () => {
    const sbId = requireUsername();
    if (!sbId) return;
    fileBtn.disabled = true;
    status.textContent = "Opening SimBrief -- log in there if prompted, the plan will generate automatically…";
    status.className = "rn-sb-status";
    try {
      const ofp = await generateViaPopup(
        {
          origin: route.origin?.icao,
          destination: route.destination?.icao,
          aircraftTypes: route.aircraft_types,
          flightNumber: route.flight_number,
        },
        sbId
      );
      saveActiveRoute(sbId, route, summarizeOfp(ofp));
      status.textContent = "Flight plan generated and filed -- also saved to your Active Route page.";
      status.className = "rn-sb-status success";
      document.getElementById("rnOfpResult").innerHTML = ofpResultHtml(ofp);
      const mapped = renderRouteMap("rnRouteMap", extractRoutePoints(ofp));
      if (!mapped) document.getElementById("rnRouteMap").outerHTML = "";
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
    const url = buildDispatchUrl({
      origin: route.origin?.icao,
      destination: route.destination?.icao,
      aircraftTypes: route.aircraft_types,
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
