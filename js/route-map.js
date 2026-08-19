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

let lightboxEl = null;
function openLightbox(url, name) {
  if (!lightboxEl) {
    lightboxEl = document.createElement("div");
    lightboxEl.id = "rnChartLightbox";
    lightboxEl.style = "position:fixed; inset:0; background:rgba(5,7,15,0.85); z-index:200; display:flex; align-items:center; justify-content:center; padding:30px; cursor:zoom-out;";
    lightboxEl.innerHTML = `
      <img id="rnChartLightboxImg" style="max-width:100%; max-height:100%; border-radius:4px; cursor:default;">
      <button type="button" id="rnChartLightboxClose" style="position:absolute; top:20px; right:20px; width:36px; height:36px; border-radius:50%; border:none; background:white; font-size:18px; cursor:pointer;">&times;</button>
    `;
    document.body.appendChild(lightboxEl);
    lightboxEl.addEventListener("click", (e) => {
      if (e.target === lightboxEl || e.target.id === "rnChartLightboxClose") closeLightbox();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeLightbox();
    });
  }
  document.getElementById("rnChartLightboxImg").src = url;
  document.getElementById("rnChartLightboxImg").alt = name;
  lightboxEl.style.display = "flex";
}

function closeLightbox() {
  if (lightboxEl) lightboxEl.style.display = "none";
}

export function renderChartGallery(containerId, charts) {
  const container = document.getElementById(containerId);
  if (!container || !charts || !charts.length) return false;

  const escapeHtml = (str) =>
    String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const mainId = `${containerId}-main`;
  container.innerHTML = `
    <img id="${mainId}" src="${escapeHtml(charts[0].url)}" alt="${escapeHtml(charts[0].name)}" style="width:100%; border-radius:var(--radius-md); border:1px solid var(--line); display:block; cursor:zoom-in;">
    <p style="font-size:11px; color:var(--muted); margin-top:6px;">Click the image to enlarge.</p>
    <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:2px;">
      ${charts
        .map(
          (c, i) => `<button type="button" class="btn btn-outline" style="flex:0 0 auto; padding:6px 12px; font-size:11px;" data-chart="${i}">${escapeHtml(c.name)}</button>`
        )
        .join("")}
    </div>`;

  let current = charts[0];
  const mainImg = document.getElementById(mainId);
  mainImg.addEventListener("click", () => openLightbox(current.url, current.name));

  container.querySelectorAll("[data-chart]").forEach((btn) => {
    btn.addEventListener("click", () => {
      current = charts[Number(btn.dataset.chart)];
      mainImg.src = current.url;
      mainImg.alt = current.name;
    });
  });

  return true;
}
