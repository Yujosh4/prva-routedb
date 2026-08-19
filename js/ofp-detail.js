// Shared OFP detail rendering -- used both right after a fresh popup
// generation (main.js) and when checking status on an already-filed route
// (active.js), so the two don't drift out of sync. All field names here
// (crew, weights, fuel, atc, params.units, tlr.*, etc.) are confirmed
// against a real generated OFP, not guessed.

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function hms(str) {
  const m = String(str || "").match(/^(\d+):(\d{2}):\d{2}$/);
  return m ? `${m[1]}h ${m[2]}m` : null;
}

function fmtNum(n) {
  const num = Number(n);
  return isFinite(num) ? num.toLocaleString() : null;
}

function detailRow(label, value) {
  return value != null && value !== "" ? `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>` : "";
}

// tlr.takeoff/landing each list every candidate runway at the airport, with
// v-speeds only populated for the ones actually viable in current wind --
// the one matching conditions.planned_runway is the one SimBrief actually
// used, confirmed against a real response (V1/VR/V2 present there, blank
// on non-viable runways).
function plannedRunway(phase) {
  const planned = phase?.conditions?.planned_runway;
  const runways = phase?.runway || [];
  return runways.find((r) => r.identifier === planned) || null;
}

// mapContainerId lets callers keep container ids unique when rendering
// several OFPs on the same page (e.g. one per Active Route card).
export function ofpDetailHtml(ofp, mapContainerId) {
  const aircraft = ofp?.aircraft?.icaocode || ofp?.aircraft?.name;
  const reg = ofp?.aircraft?.reg;
  const units = ofp?.params?.units === "lbs" ? "lb" : "kg";
  const w = ofp?.weights || {};
  const f = ofp?.fuel || {};
  const toRwy = plannedRunway(ofp?.tlr?.takeoff);
  const ldRwy = plannedRunway(ofp?.tlr?.landing);

  return `
    <div class="rn-modal-section">
      <h4>Flight Info</h4>
      <dl class="rn-detail-grid">
        ${detailRow("Callsign", ofp?.atc?.callsign)}
        ${detailRow("Aircraft", [aircraft, reg].filter(Boolean).join(" / "))}
        ${detailRow("Departure Rwy", ofp?.origin?.plan_rwy)}
        ${detailRow("Arrival Rwy", ofp?.destination?.plan_rwy)}
        ${detailRow("Cruise Altitude", ofp?.general?.initial_altitude ? `FL${Math.round(ofp.general.initial_altitude / 100)}` : null)}
        ${detailRow("Cruise Mach", ofp?.general?.cruise_mach)}
        ${detailRow("Distance", ofp?.general?.gc_distance ? `${fmtNum(ofp.general.gc_distance)} nm` : null)}
        ${detailRow("Passengers", ofp?.general?.passengers)}
      </dl>
    </div>

    <div class="rn-modal-section">
      <h4>Flight Plan Summary <span class="rn-recommended-badge">Recommended</span></h4>
      <p style="font-size:11px; color:var(--muted); margin-top:-6px; margin-bottom:10px;">No specific routing was forced -- SimBrief computed this route itself based on current winds aloft.</p>
      <dl class="rn-detail-grid">
        ${detailRow("Route", ofp?.general?.route)}
        ${detailRow("Block Time", hms(ofp?.times?.est_time_enroute))}
        ${detailRow("Ramp Fuel", f.plan_ramp ? `${fmtNum(f.plan_ramp)} ${units}` : null)}
        ${detailRow("Takeoff Fuel", f.plan_takeoff ? `${fmtNum(f.plan_takeoff)} ${units}` : null)}
        ${detailRow("Trip Fuel (burn)", f.enroute_burn ? `${fmtNum(f.enroute_burn)} ${units}` : null)}
      </dl>
    </div>

    <div class="rn-modal-section">
      <h4>Load Sheet</h4>
      <dl class="rn-detail-grid">
        ${detailRow("Zero Fuel Weight", w.est_zfw ? `${fmtNum(w.est_zfw)} / ${fmtNum(w.max_zfw)} ${units}` : null)}
        ${detailRow("Takeoff Weight", w.est_tow ? `${fmtNum(w.est_tow)} / ${fmtNum(w.max_tow)} ${units}` : null)}
        ${detailRow("Landing Weight", w.est_ldw ? `${fmtNum(w.est_ldw)} / ${fmtNum(w.max_ldw)} ${units}` : null)}
        ${detailRow("Payload", w.payload ? `${fmtNum(w.payload)} ${units}` : null)}
        ${detailRow("Cargo", w.cargo ? `${fmtNum(w.cargo)} ${units}` : null)}
        ${detailRow("Ramp Weight", w.est_ramp ? `${fmtNum(w.est_ramp)} ${units}` : null)}
      </dl>
      <p style="margin-top:10px; font-size:11px; color:var(--muted);">Est / Max shown where applicable.</p>
    </div>

    ${
      toRwy?.speeds_v1 || ldRwy
        ? `<div class="rn-modal-section">
            <h4>V-Speeds</h4>
            <dl class="rn-detail-grid">
              ${detailRow("Takeoff Runway", toRwy?.identifier)}
              ${detailRow("V1", toRwy?.speeds_v1 ? `${toRwy.speeds_v1} kts` : null)}
              ${detailRow("VR", toRwy?.speeds_vr ? `${toRwy.speeds_vr} kts` : null)}
              ${detailRow("V2", toRwy?.speeds_v2 ? `${toRwy.speeds_v2} kts` : null)}
              ${detailRow(toRwy?.speeds_other_id, toRwy?.speeds_other ? `${toRwy.speeds_other} kts` : null)}
              ${detailRow("Landing Runway", ldRwy?.identifier)}
              ${detailRow("Vref", ldRwy?.speeds_vref ? `${ldRwy.speeds_vref} kts` : null)}
            </dl>
            <p style="margin-top:10px; font-size:11px; color:var(--muted);">From SimBrief's takeoff/landing performance report for the planned runway.</p>
          </div>`
        : ""
    }

    <div class="rn-modal-section">
      <h4>Charts</h4>
      <div id="${mapContainerId}"></div>
    </div>`;
}
