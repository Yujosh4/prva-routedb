// SimBrief integration -- both calls here are confirmed to need no API key and
// no server-side proxy (verified directly: the fetcher endpoint responds with
// real JSON to a plain client-side fetch, no CORS error). Sourced from
// Navigraph's own guides, not guessed:
//   - Dispatch redirect: https://forum.navigraph.com/t/dispatch-redirect-guide/5299
//   - Latest OFP fetch:  https://forum.navigraph.com/t/fetching-a-users-latest-ofp-data/5297
// The registered API key (kept out of the browser, unused for now) is only
// needed for the full custom PHP/JS integration kit -- a deeper integration
// for later (e.g. Crew Center's PIREP auto-validation), not this.

// ICAO type designators are stable, well-established identifiers -- this
// list only covers aircraft actually seen in PRVA's route data so far.
// Unmapped types are simply omitted from the prefill rather than guessed.
const ICAO_TYPE_MAP = {
  "dash 8 q400": "DH8D",
  "a320": "A320",
  "a321": "A321",
  "a321-200": "A321",
  "a330-300": "A333",
  "a350-900": "A359",
  "a350-1000": "A35K",
  "b777-300er": "B77W",
  "777-300er": "B77W",
  "md-11": "MD11",
  "dc-10": "DC10",
  "b747-400": "B744",
  "747-400": "B744",
};

function toIcaoType(name) {
  if (!name) return null;
  return ICAO_TYPE_MAP[String(name).trim().toLowerCase()] || null;
}

export function buildDispatchUrl({ origin, destination, aircraftTypes, flightNumber }) {
  const params = new URLSearchParams();
  if (origin) params.set("orig", origin);
  if (destination) params.set("dest", destination);
  const icaoType = (aircraftTypes || []).map(toIcaoType).find(Boolean);
  if (icaoType) params.set("type", icaoType);
  // Only pass fltnum when the flight number cleanly splits into a letter
  // prefix + digits (e.g. "PR100" -> 100) -- historic entries like
  // "PR102H (A)" don't, so those are left for the pilot to fill in.
  const m = String(flightNumber || "").match(/^[A-Za-z]{2,3}(\d+)$/);
  if (m) params.set("fltnum", m[1]);
  return `https://dispatch.simbrief.com/options/custom?${params.toString()}`;
}

export async function fetchLatestOfp(username) {
  const res = await fetch(
    `https://www.simbrief.com/api/xml.fetcher.php?username=${encodeURIComponent(username)}&json=v2`
  );
  const data = await res.json();
  const status = data?.fetch?.status || "";
  if (status.toLowerCase().includes("error")) {
    throw new Error(status);
  }
  return data;
}
