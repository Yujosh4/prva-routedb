import { fetchLatestOfp, summarizeOfp } from "./simbrief.js";
import { renderRouteMap } from "./route-map.js";

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

// Only ever stores the small, summarized OFP shape (see simbrief.js's
// summarizeOfp) -- a full OFP is large enough that a couple of entries can
// blow through localStorage's ~5-10MB quota. Still defensive on top of
// that: drops the oldest entries and retries rather than losing the write.
function saveEntries(entries) {
  let toStore = entries.slice(0, 20);
  while (toStore.length > 0) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
      return;
    } catch {
      toStore = toStore.slice(0, -1);
    }
  }
}

function ofpSummaryHtml(ofp, index) {
  if (!ofp) return "";
  const block = ofp.block_seconds
    ? `${Math.floor(ofp.block_seconds / 3600)}h ${Math.round((ofp.block_seconds % 3600) / 60)}m`
    : null;
  const hasKnownFields = ofp.aircraft || ofp.route || block;
  return `
    <div style="margin-top:10px; padding-top:10px; border-top:1px solid var(--line); font-size:12px;">
      ${ofp.aircraft ? `<div><strong>Aircraft:</strong> ${escapeHtml(ofp.aircraft)}</div>` : ""}
      ${ofp.route ? `<div><strong>Route:</strong> ${escapeHtml(ofp.route)}</div>` : ""}
      ${block ? `<div><strong>Block time:</strong> ${block}</div>` : ""}
      ${!hasKnownFields ? `<div>Flight plan found, but no summary fields recognized.</div>` : ""}
      <div id="rnActiveMap-${index}" class="rn-route-map" style="margin-top:10px; display:none;"></div>
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
      ${ofpSummaryHtml(entry.ofp, index)}
    </article>`;
}

function render() {
  const entries = loadEntries();
  if (!entries.length) {
    grid.innerHTML = `<div class="rn-empty">No active routes yet. Pick one from <a href="index.html" style="text-decoration:underline;">Browse Routes</a> and hit "Fly This Route."</div>`;
    return;
  }
  grid.innerHTML = entries.map(cardHtml).join("");
  entries.forEach((entry, index) => {
    if (!entry.ofp?.points) return;
    const mapEl = document.getElementById(`rnActiveMap-${index}`);
    if (mapEl) mapEl.style.display = "block";
    const mapped = renderRouteMap(`rnActiveMap-${index}`, entry.ofp.points);
    if (!mapped && mapEl) mapEl.style.display = "none";
  });
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
      entry.ofp = summarizeOfp(ofp);
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
