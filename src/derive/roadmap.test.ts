import { describe, expect, it } from 'vitest'
import { deriveRoadmap, parseGateTitle } from './roadmap'
import { issue, loadDashboard, loadMaKlaude } from './test-helpers'

describe('deriveRoadmap against recorded fixtures', () => {
  it('reads six milestones from MaKlaude: five done and the sixth active', async () => {
    const { issues } = await loadMaKlaude()
    const { milestones, active } = deriveRoadmap(issues)
    expect(milestones.map((m) => [m.number, m.status])).toEqual([
      [1, 'done'],
      [2, 'done'],
      [3, 'done'],
      [4, 'done'],
      [5, 'done'],
      [6, 'active'],
    ])
    expect(active?.number).toBe(6)
    expect(active?.name).toBe('Chaos engineering')
    expect(active?.planIssue?.number).toBe(188)
    expect(active?.completeIssue).toBeNull()
    expect(milestones.map((m) => m.progress)).toEqual([
      { closed: 9, total: 9 },
      { closed: 6, total: 6 },
      { closed: 7, total: 7 },
      { closed: 10, total: 10 },
      { closed: 9, total: 9 },
      { closed: 19, total: 21 },
    ])
    expect(milestones[4]?.completeIssue?.number).toBe(182)
  })

  it('reads genesis-dashboard as one active milestone with its gates excluded from progress', async () => {
    const { issues } = await loadDashboard()
    const { milestones, active } = deriveRoadmap(issues)
    expect(milestones).toHaveLength(1)
    expect(active).toMatchObject({ number: 1, status: 'active', name: null, progress: { closed: 3, total: 9 } })
    expect(active?.planIssue?.number).toBe(2)
  })
})

describe('deriveRoadmap edge cases', () => {
  it('returns an empty roadmap when there are no milestone labels', () => {
    expect(deriveRoadmap([])).toEqual({ milestones: [], active: null })
    expect(deriveRoadmap([issue({ number: 1, labels: ['bug'] })])).toEqual({ milestones: [], active: null })
  })

  it('leaves every milestone planned when no plan has closed', () => {
    const { milestones, active } = deriveRoadmap([
      issue({ number: 1, title: 'Milestone 1 plan', labels: ['milestone:1', 'needs:human'] }),
      issue({ number: 2, labels: ['milestone:1'] }),
      issue({ number: 3, labels: ['milestone:2'] }),
    ])
    expect(active).toBeNull()
    expect(milestones.map((m) => m.status)).toEqual(['planned', 'planned'])
    expect(milestones[0]?.progress).toEqual({ closed: 0, total: 1 })
  })

  it('makes only the lowest planned-and-not-done milestone active', () => {
    const { milestones } = deriveRoadmap([
      issue({ number: 1, title: 'Milestone 1 plan', state: 'closed', labels: ['milestone:1'] }),
      issue({ number: 2, title: 'Milestone 1 complete', state: 'closed', labels: ['milestone:1'] }),
      issue({ number: 3, title: 'Milestone 2 plan', state: 'closed', labels: ['milestone:2'] }),
      issue({ number: 4, title: 'Milestone 3 plan', state: 'closed', labels: ['milestone:3'] }),
      issue({ number: 5, title: 'Milestone 4 complete', state: 'open', labels: ['milestone:4'] }),
    ])
    expect(milestones.map((m) => m.status)).toEqual(['done', 'active', 'planned', 'planned'])
  })

  it('counts a milestone done from its closed complete issue even without a plan', () => {
    const { milestones } = deriveRoadmap([
      issue({ number: 1, title: 'Milestone 1 complete — Foundation', state: 'closed', labels: ['milestone:1'] }),
    ])
    expect(milestones[0]).toMatchObject({ status: 'done', name: null, progress: { closed: 0, total: 0 } })
  })

  it('ignores pull requests, and gate titles for milestones with no label', () => {
    const { milestones } = deriveRoadmap([
      issue({ number: 1, labels: ['milestone:1'], isPullRequest: true }),
      issue({ number: 2, title: 'Milestone 9 plan', state: 'closed' }),
      issue({ number: 3, labels: ['milestone:1'], state: 'closed' }),
    ])
    expect(milestones).toHaveLength(1)
    expect(milestones[0]).toMatchObject({ number: 1, status: 'planned', progress: { closed: 1, total: 1 } })
  })

  it('prefers a closed plan issue over an open duplicate', () => {
    const { active } = deriveRoadmap([
      issue({ number: 1, title: 'Milestone 1 plan', state: 'open', labels: ['milestone:1'] }),
      issue({ number: 2, title: 'Milestone 1 plan', state: 'closed', labels: ['milestone:1'] }),
    ])
    expect(active?.planIssue?.number).toBe(2)
  })

  it('sorts milestones numerically, not lexically', () => {
    const { milestones } = deriveRoadmap([
      issue({ number: 1, labels: ['milestone:10'] }),
      issue({ number: 2, labels: ['milestone:2'] }),
    ])
    expect(milestones.map((m) => m.number)).toEqual([2, 10])
  })
})

describe('parseGateTitle', () => {
  it('parses plan and complete titles, with and without a name', () => {
    expect(parseGateTitle('Milestone 6 plan — Chaos engineering')).toEqual({ number: 6, kind: 'plan', name: 'Chaos engineering' })
    expect(parseGateTitle('Milestone 1 plan')).toEqual({ number: 1, kind: 'plan', name: null })
    expect(parseGateTitle('milestone 12 Complete: Done')).toEqual({ number: 12, kind: 'complete', name: 'Done' })
  })

  it('rejects titles that only mention a milestone', () => {
    expect(parseGateTitle('Create the Milestone 5 task issues and start T1')).toBeNull()
    expect(parseGateTitle('Milestone 1 planning notes')).toBeNull()
    expect(parseGateTitle('Milestone 1 acceptance check')).toBeNull()
  })
})
