import { fetchLatestOfp } from "./simbrief.js";

const STORAGE_KEY = "prva-routedb-active-routes";
const grid = document.getElementById("rnActiveGrid");

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function loadEntries() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
}

function saveEntries(entries) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

// Defensive: SimBrief's JSON field names are documented well enough to be
// fairly confident about, but not verified against a real account here, so
// this falls back to a raw JSON view rather than silently showing nothing
// if a field is missing or named differently than expected.
function ofpSummaryHtml(ofp) {
  if (!ofp) return "";
  const aircraft = ofp.aircraft?.icaocode || ofp.aircraft?.name;
  const route = ofp.general?.route;
  const block = ofp.times?.est_time_enroute
    ? `${Math.floor(ofp.times.est_time_enroute / 3600)}h ${Math.round((ofp.times.est_time_enroute % 3600) / 60)}m`
    : null;
  const hasKnownFields = aircraft || route || block;
  return `
    <div style="margin-top:10px; padding-top:10px; border-top:1px solid var(--line); font-size:12px;">
      ${aircraft ? `<div><strong>Aircraft:</strong> ${escapeHtml(aircraft)}</div>` : ""}
      ${route ? `<div><strong>Route:</strong> ${escapeHtml(route)}</div>` : ""}
      ${block ? `<div><strong>Block time:</strong> ${block}</div>` : ""}
      ${!hasKnownFields ? `<div>Flight plan found -- see raw data below.</div>` : ""}
      <details style="margin-top:6px;">
        <summary style="cursor:pointer; color:var(--muted);">Raw OFP data</summary>
        <pre style="white-space:pre-wrap; word-break:break-word; font-size:11px; margin-top:6px;">${escapeHtml(JSON.stringify(ofp, null, 2))}</pre>
      </details>
    </div>`;
}

function cardHtml(entry, index) {
  return `
    <article class="rn-card" data-index="${index}">
      <div class="rn-card-top">
        <span class="rn-flight-num">${escapeHtml(entry.flight_number)}</span>
      </div>
      <div class="rn-route-line">
        <span class="rn-code">${escapeHtml(entry.origin)}</span>
        <span class="rn-arrow">&#9992;</span>
        <span class="rn-code">${escapeHtml(entry.destination)}</span>
      </div>
      <div class="rn-card-meta">
        <span class="rn-city">SimBrief: ${escapeHtml(entry.simbrief_id)}</span>
      </div>
      <div class="rn-card-meta">
        <span class="rn-tag">Committed ${escapeHtml(formatDate(entry.committed_at))}</span>
        ${entry.ofp_checked_at ? `<span class="rn-tag">Checked ${escapeHtml(formatDate(entry.ofp_checked_at))}</span>` : ""}
      </div>
      <div class="rn-card-actions">
        <button type="button" class="btn btn-outline" data-check="${index}">Check SimBrief Status</button>
        <button type="button" class="btn btn-outline" data-remove="${index}">Remove</button>
      </div>
      <div id="rnOfpStatus-${index}" class="rn-sb-status"></div>
      ${ofpSummaryHtml(entry.ofp)}
    </article>`;
}

function render() {
  const entries = loadEntries();
  if (!entries.length) {
    grid.innerHTML = `<div class="rn-empty">No active routes yet. Pick one from <a href="index.html" style="text-decoration:underline;">Browse Routes</a> and hit "Fly This Route."</div>`;
    return;
  }
  grid.innerHTML = entries.map(cardHtml).join("");
}

grid.addEventListener("click", async (e) => {
  const removeBtn = e.target.closest("[data-remove]");
  if (removeBtn) {
    const entries = loadEntries();
    entries.splice(Number(removeBtn.dataset.remove), 1);
    saveEntries(entries);
    render();
    return;
  }

  const checkBtn = e.target.closest("[data-check]");
  if (checkBtn) {
    const idx = Number(checkBtn.dataset.check);
    const entries = loadEntries();
    const entry = entries[idx];
    if (!entry) return;
    const status = document.getElementById(`rnOfpStatus-${idx}`);
    status.textContent = "Checking SimBrief…";
    status.className = "rn-sb-status";
    try {
      const ofp = await fetchLatestOfp(entry.simbrief_id);
      entry.ofp = ofp;
      entry.ofp_checked_at = new Date().toISOString();
      saveEntries(entries);
      render();
    } catch (err) {
      status.textContent = "Couldn't fetch SimBrief status: " + err.message;
      status.className = "rn-sb-status error";
    }
  }
});

render();
