// Weather for the route details modal. Tries Infinite Flight's own live
// ATIS first -- matches what a pilot would actually hear flying this
// route in-sim -- and falls back to real-world METAR/TAF from
// aviationweather.gov (free, keyless, but blocks direct browser fetches
// with no CORS headers -- confirmed by testing, which is the whole
// reason this proxy exists at all) whenever no live ATIS is available.
//
// IF ATIS coverage is inherently sparse: it only returns anything when a
// real human controller happens to be actively staffing that specific
// airport on that specific server right now, which most airports won't
// have most of the time. That's expected, not a bug -- METAR is the
// fallback specifically because ATIS can't be relied on alone.
//
// IF ATIS requires the INFINITE_FLIGHT_API_KEY secret (obtained by
// emailing hello@infiniteflight.com and requesting one -- there's no
// self-service signup). Without that secret set, this skips straight to
// METAR, so weather keeps working even before that key exists.
//
// Deploy via the Supabase dashboard: Edge Functions -> Create a function ->
// name it "weather-proxy" -> paste this file's contents -> Deploy.
// Optional secret (add once you have a key): Edge Functions -> Manage
// secrets -> INFINITE_FLIGHT_API_KEY.

const IF_API_BASE = "https://api.infiniteflight.com/public/v2";
// Expert Server -- matches the server PRVA's community is assumed to fly
// on. Falls back to whatever session is first if Expert isn't listed.
const PREFERRED_WORLD_TYPE = 3;

Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { icao } = await req.json();
    if (!icao || typeof icao !== "string") {
      return new Response(JSON.stringify({ error: "icao is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const atis = await fetchInfiniteFlightAtis(icao);
    if (atis) {
      return new Response(JSON.stringify({ icao, source: "atis", atis, metar: null, taf: null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [metar, taf] = await Promise.all([fetchAviationWeather("metar", icao), fetchAviationWeather("taf", icao)]);
    return new Response(JSON.stringify({ icao, source: "metar", atis: null, metar, taf }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function fetchAviationWeather(kind: "metar" | "taf", icao: string) {
  try {
    const res = await fetch(`https://aviationweather.gov/api/data/${kind}?ids=${encodeURIComponent(icao)}&format=json`);
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) && data.length ? data[0] : null;
  } catch {
    return null;
  }
}

async function fetchInfiniteFlightAtis(icao: string): Promise<string | null> {
  const apiKey = Deno.env.get("INFINITE_FLIGHT_API_KEY");
  if (!apiKey) return null;

  try {
    const sessionsRes = await fetch(`${IF_API_BASE}/sessions`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!sessionsRes.ok) return null;
    const sessionsJson = await sessionsRes.json();
    const sessions = sessionsJson?.result || [];
    const session = sessions.find((s: { worldType: number }) => s.worldType === PREFERRED_WORLD_TYPE) || sessions[0];
    if (!session) return null;

    const atisRes = await fetch(
      `${IF_API_BASE}/sessions/${session.id}/airport/${encodeURIComponent(icao)}/atis`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );
    if (!atisRes.ok) return null;
    const atisJson = await atisRes.json();
    // errorCode 7 = NoAtisAvailable -- no controller currently staffing
    // this airport's ATIS frequency on this server. Expected/common, not
    // an error worth surfacing; just means fall back to METAR.
    if (atisJson?.errorCode !== 0 || !atisJson?.result) return null;
    return atisJson.result as string;
  } catch {
    return null;
  }
}
