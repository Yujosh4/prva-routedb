// Simulated on-time/delayed/cancelled status for Career Mode -- pure
// flavor for the simulation, not a claim about anything in the real world
// (unlike route suspensions, which stay a manual staff toggle precisely
// because those WOULD be a real-world claim). Deterministic per
// (schedule, calendar date): the same flight on the same date always rolls
// the same status, but a new date gives a fresh roll, so this needs no
// database writes, cron job, or staff action -- it just falls out of the
// hash the moment that date is rendered.
import { hashString } from "./career-autofill.js";

const CANCEL_PROBABILITY = 0.01; // ~1 in 100
const DELAY_PROBABILITY = 0.05; // ~1 in 20, separate from cancellation
const MIN_DELAY_MINUTES = 15;
const DELAY_RANGE_MINUTES = 75; // delays land between 15 and 90 minutes

// dateKey is a plain 'YYYY-MM-DD' string -- the calendar date being looked
// at, not necessarily "today". Returns { status: 'on_time'|'delayed'|'cancelled', delayMinutes }.
export function simulatedDisruption(scheduleId, dateKey) {
  if (!dateKey) return { status: "on_time", delayMinutes: 0 };
  const hash = hashString(scheduleId + ":" + dateKey + ":disruption");
  const roll = (hash % 10000) / 10000;
  if (roll < CANCEL_PROBABILITY) return { status: "cancelled", delayMinutes: 0 };
  if (roll < CANCEL_PROBABILITY + DELAY_PROBABILITY) {
    return { status: "delayed", delayMinutes: MIN_DELAY_MINUTES + (hash % DELAY_RANGE_MINUTES) };
  }
  return { status: "on_time", delayMinutes: 0 };
}

export function disruptionClass(status) {
  if (status === "cancelled") return "cal-status-cancelled";
  if (status === "delayed") return "cal-status-delayed";
  return "";
}

export function disruptionLabel(disruption) {
  if (disruption.status === "cancelled") return "Cancelled";
  if (disruption.status === "delayed") return `Delayed ${disruption.delayMinutes}min`;
  return null;
}
