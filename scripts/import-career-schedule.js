// One-time/occasional enrichment script -- looks up real Philippine
// Airlines / PAL Express scheduled departure times from AviationStack's
// free tier (100 requests/month) and writes them into career_schedules.
//
// Runs locally only, on purpose: AviationStack's key has a hard monthly
// quota, and a browser-based tool would expose it in the page source where
// anyone viewing the site could exhaust it. This never touches a browser
// or gets deployed anywhere.
//
// Confirmed against a real lookup (PR102) before this was written: a
// single request returns that flight's schedule for one specific date, not
// a weekly pattern. Verifying the actual day-of-week operating pattern
// would cost ~7 requests per flight -- at 100/month that only covers ~14
// routes. Instead, this does ONE lookup per flight number and assumes
// daily operation, which is flagged explicitly in each row's `notes` and
// `source` field so it's never mistaken for verified data.
//
// Setup:
//   1. cd "Route Network Database/scripts" && npm install
//   2. Copy .env.example to .env and fill in the three values (get
//      SUPABASE_SERVICE_ROLE_KEY from Project Settings -> API -- this
//      script needs it to write past RLS without a staff browser session;
//      never commit this file, never paste this key anywhere else)
//   3. node import-career-schedule.js
//
// Safe to re-run later (e.g. next month once quota resets) -- it skips
// routes that already have a real_world_api row.

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AVIATIONSTACK_KEY } = process.env;
const MAX_LOOKUPS = parseInt(process.env.MAX_LOOKUPS || "90", 10); // headroom under the 100/month cap

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !AVIATIONSTACK_KEY) {
  console.error("Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or AVIATIONSTACK_KEY in .env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const CAREER_AIRLINES = ["Philippine Airlines", "PAL Express"];

function toLocalTime(isoUtc, timeZone) {
  const date = new Date(isoUtc);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("hour")}:${get("minute")}:${get("second")}`;
}

async function fetchAviationStackFlight(flightIata) {
  const url = `http://api.aviationstack.com/v1/flights?access_key=${AVIATIONSTACK_KEY}&flight_iata=${encodeURIComponent(flightIata)}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
  return json.data?.[0] || null;
}

async function main() {
  console.log("Fetching PAL / PAL Express routes...");
  const { data: airlines, error: airlinesErr } = await supabase
    .from("airlines").select("id, name").in("name", CAREER_AIRLINES);
  if (airlinesErr) throw airlinesErr;
  if (!airlines.length) {
    console.error(`No airlines found matching ${CAREER_AIRLINES.join(", ")} -- check exact names in the airlines table.`);
    process.exit(1);
  }
  const airlineIds = airlines.map((a) => a.id);

  const { data: routes, error: routesErr } = await supabase
    .from("routes").select("id, flight_number, airline_id")
    .in("airline_id", airlineIds).eq("active", true).eq("category", "current");
  if (routesErr) throw routesErr;

  const { data: existing, error: existingErr } = await supabase
    .from("career_schedules").select("route_id").eq("source", "real_world_api");
  if (existingErr) throw existingErr;
  const alreadyDone = new Set((existing || []).map((r) => r.route_id));

  const todo = routes.filter((r) => !alreadyDone.has(r.id)).slice(0, MAX_LOOKUPS);
  console.log(`${routes.length} eligible routes, ${alreadyDone.size} already enriched, looking up ${todo.length} now.`);

  let success = 0, notFound = 0, failed = 0;

  for (const route of todo) {
    // Historic-style numbers like "PR102H (A)" aren't real IATA flight
    // numbers and won't match anything real -- skip without spending quota.
    if (!/^[A-Za-z]{2}\d{1,4}$/.test(route.flight_number)) {
      console.log(`Skipping ${route.flight_number} -- not a clean flight number.`);
      continue;
    }

    try {
      const flight = await fetchAviationStackFlight(route.flight_number);
      if (!flight?.departure?.scheduled || !flight?.departure?.timezone) {
        console.log(`No real schedule data found for ${route.flight_number}.`);
        notFound++;
        continue;
      }

      const localTime = toLocalTime(flight.departure.scheduled, flight.departure.timezone);
      const { error: insertErr } = await supabase.from("career_schedules").insert({
        route_id: route.id,
        airline_id: route.airline_id,
        departure_time_local: localTime,
        days_of_week: [1, 2, 3, 4, 5, 6, 7], // assumed daily -- see notes
        source: "real_world_api",
        notes: `Departure time from a real AviationStack snapshot on ${flight.flight_date} (${flight.departure.airport} -> ${flight.arrival?.airport}). Day-of-week operating pattern not independently verified -- assumed daily.`,
      });
      if (insertErr) throw insertErr;

      console.log(`OK ${route.flight_number}: ${localTime} local (${flight.departure.timezone})`);
      success++;
    } catch (err) {
      console.error(`FAIL ${route.flight_number}: ${err.message}`);
      failed++;
      if (String(err.message).toLowerCase().includes("usage_limit")) {
        console.error("AviationStack quota looks exhausted -- stopping early.");
        break;
      }
    }

    await new Promise((r) => setTimeout(r, 300)); // no need to hammer the API
  }

  console.log(`\nDone. ${success} succeeded, ${notFound} had no data, ${failed} failed.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
