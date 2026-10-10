import { describe, expect, it } from 'vitest'
import { DAY_MS, DEFAULT_THRESHOLDS } from './config'
import { deriveActivity } from './activity'
import { issue, loadDashboard, loadMaKlaude } from './test-helpers'

const numbers = (issues: { number: number }[]) => issues.map((i) => i.number)

describe('deriveActivity against recorded fixtures', () => {
  it('replays the last week of MaKlaude from a historical now', async () => {
    const { issues } = await loadMaKlaude()
    const activity = deriveActivity(issues, new Date('2026-08-23T00:00:00Z'))
    expect(activity.since).toBe('2026-08-16T00:00:00.000Z')
    expect(activity.merged).toHaveLength(15)
    expect(activity.closed).toHaveLength(16)
    expect(activity.opened).toHaveLength(24)
    expect(numbers(activity.merged).slice(0, 3)).toEqual([227, 226, 225])
    expect(numbers(activity.closed).slice(0, 3)).toEqual([208, 218, 217])
    expect(activity.merged.every((i) => i.isPullRequest)).toBe(true)
  })

  it('is empty for MaKlaude at recording time, after weeks of quiet', async () => {
    const { issues, recordedAt } = await loadMaKlaude()
    expect(deriveActivity(issues, recordedAt)).toMatchObject({ merged: [], closed: [], opened: [] })
  })

  it('covers all of genesis-dashboard, which is younger than the window', async () => {
    const { issues, recordedAt } = await loadDashboard()
    const activity = deriveActivity(issues, recordedAt)
    expect(numbers(activity.merged)).toEqual([14, 12, 11])
    expect(numbers(activity.closed)).toEqual([5, 4, 3, 2, 1])
    expect(activity.opened).toHaveLength(issues.length)
  })
})

describe('deriveActivity', () => {
  const NOW = new Date('2026-10-10T00:00:00Z')

  it('returns empty lists with no issues', () => {
    expect(deriveActivity([], NOW)).toEqual({ since: '2026-10-03T00:00:00.000Z', merged: [], closed: [], opened: [] })
  })

  it('splits merged pull requests from closed ones, and keeps the window inclusive', () => {
    const activity = deriveActivity(
      [
        issue({ number: 1, isPullRequest: true, state: 'closed', createdAt: '2026-09-01T00:00:00Z', closedAt: '2026-10-09T00:00:00Z', mergedAt: '2026-10-09T00:00:00Z' }),
        issue({ number: 2, isPullRequest: true, state: 'closed', createdAt: '2026-09-01T00:00:00Z', closedAt: '2026-10-08T00:00:00Z' }),
        issue({ number: 3, state: 'closed', createdAt: '2026-10-03T00:00:00Z', closedAt: '2026-10-10T00:00:00Z' }),
        issue({ number: 4, createdAt: '2026-10-02T23:59:59Z' }),
        issue({ number: 5, createdAt: '2026-10-10T00:00:01Z' }),
      ],
      NOW,
    )
    expect(numbers(activity.merged)).toEqual([1])
    expect(numbers(activity.closed)).toEqual([3, 2])
    expect(numbers(activity.opened)).toEqual([3])
  })

  it('takes its window from config', () => {
    const issues = [issue({ number: 1, createdAt: '2026-09-15T00:00:00Z' })]
    expect(deriveActivity(issues, NOW).opened).toEqual([])
    const month = { ...DEFAULT_THRESHOLDS, activityWindowMs: 30 * DAY_MS }
    expect(numbers(deriveActivity(issues, NOW, month).opened)).toEqual([1])
  })
})
