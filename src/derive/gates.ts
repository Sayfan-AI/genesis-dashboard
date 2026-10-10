// Open needs:human gates: the things waiting on a person.
import type { Issue } from '../github/client'
import { DEFAULT_THRESHOLDS, elapsedMs, type Thresholds } from './config'

export const NEEDS_HUMAN = 'needs:human'
export const AUTOMATION_FAILURE = 'automation:failure'

export interface Gate {
  issue: Issue
  waitingMs: number
  aging: boolean
  // An escalated failed run rather than a decision. It still needs a person,
  // but nothing is blocked on it.
  automationFailure: boolean
}

// Oldest first, so the longest wait is at the top.
export function deriveGates(issues: Issue[], now: Date, thresholds: Thresholds = DEFAULT_THRESHOLDS): Gate[] {
  return issues
    .filter((issue) => !issue.isPullRequest && issue.state === 'open' && issue.labels.includes(NEEDS_HUMAN))
    .map((issue) => {
      const waitingMs = Math.max(0, elapsedMs(issue.createdAt, now))
      return {
        issue,
        waitingMs,
        aging: waitingMs > thresholds.gateAgingMs,
        automationFailure: issue.labels.includes(AUTOMATION_FAILURE),
      }
    })
    .sort((a, b) => b.waitingMs - a.waitingMs || a.issue.number - b.issue.number)
}
