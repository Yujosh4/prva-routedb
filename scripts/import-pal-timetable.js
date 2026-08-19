// One-off import: replaces derived (fake) departure times/day-patterns with
// PAL's own published summer timetable (Media/*.pdf), which Martin found
// and confirmed is real/current. Solves two problems the hash-based
// "derived" times had at once: unrealistic clustering (many routes landing
// in the same narrow hour window, showing as "Departing now" simultaneously)
// and just not being real. Only UPDATES career_schedules rows that already
// exist (matched by flight_number + airline) -- it does not create new
// routes or new schedule rows; run Auto-Fill first for any route that
// doesn't have a schedule entry yet.
//
// PAL's timetable covers a summer season (Mar 29 - Oct 24, 2026) and often
// lists the SAME flight number multiple times with different day-patterns
// valid only in sub-ranges of that season (e.g. "Mo-Tu-Th-Sa" normally, but
// "We-Fr-Su (Until Sep 30/Oct 23)" as a seasonal override). Our schema has
// no concept of a schedule row's date-range validity, so this picks ONE
// representative pattern per flight number -- preferring whichever row has
// no parenthetical date qualifier (i.e. the general/base pattern), falling
// back to the first-listed row otherwise. This is a real, deliberate
// simplification, not a parsing bug.
//
// Run once locally: node import-pal-timetable.js
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { execSync } from "node:child_process";
import fs from "node:fs";

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const MEDIA_DIR = "/Users/martinyu/Desktop/PRVA/Media";
const PDFS = [
  `${MEDIA_DIR}/260729-Domestic-Summer-Jul-29-2026.pdf`,
  `${MEDIA_DIR}/260729-INTL-Summr-as-of-Jul-29-2026.pdf`,
];

const DAY_CODES = { Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6, Su: 7 };

// PR521/PR522 are PAL Express's one international pairing (per Martin,
// with a hedge -- "I think") -- same special case already used for
// terminal assignment in career-autofill.js. Every other PAL Express
// flight is a 4-digit number starting with "2", per the domestic
// timetable's own footnote ("All flights with four-digit numbers that
// start with '2' are operated by Air Philippines Corporation").
const PAL_EXPRESS_SPECIAL = new Set(["PR521", "PR522"]);

function airlineForFlightNumber(flightNumber) {
  if (PAL_EXPRESS_SPECIAL.has(flightNumber)) return "PAL Express";
  const digits = flightNumber.replace("PR", "");
  return digits.startsWith("2") ? "PAL Express" : "Philippine Airlines";
}

function parseDays(frequencyTextRaw) {
  const frequencyText = frequencyTextRaw.replace(/\([^)]*\)/g, "").trim();
  if (/^Daily$/i.test(frequencyText)) return [1, 2, 3, 4, 5, 6, 7];
  const days = frequencyText
    .split("-")
    .map((s) => DAY_CODES[s.trim()])
    .filter(Boolean);
  return days.length ? [...new Set(days)].sort((a, b) => a - b) : null;
}

// Matches both columns of a timetable row: "PR 2129   Daily    04:05  05:25  [+1]"
const ROW_RE = /PR\s*(\d+)\s+([A-Za-z0-9,\-/.() ]+?)\s+(\d{2}:\d{2})\s+(\d{2}:\d{2})\s*(\+\d)?(?=\s|$)/g;

function extractRows(pdfPath) {
  const txtPath = pdfPath.replace(/\.pdf$/i, ".extracted.txt");
  execSync(`pdftotext -layout "${pdfPath}" "${txtPath}"`);
  const text = fs.readFileSync(txtPath, "utf8");
  fs.unlinkSync(txtPath);
  const rows = [];
  for (const line of text.split("\n")) {
    for (const m of line.matchAll(ROW_RE)) {
      rows.push({ flightNumber: "PR" + m[1], frequencyText: m[2].trim(), departTime: m[3] });
    }
  }
  return rows;
}

function pickPrimary(rows) {
  return rows.find((r) => !r.frequencyText.includes("(")) || rows[0];
}

async function main() {
  const allRows = PDFS.flatMap(extractRows);
  const byFlight = new Map();
  for (const r of allRows) {
    if (!byFlight.has(r.flightNumber)) byFlight.set(r.flightNumber, []);
    byFlight.get(r.flightNumber).push(r);
  }
  console.log(`Parsed ${allRows.length} timetable rows across both PDFs, ${byFlight.size} unique flight numbers.`);

  const { data: airlines, error: airlinesErr } = await supabase
    .from("airlines").select("id, name").in("name", ["Philippine Airlines", "PAL Express"]);
  if (airlinesErr) throw airlinesErr;
  const airlineIdByName = new Map(airlines.map((a) => [a.name, a.id]));

  let updated = 0, unmatchedRoute = 0, noSchedule = 0, badFrequency = 0, duplicateFlightNumbers = 0;

  for (const [flightNumber, rows] of byFlight) {
    const primary = pickPrimary(rows);
    const days = parseDays(primary.frequencyText);
    if (!days) {
      badFrequency++;
      console.log(`  Skipped ${flightNumber}: couldn't parse frequency "${primary.frequencyText}"`);
      continue;
    }

    // Flight numbers aren't always unique within an airline -- some spreadsheet
    // imports have the same number on more than one route row (different legs/
    // dates). Apply the same real time/days to every route sharing that number
    // rather than assuming exactly one match.
    const airlineId = airlineIdByName.get(airlineForFlightNumber(flightNumber));
    const { data: matchingRoutes, error: routeErr } = await supabase
      .from("routes").select("id")
      .eq("flight_number", flightNumber).eq("airline_id", airlineId)
      .eq("category", "current").eq("active", true);
    if (routeErr) throw routeErr;
    if (!matchingRoutes?.length) {
      unmatchedRoute++;
      continue;
    }
    if (matchingRoutes.length > 1) duplicateFlightNumbers++;

    for (const route of matchingRoutes) {
      const { data: existing, error: existingErr } = await supabase
        .from("career_schedules").select("id")
        .eq("route_id", route.id);
      if (existingErr) throw existingErr;
      if (!existing?.length) {
        noSchedule++;
        continue;
      }

      const { error: updErr } = await supabase.from("career_schedules").update({
        departure_time_local: primary.departTime + ":00",
        days_of_week: days,
        source: "real_world_pdf",
        notes: "From PAL's published summer timetable (as of Jul 29, 2026).",
      }).in("id", existing.map((s) => s.id));
      if (updErr) throw updErr;
      updated += existing.length;
    }
  }

  console.log(`\nUpdated ${updated} schedule rows with real departure times/days.`);
  console.log(`${unmatchedRoute} flight numbers had no matching route in the database.`);
  console.log(`${noSchedule} route(s) matched a flight number but had no schedule row yet -- run Auto-Fill first, then re-run this script.`);
  console.log(`${badFrequency} rows had frequency text that couldn't be parsed into days.`);
  console.log(`${duplicateFlightNumbers} flight numbers matched more than one route -- the same real time/days were applied to all of them.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
