import { describe, expect, it } from 'vitest'
import { DEFAULT_THRESHOLDS } from './config'
import { ciState, derivePulls, stallOf } from './pulls'
import { check, loadDashboard, loadMaKlaude, pull } from './test-helpers'

const NOW = new Date('2026-10-10T12:00:00Z')

describe('derivePulls against recorded fixtures', () => {
  it('returns nothing for repos with no open pull requests', async () => {
    for (const load of [loadMaKlaude, loadDashboard]) {
      const { pulls, recordedAt } = await load()
      expect(pulls).toEqual([])
      expect(derivePulls([], recordedAt)).toEqual([])
    }
  })

  it('reads the recorded main-branch checks as passing', async () => {
    const { mainChecks } = await loadMaKlaude()
    expect(mainChecks).toHaveLength(4)
    expect(ciState(mainChecks)).toBe('passing')
  })
})

describe('ciState', () => {
  it('is none with no checks, so an unstarted CI never reads as green', () => {
    expect(ciState([])).toBe('none')
  })

  it('treats success, neutral, and skipped as passing', () => {
    expect(ciState([check('a', 'success'), check('b', 'neutral'), check('c', 'skipped')])).toBe('passing')
  })

  it('is pending while any check runs and none has failed', () => {
    expect(ciState([check('a', 'success'), check('b', null)])).toBe('pending')
    expect(ciState([{ ...check('a', 'success'), status: 'queued', conclusion: null }])).toBe('pending')
  })

  it('is failing as soon as one check fails, even with others still running', () => {
    expect(ciState([check('a', 'success'), check('b', null), check('c', 'failure')])).toBe('failing')
    for (const conclusion of ['timed_out', 'cancelled', 'action_required', 'startup_failure']) {
      expect(ciState([check('a', conclusion)])).toBe('failing')
    }
  })
})

describe('stallOf', () => {
  it('flags green and unmerged strictly past two hours since the last check finished', () => {
    const checks = [check('a', 'success', '2026-10-10T09:00:00Z'), check('b', 'success', '2026-10-10T10:00:00Z')]
    expect(stallOf({ pull: pull({ number: 1 }), checks }, NOW)).toBeNull()
    expect(stallOf({ pull: pull({ number: 1 }), checks }, new Date('2026-10-10T12:00:01Z'))).toBe('green-unmerged')
  })

  it('never flags a green draft', () => {
    const checks = [check('a', 'success', '2026-10-01T00:00:00Z')]
    expect(stallOf({ pull: pull({ number: 1, draft: true }), checks }, NOW)).toBeNull()
  })

  it('flags red only once neither the pull request nor a failing check has moved for 24 hours', () => {
    const checks = [check('a', 'failure', '2026-10-09T10:00:00Z')]
    const stale = pull({ number: 1, updatedAt: '2026-10-09T00:00:00Z' })
    expect(stallOf({ pull: stale, checks }, NOW)).toBe('red-untouched')
    const recentlyTouched = pull({ number: 1, updatedAt: '2026-10-10T00:00:00Z' })
    expect(stallOf({ pull: recentlyTouched, checks }, NOW)).toBeNull()
    const recentFailure = [check('a', 'failure', '2026-10-09T13:00:00Z')]
    expect(stallOf({ pull: stale, checks: recentFailure }, NOW)).toBeNull()
  })

  it('flags a red draft nobody is touching', () => {
    const checks = [check('a', 'failure', '2026-10-01T00:00:00Z')]
    expect(stallOf({ pull: pull({ number: 1, draft: true }), checks }, NOW)).toBe('red-untouched')
  })

  it('never flags pending or check-less pull requests', () => {
    const old = pull({ number: 1, updatedAt: '2026-09-01T00:00:00Z' })
    expect(stallOf({ pull: old, checks: [] }, NOW)).toBeNull()
    expect(stallOf({ pull: old, checks: [check('a', null)] }, NOW)).toBeNull()
  })

  it('takes its thresholds from config', () => {
    const checks = [check('a', 'success', '2026-10-10T11:00:00Z')]
    const tight = { ...DEFAULT_THRESHOLDS, greenUnmergedMs: 30 * 60 * 1000 }
    expect(stallOf({ pull: pull({ number: 1 }), checks }, NOW, tight)).toBe('green-unmerged')
  })
})

describe('derivePulls with mixed check states', () => {
  it('classifies each pull request and sorts them oldest first', () => {
    const statuses = derivePulls(
      [
        { pull: pull({ number: 4, createdAt: '2026-10-04T00:00:00Z' }), checks: [] },
        {
          pull: pull({ number: 2, createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z' }),
          checks: [check('lint', 'success', '2026-10-02T00:00:00Z'), check('test', 'failure', '2026-10-02T00:00:00Z')],
        },
        {
          pull: pull({ number: 1, createdAt: '2026-10-01T00:00:00Z' }),
          checks: [check('lint', 'success', '2026-10-01T00:00:00Z'), check('test', 'skipped', '2026-10-01T00:00:00Z')],
        },
        {
          pull: pull({ number: 3, createdAt: '2026-10-03T00:00:00Z' }),
          checks: [check('lint', 'success', '2026-10-03T00:00:00Z'), check('test', null)],
        },
        {
          pull: pull({ number: 5, createdAt: '2026-10-10T11:00:00Z', updatedAt: '2026-10-10T11:30:00Z' }),
          checks: [check('test', 'failure', '2026-10-10T11:30:00Z')],
        },
      ],
      NOW,
    )
    expect(statuses.map((s) => [s.pull.number, s.ci, s.stall])).toEqual([
      [1, 'passing', 'green-unmerged'],
      [2, 'failing', 'red-untouched'],
      [3, 'pending', null],
      [4, 'none', null],
      [5, 'failing', null],
    ])
    expect(statuses[1]?.failingChecks.map((c) => c.name)).toEqual(['test'])
  })
})
