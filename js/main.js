import { supabase } from "./supabase-client.js";
import { fetchAirportWeather } from "./weather.js";

const grid = document.getElementById("rnGrid");
const filterCount = document.getElementById("rnFilterCount");
const searchInput = document.getElementById("rnSearch");
const originSelect = document.getElementById("rnOriginFilter");
const destinationSelect = document.getElementById("rnDestinationFilter");
const aircraftSelect = document.getElementById("rnAircraftFilter");
const modalOverlay = document.getElementById("rnModalOverlay");
const modalClose = document.getElementById("rnModalClose");
const modalBody = document.getElementById("rnModalBody");

let allRoutes = [];
let usingSampleData = false;

// Shown only when Supabase isn't configured yet (js/config.js is blank), so the
// UI is visually verifiable before the real project/schema exist. Same shape
// the live Supabase query below returns, so nothing else needs to change once
// real credentials land in config.js.
const SAMPLE_ROUTES = [
  {
    id: "sample-1",
    flight_number: "PR 103",
    distance_nm: 1339,
    flight_time_minutes: 195,
    aircraft_types: ["A321", "A320"],
    active: true,
    origin: { icao: "RPLL", iata: "MNL", name: "Ninoy Aquino International", city: "Manila" },
    destination: { icao: "RPVM", iata: "CEB", name: "Mactan-Cebu International", city: "Cebu" },
    codeshare_partners: null,
  },
  {
    id: "sample-2",
    flight_number: "PR 501",
    distance_nm: 6923,
    flight_time_minutes: 855,
    aircraft_types: ["A350-900"],
    active: true,
    origin: { icao: "RPLL", iata: "MNL", name: "Ninoy Aquino International", city: "Manila" },
    destination: { icao: "KLAX", iata: "LAX", name: "Los Angeles International", city: "Los Angeles" },
    codeshare_partners: null,
  },
  {
    id: "sample-3",
    flight_number: "5J 1234",
    distance_nm: 2417,
    flight_time_minutes: 320,
    aircraft_types: ["A330-300"],
    active: true,
    origin: { icao: "RPLL", iata: "MNL", name: "Ninoy Aquino International", city: "Manila" },
    destination: { icao: "RJTT", iata: "HND", name: "Tokyo Haneda", city: "Tokyo" },
    codeshare_partners: { name: "STARLUX Virtual Airlines", logo_url: null },
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
        `id, flight_number, distance_nm, flight_time_minutes, aircraft_types, notes, active,
         origin:airports!routes_origin_icao_fkey(icao, iata, name, city),
         destination:airports!routes_destination_icao_fkey(icao, iata, name, city),
         codeshare_partners(name, logo_url)`
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
  routes.forEach((r) => {
    if (r.origin) origins.set(r.origin.icao, r.origin);
    if (r.destination) destinations.set(r.destination.icao, r.destination);
    (r.aircraft_types || []).forEach((t) => aircraft.add(t));
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
  const codeshare = route.codeshare_partners;
  return `
    <article class="rn-card" data-id="${escapeHtml(route.id)}">
      <div class="rn-card-top">
        <span class="rn-flight-num">${escapeHtml(route.flight_number)}</span>
        ${codeshare ? `<span class="rn-codeshare-badge">${escapeHtml(codeshare.name)}</span>` : ""}
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

  const filtered = allRoutes.filter((r) => {
    if (origin && r.origin?.icao !== origin) return false;
    if (destination && r.destination?.icao !== destination) return false;
    if (aircraft && !(r.aircraft_types || []).includes(aircraft)) return false;
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
        <div><dt>Distance</dt><dd>${route.distance_nm ? `${route.distance_nm} nm` : "—"}</dd></div>
        <div><dt>Flight Time</dt><dd>${formatTime(route.flight_time_minutes)}</dd></div>
        <div><dt>Codeshare</dt><dd>${route.codeshare_partners ? escapeHtml(route.codeshare_partners.name) : "PRVA mainline"}</dd></div>
      </dl>
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

function openSimbriefStep(route) {
  const container = document.getElementById("rnSbStep");
  container.innerHTML = `
    <div class="rn-modal-section">
      <h4>Fly This Route via SimBrief</h4>
      <div class="rn-sb-field">
        <label for="rnSbId">Your SimBrief Pilot ID or Username</label>
        <input type="text" id="rnSbId" placeholder="e.g. your SimBrief username">
      </div>
      <button type="button" class="btn btn-primary" id="rnSbSubmit">Generate Flight Plan</button>
      <div class="rn-sb-status" id="rnSbStatus"></div>
    </div>`;

  document.getElementById("rnSbSubmit").addEventListener("click", async () => {
    const status = document.getElementById("rnSbStatus");
    const sbId = document.getElementById("rnSbId").value.trim();
    if (!sbId) {
      status.textContent = "Enter your SimBrief ID or username first.";
      status.className = "rn-sb-status error";
      return;
    }
    if (!supabase) {
      status.textContent = "SimBrief dispatch isn't connected yet -- this needs the Route DB's Supabase project to be live first.";
      status.className = "rn-sb-status error";
      return;
    }
    status.textContent = "Generating flight plan…";
    status.className = "rn-sb-status";
    try {
      const { data, error } = await supabase.functions.invoke("simbrief-dispatch", {
        body: {
          simbrief_id: sbId,
          origin: route.origin?.icao,
          destination: route.destination?.icao,
          aircraft: route.aircraft_types?.[0],
          flight_number: route.flight_number,
        },
      });
      if (error) throw error;
      status.textContent = "Flight plan generated -- check your Active Route page.";
      status.className = "rn-sb-status success";
      saveActiveRoute(sbId, route, data);
    } catch (err) {
      console.error("RouteDB: SimBrief dispatch failed", err);
      status.textContent = "Couldn't reach SimBrief dispatch. Try again in a moment.";
      status.className = "rn-sb-status error";
    }
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
    ofp: ofp || null,
  });
  localStorage.setItem(key, JSON.stringify(existing.slice(0, 20)));
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

[searchInput, originSelect, destinationSelect, aircraftSelect].forEach((el) =>
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
