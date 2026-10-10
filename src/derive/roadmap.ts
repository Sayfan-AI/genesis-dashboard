// The roadmap: one entry per `milestone:N` label, each planned, active, or done.
import type { Issue } from '../github/client'

export type MilestoneStatus = 'planned' | 'active' | 'done'

export interface Milestone {
  number: number
  // The text after the dash in the plan issue's title, e.g. "Chaos engineering".
  name: string | null
  status: MilestoneStatus
  planIssue: Issue | null
  completeIssue: Issue | null
  // Task issues only: the plan and complete gates don't count.
  progress: { closed: number; total: number }
}

export interface Roadmap {
  // Ascending by milestone number.
  milestones: Milestone[]
  active: Milestone | null
}

const MILESTONE_LABEL = /^milestone:(\d+)$/
const GATE_TITLE = /^milestone\s+(\d+)\s+(plan|complete)\b\s*(?:[-—–:]\s*(.*))?$/i

interface GateTitle {
  number: number
  kind: 'plan' | 'complete'
  name: string | null
}

export function parseGateTitle(title: string): GateTitle | null {
  const match = GATE_TITLE.exec(title.trim())
  if (!match?.[1] || !match[2]) return null
  return {
    number: Number(match[1]),
    kind: match[2].toLowerCase() as GateTitle['kind'],
    name: match[3]?.trim() || null,
  }
}

export function milestoneNumbers(issue: Issue): number[] {
  const numbers: number[] = []
  for (const label of issue.labels) {
    const match = MILESTONE_LABEL.exec(label)
    if (match?.[1]) numbers.push(Number(match[1]))
  }
  return numbers
}

// Pull requests are left out: they deliver tasks, they aren't tasks.
export function deriveRoadmap(issues: Issue[]): Roadmap {
  const byNumber = new Map<number, Milestone>()
  const milestone = (number: number): Milestone => {
    let entry = byNumber.get(number)
    if (!entry) {
      entry = { number, name: null, status: 'planned', planIssue: null, completeIssue: null, progress: { closed: 0, total: 0 } }
      byNumber.set(number, entry)
    }
    return entry
  }

  const tasks = issues.filter((issue) => !issue.isPullRequest)
  for (const issue of tasks) {
    for (const number of milestoneNumbers(issue)) milestone(number)
  }

  for (const issue of tasks) {
    const gate = parseGateTitle(issue.title)
    if (gate) {
      // Gates only attach to milestones that exist as labels.
      const entry = byNumber.get(gate.number)
      if (!entry) continue
      const key = gate.kind === 'plan' ? 'planIssue' : 'completeIssue'
      // With duplicates, a closed one wins: closing is what carries meaning.
      const current = entry[key]
      if (!current || (current.state === 'open' && issue.state === 'closed')) entry[key] = issue
      if (gate.kind === 'plan' && gate.name) entry.name = gate.name
      continue
    }
    for (const number of milestoneNumbers(issue)) {
      const { progress } = milestone(number)
      progress.total++
      if (issue.state === 'closed') progress.closed++
    }
  }

  const milestones = [...byNumber.values()].sort((a, b) => a.number - b.number)
  let active: Milestone | null = null
  for (const entry of milestones) {
    if (entry.completeIssue?.state === 'closed') {
      entry.status = 'done'
    } else if (!active && entry.planIssue?.state === 'closed') {
      entry.status = 'active'
      active = entry
    }
  }
  return { milestones, active }
}
