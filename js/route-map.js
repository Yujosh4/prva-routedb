// Renders a route map from a list of [lat, lon] points using Leaflet +
// OpenStreetMap tiles (free, no key).

// SimBrief's navlog field names are well-established in the flight-sim
// community but not verified here against a real response -- checks a few
// plausible field name variants and returns null (caller skips the map)
// rather than throwing if the shape doesn't match.
export function extractRoutePoints(ofp) {
  let fixes = ofp?.navlog?.fix;
  if (!fixes) return null;
  if (!Array.isArray(fixes)) fixes = [fixes];

  const points = fixes
    .map((f) => {
      const lat = parseFloat(f.pos_lat ?? f.lat);
      const lon = parseFloat(f.pos_long ?? f.pos_lon ?? f.lon);
      return isFinite(lat) && isFinite(lon) ? [lat, lon] : null;
    })
    .filter(Boolean);

  return points.length >= 2 ? points : null;
}

export function renderRouteMap(containerId, points) {
  const container = document.getElementById(containerId);
  if (!container || typeof L === "undefined" || !points || points.length < 2) return false;

  container.innerHTML = "";
  const map = L.map(containerId, { zoomControl: true, attributionControl: true });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 8,
  }).addTo(map);

  const line = L.polyline(points, { color: "#c8102e", weight: 2.5 }).addTo(map);
  L.circleMarker(points[0], { radius: 5, color: "#0a0f1e", fillOpacity: 1 }).addTo(map);
  L.circleMarker(points[points.length - 1], { radius: 5, color: "#0a0f1e", fillOpacity: 1 }).addTo(map);
  map.fitBounds(line.getBounds(), { padding: [20, 20] });
  return true;
}
