import { supabase } from "./supabase-client.js";
import { initRouteModal } from "./route-modal.js";
import { initThemeToggle } from "./theme.js";

initThemeToggle();

const grid = document.getElementById("rnGrid");
const filterCount = document.getElementById("rnFilterCount");
const searchInput = document.getElementById("rnSearch");
const originSelect = document.getElementById("rnOriginFilter");
const destinationSelect = document.getElementById("rnDestinationFilter");
const aircraftSelect = document.getElementById("rnAircraftFilter");
const airlineSelect = document.getElementById("rnAirlineFilter");
const categorySelect = document.getElementById("rnCategoryFilter");
const { openModal } = initRouteModal();

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
         origin:airports!routes_origin_icao_fkey(icao, iata, name, city, runway_notes),
         destination:airports!routes_destination_icao_fkey(icao, iata, name, city, runway_notes),
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

grid.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-details]");
  if (!btn) return;
  const route = allRoutes.find((r) => String(r.id) === btn.dataset.details);
  if (route) openModal(route);
});

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
