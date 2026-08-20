// Resolves an IFC (Infinite Flight Community / Discourse) username to the
// Infinite Flight Live API's internal userId -- done once at pilot signup
// and cached on the pilots row (infinite_flight_user_id), since that's
// the ID PIREP verification later queries Get User Flights by. Requires
// the INFINITE_FLIGHT_API_KEY secret, so it has to run server-side same
// as weather-proxy's ATIS lookup -- this is the same Live API, same key,
// just a different endpoint (Get User Stats, not ATIS/sessions).
//
// Deploy via the Supabase dashboard: Edge Functions -> Create a function ->
// name it "resolve-if-user" -> paste this file's contents -> Deploy.
// Reuses the INFINITE_FLIGHT_API_KEY secret already set for weather-proxy
// -- no new secret needed if that's already configured.

Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { discourseUsername } = await req.json();
    if (!discourseUsername || typeof discourseUsername !== "string") {
      return new Response(JSON.stringify({ error: "discourseUsername is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("INFINITE_FLIGHT_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "INFINITE_FLIGHT_API_KEY secret not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const res = await fetch("https://api.infiniteflight.com/public/v2/users", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ discourseNames: [discourseUsername] }),
    });
    if (!res.ok) {
      return new Response(JSON.stringify({ error: "Infinite Flight API request failed", status: res.status }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const json = await res.json();
    const match = json?.result?.[0];
    if (json?.errorCode !== 0 || !match) {
      // Not an error in the HTTP sense -- just means this username wasn't
      // found (typo, unlinked account, etc). Let the caller decide what
      // to show the pilot.
      return new Response(JSON.stringify({ found: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ found: true, infiniteFlightUserId: match.userId, discourseUsername: match.discourseUsername }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
