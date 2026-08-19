import { supabase } from "./supabase-client.js";
import { requireStaffSession } from "./auth-guard.js";
import { CAREER_AIRLINES, ALL_DAYS as DAYS, assignPlausibleTime as sharedAssignTime } from "./career-autofill.js";

await requireStaffSession();

const DAY_LABELS = { 1: "M", 2: "T", 3: "W", 4: "T", 5: "F", 6: "S", 7: "S" };

const summaryEl = document.getElementById("csSummary");
const tableWrap = document.getElementById("csTableWrap");
const searchInput = document.getElementById("csSearch");
const autoFillBtn = document.getElementById("autoFillBtn");
const autoFillStatus = document.getElementById("autoFillStatus");

let routes = [];
let schedulesByRoute = new Map();

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function assignPlausibleTime(route) {
  return sharedAssignTime(route.flight_number, route.distance_nm);
}

async function loadAll() {
  const { data: airlines, error: airlinesErr } = await supabase
    .from("airlines").select("id, name").in("name", CAREER_AIRLINES);
  if (airlinesErr) throw airlinesErr;
  const airlineIds = airlines.map((a) => a.id);

  const { data: routeRows, error: routesErr } = await supabase
    .from("routes")
    .select(`id, flight_number, distance_nm, airline_id,
      origin:airports!routes_origin_icao_fkey(icao, city),
      destination:airports!routes_destination_icao_fkey(icao, city)`)
    .in("airline_id", airlineIds).eq("active", true).eq("category", "current")
    .order("flight_number");
  if (routesErr) throw routesErr;

  const { data: scheduleRows, error: schedErr } = await supabase
    .from("career_schedules")
    .select("id, route_id, departure_time_local, days_of_week, active, gate, terminal, source, notes");
  if (schedErr) throw schedErr;

  routes = routeRows;
  schedulesByRoute = new Map(scheduleRows.map((s) => [s.route_id, s]));
}

function renderSummary() {
  const scheduled = routes.filter((r) => schedulesByRoute.has(r.id));
  const suspended = scheduled.filter((r) => schedulesByRoute.get(r.id).active === false);
  const active = scheduled.filter((r) => schedulesByRoute.get(r.id).active !== false);
  const unscheduled = routes.length - scheduled.length;
  summaryEl.innerHTML = `
    <div><strong>${routes.length}</strong><div style="font-size:11px;color:var(--muted);">total routes</div></div>
    <div><strong>${active.length}</strong><div style="font-size:11px;color:var(--muted);">scheduled &amp; active</div></div>
    <div><strong>${suspended.length}</strong><div style="font-size:11px;color:var(--muted);">suspended</div></div>
    <div><strong>${unscheduled}</strong><div style="font-size:11px;color:var(--muted);">not yet scheduled</div></div>`;
}

function rowHtml(route) {
  const s = schedulesByRoute.get(route.id);
  const rowClass = !s ? "cs-row-none" : s.active === false ? "cs-row-suspended" : "";
  const time = s?.departure_time_local?.slice(0, 5) || "";
  const days = new Set(s?.days_of_week || DAYS);
  return `
    <tr class="${rowClass}" data-route="${route.id}">
      <td>${escapeHtml(route.flight_number)}</td>
      <td>${escapeHtml(route.origin?.icao)} &rarr; ${escapeHtml(route.destination?.icao)}</td>
      <td><input type="time" class="cs-time" value="${time}"></td>
      <td><div class="cs-days">
        ${DAYS.map((d) => `<label><span>${DAY_LABELS[d]}</span><input type="checkbox" class="cs-day" value="${d}" ${days.has(d) ? "checked" : ""}></label>`).join("")}
      </div></td>
      <td><input type="checkbox" class="cs-active" ${s?.active === false ? "" : "checked"}> Active</td>
      <td><input type="text" class="cs-gate" value="${escapeHtml(s?.gate || "")}" placeholder="e.g. 24" style="width:60px;"></td>
      <td><input type="text" class="cs-terminal" value="${escapeHtml(s?.terminal || "")}" placeholder="e.g. 1" style="width:60px;"></td>
      <td><input type="text" class="cs-notes" value="${escapeHtml(s?.notes || "")}" placeholder="Reason if suspended..."></td>
      <td>${s ? `<span style="font-size:10px;color:var(--muted);">${escapeHtml(s.source)}</span>` : `<span style="font-size:10px;color:var(--muted);">unscheduled</span>`}</td>
      <td><button type="button" class="btn btn-outline cs-save-btn" data-save="${route.id}">Save</button></td>
    </tr>`;
}

function renderTable(filtered) {
  tableWrap.innerHTML = `
    <table class="cs-table">
      <thead><tr>
        <th>Flight</th><th>Route</th><th>Time (local)</th><th>Days</th><th>Active</th><th>Gate</th><th>Term.</th><th>Notes</th><th>Source</th><th></th>
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

async function saveRow(routeId, tr) {
  const route = routes.find((r) => r.id === routeId);
  const time = tr.querySelector(".cs-time").value;
  if (!time) {
    alert("Set a departure time first (or use Auto-Fill).");
    return;
  }
  const days = [...tr.querySelectorAll(".cs-day:checked")].map((cb) => Number(cb.value));
  const active = tr.querySelector(".cs-active").checked;
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
    departure_time_local: assignPlausibleTime(route),
    days_of_week: DAYS,
    active: true,
    source: "derived",
    notes: "Auto-assigned plausible time -- not sourced from real-world data.",
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

searchInput.addEventListener("input", applySearch);

document.getElementById("logoutLink").addEventListener("click", async (e) => {
  e.preventDefault();
  await supabase.auth.signOut();
  window.location.href = "auth.html";
});

(async function init() {
  try {
    await loadAll();
    renderSummary();
    applySearch();
  } catch (err) {
    tableWrap.innerHTML = `<div class="rn-error">Couldn't load: ${escapeHtml(err.message)}</div>`;
  }
})();
