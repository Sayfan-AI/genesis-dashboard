import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { deriveActivity } from '../derive/activity'
import { HOUR_MS } from '../derive/config'
import { deriveGates } from '../derive/gates'
import { derivePulls } from '../derive/pulls'
import { deriveRoadmap } from '../derive/roadmap'
import { check, issue, pull } from '../derive/test-helpers'
import { ActivitySection, GatesSection, PullsSection, RoadmapSection } from './Sections'

const NOW = new Date('2026-10-10T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * HOUR_MS).toISOString()

function section(name: RegExp) {
  return screen.getByRole('region', { name })
}

describe('GatesSection', () => {
  it('lists gates oldest first with wait times and marks aging ones', () => {
    const gates = deriveGates(
      [
        issue({ number: 224, title: 'Pick Slack channel', labels: ['needs:human'], createdAt: hoursAgo(3) }),
        issue({ number: 212, title: 'Approve Milestone 7 plan', labels: ['needs:human'], createdAt: hoursAgo(98) }),
        issue({ number: 230, title: 'Not a gate', createdAt: hoursAgo(1) }),
      ],
      NOW,
    )
    render(<GatesSection gates={gates} />)
    const items = within(section(/gates/i)).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('issue #212')
    expect(items[0]).toHaveTextContent('waiting 4d 2h')
    expect(items[0]).toHaveAttribute('data-aging', 'true')
    expect(items[1]).toHaveTextContent('issue #224')
    expect(items[1]).toHaveTextContent('waiting 3h')
    expect(items[1]).not.toHaveAttribute('data-aging')
    expect(screen.getByText(/aging, open more than 3d/)).toBeInTheDocument()
  })

  it('flags escalated failed runs', () => {
    const gates = deriveGates(
      [issue({ number: 5, labels: ['needs:human', 'automation:failure'], createdAt: hoursAgo(1) })],
      NOW,
    )
    render(<GatesSection gates={gates} />)
    expect(screen.getByText('failed run')).toBeInTheDocument()
  })

  it('says so when nothing is waiting', () => {
    render(<GatesSection gates={[]} />)
    expect(within(section(/gates/i)).getByText('Nothing is waiting on you.')).toBeInTheDocument()
  })
})

describe('PullsSection', () => {
  it('shows CI state and highlights stalled pull requests', () => {
    const pulls = derivePulls(
      [
        { pull: pull({ number: 231, title: 'Add retry', createdAt: hoursAgo(5) }), checks: [check('CI', 'success', hoursAgo(4))] },
        { pull: pull({ number: 228, title: 'Fix labels', createdAt: hoursAgo(40), updatedAt: hoursAgo(30) }), checks: [check('CI', 'failure', hoursAgo(30))] },
        { pull: pull({ number: 233, title: 'Tighten budgets', createdAt: hoursAgo(1) }), checks: [check('CI', null)] },
        { pull: pull({ number: 234, title: 'Docs', createdAt: hoursAgo(0.5) }), checks: [check('CI', 'success', hoursAgo(0.2))] },
        { pull: pull({ number: 235, title: 'Fresh', createdAt: hoursAgo(0.1), draft: true }), checks: [] },
      ],
      NOW,
    )
    render(<PullsSection pulls={pulls} now={NOW} />)
    const list = within(section(/pull requests/i))
    const row = (n: number) => list.getByText(`PR #${n}`).closest('li')

    expect(row(231)).toHaveTextContent('CI green')
    expect(row(231)).toHaveAttribute('data-stall', 'green-unmerged')
    expect(row(231)).toHaveTextContent('stalled: green, not merged')

    expect(row(228)).toHaveTextContent('CI red')
    expect(row(228)).toHaveAttribute('data-stall', 'red-untouched')
    expect(row(228)).toHaveTextContent('open 1d 16h')

    expect(row(233)).toHaveTextContent('CI running')
    expect(row(233)).not.toHaveAttribute('data-stall')

    expect(row(234)).toHaveTextContent('CI green')
    expect(row(234)).not.toHaveAttribute('data-stall')

    expect(row(235)).toHaveTextContent('no checks yet')
    expect(row(235)).toHaveTextContent('draft')
  })

  it('says so when there are none', () => {
    render(<PullsSection pulls={[]} now={NOW} />)
    expect(within(section(/pull requests/i)).getByText('No open pull requests.')).toBeInTheDocument()
  })
})

describe('RoadmapSection', () => {
  it('shows each milestone status and progress for the active one', () => {
    const roadmap = deriveRoadmap([
      issue({ number: 1, title: 'Milestone 1 plan - Core loop', labels: ['milestone:1'], state: 'closed' }),
      issue({ number: 2, title: 'Milestone 1 complete', labels: ['milestone:1'], state: 'closed' }),
      issue({ number: 3, title: 'Milestone 2 plan - Multi-repo', labels: ['milestone:2'], state: 'closed' }),
      issue({ number: 4, labels: ['milestone:2'], state: 'closed' }),
      issue({ number: 5, labels: ['milestone:2'] }),
      issue({ number: 6, labels: ['milestone:2'] }),
      issue({ number: 7, labels: ['milestone:3'] }),
    ])
    render(<RoadmapSection roadmap={roadmap} />)
    const items = within(section(/roadmap/i)).getAllByRole('listitem')
    expect(items.map((li) => li.getAttribute('data-status'))).toEqual(['done', 'active', 'planned'])
    expect(items[0]).toHaveTextContent('Core loop')
    expect(items[1]).toHaveTextContent('Multi-repo')
    expect(items[1]).toHaveTextContent('1/3')
    expect(items[2]).toHaveTextContent('Milestone 3')
    const bar = screen.getByRole('progressbar', { name: 'Milestone 2 progress' })
    expect(bar).toHaveAttribute('aria-valuenow', '1')
    expect(bar).toHaveAttribute('aria-valuemax', '3')
    expect(screen.getAllByRole('progressbar')).toHaveLength(1)
  })

  it('explains an empty roadmap', () => {
    render(<RoadmapSection roadmap={deriveRoadmap([])} />)
    expect(within(section(/roadmap/i)).getByText(/No milestones yet/)).toBeInTheDocument()
  })
})

describe('ActivitySection', () => {
  it('interleaves merged, closed, and opened newest first', () => {
    const activity = deriveActivity(
      [
        issue({ number: 230, title: 'Cache org listing', isPullRequest: true, state: 'closed', createdAt: hoursAgo(200), closedAt: hoursAgo(6), mergedAt: hoursAgo(6) }),
        issue({ number: 226, title: 'Badge rendering', state: 'closed', createdAt: hoursAgo(200), closedAt: hoursAgo(9) }),
        issue({ number: 224, title: 'Pick Slack channel', createdAt: hoursAgo(3) }),
        issue({ number: 100, title: 'Ancient', state: 'closed', createdAt: hoursAgo(900), closedAt: hoursAgo(800) }),
      ],
      NOW,
    )
    render(<ActivitySection activity={activity} now={NOW} />)
    const items = within(section(/recent activity \(last 7d\)/i)).getAllByRole('listitem')
    expect(items.map((li) => li.getAttribute('data-kind'))).toEqual(['opened', 'merged', 'closed'])
    expect(items[0]).toHaveTextContent('issue #224')
    expect(items[0]).toHaveTextContent('3h ago')
    expect(items[1]).toHaveTextContent('PR #230')
    expect(items[1]).toHaveTextContent('6h ago')
    expect(items[2]).toHaveTextContent('issue #226')
  })

  it('says so when the window is quiet', () => {
    render(<ActivitySection activity={deriveActivity([], NOW)} now={NOW} />)
    expect(screen.getByText('Nothing merged, closed, or opened in the last 7d.')).toBeInTheDocument()
  })
})
