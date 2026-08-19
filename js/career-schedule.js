import { supabase } from "./supabase-client.js";
import { requireStaffSession } from "./auth-guard.js";
import { CAREER_AIRLINES, ALL_DAYS as DAYS, assignPlausibleSchedule, assignPlausibleTerminal, hashString } from "./career-autofill.js";

await requireStaffSession();

const DAY_LABELS = { 1: "M", 2: "T", 3: "W", 4: "T", 5: "F", 6: "S", 7: "S" };

const summaryEl = document.getElementById("csSummary");
const tableWrap = document.getElementById("csTableWrap");
const searchInput = document.getElementById("csSearch");
const autoFillBtn = document.getElementById("autoFillBtn");
const autoFillStatus = document.getElementById("autoFillStatus");
const rosterMonthSelect = document.getElementById("csRosterMonth");
const rosterCapInput = document.getElementById("csRosterCap");
const generateRosterBtn = document.getElementById("csGenerateRosterBtn");
const rosterStatus = document.getElementById("csRosterStatus");

let routes = [];
let schedulesByRoute = new Map();
let airlineNameById = new Map();
let rosterByScheduleMonth = new Map(); // schedule_id -> Set<'YYYY-MM'>

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function yearMonthInfo(monthOffset) {
  const d = new Date();
  d.setDate(1); // avoid month-length rollover (e.g. Jan 31 + 1 month skipping March)
  d.setMonth(d.getMonth() + monthOffset);
  return { value: d.toISOString().slice(0, 7), label: d.toLocaleDateString(undefined, { month: "long", year: "numeric" }) };
}

function targetMonth() {
  return rosterMonthSelect.value;
}

function isInRoster(scheduleId, month) {
  return rosterByScheduleMonth.get(scheduleId)?.has(month) || false;
}

function populateRosterMonthOptions() {
  const thisMonth = yearMonthInfo(0);
  const nextMonth = yearMonthInfo(1);
  rosterMonthSelect.innerHTML = `
    <option value="${thisMonth.value}">This Month (${thisMonth.label})</option>
    <option value="${nextMonth.value}">Next Month (${nextMonth.label})</option>`;
}

async function loadAll() {
  const { data: airlines, error: airlinesErr } = await supabase
    .from("airlines").select("id, name").in("name", CAREER_AIRLINES);
  if (airlinesErr) throw airlinesErr;
  const airlineIds = airlines.map((a) => a.id);
  airlineNameById = new Map(airlines.map((a) => [a.id, a.name]));

  const { data: routeRows, error: routesErr } = await supabase
    .from("routes")
    .select(`id, flight_number, distance_nm, airline_id,
      origin:airports!routes_origin_icao_fkey(icao, city, country),
      destination:airports!routes_destination_icao_fkey(icao, city, country)`)
    .in("airline_id", airlineIds).eq("active", true).eq("category", "current")
    .order("flight_number");
  if (routesErr) throw routesErr;

  const { data: scheduleRows, error: schedErr } = await supabase
    .from("career_schedules")
    .select("id, route_id, departure_time_local, days_of_week, active, gate, terminal, source, notes");
  if (schedErr) throw schedErr;

  const { data: rosterRows, error: rosterErr } = await supabase
    .from("career_mode_roster").select("schedule_id, year_month");
  if (rosterErr) throw rosterErr;

  routes = routeRows;
  schedulesByRoute = new Map(scheduleRows.map((s) => [s.route_id, s]));
  rosterByScheduleMonth = new Map();
  (rosterRows || []).forEach((r) => {
    if (!rosterByScheduleMonth.has(r.schedule_id)) rosterByScheduleMonth.set(r.schedule_id, new Set());
    rosterByScheduleMonth.get(r.schedule_id).add(r.year_month);
  });
}

function renderSummary() {
  const scheduled = routes.filter((r) => schedulesByRoute.has(r.id));
  const suspended = scheduled.filter((r) => schedulesByRoute.get(r.id).active === false);
  const active = scheduled.filter((r) => schedulesByRoute.get(r.id).active !== false);
  const unscheduled = routes.length - scheduled.length;
  const month = targetMonth();
  const inRoster = scheduled.filter((r) => isInRoster(schedulesByRoute.get(r.id).id, month)).length;
  summaryEl.innerHTML = `
    <div><strong>${routes.length}</strong><div style="font-size:11px;color:var(--muted);">total routes</div></div>
    <div><strong>${active.length}</strong><div style="font-size:11px;color:var(--muted);">scheduled &amp; active</div></div>
    <div><strong>${suspended.length}</strong><div style="font-size:11px;color:var(--muted);">suspended</div></div>
    <div><strong>${unscheduled}</strong><div style="font-size:11px;color:var(--muted);">not yet scheduled</div></div>
    <div><strong>${inRoster}</strong><div style="font-size:11px;color:var(--muted);">in roster for selected month</div></div>`;
}

function rowHtml(route) {
  const s = schedulesByRoute.get(route.id);
  const rowClass = !s ? "cs-row-none" : s.active === false ? "cs-row-suspended" : "";
  const time = s?.departure_time_local?.slice(0, 5) || "";
  const days = new Set(s?.days_of_week || DAYS);
  const inRoster = s ? isInRoster(s.id, targetMonth()) : false;
  return `
    <tr class="${rowClass}" data-route="${route.id}">
      <td>${escapeHtml(route.flight_number)}</td>
      <td>${escapeHtml(route.origin?.icao)} &rarr; ${escapeHtml(route.destination?.icao)}</td>
      <td><input type="time" class="cs-time" value="${time}"></td>
      <td><div class="cs-days">
        ${DAYS.map((d) => `<label><span>${DAY_LABELS[d]}</span><input type="checkbox" class="cs-day" value="${d}" ${days.has(d) ? "checked" : ""}></label>`).join("")}
      </div></td>
      <td><input type="checkbox" class="cs-active" ${s?.active === false ? "" : "checked"}> Active</td>
      <td><input type="checkbox" class="cs-in-career-mode" ${inRoster ? "checked" : ""} ${!s ? "disabled" : ""}></td>
      <td><input type="text" class="cs-gate" value="${escapeHtml(s?.gate || "")}" placeholder="e.g. 24" style="width:60px;"></td>
      <td><select class="cs-terminal" style="width:75px;">
        <option value="" ${!s?.terminal ? "selected" : ""}>TBD</option>
        <option value="T1" ${s?.terminal === "T1" ? "selected" : ""}>T1</option>
        <option value="T2" ${s?.terminal === "T2" ? "selected" : ""}>T2</option>
      </select></td>
      <td><input type="text" class="cs-notes" value="${escapeHtml(s?.notes || "")}" placeholder="Reason if suspended..."></td>
      <td>${s ? `<span style="font-size:10px;color:var(--muted);">${escapeHtml(s.source)}</span>` : `<span style="font-size:10px;color:var(--muted);">unscheduled</span>`}</td>
      <td><button type="button" class="btn btn-outline cs-save-btn" data-save="${route.id}">Save</button></td>
    </tr>`;
}

function renderTable(filtered) {
  tableWrap.innerHTML = `
    <table class="cs-table">
      <thead><tr>
        <th>Flight</th><th>Route</th><th>Time (local)</th><th>Days</th><th>Active</th><th>In CM (selected month)</th><th>Gate</th><th>Term.</th><th>Notes</th><th>Source</th><th></th>
      </tr></thead>
      <tbody>${filtered.map(rowHtml).join("")}</tbody>
    </table>`;
}

function applySearch() {
  const q = searchInput.value.trim().toLowerCase();
  const filtered = !q
    ? routes
    : routes.filter((r) =>
        [r.flight_number, r.origin?.icao, r.origin?.city, r.destination?.icao, r.destination?.city]
          .join(" ").toLowerCase().includes(q)
      );
  renderTable(filtered);
}

async function setRosterMembership(scheduleId, month, shouldBeIn) {
  const currentlyIn = isInRoster(scheduleId, month);
  if (currentlyIn === shouldBeIn) return null;
  if (shouldBeIn) {
    const { error } = await supabase.from("career_mode_roster").insert({ schedule_id: scheduleId, year_month: month });
    if (error) return error;
    if (!rosterByScheduleMonth.has(scheduleId)) rosterByScheduleMonth.set(scheduleId, new Set());
    rosterByScheduleMonth.get(scheduleId).add(month);
  } else {
    const { error } = await supabase.from("career_mode_roster").delete().eq("schedule_id", scheduleId).eq("year_month", month);
    if (error) return error;
    rosterByScheduleMonth.get(scheduleId)?.delete(month);
  }
  return null;
}

async function saveRow(routeId, tr) {
  const route = routes.find((r) => r.id === routeId);
  const time = tr.querySelector(".cs-time").value;
  if (!time) {
    alert("Set a departure time first (or use Auto-Fill).");
    return;
  }
  const days = [...tr.querySelectorAll(".cs-day:checked")].map((cb) => Number(cb.value));
  const active = tr.querySelector(".cs-active").checked;
  const wantsInRoster = tr.querySelector(".cs-in-career-mode").checked;
  const gate = tr.querySelector(".cs-gate").value.trim();
  const terminal = tr.querySelector(".cs-terminal").value.trim();
  const notes = tr.querySelector(".cs-notes").value.trim();
  const existing = schedulesByRoute.get(routeId);

  const payload = {
    route_id: routeId,
    airline_id: route.airline_id,
    departure_time_local: time + ":00",
    days_of_week: days.length ? days : DAYS,
    active,
    gate: gate || null,
    terminal: terminal || null,
    source: existing?.source === "real_world_api" ? "real_world_api" : "manual",
    notes: notes || null,
  };

  const { data, error } = existing
    ? await supabase.from("career_schedules").update(payload).eq("id", existing.id).select().single()
    : await supabase.from("career_schedules").insert(payload).select().single();

  if (error) {
    alert("Couldn't save: " + error.message);
    return;
  }
  schedulesByRoute.set(routeId, data);

  const rosterErr = await setRosterMembership(data.id, targetMonth(), wantsInRoster);
  if (rosterErr) {
    alert("Schedule saved, but couldn't update roster membership: " + rosterErr.message);
  }

  renderSummary();
  applySearch();
}

tableWrap.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-save]");
  if (!btn) return;
  saveRow(btn.dataset.save, btn.closest("tr"));
});

autoFillBtn.addEventListener("click", async () => {
  const todo = routes.filter((r) => !schedulesByRoute.has(r.id));
  if (!todo.length) {
    autoFillStatus.textContent = "Every route already has a schedule entry.";
    autoFillStatus.className = "rn-sb-status success";
    return;
  }
  autoFillBtn.disabled = true;
  autoFillStatus.textContent = `Assigning times to ${todo.length} routes…`;
  autoFillStatus.className = "rn-sb-status";

  const payload = todo.map((route) => ({
    route_id: route.id,
    airline_id: route.airline_id,
    ...assignPlausibleSchedule(route.flight_number, route.distance_nm),
    active: true,
    terminal: assignPlausibleTerminal(
      airlineNameById.get(route.airline_id),
      route.flight_number,
      route.origin?.country,
      route.destination?.country
    ),
    source: "derived",
    notes: "Auto-assigned plausible schedule -- not sourced from real-world data.",
  }));

  const { data, error } = await supabase.from("career_schedules").insert(payload).select();
  autoFillBtn.disabled = false;
  if (error) {
    autoFillStatus.textContent = "Auto-fill failed: " + error.message;
    autoFillStatus.className = "rn-sb-status error";
    return;
  }
  data.forEach((row) => schedulesByRoute.set(row.route_id, row));
  autoFillStatus.textContent = `Assigned times to ${data.length} routes.`;
  autoFillStatus.className = "rn-sb-status success";
  renderSummary();
  applySearch();
});

generateRosterBtn.addEventListener("click", async () => {
  const cap = Math.max(1, parseInt(rosterCapInput.value, 10) || 50);
  const month = targetMonth();
  const eligible = routes.filter((r) => schedulesByRoute.has(r.id));
  if (!eligible.length) {
    rosterStatus.textContent = "No scheduled routes yet -- use Auto-Fill first.";
    rosterStatus.className = "rn-sb-status error";
    return;
  }

  generateRosterBtn.disabled = true;
  rosterStatus.textContent = `Generating for ${month}…`;
  rosterStatus.className = "rn-sb-status";

  // Seeded by the target year-month, not pure randomness, so re-clicking
  // for the same month reproduces the same roster instead of reshuffling
  // it every time -- and picking a different month naturally gives a
  // different selection.
  const ranked = [...eligible].sort(
    (a, b) => hashString(a.flight_number + ":" + month) - hashString(b.flight_number + ":" + month)
  );
  const selected = new Set(ranked.slice(0, cap).map((r) => r.id));
  const scheduleIds = eligible.map((r) => schedulesByRoute.get(r.id).id);
  const selectedScheduleIds = eligible.filter((r) => selected.has(r.id)).map((r) => schedulesByRoute.get(r.id).id);

  // Full replace for this month only -- other months' rows are untouched.
  const { error: delErr } = await supabase.from("career_mode_roster").delete().eq("year_month", month).in("schedule_id", scheduleIds);
  if (delErr) {
    generateRosterBtn.disabled = false;
    rosterStatus.textContent = "Couldn't generate roster: " + delErr.message;
    rosterStatus.className = "rn-sb-status error";
    return;
  }
  const { error: insErr } = selectedScheduleIds.length
    ? await supabase.from("career_mode_roster").insert(selectedScheduleIds.map((id) => ({ schedule_id: id, year_month: month })))
    : { error: null };

  generateRosterBtn.disabled = false;
  if (insErr) {
    rosterStatus.textContent = "Couldn't generate roster: " + insErr.message;
    rosterStatus.className = "rn-sb-status error";
    return;
  }

  scheduleIds.forEach((id) => rosterByScheduleMonth.get(id)?.delete(month));
  selectedScheduleIds.forEach((id) => {
    if (!rosterByScheduleMonth.has(id)) rosterByScheduleMonth.set(id, new Set());
    rosterByScheduleMonth.get(id).add(month);
  });

  rosterStatus.textContent = `Roster set for ${month}: ${selectedScheduleIds.length} route${selectedScheduleIds.length === 1 ? "" : "s"} (cap ${cap}).`;
  rosterStatus.className = "rn-sb-status success";
  renderSummary();
  applySearch();
});

rosterMonthSelect.addEventListener("change", () => {
  renderSummary();
  applySearch();
});

searchInput.addEventListener("input", applySearch);

document.getElementById("logoutLink").addEventListener("click", async (e) => {
  e.preventDefault();
  await supabase.auth.signOut();
  window.location.href = "auth.html";
});

(async function init() {
  try {
    populateRosterMonthOptions();
    await loadAll();
    renderSummary();
    applySearch();
  } catch (err) {
    tableWrap.innerHTML = `<div class="rn-error">Couldn't load: ${escapeHtml(err.message)}</div>`;
  }
})();
