// Shared deterministic scheduling logic -- used both by the staff
// auto-fill button (career-schedule.js) and automatically at import time
// (import.js), so every new PAL/PAL Express route gets a plausible
// departure time the moment it's imported, with no separate manual step
// required. Deterministic (hash of flight number, not Math.random) so
// re-computing for the same route always gives the same time.
export const CAREER_AIRLINES = ["Philippine Airlines", "PAL Express"];
export const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) >>> 0;
  return h;
}

// Biased by distance toward the pattern actually observed in the real
// AviationStack import: long-haul PRVA departures cluster early-morning or
// overnight rather than being spread evenly through the day.
export function assignPlausibleTime(flightNumber, distanceNm) {
  const hash = hashString(flightNumber);
  const distance = distanceNm || 0;
  let hourOptions;
  if (distance > 3000) hourOptions = [1, 2, 3, 6, 7, 22, 23, 0];
  else if (distance > 800) hourOptions = [6, 7, 8, 17, 18, 19, 20];
  else hourOptions = [5, 6, 8, 9, 11, 13, 15, 17, 19, 21];
  const hour = hourOptions[hash % hourOptions.length];
  const minute = Math.floor((hash / hourOptions.length) % 60);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
}

// Creates career_schedules rows for any of the given routes that don't
// already have one, for the airlines Career Mode covers. Silently no-ops
// for routes on other airlines or that are already scheduled -- safe to
// call after every import without needing to check anything first.
export async function autoScheduleNewRoutes(supabase, insertedRoutes) {
  if (!insertedRoutes?.length) return { scheduled: 0 };

  const { data: airlines, error: airlinesErr } = await supabase
    .from("airlines").select("id, name").in("name", CAREER_AIRLINES);
  if (airlinesErr || !airlines?.length) return { scheduled: 0, error: airlinesErr };
  const careerAirlineIds = new Set(airlines.map((a) => a.id));

  const eligible = insertedRoutes.filter((r) => careerAirlineIds.has(r.airline_id));
  if (!eligible.length) return { scheduled: 0 };

  const routeIds = eligible.map((r) => r.id);
  const { data: existing, error: existingErr } = await supabase
    .from("career_schedules").select("route_id").in("route_id", routeIds);
  if (existingErr) return { scheduled: 0, error: existingErr };
  const alreadyScheduled = new Set((existing || []).map((s) => s.route_id));

  const toInsert = eligible
    .filter((r) => !alreadyScheduled.has(r.id))
    .map((r) => ({
      route_id: r.id,
      airline_id: r.airline_id,
      departure_time_local: assignPlausibleTime(r.flight_number, r.distance_nm),
      days_of_week: ALL_DAYS,
      active: true,
      source: "derived",
      notes: "Auto-assigned at import time -- not sourced from real-world data.",
    }));
  if (!toInsert.length) return { scheduled: 0 };

  const { error: insertErr } = await supabase.from("career_schedules").insert(toInsert);
  if (insertErr) return { scheduled: 0, error: insertErr };
  return { scheduled: toInsert.length };
}
