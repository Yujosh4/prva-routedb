import { supabase } from "./supabase-client.js";

// aviationweather.gov's API is free and keyless, but it doesn't send CORS
// headers -- browsers block a direct client-side fetch to it outright
// (confirmed while testing this locally, not a hypothetical). So this goes
// through a small Supabase Edge Function (`weather-proxy`) that fetches it
// server-side and hands the JSON back. The same function also tries
// Infinite Flight's own live ATIS first (matches what a pilot would
// actually hear flying the route in-sim), falling back to real-world
// METAR/TAF whenever no live ATIS is currently available -- which is most
// of the time for most airports, since ATIS only exists when a real human
// controller happens to be staffing that airport right now.
export async function fetchAirportWeather(icao) {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.functions.invoke("weather-proxy", {
      body: { icao },
    });
    if (error) throw error;
    // expected shape: { icao, source: "atis"|"metar", atis: string|null,
    // metar: {...}|null, taf: {...}|null }
    return data;
  } catch (err) {
    console.error(`RouteDB: failed to load weather for ${icao}`, err);
    return null;
  }
}
