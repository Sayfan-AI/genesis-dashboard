// Open pull requests, their CI state, and which ones have stalled.
import type { CheckRun, PullRequest } from '../github/client'
import { DEFAULT_THRESHOLDS, elapsedMs, type Thresholds } from './config'

// 'none' means no check has reported yet. In a repo with CI that's "not
// started", not "nothing to run", so it never counts as green.
export type CiState = 'none' | 'pending' | 'passing' | 'failing'

export type Stall = 'green-unmerged' | 'red-untouched'

export interface PullInput {
  pull: PullRequest
  // Check runs for the pull request's head commit.
  checks: CheckRun[]
}

export interface PullStatus {
  pull: PullRequest
  ci: CiState
  failingChecks: CheckRun[]
  stall: Stall | null
}

const PASSING_CONCLUSIONS = new Set(['success', 'neutral', 'skipped'])

type CheckOutcome = 'pending' | 'passing' | 'failing'

export function checkOutcome(check: CheckRun): CheckOutcome {
  if (check.status !== 'completed' || check.conclusion === null) return 'pending'
  return PASSING_CONCLUSIONS.has(check.conclusion) ? 'passing' : 'failing'
}

// One failure makes the whole thing red, even while other checks still run.
export function ciState(checks: CheckRun[]): CiState {
  if (checks.length === 0) return 'none'
  const outcomes = checks.map(checkOutcome)
  if (outcomes.includes('failing')) return 'failing'
  if (outcomes.includes('pending')) return 'pending'
  return 'passing'
}

function latest(timestamps: (string | null)[]): string | null {
  let best: string | null = null
  for (const ts of timestamps) {
    if (ts !== null && (best === null || Date.parse(ts) > Date.parse(best))) best = ts
  }
  return best
}

// Green-unmerged: passing and not a draft for longer than the threshold,
// counted from when the last check finished. A draft isn't asking to merge.
// Red-untouched: failing, and neither the pull request nor a failing check has
// moved for longer than the threshold. Drafts count: red and idle is idle.
export function stallOf(input: PullInput, now: Date, thresholds: Thresholds = DEFAULT_THRESHOLDS): Stall | null {
  const { pull, checks } = input
  const ci = ciState(checks)
  if (ci === 'passing' && !pull.draft) {
    const greenSince = latest(checks.map((c) => c.completedAt)) ?? pull.updatedAt
    if (elapsedMs(greenSince, now) > thresholds.greenUnmergedMs) return 'green-unmerged'
  }
  if (ci === 'failing') {
    const failing = checks.filter((c) => checkOutcome(c) === 'failing')
    const touched = latest([pull.updatedAt, ...failing.map((c) => c.completedAt)]) ?? pull.updatedAt
    if (elapsedMs(touched, now) > thresholds.redUntouchedMs) return 'red-untouched'
  }
  return null
}

// Oldest first.
export function derivePulls(inputs: PullInput[], now: Date, thresholds: Thresholds = DEFAULT_THRESHOLDS): PullStatus[] {
  return inputs
    .map((input) => ({
      pull: input.pull,
      ci: ciState(input.checks),
      failingChecks: input.checks.filter((c) => checkOutcome(c) === 'failing'),
      stall: stallOf(input, now, thresholds),
    }))
    .sort((a, b) => Date.parse(a.pull.createdAt) - Date.parse(b.pull.createdAt) || a.pull.number - b.pull.number)
}
