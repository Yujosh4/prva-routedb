// Career Mode only: keeps pilots from always defaulting to their favorite
// widebody on routes that are realistically flown on multiple types.
// Narrowbodies (and anything not explicitly marked) are always available.
// A widebody staff has flagged "Occasional" in a route's remarks (real
// text they typed after adding the type to the spreadsheet, not
// fabricated) has only a chance of actually being offered on any given
// day -- deterministic per (route, date, aircraft), so it's consistent
// within a day and varies day to day, same pattern as career-disruptions.js.
import { hashString } from "./career-autofill.js";

const OCCASIONAL_AVAILABILITY_RATE = 0.35;

// Parses "Occasional A359" / "Occasional A359 & A35K" out of a route's
// staff-written remarks into the ICAO type codes it names.
export function occasionalIcaoCodes(notes) {
  const m = String(notes || "").match(/Occasional\s+([A-Z0-9]+)(?:\s*&\s*([A-Z0-9]+))?/i);
  if (!m) return new Set();
  return new Set([m[1], m[2]].filter(Boolean).map((s) => s.toUpperCase()));
}

export function isAircraftAvailableToday(routeId, dateKey, aircraftIcao, occasionalSet) {
  if (!occasionalSet.has(aircraftIcao)) return true;
  if (!dateKey) return true; // no date context to roll against -- fail open rather than hide options
  const hash = hashString(`${routeId}:${dateKey}:${aircraftIcao}:availability`);
  return (hash % 10000) / 10000 < OCCASIONAL_AVAILABILITY_RATE;
}
