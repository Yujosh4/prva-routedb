// SimBrief integration. Three mechanisms, sourced from Navigraph's own
// guides and reference kit, not guessed:
//   - Dispatch redirect (buildDispatchUrl): no key needed.
//     https://forum.navigraph.com/t/dispatch-redirect-guide/5299
//   - Latest OFP fetch (fetchLatestOfp): no key needed.
//     https://forum.navigraph.com/t/fetching-a-users-latest-ofp-data/5297
//   - Popup-based auto-generation (openDispatchPopup): DOES need the
//     registered API key, ported from SimBrief's official kit
//     (https://www.simbrief.com/api/SimBrief_APIv1.zip -> simbrief.apiv1.js
//     + simbrief.apiv1.php). The key never reaches the browser -- only the
//     signed "api_code" it produces does, computed server-side by the
//     simbrief-auth-code Edge Function. This still opens a small SimBrief
//     login popup (SimBrief's terms don't allow bypassing that), but skips
//     the pilot having to land on and manually submit SimBrief's own
//     dispatch form -- generation happens in the popup, then this fetches
//     the result back via fetchLatestOfp once it closes.
import { supabase } from "./supabase-client.js";
import { extractCharts } from "./route-map.js";

// ICAO type designators are stable, well-established identifiers -- this
// list only covers aircraft actually seen in PRVA's route data so far.
// Unmapped types are simply omitted from the prefill rather than guessed.
const ICAO_TYPE_MAP = {
  "dash 8 q400": "DH8D",
  "dash 8-400": "DH8D",
  "a320": "A320",
  "a320-200": "A320",
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

// PRVA's own fixed tail per ICAO type, as given by Martin. A320 has no
// livery in Infinite Flight yet, so its entry is a literal placeholder
// ("RP-C####") rather than a real registration.
const REGISTRATION_MAP = {
  A359: "RP-C3506",
  B77W: "RP-C7777",
  A321: "RP-C9907",
  A333: "RP-C8780",
  A35K: "RP-C3510",
  DH8D: "RP-C3031",
  A320: "RP-C####",
  B744: "RP-C7471",
  MD11: "N276WA",
};

function toIcaoType(name) {
  if (!name) return null;
  return ICAO_TYPE_MAP[String(name).trim().toLowerCase()] || null;
}

// Builds the list of {sourceName, icao, reg} options a route's aircraft_types
// array maps to, for a pilot-facing picker. Types with no known ICAO
// mapping are dropped rather than shown as a broken/unusable option.
export function aircraftOptionsFor(aircraftTypes) {
  return (aircraftTypes || [])
    .map((name) => {
      const icao = toIcaoType(name);
      return icao ? { sourceName: name, icao, reg: REGISTRATION_MAP[icao] || null } : null;
    })
    .filter(Boolean);
}

export function buildDispatchUrl({ origin, destination, aircraftIcao, reg, flightNumber }) {
  const params = new URLSearchParams();
  if (origin) params.set("orig", origin);
  if (destination) params.set("dest", destination);
  if (aircraftIcao) params.set("type", aircraftIcao);
  if (reg) params.set("reg", reg);
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

function waitForPopupClose(popup) {
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (popup.closed) {
        clearInterval(timer);
        resolve();
      }
    }, 500);
  });
}

// Opens the SimBrief login+generate popup with this route pre-filled, waits
// for it to close, then fetches the pilot's now-freshly-generated OFP.
// Rejects with a clear, user-facing message on every failure path (popup
// blocked, aircraft type not recognized, auth code request failed) so the
// caller can show it directly and suggest the manual fallback.
export async function generateViaPopup({ origin, destination, aircraftIcao, reg, flightNumber }, username) {
  const type = aircraftIcao;
  if (!origin || !destination || !type) {
    throw new Error("Missing origin, destination, or a recognized aircraft type -- try Filing Manually instead.");
  }
  const fltnumMatch = String(flightNumber || "").match(/^[A-Za-z]{2,3}(\d+)$/);
  const fltnum = fltnumMatch ? fltnumMatch[1] : "";

  const timestamp = Math.round(Date.now() / 1000);
  // SimBrief's own reference kit only strips a literal "http://" prefix
  // (a legacy-era quirk) -- kept exact so the signature this produces
  // matches what SimBrief's backend independently recomputes to validate
  // the request. The value itself doesn't matter to this app (no redirect
  // dance -- see the popup-close handling below), only that it's identical
  // between the string we sign and the field we submit.
  const outputpageCalc = location.href.replace("http://", "");
  const api_req = origin + destination + type + timestamp + outputpageCalc;

  if (!supabase) {
    throw new Error("Supabase isn't connected yet -- can't request a signed SimBrief authorization code.");
  }
  const { data, error } = await supabase.functions.invoke("simbrief-auth-code", { body: { api_req } });
  if (error || !data?.api_code) {
    throw new Error("Couldn't get SimBrief authorization -- try again in a moment, or File Manually instead.");
  }

  const popup = window.open("about:blank", "SBworker", "width=600,height=315");
  if (!popup) {
    throw new Error("Your browser blocked the SimBrief popup -- allow popups for this site and try again.");
  }
  popup.focus();

  const form = document.createElement("form");
  form.method = "get";
  form.action = "https://www.simbrief.com/ofp/ofp.loader.api.php";
  form.target = "SBworker";
  form.style.display = "none";
  const fields = { orig: origin, dest: destination, type, reg, fltnum, apicode: data.api_code, outputpage: outputpageCalc, timestamp };
  for (const [name, value] of Object.entries(fields)) {
    if (value === "" || value == null) continue;
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
  document.body.removeChild(form);

  await waitForPopupClose(popup);
  return fetchLatestOfp(username);
}

// A full SimBrief OFP is large (full navlog, weather, weights, everything)
// -- easily hundreds of KB per plan, which blows through localStorage's
// ~5-10MB quota after just a couple of entries. Active Route only ever
// needs a handful of summary fields plus map points, so that's all that
// gets persisted -- the full object is only held in memory right after
// generation, never written to storage.
// Field names below are confirmed against a real OFP response (fetched
// directly for verification), not guessed -- est_time_enroute in
// particular is a "HH:MM:SS" string, not a seconds count, which is what
// caused the block time to show as "NaNh NaNm" before this was checked.
function parseHms(hms) {
  const m = String(hms || "").match(/^(\d+):(\d{2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

export function summarizeOfp(ofp) {
  if (!ofp) return null;
  return {
    aircraft: ofp.aircraft?.icaocode || ofp.aircraft?.name || null,
    route: ofp.general?.route || null,
    block_minutes: parseHms(ofp.times?.est_time_enroute),
    charts: extractCharts(ofp),
  };
}
