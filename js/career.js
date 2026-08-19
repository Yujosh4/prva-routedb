import { supabase } from "./supabase-client.js";
import { initRouteModal } from "./route-modal.js";

const grid = document.getElementById("rnGrid");
const filterCount = document.getElementById("rnFilterCount");
const searchInput = document.getElementById("rnSearch");
const originSelect = document.getElementById("rnOriginFilter");
const destinationSelect = document.getElementById("rnDestinationFilter");
const airlineSelect = document.getElementById("rnAirlineFilter");
const daySelect = document.getElementById("rnDayFilter");
const { openModal } = initRouteModal();

const DAY_NAMES = { 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat", 7: "Sun" };

let allEntries = [];
let usingSampleData = false;

const SAMPLE_ENTRIES = [
  {
    id: "sample-cs-1",
    departure_time_local: "06:15:00",
    days_of_week: [1, 2, 3, 4, 5, 6, 7],
    route: {
      id: "sample-1", flight_number: "PR102", aircraft_types: ["B777-300ER"], liveries: ["Philippine Airlines"],
      distance_nm: 6339, flight_time_minutes: 745, category: "current",
      origin: { icao: "RPLL", iata: "MNL", name: "Ninoy Aquino International", city: "Manila" },
      destination: { icao: "KLAX", iata: "LAX", name: "Los Angeles International", city: "Los Angeles" },
    },
    airline: { name: "Philippine Airlines", logo_url: null, is_mainline: true },
    min_rank: null,
  },
];

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

async function loadSchedule() {
  if (!supabase) {
    usingSampleData = true;
    return SAMPLE_ENTRIES;
  }
  try {
    const { data, error } = await supabase
      .from("career_schedules")
      .select(
        `id, departure_time_local, days_of_week, source, notes,
         route:routes(id, flight_number, aircraft_types, liveries, distance_nm, flight_time_minutes, category,
           origin:airports!routes_origin_icao_fkey(icao, iata, name, city),
           destination:airports!routes_destination_icao_fkey(icao, iata, name, city)),
         airline:airlines(name, logo_url, is_mainline),
         min_rank:ranks(name, sort_order)`
      )
      .eq("active", true)
      .order("departure_time_local");
    if (error) throw error;
    return (data || []).filter((e) => e.route); // drop any orphaned rows defensively
  } catch (err) {
    console.error("Career Mode: failed to load schedule", err);
    return null;
  }
}

function formatTime12h(hms) {
  const [h, m] = String(hms).split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

function formatDays(days) {
  if (!days || days.length === 7) return "Daily";
  return [...days].sort((a, b) => a - b).map((d) => DAY_NAMES[d]).join("/");
}

function formatFlightTime(minutes) {
  if (!minutes) return "—";
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function populateFilterOptions(entries) {
  const origins = new Map();
  const destinations = new Map();
  const airlines = new Set();
  const daysSeen = new Set();
  entries.forEach((e) => {
    if (e.route.origin) origins.set(e.route.origin.icao, e.route.origin);
    if (e.route.destination) destinations.set(e.route.destination.icao, e.route.destination);
    if (e.airline?.name) airlines.add(e.airline.name);
    (e.days_of_week || []).forEach((d) => daysSeen.add(d));
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
  airlineSelect.innerHTML = [
    `<option value="">Any airline</option>`,
    ...[...airlines].sort().map((a) => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`),
  ].join("");
  daySelect.innerHTML = [
    `<option value="">Any day</option>`,
    ...Object.entries(DAY_NAMES).filter(([d]) => daysSeen.has(Number(d))).map(([d, name]) => `<option value="${d}">${name}</option>`),
  ].join("");
}

function entryCardHtml(entry) {
  const r = entry.route;
  const o = r.origin || {};
  const d = r.destination || {};
  const airline = entry.airline;
  return `
    <article class="rn-card" data-id="${escapeHtml(entry.id)}">
      <div class="rn-card-top">
        <span class="rn-flight-num">
          ${airline?.logo_url ? `<img class="rn-airline-logo" src="${escapeHtml(airline.logo_url)}" alt="${escapeHtml(airline.name)}">` : ""}
          ${escapeHtml(r.flight_number)}
        </span>
        ${entry.min_rank ? `<span class="rn-codeshare-badge">${escapeHtml(entry.min_rank.name)}+</span>` : ""}
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
        <span class="rn-tag">${escapeHtml(formatTime12h(entry.departure_time_local))} local</span>
        <span class="rn-tag">${escapeHtml(formatDays(entry.days_of_week))}</span>
        <span class="rn-tag">${formatFlightTime(r.flight_time_minutes)}</span>
      </div>
      <div class="rn-card-actions">
        <button type="button" class="btn btn-outline" data-details="${escapeHtml(entry.id)}">More Details</button>
      </div>
    </article>`;
}

function applyFilters() {
  const q = searchInput.value.trim().toLowerCase();
  const origin = originSelect.value;
  const destination = destinationSelect.value;
  const airline = airlineSelect.value;
  const day = daySelect.value ? Number(daySelect.value) : null;

  const filtered = allEntries.filter((e) => {
    const r = e.route;
    if (origin && r.origin?.icao !== origin) return false;
    if (destination && r.destination?.icao !== destination) return false;
    if (airline && e.airline?.name !== airline) return false;
    if (day && !(e.days_of_week || []).includes(day)) return false;
    if (q) {
      const hay = [r.flight_number, r.origin?.icao, r.origin?.city, r.destination?.icao, r.destination?.city]
        .join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  renderGrid(filtered);
  filterCount.textContent = `${filtered.length} flight${filtered.length === 1 ? "" : "s"}`;
}

function renderGrid(entries) {
  if (entries === null) {
    grid.innerHTML = `<div class="rn-error">Couldn't load the schedule right now. Try refreshing in a moment.</div>`;
    return;
  }
  if (!entries.length) {
    grid.innerHTML = `<div class="rn-empty">No scheduled flights match those filters.</div>`;
    return;
  }
  grid.innerHTML = entries.map(entryCardHtml).join("");
}

grid.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-details]");
  if (!btn) return;
  const entry = allEntries.find((x) => String(x.id) === btn.dataset.details);
  if (!entry) return;

  // The shared modal (route-modal.js) works on plain route objects -- flatten
  // this schedule entry into that shape, adding a careerInfo block for the
  // extra schedule-specific fields it doesn't otherwise know about.
  const careerInfo = `
    <div><dt>Scheduled Departure</dt><dd>${escapeHtml(formatTime12h(entry.departure_time_local))} local</dd></div>
    <div><dt>Operates</dt><dd>${escapeHtml(formatDays(entry.days_of_week))}</dd></div>
    ${entry.min_rank ? `<div><dt>Minimum Rank</dt><dd>${escapeHtml(entry.min_rank.name)}</dd></div>` : ""}
  `;
  openModal({ ...entry.route, airline: entry.airline, careerInfo });
});

[searchInput, originSelect, destinationSelect, airlineSelect, daySelect].forEach((el) =>
  el.addEventListener("input", applyFilters)
);

(async function init() {
  const entries = await loadSchedule();
  if (entries === null) {
    renderGrid(null);
    return;
  }
  allEntries = entries;
  const banner = document.getElementById("rnSampleBanner");
  if (banner) banner.style.display = usingSampleData ? "block" : "none";
  populateFilterOptions(allEntries);
  applyFilters();
})();
