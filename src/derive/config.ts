// Thresholds for the derivations, as plain milliseconds so they compose with
// Date arithmetic. Every derivation takes `now` and these as arguments, so the
// same inputs always give the same answer.
export const HOUR_MS = 60 * 60 * 1000
export const DAY_MS = 24 * HOUR_MS

export interface Thresholds {
  // A green, non-draft pull request that's still open after this is stalled.
  greenUnmergedMs: number
  // A red pull request nobody has touched for this long is stalled.
  redUntouchedMs: number
  // A needs:human gate open longer than this is flagged as aging.
  gateAgingMs: number
  // How far back recent activity reaches.
  activityWindowMs: number
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  greenUnmergedMs: 2 * HOUR_MS,
  redUntouchedMs: 24 * HOUR_MS,
  gateAgingMs: 3 * DAY_MS,
  activityWindowMs: 7 * DAY_MS,
}

// Milliseconds from an ISO timestamp to now. Negative when it's in the future.
export function elapsedMs(since: string, now: Date): number {
  return now.getTime() - Date.parse(since)
}
