// Multiplier rates and rules, confirmed with Martin during Crew Center
// planning (see /Users/martinyu/.claude/plans/piped-questing-crab.md).
// Centralized here since PIREP submission, staff review, and the
// leaderboard/hours calculations all need to agree on the same values --
// no stacking, only the single highest-applicable rate ever applies to a
// given PIREP.
export const FIXED_RATES = {
  none: 1.0,
  rotw: 1.5,
};

// Tier perk depends on the pilot's OWN rank at submission time, not a
// choice they make -- keyed by rank name exactly as it appears in
// sql/007_career_mode_schema.sql. Capped at 1.5x (matching ROTW) so the
// top passive perk never exceeds the flagship weekly promotion.
export const TIER_PERK_RATES = {
  "MM Classic": 1.1,
  "MM Elite": 1.25,
  "MM Premier Elite": 1.4,
  "MM Million Miler": 1.5,
};

// Self-reported at submission time -- no purchase-tracking or event-
// management system exists yet, so these are chosen by the pilot and
// always go to manual staff review regardless of logbook verification
// (see pirep-verify's README comment / the plan's PIREP verification
// section for why that's by design, not a gap).
export const SHOP_RATES = [2, 2.5, 3];
export const EVENT_RATES = [3, 3.5, 4];

export function tierPerkRateForRank(rankName) {
  return TIER_PERK_RATES[rankName] ?? null;
}

export function multiplierLabel(type, value) {
  const names = { none: "No bonus", rotw: "Route of the Week", event: "Event", shop: "Shop-purchased", tier_perk: "Rank perk" };
  return type === "none" ? names.none : `${names[type]} (${value}x)`;
}
