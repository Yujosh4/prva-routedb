const STORAGE_KEY = "prva-routedb-active-routes";
const grid = document.getElementById("rnActiveGrid");

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
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
      </div>
      <div class="rn-card-actions">
        <button type="button" class="btn btn-outline" data-remove="${index}">Remove</button>
      </div>
    </article>`;
}

function render() {
  const entries = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  if (!entries.length) {
    grid.innerHTML = `<div class="rn-empty">No active routes yet. Pick one from <a href="index.html" style="text-decoration:underline;">Browse Routes</a> and hit "Fly This Route."</div>`;
    return;
  }
  grid.innerHTML = entries.map(cardHtml).join("");
}

grid.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-remove]");
  if (!btn) return;
  const entries = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  entries.splice(Number(btn.dataset.remove), 1);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  render();
});

render();
