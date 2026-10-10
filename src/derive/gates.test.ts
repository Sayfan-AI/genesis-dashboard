import { describe, expect, it } from 'vitest'
import { DAY_MS, HOUR_MS } from './config'
import { deriveGates } from './gates'
import { issue, loadDashboard, loadMaKlaude } from './test-helpers'

const NOW = new Date('2026-10-10T00:00:00Z')

describe('deriveGates against recorded fixtures', () => {
  it('finds no open gates in either recorded repo', async () => {
    for (const load of [loadMaKlaude, loadDashboard]) {
      const { issues, recordedAt } = await load()
      expect(issues.some((i) => i.labels.includes('needs:human'))).toBe(true)
      expect(deriveGates(issues, recordedAt)).toEqual([])
    }
  })
})

describe('deriveGates', () => {
  const issues = [
    issue({ number: 1, labels: ['needs:human'], createdAt: '2026-10-09T00:00:00Z' }),
    issue({ number: 2, labels: ['needs:human', 'automation:failure'], createdAt: '2026-10-01T00:00:00Z' }),
    issue({ number: 3, labels: ['needs:human'], state: 'closed', createdAt: '2026-09-01T00:00:00Z' }),
    issue({ number: 4, labels: ['needs:human'], isPullRequest: true, createdAt: '2026-09-01T00:00:00Z' }),
    issue({ number: 5, labels: ['bug'], createdAt: '2026-09-01T00:00:00Z' }),
    issue({ number: 6, labels: ['needs:human'], createdAt: '2026-10-07T00:00:00Z' }),
  ]

  it('lists open needs:human issues oldest first with their wait', () => {
    const gates = deriveGates(issues, NOW)
    expect(gates.map((g) => [g.issue.number, g.waitingMs, g.aging, g.automationFailure])).toEqual([
      [2, 9 * DAY_MS, true, true],
      [6, 3 * DAY_MS, false, false],
      [1, DAY_MS, false, false],
    ])
  })

  it('flags aging strictly past the threshold, which is configurable', () => {
    const justOver = new Date(NOW.getTime() + 1)
    expect(deriveGates(issues, justOver).find((g) => g.issue.number === 6)?.aging).toBe(true)
    const strict = { greenUnmergedMs: 0, redUntouchedMs: 0, activityWindowMs: 0, gateAgingMs: 12 * HOUR_MS }
    expect(deriveGates(issues, NOW, strict).every((g) => g.aging)).toBe(true)
  })

  it('never reports a negative wait for a gate opened after now', () => {
    const [gate] = deriveGates([issue({ number: 1, labels: ['needs:human'], createdAt: '2026-10-11T00:00:00Z' })], NOW)
    expect(gate?.waitingMs).toBe(0)
  })
})
