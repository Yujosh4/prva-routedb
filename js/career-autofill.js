// Shared deterministic scheduling logic -- used both by the staff
// auto-fill button (career-schedule.js) and automatically at import time
// (import.js), so every new PAL/PAL Express route gets a plausible
// departure time the moment it's imported, with no separate manual step
// required. Deterministic (hash of flight number, not Math.random) so
// re-computing for the same route always gives the same time.
export const CAREER_AIRLINES = ["Philippine Airlines", "PAL Express"];
export const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

export function hashString(str) {
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

// Day-of-week patterns, ISO numbering (1=Mon..7=Sun). Not every real route
// flies daily -- thin regional routes especially don't -- so defaulting
// every auto-scheduled route to all 7 days was both unrealistic and the
// reason the calendar felt like every single flight showed up every day.
const DAILY = [1, 2, 3, 4, 5, 6, 7];
const SIX_SKIP_SUN = [1, 2, 3, 4, 5, 6];
const SIX_SKIP_WED = [1, 2, 4, 5, 6, 7];
const WEEKDAYS = [1, 2, 3, 4, 5];
const FOUR_SPREAD = [1, 3, 5, 7];
const MON_WED_FRI = [1, 3, 5];
const TUE_THU_SAT = [2, 4, 6];
const WEEKEND_LEISURE = [5, 6, 7];

// Long-haul routes in real fleets are almost always daily or near-daily;
// short/regional routes vary a lot more, down to a few times a week.
function dayPatternPool(distanceNm) {
  const d = distanceNm || 0;
  if (d > 3000) return [DAILY, DAILY, DAILY, SIX_SKIP_SUN, SIX_SKIP_WED];
  if (d > 800) return [DAILY, DAILY, SIX_SKIP_SUN, SIX_SKIP_WED, FOUR_SPREAD, WEEKDAYS];
  return [DAILY, SIX_SKIP_SUN, FOUR_SPREAD, MON_WED_FRI, TUE_THU_SAT, WEEKDAYS, WEEKEND_LEISURE];
}

export function assignPlausibleDays(flightNumber, distanceNm) {
  const hash = hashString(flightNumber + ":days");
  const pool = dayPatternPool(distanceNm);
  return pool[hash % pool.length];
}

export function assignPlausibleSchedule(flightNumber, distanceNm) {
  return {
    departure_time_local: assignPlausibleTime(flightNumber, distanceNm),
    days_of_week: assignPlausibleDays(flightNumber, distanceNm),
  };
}

// NAIA terminal assignment -- real operational fact confirmed by Martin,
// not a fabricated guess: PAL mainline splits Terminal 1 (international) /
// Terminal 2 (domestic); PAL Express is Terminal 2 except its one
// international pairing, PR521/PR522, which uses Terminal 1. Gate stays
// staff-only (js/career-schedule.js) since it varies per flight in a way
// this rule can't capture.
const PAL_EXPRESS_INTL_FLIGHTS = new Set(["PR521", "PR522"]);

export function assignPlausibleTerminal(airlineName, flightNumber, originCountry, destinationCountry) {
  if (airlineName === "Philippine Airlines") {
    const domestic = originCountry === "PH" && destinationCountry === "PH";
    return domestic ? "T2" : "T1";
  }
  if (airlineName === "PAL Express") {
    return PAL_EXPRESS_INTL_FLIGHTS.has(flightNumber) ? "T1" : "T2";
  }
  return null;
}

// Creates career_schedules rows for any of the given routes that don't
// already have one, for the airlines Career Mode covers. Silently no-ops
// for routes on other airlines, routes that are historic/inactive, or
// routes that are already scheduled -- safe to call after every import
// without needing to check anything first.
export async function autoScheduleNewRoutes(supabase, insertedRoutes) {
  if (!insertedRoutes?.length) return { scheduled: 0 };

  const { data: airlines, error: airlinesErr } = await supabase
    .from("airlines").select("id, name").in("name", CAREER_AIRLINES);
  if (airlinesErr || !airlines?.length) return { scheduled: 0, error: airlinesErr };
  const careerAirlineIds = new Set(airlines.map((a) => a.id));
  const airlineNameById = new Map(airlines.map((a) => [a.id, a.name]));

  // Career Mode only covers routes actually being flown right now -- a
  // suspended or historic route shouldn't get a fabricated recurring
  // schedule just because it happened to be part of an import batch.
  const eligible = insertedRoutes.filter(
    (r) => careerAirlineIds.has(r.airline_id) && r.category === "current" && r.active !== false
  );
  if (!eligible.length) return { scheduled: 0 };

  const routeIds = eligible.map((r) => r.id);
  const { data: existing, error: existingErr } = await supabase
    .from("career_schedules").select("route_id").in("route_id", routeIds);
  if (existingErr) return { scheduled: 0, error: existingErr };
  const alreadyScheduled = new Set((existing || []).map((s) => s.route_id));

  const toSchedule = eligible.filter((r) => !alreadyScheduled.has(r.id));
  if (!toSchedule.length) return { scheduled: 0 };

  const icaos = [...new Set(toSchedule.flatMap((r) => [r.origin_icao, r.destination_icao]))];
  const { data: airports, error: airportsErr } = await supabase
    .from("airports").select("icao, country").in("icao", icaos);
  if (airportsErr) return { scheduled: 0, error: airportsErr };
  const countryByIcao = new Map((airports || []).map((a) => [a.icao, a.country]));

  const toInsert = toSchedule.map((r) => ({
    route_id: r.id,
    airline_id: r.airline_id,
    ...assignPlausibleSchedule(r.flight_number, r.distance_nm),
    active: true,
    terminal: assignPlausibleTerminal(
      airlineNameById.get(r.airline_id),
      r.flight_number,
      countryByIcao.get(r.origin_icao),
      countryByIcao.get(r.destination_icao)
    ),
    source: "derived",
    notes: "Auto-assigned at import time -- not sourced from real-world data.",
  }));

  const { error: insertErr } = await supabase.from("career_schedules").insert(toInsert);
  if (insertErr) return { scheduled: 0, error: insertErr };
  return { scheduled: toInsert.length };
}
