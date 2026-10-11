// Fetches everything one dashboard needs and runs it through the derivations.
// The fetch is the only impure part; given the same responses and `now`, the
// result is always the same.
import { GitHubError, type CheckRun, type GitHubClient, type Repo } from '../github/client'
import type { RepoRef } from '../repo'
import { DEFAULT_THRESHOLDS, type Thresholds } from '../derive/config'
import { deriveActivity, type Activity } from '../derive/activity'
import { deriveGates, type Gate } from '../derive/gates'
import { derivePulls, type PullStatus } from '../derive/pulls'
import { deriveRoadmap, type Roadmap } from '../derive/roadmap'

export interface DashboardData {
  repo: Repo
  roadmap: Roadmap
  gates: Gate[]
  pulls: PullStatus[]
  activity: Activity
  // True when the issue listing hit the page cap, so counts may be low.
  truncated: boolean
  // The `now` the derivations ran against.
  loadedAt: Date
}

// One call each for the repo, its issues, and its open pull requests, plus one
// check-runs call per open pull request. A failed check-runs call only costs
// that pull request its CI state; a rate limit still fails the whole load.
export async function loadDashboard(
  client: GitHubClient,
  ref: RepoRef,
  now: Date,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): Promise<DashboardData> {
  // The repo call goes first so a missing repo costs one request, not three.
  const repo = await client.getRepo(ref)
  const [{ issues, truncated }, openPulls] = await Promise.all([client.listIssues(ref), client.listOpenPulls(ref)])
  const inputs = await Promise.all(
    openPulls.map(async (pull) => ({ pull, checks: await checksOrNull(client, ref, pull.headSha) })),
  )
  return {
    repo,
    roadmap: deriveRoadmap(issues),
    gates: deriveGates(issues, now, thresholds),
    pulls: derivePulls(inputs, now, thresholds),
    activity: deriveActivity(issues, now, thresholds),
    truncated,
    loadedAt: now,
  }
}

// Null when the check runs can't be read, for example a token without
// `checks: read` (403) or a 5xx. Rate limits rethrow so they aren't hidden.
async function checksOrNull(client: GitHubClient, ref: RepoRef, sha: string): Promise<CheckRun[] | null> {
  try {
    return await client.listCheckRuns(ref, sha)
  } catch (error) {
    if (error instanceof GitHubError && error.kind !== 'rate-limited') return null
    throw error
  }
}
