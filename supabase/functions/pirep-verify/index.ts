// Verifies a PIREP by checking the pilot's real Infinite Flight logbook
// (Get User Flights -- see sql/016_pireps.sql and the Crew Center plan
// for why this replaced two earlier, worse ideas: a live flight-plan
// check that only proves what the FMS says, and a two-stage live-
// position spot-check that's fragile to app crashes). Matches on origin/
// destination ICAO plus a +/-1 day window around the claimed flight_date
// (not same-day-only, since a logbook entry's UTC timestamp can fall on
// the neighboring calendar date depending on timezone).
//
// Deploy via the Supabase dashboard: Edge Functions -> Create a function ->
// name it "pirep-verify" -> paste this file's contents -> Deploy. Reuses
// the INFINITE_FLIGHT_API_KEY secret already set for weather-proxy and
// resolve-if-user -- no new secret needed.

const PAGES_TO_CHECK = 3; // ~30 most recent flights -- comfortably covers any realistic gap between PIREPs
const DATE_WINDOW_MS = 24 * 60 * 60 * 1000;

Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { infiniteFlightUserId, originIcao, destinationIcao, flightDate } = await req.json();
    if (!infiniteFlightUserId || !originIcao || !destinationIcao || !flightDate) {
      return new Response(
        JSON.stringify({ error: "infiniteFlightUserId, originIcao, destinationIcao, and flightDate are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const apiKey = Deno.env.get("INFINITE_FLIGHT_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "INFINITE_FLIGHT_API_KEY secret not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const claimedDate = new Date(`${flightDate}T00:00:00Z`).getTime();
    let match = null;

    for (let page = 1; page <= PAGES_TO_CHECK && !match; page++) {
      const res = await fetch(`https://api.infiniteflight.com/public/v2/users/${infiniteFlightUserId}/flights?page=${page}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) break;
      const json = await res.json();
      if (json?.errorCode !== 0 || !json?.result) break;

      const flights = json.result.data || [];
      match = flights.find((f: { originAirport: string | null; destinationAirport: string | null; created: string }) => {
        if (f.originAirport !== originIcao || f.destinationAirport !== destinationIcao) return false;
        const flownAt = new Date(f.created).getTime();
        return Math.abs(flownAt - claimedDate) <= DATE_WINDOW_MS;
      });

      if (!json.result.hasNextPage) break;
    }

    if (match) {
      return new Response(
        JSON.stringify({ verified: true, matchedFlightId: match.id, loggedMinutes: match.totalTime }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    return new Response(JSON.stringify({ verified: false, matchedFlightId: null, loggedMinutes: null }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
