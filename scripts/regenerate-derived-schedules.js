// One-off maintenance script. career-autofill.js's day-of-week logic used
// to default every auto-scheduled route to flying all 7 days -- which is
// what actually made the Career Mode calendar feel overwhelming (every
// route showing on every single day). That logic is now fixed to assign
// realistic, distance-biased day patterns, but the ~334 career_schedules
// rows already generated under the old logic don't pick that up on their
// own. This recomputes days_of_week for exactly those rows (source =
// 'derived' only -- real_world_api rows are real data and untouched), and
// removes any derived schedule left over for a route that's since gone
// historic/inactive, using the same rule the fixed auto-scheduler applies
// to new imports.
//
// Run once locally: node regenerate-derived-schedules.js
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

// Mirrors assignPlausibleDays() in js/career-autofill.js exactly -- inlined
// here rather than imported because that file sits outside this Node
// package's ESM boundary (its nearest package.json has no "type": "module",
// so Node resolves it as CommonJS and the named export fails).
function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) >>> 0;
  return h;
}
const DAILY = [1, 2, 3, 4, 5, 6, 7];
const SIX_SKIP_SUN = [1, 2, 3, 4, 5, 6];
const SIX_SKIP_WED = [1, 2, 4, 5, 6, 7];
const WEEKDAYS = [1, 2, 3, 4, 5];
const FOUR_SPREAD = [1, 3, 5, 7];
const MON_WED_FRI = [1, 3, 5];
const TUE_THU_SAT = [2, 4, 6];
const WEEKEND_LEISURE = [5, 6, 7];
function dayPatternPool(distanceNm) {
  const d = distanceNm || 0;
  if (d > 3000) return [DAILY, DAILY, DAILY, SIX_SKIP_SUN, SIX_SKIP_WED];
  if (d > 800) return [DAILY, DAILY, SIX_SKIP_SUN, SIX_SKIP_WED, FOUR_SPREAD, WEEKDAYS];
  return [DAILY, SIX_SKIP_SUN, FOUR_SPREAD, MON_WED_FRI, TUE_THU_SAT, WEEKDAYS, WEEKEND_LEISURE];
}
function assignPlausibleDays(flightNumber, distanceNm) {
  const hash = hashString(flightNumber + ":days");
  const pool = dayPatternPool(distanceNm);
  return pool[hash % pool.length];
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const { data: schedules, error } = await supabase
    .from("career_schedules")
    .select("id, route_id, days_of_week, route:routes(flight_number, distance_nm, category, active)")
    .eq("source", "derived");
  if (error) throw error;

  console.log(`Found ${schedules.length} derived schedule rows.`);

  const staleIds = schedules.filter((s) => !s.route || s.route.category !== "current" || s.route.active === false).map((s) => s.id);
  const toRecompute = schedules.filter((s) => s.route && s.route.category === "current" && s.route.active !== false);

  let updated = 0;
  for (const s of toRecompute) {
    const newDays = assignPlausibleDays(s.route.flight_number, s.route.distance_nm);
    const same = JSON.stringify([...s.days_of_week].sort()) === JSON.stringify([...newDays].sort());
    if (same) continue;
    const { error: updErr } = await supabase.from("career_schedules").update({ days_of_week: newDays }).eq("id", s.id);
    if (updErr) {
      console.error(`Failed to update ${s.id}:`, updErr.message);
      continue;
    }
    updated++;
  }

  if (staleIds.length) {
    const { error: delErr } = await supabase.from("career_schedules").delete().in("id", staleIds);
    if (delErr) console.error("Failed to remove stale schedules:", delErr.message);
  }

  console.log(`Updated ${updated} rows with a new day-of-week pattern.`);
  console.log(`Removed ${staleIds.length} schedule rows for routes that are no longer current/active.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
