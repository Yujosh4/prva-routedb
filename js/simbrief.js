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
import { extractRoutePoints } from "./route-map.js";

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
export async function generateViaPopup({ origin, destination, aircraftTypes, flightNumber }, username) {
  const type = (aircraftTypes || []).map(toIcaoType).find(Boolean);
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
  const fields = { orig: origin, dest: destination, type, fltnum, apicode: data.api_code, outputpage: outputpageCalc, timestamp };
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
export function summarizeOfp(ofp) {
  if (!ofp) return null;
  return {
    aircraft: ofp.aircraft?.icaocode || ofp.aircraft?.name || null,
    route: ofp.general?.route || null,
    block_seconds: ofp.times?.est_time_enroute ?? null,
    points: extractRoutePoints(ofp),
  };
}
