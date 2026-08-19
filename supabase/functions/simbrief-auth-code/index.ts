// Computes the SimBrief API authorization code so the popup-based dispatch
// flow (js/simbrief.js's openDispatchPopup) can be authorized without ever
// exposing the SimBrief API key to the browser.
//
// This is a direct, faithful port of the signing logic in SimBrief's own
// reference kit (simbrief.apiv1.php, downloaded from
// https://www.simbrief.com/api/SimBrief_APIv1.zip):
//
//   $api_code = md5($simbrief_api_key . $_GET['api_req']);
//
// api_req must be built client-side as exactly:
//   orig + dest + type + timestamp + outputpage (with "http://" stripped)
// -- SimBrief's own backend recomputes the same signature independently to
// authorize the request, so this concatenation format has to match theirs
// exactly, not just be "good enough".
//
// Deploy via the Supabase dashboard: Edge Functions -> Create a function ->
// name it "simbrief-auth-code" -> paste this file's contents -> Deploy.
// Then add the secret it depends on: Edge Functions -> Manage secrets ->
// SIMBRIEF_API_KEY -> paste the key SimBrief emailed you. Never put that
// key anywhere in the browser-side code or in this repo.

import { createHash } from "node:crypto";

Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { api_req } = await req.json();
    if (!api_req || typeof api_req !== "string") {
      return new Response(JSON.stringify({ error: "api_req is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("SIMBRIEF_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "SIMBRIEF_API_KEY secret not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const api_code = createHash("md5").update(apiKey + api_req).digest("hex");

    return new Response(JSON.stringify({ api_code }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
