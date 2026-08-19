import { supabase } from "./supabase-client.js";
import { initRouteModal } from "./route-modal.js";
import { minutesToEffectiveDeparture, urgencyClass, formatCountdown } from "./career-time.js";

const grid = document.getElementById("rnGrid");
const filterCount = document.getElementById("rnFilterCount");
const searchInput = document.getElementById("rnSearch");
const originSelect = document.getElementById("rnOriginFilter");
const destinationSelect = document.getElementById("rnDestinationFilter");
const airlineSelect = document.getElementById("rnAirlineFilter");
const daySelect = document.getElementById("rnDayFilter");
const { openModal } = initRouteModal();

const viewCalendarBtn = document.getElementById("viewCalendarBtn");
const viewListBtn = document.getElementById("viewListBtn");
const calMonthNav = document.getElementById("calMonthNav");
const calMonthLabel = document.getElementById("calMonthLabel");
const calPrevBtn = document.getElementById("calPrevBtn");
const calNextBtn = document.getElementById("calNextBtn");
const calendarView = document.getElementById("calendarView");
const calGrid = document.getElementById("calGrid");
const calDayModalOverlay = document.getElementById("calDayModalOverlay");
const calDayModalClose = document.getElementById("calDayModalClose");
const calDayModalBody = document.getElementById("calDayModalBody");

const DAY_NAMES = { 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat", 7: "Sun" };
const WEEKDAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_CHIPS_PER_DAY = 3;

let allEntries = [];
let usingSampleData = false;
let view = "calendar"; // "calendar" | "list"
let calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

const SAMPLE_ENTRIES = [
  {
    id: "sample-cs-1",
    departure_time_local: "06:15:00",
    days_of_week: [1, 2, 3, 4, 5, 6, 7],
    gate: "24", terminal: "2",
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
        `id, departure_time_local, days_of_week, gate, terminal, source, notes,
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

// Only returns a value when this entry operates on the origin airport's
// current local weekday -- a countdown to a day that isn't "today" there
// isn't meaningful, so it's simply omitted rather than shown wrong.
function entryCountdownMinutes(entry) {
  return minutesToEffectiveDeparture(entry.route.origin?.icao, entry.departure_time_local, entry.days_of_week);
}

function countdownBadgeHtml(entry) {
  const minutes = entryCountdownMinutes(entry);
  if (minutes === null) return "";
  return `<span class="rn-tag cal-urgency-tag ${urgencyClass(minutes)}">${escapeHtml(formatCountdown(minutes))}</span>`;
}

function gateTerminalHtml(entry) {
  if (!entry.gate && !entry.terminal) return "";
  const parts = [];
  if (entry.terminal) parts.push(`Terminal ${escapeHtml(entry.terminal)}`);
  if (entry.gate) parts.push(`Gate ${escapeHtml(entry.gate)}`);
  return `<span class="rn-tag">${parts.join(" &middot; ")}</span>`;
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
        ${gateTerminalHtml(entry)}
        ${countdownBadgeHtml(entry)}
      </div>
      <div class="rn-card-actions">
        <button type="button" class="btn btn-outline" data-details="${escapeHtml(entry.id)}">More Details</button>
      </div>
    </article>`;
}

function getFilteredEntries() {
  const q = searchInput.value.trim().toLowerCase();
  const origin = originSelect.value;
  const destination = destinationSelect.value;
  const airline = airlineSelect.value;
  const day = daySelect.value ? Number(daySelect.value) : null;

  return allEntries.filter((e) => {
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
}

function openEntryDetails(entry) {
  // The shared modal (route-modal.js) works on plain route objects -- flatten
  // this schedule entry into that shape, adding a careerInfo block for the
  // extra schedule-specific fields it doesn't otherwise know about.
  const minutes = entryCountdownMinutes(entry);
  const careerInfo = `
    <div><dt>Scheduled Departure</dt><dd>${escapeHtml(formatTime12h(entry.departure_time_local))} local</dd></div>
    <div><dt>Operates</dt><dd>${escapeHtml(formatDays(entry.days_of_week))}</dd></div>
    ${entry.terminal ? `<div><dt>Terminal</dt><dd>${escapeHtml(entry.terminal)}</dd></div>` : ""}
    ${entry.gate ? `<div><dt>Gate</dt><dd>${escapeHtml(entry.gate)}</dd></div>` : ""}
    ${minutes !== null ? `<div><dt>Countdown</dt><dd class="${urgencyClass(minutes)}">${escapeHtml(formatCountdown(minutes))} (incl. 5min buffer)</dd></div>` : ""}
    ${entry.min_rank ? `<div><dt>Minimum Rank</dt><dd>${escapeHtml(entry.min_rank.name)}</dd></div>` : ""}
  `;
  openModal({ ...entry.route, airline: entry.airline, careerInfo });
}

// ---------- List view ----------
function renderList() {
  const filtered = getFilteredEntries();
  if (allEntries === null) {
    grid.innerHTML = `<div class="rn-error">Couldn't load the schedule right now. Try refreshing in a moment.</div>`;
    return;
  }
  if (!filtered.length) {
    grid.innerHTML = `<div class="rn-empty">No scheduled flights match those filters.</div>`;
    filterCount.textContent = "0 flights";
    return;
  }
  grid.innerHTML = filtered.map(entryCardHtml).join("");
  filterCount.textContent = `${filtered.length} flight${filtered.length === 1 ? "" : "s"}`;
}

grid.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-details]");
  if (!btn) return;
  const entry = allEntries.find((x) => String(x.id) === btn.dataset.details);
  if (entry) openEntryDetails(entry);
});

// ---------- Calendar view ----------
// ISO weekday: 1=Monday .. 7=Sunday, matching career_schedules.days_of_week.
function isoWeekday(date) {
  const d = date.getDay(); // 0=Sunday..6=Saturday
  return d === 0 ? 7 : d;
}

function renderCalendar() {
  const filtered = getFilteredEntries();
  filterCount.textContent = `${filtered.length} flight${filtered.length === 1 ? "" : "s"} this filter`;

  const year = calMonth.getFullYear();
  const month = calMonth.getMonth();
  calMonthLabel.textContent = calMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const firstOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = isoWeekday(firstOfMonth) - 1; // days before the 1st to pad the grid

  const today = new Date();
  const isToday = (day) => today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;

  let html = WEEKDAY_HEADERS.map((w) => `<div class="cal-weekday">${w}</div>`).join("");

  for (let i = 0; i < leadingBlanks; i++) {
    html += `<div class="cal-day cal-day-empty"></div>`;
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const weekday = isoWeekday(new Date(year, month, day));
    const dayEntries = filtered
      .filter((e) => (e.days_of_week || []).includes(weekday))
      .sort((a, b) => a.departure_time_local.localeCompare(b.departure_time_local));
    const todayCell = isToday(day);

    // On today's cell specifically, the 3 visible slots should be whichever
    // flights are actually still relevant -- not just whichever happen to
    // have the earliest clock time, which as the day goes on increasingly
    // means "already departed hours ago" while the flights someone might
    // actually want to fly sit buried behind "+N more".
    const displayOrder = todayCell
      ? [...dayEntries].sort((a, b) => {
          const ma = entryCountdownMinutes(a);
          const mb = entryCountdownMinutes(b);
          const aDeparted = ma !== null && ma <= 0;
          const bDeparted = mb !== null && mb <= 0;
          if (aDeparted !== bDeparted) return aDeparted ? 1 : -1;
          return a.departure_time_local.localeCompare(b.departure_time_local);
        })
      : dayEntries;

    const visible = displayOrder.slice(0, MAX_CHIPS_PER_DAY);
    const overflow = dayEntries.length - visible.length;

    html += `
      <div class="cal-day ${todayCell ? "cal-day-today" : ""} ${dayEntries.length ? "cal-has-flights" : ""}" ${dayEntries.length ? `data-daycell="${weekday}"` : ""}>
        <span class="cal-day-num">${day}</span>
        <div class="cal-day-flights">
          ${visible
            .map((e) => {
              // Only "today" at the airport's own clock earns urgency styling --
              // matching weekday on some other week of the month must not.
              // Kept as a slim left-border accent (not a full background fill)
              // and no inline countdown text, so a busy day doesn't read as a
              // wall of red -- the full countdown is one click away.
              const minutes = todayCell ? entryCountdownMinutes(e) : null;
              const cls = minutes !== null ? urgencyClass(minutes) : "";
              const title = minutes !== null
                ? `${e.route.flight_number} ${formatTime12h(e.departure_time_local)} -- ${formatCountdown(minutes)}`
                : `${e.route.flight_number} ${formatTime12h(e.departure_time_local)}`;
              return `<span class="cal-flight-chip ${cls}" data-entry="${escapeHtml(e.id)}" title="${escapeHtml(title)}">${escapeHtml(e.route.flight_number)} ${escapeHtml(formatTime12h(e.departure_time_local))}</span>`;
            })
            .join("")}
          ${overflow > 0 ? `<span class="cal-day-more" data-daylist="${weekday}">+${overflow} more</span>` : ""}
        </div>
      </div>`;
  }

  calGrid.innerHTML = html;

  calGrid.querySelectorAll("[data-entry]").forEach((chip) => {
    chip.addEventListener("click", (e) => {
      e.stopPropagation();
      const entry = allEntries.find((x) => String(x.id) === chip.dataset.entry);
      if (entry) openEntryDetails(entry);
    });
  });

  calGrid.querySelectorAll("[data-daylist]").forEach((moreLink) => {
    moreLink.addEventListener("click", (e) => {
      e.stopPropagation();
      const weekday = Number(moreLink.dataset.daylist);
      const dayEntries = filtered
        .filter((e) => (e.days_of_week || []).includes(weekday))
        .sort((a, b) => a.departure_time_local.localeCompare(b.departure_time_local));
      openDayListModal(DAY_NAMES[weekday], dayEntries);
    });
  });

  // Whole day cell is clickable -- opens the full day list, same as "+N
  // more" used to. The chip/more-link handlers above stop propagation so
  // clicking one of those doesn't also trigger this.
  calGrid.querySelectorAll("[data-daycell]").forEach((cell) => {
    cell.addEventListener("click", () => {
      const weekday = Number(cell.dataset.daycell);
      const dayEntries = filtered
        .filter((e) => (e.days_of_week || []).includes(weekday))
        .sort((a, b) => a.departure_time_local.localeCompare(b.departure_time_local));
      openDayListModal(DAY_NAMES[weekday], dayEntries);
    });
  });
}

function openDayListModal(dayLabel, entries) {
  calDayModalBody.innerHTML = `
    <h2>${escapeHtml(dayLabel)}'s Flights</h2>
    <div class="rn-modal-section">
      ${entries
        .map((e) => {
          const minutes = entryCountdownMinutes(e);
          const gt = [e.terminal ? `T${e.terminal}` : "", e.gate ? `Gate ${e.gate}` : ""].filter(Boolean).join(" / ");
          return `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid var(--line);">
          <div>
            <strong>${escapeHtml(e.route.flight_number)}</strong>
            <span style="color:var(--muted); font-size:13px;"> -- ${escapeHtml(e.route.origin?.icao)} &rarr; ${escapeHtml(e.route.destination?.icao)}</span>
            ${gt ? `<span style="color:var(--muted); font-size:12px; display:block;">${escapeHtml(gt)}</span>` : ""}
          </div>
          <div style="display:flex; align-items:center; gap:10px;">
            ${minutes !== null ? `<span class="rn-tag cal-urgency-tag ${urgencyClass(minutes)}">${escapeHtml(formatCountdown(minutes))}</span>` : ""}
            <span style="font-size:13px;">${escapeHtml(formatTime12h(e.departure_time_local))}</span>
            <button type="button" class="btn btn-outline" data-daylist-entry="${escapeHtml(e.id)}">Details</button>
          </div>
        </div>`;
        })
        .join("")}
    </div>`;
  calDayModalOverlay.classList.add("open");

  calDayModalBody.querySelectorAll("[data-daylist-entry]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const entry = allEntries.find((x) => String(x.id) === btn.dataset.daylistEntry);
      closeDayListModal();
      if (entry) openEntryDetails(entry);
    });
  });
}

function closeDayListModal() {
  calDayModalOverlay.classList.remove("open");
  calDayModalBody.innerHTML = "";
}

calDayModalClose.addEventListener("click", closeDayListModal);
calDayModalOverlay.addEventListener("click", (e) => { if (e.target === calDayModalOverlay) closeDayListModal(); });

calPrevBtn.addEventListener("click", () => {
  calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1);
  renderCalendar();
});
calNextBtn.addEventListener("click", () => {
  calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1);
  renderCalendar();
});

// ---------- View switching ----------
function setView(next) {
  view = next;
  viewCalendarBtn.dataset.active = String(view === "calendar");
  viewListBtn.dataset.active = String(view === "list");
  calendarView.style.display = view === "calendar" ? "block" : "none";
  calMonthNav.style.display = view === "calendar" ? "flex" : "none";
  grid.style.display = view === "list" ? "grid" : "none";
  render();
}

viewCalendarBtn.addEventListener("click", () => setView("calendar"));
viewListBtn.addEventListener("click", () => setView("list"));

function render() {
  if (view === "calendar") renderCalendar();
  else renderList();
}

[searchInput, originSelect, destinationSelect, airlineSelect, daySelect].forEach((el) =>
  el.addEventListener("input", render)
);

(async function init() {
  const entries = await loadSchedule();
  if (entries === null) {
    allEntries = [];
    grid.innerHTML = `<div class="rn-error">Couldn't load the schedule right now. Try refreshing in a moment.</div>`;
    calGrid.innerHTML = "";
    return;
  }
  allEntries = entries;
  const banner = document.getElementById("rnSampleBanner");
  if (banner) banner.style.display = usingSampleData ? "block" : "none";
  populateFilterOptions(allEntries);
  render();

  // Keep countdowns/urgency colors live without a full page reload.
  setInterval(render, 60000);
})();
