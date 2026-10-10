import { describe, expect, it } from 'vitest'
import { deriveGates } from './gates'
import { derivePulls } from './pulls'
import { deriveRoadmap } from './roadmap'
import { BADGE_BUDGET_RESERVE, deriveBadges, nextBadgeLoad } from './badges'
import { check, issue, loadDashboard, loadMaKlaude, pull } from './test-helpers'

describe('deriveBadges', () => {
  it('reads MaKlaude: no gates, no open pull requests, milestone 6 active', async () => {
    const { issues, recordedAt } = await loadMaKlaude()
    const badges = deriveBadges({ gates: deriveGates(issues, recordedAt), pulls: [], roadmap: deriveRoadmap(issues) })
    expect(badges).toEqual({ gates: 0, stalled: 0, milestone: 6 })
  })

  it('reads this repo: milestone 1 active', async () => {
    const { issues, recordedAt } = await loadDashboard()
    expect(deriveBadges({ gates: deriveGates(issues, recordedAt), pulls: [], roadmap: deriveRoadmap(issues) }).milestone).toBe(1)
  })

  it('counts open gates and only the stalled pull requests', () => {
    const now = new Date('2026-10-10T12:00:00Z')
    const issues = [
      issue({ number: 1, labels: ['needs:human'] }),
      issue({ number: 2, labels: ['needs:human', 'automation:failure'] }),
      issue({ number: 3, labels: ['needs:human'], state: 'closed' }),
    ]
    const old = '2026-10-01T00:00:00Z'
    const pulls = derivePulls(
      [
        { pull: pull({ number: 10, createdAt: old, updatedAt: old }), checks: [check('ci', 'success')] },
        { pull: pull({ number: 11, createdAt: old, updatedAt: old }), checks: [check('ci', 'failure')] },
        // Green, but only just: not stalled yet.
        { pull: pull({ number: 12 }), checks: [check('ci', 'success', now.toISOString())] },
      ],
      now,
    )
    expect(deriveBadges({ gates: deriveGates(issues, now), pulls, roadmap: deriveRoadmap([]) })).toEqual({
      gates: 2,
      stalled: 2,
      milestone: null,
    })
  })
})

describe('nextBadgeLoad', () => {
  const plenty = 50

  it('waits for the selected repo to settle', () => {
    expect(nextBadgeLoad(['idle', 'idle'], false, plenty)).toBeNull()
    expect(nextBadgeLoad(['idle', 'idle'], true, plenty)).toBe(0)
  })

  it('loads one at a time, in order', () => {
    expect(nextBadgeLoad(['settled', 'loading', 'idle'], true, plenty)).toBeNull()
    expect(nextBadgeLoad(['settled', 'settled', 'idle'], true, plenty)).toBe(2)
    expect(nextBadgeLoad(['settled', 'settled'], true, plenty)).toBeNull()
  })

  it('stops at the budget reserve, and before the budget is known', () => {
    expect(nextBadgeLoad(['idle'], true, BADGE_BUDGET_RESERVE)).toBeNull()
    expect(nextBadgeLoad(['idle'], true, BADGE_BUDGET_RESERVE + 1)).toBe(0)
    expect(nextBadgeLoad(['idle'], true, null)).toBeNull()
  })
})
