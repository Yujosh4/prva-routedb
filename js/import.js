import { supabase } from "./supabase-client.js";
import { requireStaffSession } from "./auth-guard.js";
import { autoScheduleNewRoutes } from "./career-autofill.js";

await requireStaffSession();

const airlineSelect = document.getElementById("airlineSelect");
const newAirlineName = document.getElementById("newAirlineName");
const newAirlineLogo = document.getElementById("newAirlineLogo");
const newAirlineMainline = document.getElementById("newAirlineMainline");
const createAirlineBtn = document.getElementById("createAirlineBtn");
const airlineStatus = document.getElementById("airlineStatus");

const fileInput = document.getElementById("fileInput");
const sheetSelect = document.getElementById("sheetSelect");
const categorySelect = document.getElementById("categorySelect");

const previewSummary = document.getElementById("previewSummary");
const previewTableWrap = document.getElementById("previewTableWrap");
const importBtn = document.getElementById("importBtn");
const importStatus = document.getElementById("importStatus");

let workbook = null;
let parsedRows = []; // includes both valid and invalid rows, for the preview table

// ---------- Airlines ----------
async function loadAirlines(selectId) {
  const { data, error } = await supabase.from("airlines").select("id, name, is_mainline").order("name");
  if (error) {
    airlineStatus.textContent = "Couldn't load airlines: " + error.message;
    airlineStatus.className = "rn-sb-status error";
    return;
  }
  airlineSelect.innerHTML = data
    .map((a) => `<option value="${a.id}">${a.name}${a.is_mainline ? " (Mainline)" : ""}</option>`)
    .join("");
  if (selectId) airlineSelect.value = selectId;
}

createAirlineBtn.addEventListener("click", async () => {
  const name = newAirlineName.value.trim();
  if (!name) {
    airlineStatus.textContent = "Enter an airline name first.";
    airlineStatus.className = "rn-sb-status error";
    return;
  }
  airlineStatus.textContent = "Creating airline…";
  airlineStatus.className = "rn-sb-status";

  let logo_url = null;
  const file = newAirlineLogo.files[0];
  if (file) {
    const path = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-]/g, "_")}`;
    const { error: uploadError } = await supabase.storage.from("airline-logos").upload(path, file);
    if (uploadError) {
      airlineStatus.textContent = "Logo upload failed: " + uploadError.message;
      airlineStatus.className = "rn-sb-status error";
      return;
    }
    logo_url = supabase.storage.from("airline-logos").getPublicUrl(path).data.publicUrl;
  }

  const is_mainline = newAirlineMainline.checked;
  const { data, error } = await supabase.from("airlines").insert({ name, logo_url, is_mainline }).select().single();
  if (error) {
    airlineStatus.textContent = error.message.includes("one_mainline_airline")
      ? "Only one airline can be marked mainline, and one already is. Leave the mainline box unchecked for a codeshare or subsidiary brand."
      : "Couldn't create airline: " + error.message;
    airlineStatus.className = "rn-sb-status error";
    return;
  }
  airlineStatus.textContent = `Created "${name}".`;
  airlineStatus.className = "rn-sb-status success";
  newAirlineName.value = "";
  newAirlineLogo.value = "";
  newAirlineMainline.checked = false;
  await loadAirlines(data.id);
});

// ---------- Spreadsheet parsing ----------
const HEADER_ALIASES = {
  flightNumber: ["flight number", "route number"],
  depCity: ["departure city"],
  arrCity: ["arrival city"],
  depIcao: ["dep. icao", "dep icao"],
  arrIcao: ["arr. icao", "arr icao"],
  flightTime: ["flight time"],
  aircraft: ["aircraft"],
  livery: ["livery"],
  remarks: ["remarks"],
};

function buildHeaderMap(headerRow) {
  const norm = headerRow.map((h) => String(h ?? "").trim().toLowerCase());
  const map = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = norm.findIndex((h) => aliases.includes(h));
    if (idx !== -1) map[field] = idx;
  }
  return map;
}

function parseFlightTimeToMinutes(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    // SheetJS's cellDates conversion encodes the time using the browser's
    // local time zone, not UTC -- so this has to decode with the matching
    // local getters. Using getUTCHours/getUTCMinutes here silently shifted
    // every imported time by the browser's UTC offset (confirmed against
    // real imported data: exactly -8h, matching PHT/UTC+8) and could wrap
    // to a nonsense hour entirely for early-morning departures.
    return value.getHours() * 60 + value.getMinutes();
  }
  const str = String(value).trim();

  // A range like "0:45 - 1:15" (variable block time on short-haul routes) --
  // average the two ends rather than failing to parse.
  const range = str.match(/^(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})$/);
  if (range) {
    const start = parseInt(range[1], 10) * 60 + parseInt(range[2], 10);
    const end = parseInt(range[3], 10) * 60 + parseInt(range[4], 10);
    return Math.round((start + end) / 2);
  }

  const m = str.match(/^(\d{1,2}):(\d{2})$/);
  if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  const num = Number(str);
  if (!isNaN(num) && num > 0 && num < 1) return Math.round(num * 24 * 60);
  return null;
}

function splitList(value) {
  if (!value) return [];
  return String(value).split(",").map((s) => s.trim()).filter(Boolean);
}

function haversineNm(lat1, lon1, lat2, lon2) {
  const R = 3440.065;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function parseSheet(sheetName) {
  const ws = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  if (!rows.length) return [];

  const map = buildHeaderMap(rows[0]);
  const dataRows = rows.slice(1).filter((r) => r.some((c) => c != null && c !== ""));

  const parsed = dataRows.map((r) => {
    const flight_number = map.flightNumber != null ? String(r[map.flightNumber] ?? "").trim() : "";
    const origin_icao = map.depIcao != null ? String(r[map.depIcao] ?? "").trim().toUpperCase() : "";
    const destination_icao = map.arrIcao != null ? String(r[map.arrIcao] ?? "").trim().toUpperCase() : "";
    const aircraft_types = map.aircraft != null ? splitList(r[map.aircraft]) : [];
    const liveries = map.livery != null ? splitList(r[map.livery]) : [];
    const flight_time_minutes = map.flightTime != null ? parseFlightTimeToMinutes(r[map.flightTime]) : null;
    const notes = map.remarks != null ? (r[map.remarks] ?? null) : null;

    const errors = [];
    if (!flight_number) errors.push("missing flight number");
    if (!origin_icao) errors.push("missing origin ICAO");
    if (!destination_icao) errors.push("missing destination ICAO");

    return { flight_number, origin_icao, destination_icao, aircraft_types, liveries, flight_time_minutes, notes, errors };
  });

  // Resolve airports referenced, so we can flag anything missing and compute distance.
  const uniqueIcaos = [...new Set(parsed.flatMap((r) => [r.origin_icao, r.destination_icao].filter(Boolean)))];
  const { data: airports, error } = await supabase.from("airports").select("icao, lat, lon").in("icao", uniqueIcaos);
  if (error) {
    previewSummary.textContent = "Couldn't check airports: " + error.message;
    previewSummary.className = "imp-summary";
    return parsed;
  }
  const airportMap = new Map((airports || []).map((a) => [a.icao, a]));

  parsed.forEach((r) => {
    const o = airportMap.get(r.origin_icao);
    const d = airportMap.get(r.destination_icao);
    if (r.origin_icao && !o) r.errors.push(`origin ${r.origin_icao} not in airports table`);
    if (r.destination_icao && !d) r.errors.push(`destination ${r.destination_icao} not in airports table`);
    r.distance_nm =
      o && d && o.lat != null && d.lat != null
        ? Math.round(haversineNm(o.lat, o.lon, d.lat, d.lon))
        : null;
  });

  return parsed;
}

function formatMinutes(minutes) {
  if (minutes == null) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function renderPreview(rows) {
  const validCount = rows.filter((r) => r.errors.length === 0).length;
  previewSummary.innerHTML = `<strong>${rows.length}</strong> rows parsed, <strong>${validCount}</strong> ready to import${
    rows.length - validCount ? `, <strong>${rows.length - validCount}</strong> with errors (shown in red, won't be imported)` : ""
  }.`;

  const headers = ["Flight #", "From", "To", "Aircraft", "Livery", "Time", "Distance", "Issues"];
  const body = rows
    .map(
      (r) => `
      <tr class="${r.errors.length ? "imp-row-error" : ""}">
        <td>${r.flight_number || "—"}</td>
        <td>${r.origin_icao || "—"}</td>
        <td>${r.destination_icao || "—"}</td>
        <td>${r.aircraft_types.join(", ") || "—"}</td>
        <td>${r.liveries.join(", ") || "—"}</td>
        <td>${formatMinutes(r.flight_time_minutes)}</td>
        <td>${r.distance_nm != null ? r.distance_nm + " nm" : "—"}</td>
        <td>${r.errors.join("; ")}</td>
      </tr>`
    )
    .join("");

  previewTableWrap.innerHTML = `
    <table class="imp-table">
      <thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
      <tbody>${body}</tbody>
    </table>`;

  importBtn.disabled = validCount === 0;
}

async function refreshPreview() {
  const sheetName = sheetSelect.value;
  if (!workbook || !sheetName) return;
  previewSummary.textContent = "Parsing…";
  parsedRows = await parseSheet(sheetName);
  renderPreview(parsedRows);
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    workbook = XLSX.read(e.target.result, { type: "array", cellDates: true });
    sheetSelect.disabled = false;
    sheetSelect.innerHTML = workbook.SheetNames.map((n) => `<option value="${n}">${n}</option>`).join("");
    const historicIdx = workbook.SheetNames.findIndex((n) => /historic/i.test(n));
    if (historicIdx !== -1) {
      sheetSelect.selectedIndex = historicIdx;
      categorySelect.value = "historic";
    } else {
      categorySelect.value = "current";
    }
    await refreshPreview();
  };
  reader.readAsArrayBuffer(file);
});

sheetSelect.addEventListener("change", () => {
  categorySelect.value = /historic/i.test(sheetSelect.value) ? "historic" : "current";
  refreshPreview();
});

importBtn.addEventListener("click", async () => {
  const airline_id = airlineSelect.value;
  const category = categorySelect.value;
  if (!airline_id) {
    importStatus.textContent = "Pick an airline first.";
    importStatus.className = "rn-sb-status error";
    return;
  }
  const validRows = parsedRows.filter((r) => r.errors.length === 0);
  if (!validRows.length) return;

  importBtn.disabled = true;
  importStatus.textContent = `Importing ${validRows.length} routes…`;
  importStatus.className = "rn-sb-status";

  const payload = validRows.map((r) => ({
    flight_number: r.flight_number,
    origin_icao: r.origin_icao,
    destination_icao: r.destination_icao,
    aircraft_types: r.aircraft_types,
    liveries: r.liveries,
    flight_time_minutes: r.flight_time_minutes,
    distance_nm: r.distance_nm,
    notes: r.notes,
    airline_id,
    category,
  }));

  const { data: inserted, error } = await supabase.from("routes").insert(payload).select();
  if (error) {
    importStatus.textContent = "Import failed: " + error.message;
    importStatus.className = "rn-sb-status error";
    importBtn.disabled = false;
    return;
  }

  // Automatic, no separate staff step: any PAL/PAL Express route just
  // imported gets a plausible Career Mode departure time right away.
  const { scheduled } = await autoScheduleNewRoutes(supabase, inserted);

  importStatus.textContent = `Imported ${validRows.length} routes.` +
    (scheduled ? ` ${scheduled} auto-scheduled for Career Mode.` : "");
  importStatus.className = "rn-sb-status success";
});

document.getElementById("logoutLink").addEventListener("click", async (e) => {
  e.preventDefault();
  await supabase.auth.signOut();
  window.location.href = "auth.html";
});

loadAirlines();
