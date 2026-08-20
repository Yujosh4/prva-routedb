// Staff PIREP review queue (Crew Center Phase 5). Loads every pireps row
// still awaiting a decision, lets staff re-check each against the pilot's
// real Infinite Flight logbook, then approve/reject individually or in
// bulk. Bulk actions deliberately never touch a PIREP with a multiplier --
// a green logbook match only proves the flight happened, not that the
// claimed bonus reason is legitimate, so those always need a human to
// read the remarks and decide (see the Crew Center plan's PIREP
// verification section).
import { supabase } from "./supabase-client.js";
import { requireStaffSession } from "./auth-guard.js";
import { initThemeToggle } from "./theme.js";
import { multiplierLabel } from "./crew-multipliers.js";

initThemeToggle();
const staffSession = await requireStaffSession();

const summaryEl = document.getElementById("pvSummary");
const tableWrap = document.getElementById("pvTableWrap");
const bulkStatus = document.getElementById("pvBulkStatus");
const verifyBtn = document.getElementById("pvVerifyBtn");
const approveAllBtn = document.getElementById("pvApproveAllBtn");
const rejectAllBtn = document.getElementById("pvRejectAllBtn");

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

let rows = [];

function flatten(raw) {
  const schedule = raw.flight_claims?.career_schedules;
  const route = schedule?.routes;
  return {
    id: raw.id,
    pilotId: raw.pilot_id,
    pilotName: raw.pilots?.display_name ?? "Unknown pilot",
    infiniteFlightUserId: raw.pilots?.infinite_flight_user_id ?? null,
    flightDate: raw.flight_claims?.flight_date ?? null,
    flightNumber: route?.flight_number ?? "?",
    originIcao: route?.origin_icao ?? null,
    destinationIcao: route?.destination_icao ?? null,
    flightTimeMinutes: route?.flight_time_minutes ?? null,
    verificationStatus: raw.verification_status,
    multiplierType: raw.multiplier_type,
    multiplierValue: raw.multiplier_value,
    remarks: raw.remarks,
    loggedFlightMinutes: raw.logged_flight_minutes,
    createdAt: raw.created_at,
  };
}

async function loadAndRender() {
  const { data, error } = await supabase
    .from("pireps")
    .select(`
      id, pilot_id, verification_status, multiplier_type, multiplier_value, remarks,
      review_status, logged_flight_minutes, created_at,
      pilots(display_name, infinite_flight_user_id),
      flight_claims(flight_date, career_schedules(id, routes(flight_number, origin_icao, destination_icao, flight_time_minutes)))
    `)
    .eq("review_status", "pending")
    .order("created_at");
  if (error) {
    tableWrap.innerHTML = `<p class="rn-sb-status error">Couldn't load PIREPs: ${escapeHtml(error.message)}</p>`;
    return;
  }
  rows = (data || []).map(flatten);
  renderSummary();
  renderTable();
}

function renderSummary() {
  const verified = rows.filter((r) => r.verificationStatus === "verified").length;
  const unverified = rows.filter((r) => r.verificationStatus === "unverified").length;
  const unchecked = rows.filter((r) => r.verificationStatus === "pending").length;
  const withMultiplier = rows.filter((r) => r.multiplierType !== "none").length;
  summaryEl.innerHTML = `
    <span><strong>${rows.length}</strong> pending PIREP${rows.length === 1 ? "" : "s"}</span>
    <span><strong>${verified}</strong> verified</span>
    <span><strong>${unverified}</strong> unverified</span>
    <span><strong>${unchecked}</strong> not yet checked</span>
    <span><strong>${withMultiplier}</strong> claiming a multiplier (individual review only)</span>
  `;
}

function badgeInfo(status) {
  if (status === "verified") return { cls: "pirep-badge-verified", label: "Verified" };
  if (status === "unverified") return { cls: "pirep-badge-unverified", label: "Unverified" };
  return { cls: "", label: "Not checked" };
}

function rowClass(status) {
  if (status === "verified") return "pirep-row-verified";
  if (status === "unverified") return "pirep-row-unverified";
  return "";
}

function renderTable() {
  if (!rows.length) {
    tableWrap.innerHTML = `<p style="color:var(--muted);">No PIREPs awaiting review.</p>`;
    return;
  }
  const badge = (status) => {
    const info = badgeInfo(status);
    return `<span class="pirep-badge ${info.cls}">${info.label}</span>`;
  };
  tableWrap.innerHTML = `
    <table class="cs-table">
      <thead><tr>
        <th>Pilot</th><th>Flight</th><th>Date</th><th>Logbook Check</th><th>Multiplier</th><th>Remarks</th><th>Action</th>
      </tr></thead>
      <tbody>
        ${rows.map((p) => `
          <tr class="${rowClass(p.verificationStatus)}">
            <td>${escapeHtml(p.pilotName)}</td>
            <td>${escapeHtml(p.flightNumber)} (${escapeHtml(p.originIcao || "?")} → ${escapeHtml(p.destinationIcao || "?")})</td>
            <td>${escapeHtml(p.flightDate || "—")}</td>
            <td>${badge(p.verificationStatus)}</td>
            <td>${p.multiplierType !== "none" ? `<span class="pirep-badge pirep-badge-multiplier">${escapeHtml(multiplierLabel(p.multiplierType, p.multiplierValue))}</span>` : "—"}</td>
            <td style="max-width:240px;">${escapeHtml(p.remarks || "—")}</td>
            <td style="white-space:nowrap;">
              <button type="button" class="btn btn-primary cs-save-btn" data-approve="${escapeHtml(p.id)}">Approve</button>
              <button type="button" class="btn btn-outline cs-save-btn" data-reject="${escapeHtml(p.id)}">Reject</button>
            </td>
          </tr>`).join("")}
      </tbody>
    </table>`;
}

// hours_awarded is computed and stored here so it's ready whenever rank/
// hours tracking (Phase 6/7) starts reading it -- this phase does not yet
// write to pilots.total_hours or recompute rank_id, that wiring belongs
// to the trigger/function the plan schedules for after multipliers land.
async function reviewOne(pirep, decision) {
  const payload = {
    review_status: decision,
    reviewed_by: staffSession.user.id,
    reviewed_at: new Date().toISOString(),
  };
  if (decision === "approved") {
    const minutes = pirep.loggedFlightMinutes ?? pirep.flightTimeMinutes ?? 0;
    payload.hours_awarded = Math.round((minutes / 60) * pirep.multiplierValue * 100) / 100;
  }
  return supabase.from("pireps").update(payload).eq("id", pirep.id);
}

tableWrap.addEventListener("click", async (e) => {
  const approveId = e.target.dataset.approve;
  const rejectId = e.target.dataset.reject;
  const id = approveId || rejectId;
  if (!id) return;
  const pirep = rows.find((r) => r.id === id);
  if (!pirep) return;
  e.target.disabled = true;
  const { error } = await reviewOne(pirep, approveId ? "approved" : "rejected");
  if (error) {
    bulkStatus.textContent = `Couldn't update that PIREP: ${error.message}`;
    bulkStatus.className = "rn-sb-status error";
    e.target.disabled = false;
    return;
  }
  await loadAndRender();
});

verifyBtn.addEventListener("click", async () => {
  verifyBtn.disabled = true;
  bulkStatus.textContent = "Checking logbooks…";
  bulkStatus.className = "rn-sb-status";
  let checked = 0;
  let skipped = 0;
  for (const p of rows) {
    if (!p.infiniteFlightUserId || !p.originIcao || !p.destinationIcao || !p.flightDate) {
      skipped++;
      continue;
    }
    try {
      const { data, error } = await supabase.functions.invoke("pirep-verify", {
        body: {
          infiniteFlightUserId: p.infiniteFlightUserId,
          originIcao: p.originIcao,
          destinationIcao: p.destinationIcao,
          flightDate: p.flightDate,
        },
      });
      if (!error && data) {
        await supabase.from("pireps").update({
          verification_status: data.verified ? "verified" : "unverified",
          if_logbook_flight_id: data.matchedFlightId,
          logged_flight_minutes: data.loggedMinutes,
        }).eq("id", p.id);
        checked++;
      } else {
        skipped++;
      }
    } catch (err) {
      console.error("[crew-pireps] pirep-verify failed", err);
      skipped++;
    }
  }
  bulkStatus.textContent = `Checked ${checked} PIREP(s)${skipped ? `, skipped ${skipped} (no linked Infinite Flight account)` : ""}.`;
  verifyBtn.disabled = false;
  await loadAndRender();
});

approveAllBtn.addEventListener("click", async () => {
  const eligible = rows.filter((p) => p.multiplierType === "none" && p.verificationStatus === "verified");
  if (!eligible.length) {
    bulkStatus.textContent = "No verified, non-multiplier PIREPs to approve.";
    bulkStatus.className = "rn-sb-status";
    return;
  }
  approveAllBtn.disabled = true;
  await Promise.all(eligible.map((p) => reviewOne(p, "approved")));
  bulkStatus.textContent = `Approved ${eligible.length} PIREP(s).`;
  bulkStatus.className = "rn-sb-status success";
  approveAllBtn.disabled = false;
  await loadAndRender();
});

rejectAllBtn.addEventListener("click", async () => {
  const eligible = rows.filter((p) => p.multiplierType === "none" && p.verificationStatus === "unverified");
  if (!eligible.length) {
    bulkStatus.textContent = "No unverified, non-multiplier PIREPs to reject.";
    bulkStatus.className = "rn-sb-status";
    return;
  }
  rejectAllBtn.disabled = true;
  await Promise.all(eligible.map((p) => reviewOne(p, "rejected")));
  bulkStatus.textContent = `Rejected ${eligible.length} PIREP(s).`;
  bulkStatus.className = "rn-sb-status success";
  rejectAllBtn.disabled = false;
  await loadAndRender();
});

document.getElementById("logoutLink").addEventListener("click", async (e) => {
  e.preventDefault();
  await supabase.auth.signOut();
  window.location.href = "auth.html";
});

await loadAndRender();
