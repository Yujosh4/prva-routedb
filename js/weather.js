import { supabase } from "./supabase-client.js";

// aviationweather.gov's API is free and keyless, but it doesn't send CORS
// headers -- browsers block a direct client-side fetch to it outright
// (confirmed while testing this locally, not a hypothetical). So this goes
// through a small Supabase Edge Function (`weather-proxy`) that fetches it
// server-side and hands the JSON back -- no secret involved, purely a CORS
// workaround, same free-tier Edge Function allowance as the SimBrief call.
export async function fetchAirportWeather(icao) {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.functions.invoke("weather-proxy", {
      body: { icao },
    });
    if (error) throw error;
    return data; // expected shape: { icao, metar: {...}|null, taf: {...}|null }
  } catch (err) {
    console.error(`RouteDB: failed to load weather for ${icao}`, err);
    return null;
  }
}
