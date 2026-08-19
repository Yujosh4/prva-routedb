// One-off maintenance script. Pre-fills career_schedules.terminal using the
// real NAIA rule Martin confirmed: PAL mainline splits by international
// (Terminal 1) vs domestic (Terminal 2); PAL Express is Terminal 2 except
// PR521/PR522, which are its one international pairing and use Terminal 1.
// Only touches rows where terminal is currently null -- never overwrites a
// value staff already set manually in career-schedule.html.
//
// Run once locally: node backfill-terminals.js
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const PAL_EXPRESS_INTL_FLIGHTS = new Set(["PR521", "PR522"]);

async function main() {
  const { data: airlines, error: airlinesErr } = await supabase
    .from("airlines").select("id, name").in("name", ["Philippine Airlines", "PAL Express"]);
  if (airlinesErr) throw airlinesErr;
  const palId = airlines.find((a) => a.name === "Philippine Airlines")?.id;
  const palExpressId = airlines.find((a) => a.name === "PAL Express")?.id;

  const { data: schedules, error } = await supabase
    .from("career_schedules")
    .select(`id, terminal, airline_id,
      route:routes(flight_number,
        origin:airports!routes_origin_icao_fkey(country),
        destination:airports!routes_destination_icao_fkey(country))`)
    .is("terminal", null)
    .in("airline_id", [palId, palExpressId]);
  if (error) throw error;

  console.log(`Found ${schedules.length} schedule rows with no terminal set.`);

  let updated = 0;
  for (const s of schedules) {
    if (!s.route) continue;
    let terminal;
    if (s.airline_id === palId) {
      const domestic = s.route.origin?.country === "PH" && s.route.destination?.country === "PH";
      terminal = domestic ? "T2" : "T1";
    } else {
      terminal = PAL_EXPRESS_INTL_FLIGHTS.has(s.route.flight_number) ? "T1" : "T2";
    }
    const { error: updErr } = await supabase.from("career_schedules").update({ terminal }).eq("id", s.id);
    if (updErr) {
      console.error(`Failed to update ${s.id}:`, updErr.message);
      continue;
    }
    updated++;
  }

  console.log(`Set terminal on ${updated} rows.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
