// Shared by the derivation tests: recorded data read through the real client,
// and builders for synthetic issues, pull requests, and check runs.
import { GitHubClient, type CheckRun, type Issue, type PullRequest } from '../github/client'
import { fixtures, replay, type Fixture } from '../github/fixtures'

export const MAKLAUDE = { owner: 'Sayfan-AI', name: 'MaKlaude' }
export const DASHBOARD = { owner: 'Sayfan-AI', name: 'genesis-dashboard' }

async function load(fixture: Fixture, repo: typeof MAKLAUDE) {
  const client = new GitHubClient({ fetch: replay(fixture.responses).fetch })
  const [{ issues }, pulls, mainChecks] = await Promise.all([
    client.listIssues(repo),
    client.listOpenPulls(repo),
    client.listCheckRuns(repo, 'main'),
  ])
  return { issues, pulls, mainChecks, recordedAt: new Date(fixture.recordedAt) }
}

export const loadMaKlaude = () => load(fixtures.maklaude, MAKLAUDE)
export const loadDashboard = () => load(fixtures.genesisDashboard, DASHBOARD)

export function issue(overrides: Partial<Issue> & { number: number }): Issue {
  return {
    title: `Issue ${overrides.number}`,
    state: 'open',
    labels: [],
    author: 'genesis-dev-bot',
    htmlUrl: `https://github.com/o/r/issues/${overrides.number}`,
    comments: 0,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    closedAt: null,
    isPullRequest: false,
    mergedAt: null,
    ...overrides,
  }
}

export function pull(overrides: Partial<PullRequest> & { number: number }): PullRequest {
  return {
    title: `PR ${overrides.number}`,
    draft: false,
    headSha: `sha${overrides.number}`,
    author: 'genesis-dev-bot',
    htmlUrl: `https://github.com/o/r/pull/${overrides.number}`,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    ...overrides,
  }
}

export function check(
  name: string,
  conclusion: string | null,
  completedAt: string | null = conclusion === null ? null : '2026-10-01T00:00:00Z',
): CheckRun {
  return {
    name,
    status: conclusion === null ? 'in_progress' : 'completed',
    conclusion,
    completedAt,
    htmlUrl: `https://github.com/o/r/runs/${name}`,
  }
}
