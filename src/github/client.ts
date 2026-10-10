// A read-only GitHub REST client. It only ever issues GET requests, keeps an
// ETag cache so repeat loads cost nothing against the rate limit when the data
// hasn't changed, and tracks the rate-limit budget from response headers.
//
// This file has no runtime imports so scripts/record-fixtures.ts can load it
// directly with Node's type stripping.
import type { RepoRef } from '../repo'

export const API_ORIGIN = 'https://api.github.com'

// A cap on paginated reads. At 100 per page this is 1000 issues, and it stops
// one oversized repo from spending a visitor's whole 60 requests/hour.
export const DEFAULT_MAX_PAGES = 10

// The method is part of the type, so a non-GET request doesn't compile.
export interface GetInit {
  method: 'GET'
  headers: Record<string, string>
}

export type FetchLike = (input: string, init: GetInit) => Promise<Response>

export interface RateLimit {
  limit: number
  remaining: number
  resetAt: Date
}

export type GitHubErrorKind = 'not-found' | 'rate-limited' | 'http'

export class GitHubError extends Error {
  readonly kind: GitHubErrorKind
  readonly status: number
  // Set when kind is 'rate-limited': when requests will succeed again.
  readonly resetAt: Date | null

  constructor(kind: GitHubErrorKind, status: number, message: string, resetAt: Date | null = null) {
    super(message)
    this.name = 'GitHubError'
    this.kind = kind
    this.status = status
    this.resetAt = resetAt
  }
}

export interface Repo {
  fullName: string
  defaultBranch: string
  private: boolean
  htmlUrl: string
}

// An entry from the issues endpoint, which also lists pull requests.
export interface Issue {
  number: number
  title: string
  state: 'open' | 'closed'
  labels: string[]
  author: string | null
  htmlUrl: string
  comments: number
  createdAt: string
  updatedAt: string
  closedAt: string | null
  isPullRequest: boolean
  // Only set on pull requests that merged.
  mergedAt: string | null
}

// An entry from an organization's repository listing.
export interface OrgRepo {
  name: string
  fullName: string
  private: boolean
  archived: boolean
}

export interface IssueList {
  issues: Issue[]
  // True when the page cap cut the listing short.
  truncated: boolean
}

export interface PullRequest {
  number: number
  title: string
  draft: boolean
  headSha: string
  author: string | null
  htmlUrl: string
  createdAt: string
  updatedAt: string
}

export interface CheckRun {
  name: string
  status: string
  // null until the run completes.
  conclusion: string | null
  completedAt: string | null
  htmlUrl: string
}

export interface GitHubClientOptions {
  fetch?: FetchLike
  token?: string | null
  maxPages?: number
}

interface CacheEntry {
  etag: string
  body: unknown
}

interface RawResponse {
  body: unknown
  next: string | null
}

export class GitHubClient {
  readonly #fetch: FetchLike
  readonly #maxPages: number
  readonly #cache = new Map<string, CacheEntry>()
  // Held in memory only: never written to storage, cookies, or a URL.
  #token: string | null
  #rateLimit: RateLimit | null = null

  constructor(options: GitHubClientOptions = {}) {
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init))
    this.#token = options.token ?? null
    this.#maxPages = options.maxPages ?? DEFAULT_MAX_PAGES
  }

  // Replacing the token drops the cache: what a request returns depends on
  // who's asking, so an answer cached for one token can't serve another.
  setToken(token: string | null): void {
    const next = token?.trim() || null
    if (next === this.#token) return
    this.#token = next
    this.#cache.clear()
  }

  get hasToken(): boolean {
    return this.#token !== null
  }

  // The budget reported by the most recent response, or null before the first.
  get rateLimit(): RateLimit | null {
    return this.#rateLimit
  }

  async getRepo(repo: RepoRef): Promise<Repo> {
    const { body } = await this.#get(`/repos/${repoPath(repo)}`)
    const raw = body as RawRepo
    return {
      fullName: raw.full_name,
      defaultBranch: raw.default_branch,
      private: raw.private,
      htmlUrl: raw.html_url,
    }
  }

  // Every repository in an organization that the caller can see: public ones
  // without a token, private ones too with a token that has access.
  async listOrgRepos(org: string): Promise<OrgRepo[]> {
    const { items } = await this.#getPaginated(
      `/orgs/${encodeURIComponent(org)}/repos?type=all&sort=full_name&per_page=100`,
    )
    return (items as RawOrgRepo[]).map((raw) => ({
      name: raw.name,
      fullName: raw.full_name,
      private: raw.private,
      archived: raw.archived ?? false,
    }))
  }

  // Whether a file exists on the default branch. A missing file and an empty
  // repository both answer 404, and both mean no.
  async hasFile(repo: RepoRef, path: string): Promise<boolean> {
    const encoded = path.split('/').map(encodeURIComponent).join('/')
    try {
      await this.#get(`/repos/${repoPath(repo)}/contents/${encoded}`)
      return true
    } catch (error) {
      if (error instanceof GitHubError && error.kind === 'not-found') return false
      throw error
    }
  }

  // Every issue and pull request, open and closed, newest first.
  async listIssues(repo: RepoRef): Promise<IssueList> {
    const { items, truncated } = await this.#getPaginated(
      `/repos/${repoPath(repo)}/issues?state=all&per_page=100`,
    )
    return { issues: (items as RawIssue[]).map(toIssue), truncated }
  }

  async listOpenPulls(repo: RepoRef): Promise<PullRequest[]> {
    const { items } = await this.#getPaginated(
      `/repos/${repoPath(repo)}/pulls?state=open&per_page=100`,
    )
    return (items as RawPull[]).map((raw) => ({
      number: raw.number,
      title: raw.title,
      draft: raw.draft ?? false,
      headSha: raw.head.sha,
      author: raw.user?.login ?? null,
      htmlUrl: raw.html_url,
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
    }))
  }

  // Check runs for a commit SHA or branch name.
  async listCheckRuns(repo: RepoRef, ref: string): Promise<CheckRun[]> {
    const { body } = await this.#get(
      `/repos/${repoPath(repo)}/commits/${encodeURIComponent(ref)}/check-runs?per_page=100`,
    )
    return (body as { check_runs: RawCheckRun[] }).check_runs.map((raw) => ({
      name: raw.name,
      status: raw.status,
      conclusion: raw.conclusion,
      completedAt: raw.completed_at,
      htmlUrl: raw.html_url,
    }))
  }

  async #getPaginated(path: string): Promise<{ items: unknown[]; truncated: boolean }> {
    const items: unknown[] = []
    let url: string | null = API_ORIGIN + path
    for (let page = 0; page < this.#maxPages && url; page++) {
      const response: RawResponse = await this.#request(url)
      items.push(...(response.body as unknown[]))
      url = response.next
    }
    return { items, truncated: url !== null }
  }

  #get(path: string): Promise<RawResponse> {
    return this.#request(API_ORIGIN + path)
  }

  async #request(url: string): Promise<RawResponse> {
    // Pagination URLs come from response headers. Refusing anything off the API
    // origin keeps the token from ever being sent somewhere else.
    if (!url.startsWith(API_ORIGIN + '/')) {
      throw new GitHubError('http', 0, `refusing to request a non-GitHub-API URL: ${url}`)
    }
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    }
    if (this.#token) headers.Authorization = `Bearer ${this.#token}`
    const cached = this.#cache.get(url)
    if (cached) headers['If-None-Match'] = cached.etag

    // The only request this client makes, and it's a GET. client.test.ts fails
    // if any public method ever issues anything else. A request carrying
    // If-None-Match bypasses the browser's HTTP cache, so a 304 reaches us.
    const response = await this.#fetch(url, { method: 'GET', headers })
    this.#rateLimit = readRateLimit(response.headers) ?? this.#rateLimit
    const next = nextLink(response.headers.get('link'))

    if (response.status === 304 && cached) return { body: cached.body, next }
    if (response.ok) {
      const body: unknown = await response.json()
      const etag = response.headers.get('etag')
      if (etag) this.#cache.set(url, { etag, body })
      return { body, next }
    }
    throw this.#errorFor(response)
  }

  #errorFor(response: Response): GitHubError {
    const { status } = response
    if (status === 404) return new GitHubError('not-found', status, 'not found')
    if (status === 403 || status === 429) {
      if (response.headers.get('x-ratelimit-remaining') === '0') {
        const resetAt = this.#rateLimit?.resetAt ?? null
        return new GitHubError('rate-limited', status, 'rate limited', resetAt)
      }
      // Secondary rate limits say how long to wait instead.
      const retryAfter = Number(response.headers.get('retry-after'))
      if (retryAfter > 0) {
        const resetAt = new Date(Date.now() + retryAfter * 1000)
        return new GitHubError('rate-limited', status, 'rate limited', resetAt)
      }
    }
    return new GitHubError('http', status, `GitHub API returned ${status}`)
  }
}

// "resets at HH:MM", in the viewer's local time.
export function formatResetTime(resetAt: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(resetAt.getHours())}:${pad(resetAt.getMinutes())}`
}

function repoPath(repo: RepoRef): string {
  return `${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`
}

function readRateLimit(headers: Headers): RateLimit | null {
  const limit = headers.get('x-ratelimit-limit')
  const remaining = headers.get('x-ratelimit-remaining')
  const reset = headers.get('x-ratelimit-reset')
  if (limit === null || remaining === null || reset === null) return null
  return {
    limit: Number(limit),
    remaining: Number(remaining),
    resetAt: new Date(Number(reset) * 1000),
  }
}

// Extracts the rel="next" URL from a Link header.
export function nextLink(link: string | null): string | null {
  if (!link) return null
  for (const part of link.split(',')) {
    const match = /<([^>]+)>\s*;\s*rel="next"/.exec(part)
    if (match?.[1]) return match[1]
  }
  return null
}

function toIssue(raw: RawIssue): Issue {
  return {
    number: raw.number,
    title: raw.title,
    state: raw.state,
    labels: raw.labels.map((label) => (typeof label === 'string' ? label : label.name)),
    author: raw.user?.login ?? null,
    htmlUrl: raw.html_url,
    comments: raw.comments,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    closedAt: raw.closed_at,
    isPullRequest: raw.pull_request !== undefined,
    mergedAt: raw.pull_request?.merged_at ?? null,
  }
}

// The subset of GitHub's response shapes this client reads.
interface RawUser {
  login: string
}

interface RawRepo {
  full_name: string
  default_branch: string
  private: boolean
  html_url: string
}

interface RawOrgRepo {
  name: string
  full_name: string
  private: boolean
  archived?: boolean
}

interface RawIssue {
  number: number
  title: string
  state: 'open' | 'closed'
  labels: (string | { name: string })[]
  user: RawUser | null
  html_url: string
  comments: number
  created_at: string
  updated_at: string
  closed_at: string | null
  pull_request?: { merged_at: string | null }
}

interface RawPull {
  number: number
  title: string
  draft?: boolean
  head: { sha: string }
  user: RawUser | null
  html_url: string
  created_at: string
  updated_at: string
}

interface RawCheckRun {
  name: string
  status: string
  conclusion: string | null
  completed_at: string | null
  html_url: string
}
