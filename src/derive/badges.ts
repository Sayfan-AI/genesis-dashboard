// The side panel's at-a-glance numbers for one repo, from the same data its
// dashboard shows.
import type { DashboardData } from '../dashboard/load'

export interface Badges {
  gates: number
  stalled: number
  // The active milestone's number, or null when none is active.
  milestone: number | null
}

export function deriveBadges(data: Pick<DashboardData, 'gates' | 'pulls' | 'roadmap'>): Badges {
  return {
    gates: data.gates.length,
    stalled: data.pulls.filter((status) => status.stall !== null).length,
    milestone: data.roadmap.active?.number ?? null,
  }
}

// How many requests to leave unspent for the selected repo's refreshes. Badges
// for other repos only load while the budget is above this.
export const BADGE_BUDGET_RESERVE = 10

export type BadgeLoadState = 'idle' | 'loading' | 'settled'

// Which repo's badges to load next, or null for none. One at a time, in panel
// order, and only once the selected repo has settled, so the repo the visitor
// is looking at always goes first. `remaining` is null before any response.
export function nextBadgeLoad(states: BadgeLoadState[], selectedSettled: boolean, remaining: number | null): number | null {
  if (!selectedSettled || remaining === null || remaining <= BADGE_BUDGET_RESERVE) return null
  if (states.includes('loading')) return null
  const index = states.indexOf('idle')
  return index === -1 ? null : index
}
