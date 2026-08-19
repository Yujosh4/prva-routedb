// Countdown / urgency helpers for Career Mode. Deliberately stays inside one
// consistent time frame -- the origin airport's own local wall clock --
// rather than converting to true UTC instants: the only thing that matters
// is "how long until this departs, as the airport clock would show it,"
// and building two Date objects from the same local Y/M/D lets normal Date
// arithmetic do the diff safely without any real UTC/DST math.
import { timezoneForIcao } from "./airport-timezones.js";

const BUFFER_MINUTES = 5;

function airportLocalParts(timezone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: parts.hour === "24" ? 0 : Number(parts.hour),
    minute: Number(parts.minute), second: Number(parts.second),
  };
}

// 'YYYY-MM-DD' for "today" at the given origin airport's local clock, or
// null if the airport's timezone isn't known. Used to key the day's
// simulated on-time/delayed/cancelled status to the airport's own date,
// not the viewer's.
export function airportLocalDateKey(originIcao) {
  const timezone = timezoneForIcao(originIcao);
  if (!timezone) return null;
  const now = airportLocalParts(timezone);
  return `${now.year}-${String(now.month).padStart(2, "0")}-${String(now.day).padStart(2, "0")}`;
}

// Minutes from "now" (at the origin airport) until (departure + any
// simulated delay - 5min buffer), for a schedule entry departing TODAY at
// that airport's local date. Returns null when the airport's timezone
// isn't known, or the entry doesn't operate on the airport's current local
// weekday -- a countdown isn't meaningful in either case.
export function minutesToEffectiveDeparture(originIcao, departureTimeLocal, daysOfWeek, delayMinutes = 0) {
  const timezone = timezoneForIcao(originIcao);
  if (!timezone || !departureTimeLocal) return null;

  const now = airportLocalParts(timezone);
  const nowLocal = new Date(now.year, now.month - 1, now.day, now.hour, now.minute, now.second);
  const todayWeekday = nowLocal.getDay() === 0 ? 7 : nowLocal.getDay();
  if (daysOfWeek && daysOfWeek.length && !daysOfWeek.includes(todayWeekday)) return null;

  const [h, m] = String(departureTimeLocal).split(":").map(Number);
  const departureLocal = new Date(now.year, now.month - 1, now.day, h, m + delayMinutes, 0);
  const effectiveTarget = new Date(departureLocal.getTime() - BUFFER_MINUTES * 60000);

  return Math.round((effectiveTarget.getTime() - nowLocal.getTime()) / 60000);
}

export function urgencyClass(minutes) {
  if (minutes === null || minutes === undefined) return "";
  if (minutes <= 0) return "cal-urgency-departed";
  if (minutes <= 30) return "cal-urgency-critical";
  if (minutes <= 120) return "cal-urgency-soon";
  return "cal-urgency-upcoming";
}

export function formatCountdown(minutes) {
  if (minutes === null || minutes === undefined) return null;
  if (minutes <= 0) return "Departing now";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}hr ${m}min`;
  return `${m}min`;
}
