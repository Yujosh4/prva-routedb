// SimBrief generates its own chart images per OFP -- route map, significant
// weather, winds aloft at cruise altitudes, vertical profile -- confirmed
// directly against a real OFP response (images.directory + images.map[],
// each {name, link}, combined as `${directory}${link}`, publicly
// accessible with no auth). Far better than plotting our own from raw
// waypoints, so this renders SimBrief's actual charts instead.
export function extractCharts(ofp) {
  const directory = ofp?.images?.directory;
  const maps = ofp?.images?.map;
  if (!directory || !Array.isArray(maps) || !maps.length) return null;
  return maps.map((m) => ({ name: m.name, url: directory + m.link }));
}

export function renderChartGallery(containerId, charts) {
  const container = document.getElementById(containerId);
  if (!container || !charts || !charts.length) return false;

  const escapeHtml = (str) =>
    String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const mainId = `${containerId}-main`;
  container.innerHTML = `
    <img id="${mainId}" src="${escapeHtml(charts[0].url)}" alt="${escapeHtml(charts[0].name)}" style="width:100%; border-radius:var(--radius-md); border:1px solid var(--line); display:block;">
    <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:8px;">
      ${charts
        .map(
          (c, i) => `<button type="button" class="btn btn-outline" style="flex:0 0 auto; padding:6px 12px; font-size:11px;" data-chart="${i}">${escapeHtml(c.name)}</button>`
        )
        .join("")}
    </div>`;

  container.querySelectorAll("[data-chart]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const chart = charts[Number(btn.dataset.chart)];
      document.getElementById(mainId).src = chart.url;
      document.getElementById(mainId).alt = chart.name;
    });
  });

  return true;
}
