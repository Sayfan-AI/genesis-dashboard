import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_MAX_PAGES, GitHubClient, GitHubError, formatResetTime, nextLink, type FetchLike } from './client'
import { fixtures, replay, type RecordedResponse } from './fixtures'

const MAKLAUDE = { owner: 'Sayfan-AI', name: 'MaKlaude' }
const DASHBOARD = { owner: 'Sayfan-AI', name: 'genesis-dashboard' }
const EMPTY = { owner: 'someone', name: 'empty' }

// A repo that exists but has never had an issue, pull request, or commit.
const emptyRepo: Record<string, RecordedResponse> = {
  '/repos/someone/empty': {
    status: 200,
    etag: '"repo"',
    link: null,
    body: { full_name: 'someone/empty', default_branch: 'main', private: false, html_url: 'https://github.com/someone/empty' },
  },
  '/repos/someone/empty/issues?state=all&per_page=100': { status: 200, etag: '"i"', link: null, body: [] },
  '/repos/someone/empty/pulls?state=open&per_page=100': { status: 200, etag: '"p"', link: null, body: [] },
}

function status(code: number, headers: Record<string, string> = {}): FetchLike {
  return async () => new Response(JSON.stringify({ message: 'nope' }), { status: code, headers })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GitHubClient against recorded fixtures', () => {
  it('reads repo metadata', async () => {
    const client = new GitHubClient({ fetch: replay(fixtures.maklaude.responses).fetch })
    expect(await client.getRepo(MAKLAUDE)).toEqual({
      fullName: 'Sayfan-AI/MaKlaude',
      defaultBranch: 'main',
      private: false,
      htmlUrl: 'https://github.com/Sayfan-AI/MaKlaude',
    })
  })

  it('follows pagination to list every issue and pull request', async () => {
    const { fetch, calls } = replay(fixtures.maklaude.responses)
    const { issues, truncated } = await new GitHubClient({ fetch }).listIssues(MAKLAUDE)
    expect(truncated).toBe(false)
    expect(calls).toHaveLength(3)
    expect(issues.length).toBeGreaterThan(200)
    expect(new Set(issues.map((i) => i.number)).size).toBe(issues.length)
    expect(issues.some((i) => i.isPullRequest && i.mergedAt !== null)).toBe(true)
    expect(issues.some((i) => !i.isPullRequest && i.mergedAt === null)).toBe(true)
  })

  it('normalizes issues', async () => {
    const client = new GitHubClient({ fetch: replay(fixtures.genesisDashboard.responses).fetch })
    const { issues } = await client.listIssues(DASHBOARD)
    const onboarding = issues.find((i) => i.number === 1)
    expect(onboarding).toMatchObject({
      title: 'Onboarding: genesis-dashboard',
      state: 'closed',
      isPullRequest: false,
      mergedAt: null,
    })
    expect(onboarding?.labels).toContain('needs:human')
    expect(onboarding?.closedAt).not.toBeNull()
    const scaffold = issues.find((i) => i.number === 11)
    expect(scaffold).toMatchObject({ isPullRequest: true, state: 'closed' })
    expect(scaffold?.mergedAt).not.toBeNull()
  })

  it('reads open pull requests and check runs', async () => {
    const client = new GitHubClient({ fetch: replay(fixtures.maklaude.responses).fetch })
    expect(await client.listOpenPulls(MAKLAUDE)).toEqual([])
    const runs = await client.listCheckRuns(MAKLAUDE, 'main')
    expect(runs.length).toBeGreaterThan(0)
    for (const run of runs) {
      expect(run.name).toEqual(expect.any(String))
      expect(run.status).toEqual(expect.any(String))
    }
  })

  it('handles an empty repo', async () => {
    const client = new GitHubClient({ fetch: replay(emptyRepo).fetch })
    expect((await client.getRepo(EMPTY)).fullName).toBe('someone/empty')
    expect(await client.listIssues(EMPTY)).toEqual({ issues: [], truncated: false })
    expect(await client.listOpenPulls(EMPTY)).toEqual([])
  })

  it('stops at the page cap and says the listing is truncated', async () => {
    const { fetch, calls } = replay(fixtures.maklaude.responses)
    const { issues, truncated } = await new GitHubClient({ fetch, maxPages: 2 }).listIssues(MAKLAUDE)
    expect(truncated).toBe(true)
    expect(calls).toHaveLength(2)
    expect(issues).toHaveLength(200)
    expect(DEFAULT_MAX_PAGES).toBeGreaterThanOrEqual(3)
  })
})

describe('errors', () => {
  it('reports a missing repo as not-found', async () => {
    const client = new GitHubClient({ fetch: replay(fixtures.maklaude.responses).fetch })
    const error = await client.getRepo({ owner: 'Sayfan-AI', name: 'does-not-exist' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(GitHubError)
    expect(error).toMatchObject({ kind: 'not-found', status: 404 })
  })

  it('reports an exhausted budget as rate-limited, with the reset time', async () => {
    const reset = 1_800_000_000
    const client = new GitHubClient({
      fetch: status(403, {
        'x-ratelimit-limit': '60',
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(reset),
      }),
    })
    const error = await client.getRepo(MAKLAUDE).catch((e: unknown) => e)
    expect(error).toMatchObject({ kind: 'rate-limited', status: 403, resetAt: new Date(reset * 1000) })
    expect(client.rateLimit).toEqual({ limit: 60, remaining: 0, resetAt: new Date(reset * 1000) })
  })

  it('reports a secondary rate limit using retry-after', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const client = new GitHubClient({ fetch: status(429, { 'retry-after': '30' }) })
    const error = await client.getRepo(MAKLAUDE).catch((e: unknown) => e)
    expect(error).toMatchObject({ kind: 'rate-limited', resetAt: new Date(1_030_000) })
  })

  it('reports any other 403 as a plain http error', async () => {
    const client = new GitHubClient({ fetch: status(403, { 'x-ratelimit-remaining': '42' }) })
    const error = await client.getRepo(MAKLAUDE).catch((e: unknown) => e)
    expect(error).toMatchObject({ kind: 'http', status: 403 })
  })
})

describe('rate limit and caching', () => {
  it('tracks the budget from response headers', async () => {
    const { fetch } = replay(fixtures.maklaude.responses, { rateLimit: { limit: 60, remaining: 10, reset: 1_800_000_000 } })
    const client = new GitHubClient({ fetch })
    expect(client.rateLimit).toBeNull()
    await client.getRepo(MAKLAUDE)
    expect(client.rateLimit).toEqual({ limit: 60, remaining: 9, resetAt: new Date(1_800_000_000_000) })
  })

  it('revalidates with the ETag and serves the cached body on 304', async () => {
    const { fetch, calls } = replay(fixtures.maklaude.responses)
    const client = new GitHubClient({ fetch })
    const first = await client.listIssues(MAKLAUDE)
    const second = await client.listIssues(MAKLAUDE)
    expect(second).toEqual(first)
    expect(calls).toHaveLength(6)
    for (const call of calls.slice(0, 3)) expect(new Headers(call.init.headers).has('if-none-match')).toBe(false)
    for (const call of calls.slice(3)) expect(new Headers(call.init.headers).get('if-none-match')).toMatch(/.+/)
  })

  it('drops the cache when the token changes', async () => {
    const { fetch, calls } = replay(fixtures.maklaude.responses)
    const client = new GitHubClient({ fetch })
    await client.getRepo(MAKLAUDE)
    client.setToken('ghp_example')
    await client.getRepo(MAKLAUDE)
    expect(new Headers(calls[1]?.init.headers).has('if-none-match')).toBe(false)
  })

  it('formats the reset time as HH:MM local time', () => {
    expect(formatResetTime(new Date(2026, 9, 10, 7, 5))).toBe('07:05')
    expect(formatResetTime(new Date(2026, 9, 10, 23, 59))).toBe('23:59')
  })

  it('parses the next link', () => {
    expect(nextLink(null)).toBeNull()
    expect(nextLink('<https://api.github.com/a?page=1>; rel="prev"')).toBeNull()
    expect(nextLink('<https://api.github.com/a?page=1>; rel="prev", <https://api.github.com/a?page=3>; rel="next"')).toBe(
      'https://api.github.com/a?page=3',
    )
  })
})

describe('read-only', () => {
  // Every public method, with how to call it. A method added to the client
  // without an entry here fails the first test, so none escapes the GET check.
  const calls: Record<string, (client: GitHubClient) => Promise<unknown>> = {
    getRepo: (c) => c.getRepo(MAKLAUDE),
    listIssues: (c) => c.listIssues(MAKLAUDE),
    listOpenPulls: (c) => c.listOpenPulls(MAKLAUDE),
    listCheckRuns: (c) => c.listCheckRuns(MAKLAUDE, 'main'),
    listOrgRepos: (c) => c.listOrgRepos('Sayfan-AI'),
    hasFile: (c) => c.hasFile(MAKLAUDE, '.genesis/config.toml'),
    setToken: async (c) => c.setToken('ghp_example'),
  }

  it('covers every public method', () => {
    const methods = Object.getOwnPropertyNames(GitHubClient.prototype).filter((name) => {
      const descriptor = Object.getOwnPropertyDescriptor(GitHubClient.prototype, name)
      return name !== 'constructor' && typeof descriptor?.value === 'function'
    })
    expect(methods.sort()).toEqual(Object.keys(calls).sort())
  })

  it('only ever issues GET requests', async () => {
    const { fetch, calls: requests } = replay({ ...fixtures.maklaude.responses, ...fixtures.sayfanOrg.responses })
    const client = new GitHubClient({ fetch, token: 'ghp_example' })
    for (const call of Object.values(calls)) {
      await call(client)
      await call(client) // again, so the cached revalidation path is covered too
    }
    expect(requests.length).toBeGreaterThan(0)
    for (const request of requests) expect(request.init.method).toBe('GET')
  })
})

describe('token handling', () => {
  it('sends the token only as an Authorization header', async () => {
    const { fetch, calls } = replay(fixtures.maklaude.responses)
    const client = new GitHubClient({ fetch, token: 'ghp_secret' })
    await client.listIssues(MAKLAUDE)
    for (const call of calls) {
      expect(call.url).not.toContain('ghp_secret')
      expect(new Headers(call.init.headers).get('authorization')).toBe('Bearer ghp_secret')
    }
  })

  it('sends no Authorization header without a token', async () => {
    const { fetch, calls } = replay(fixtures.maklaude.responses)
    const client = new GitHubClient({ fetch, token: 'ghp_secret' })
    client.setToken(null)
    await client.getRepo(MAKLAUDE)
    expect(client.hasToken).toBe(false)
    expect(new Headers(calls[0]?.init.headers).has('authorization')).toBe(false)
  })

  it('never persists the token', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const cookie = vi.spyOn(document, 'cookie', 'set')
    const pushState = vi.spyOn(window.history, 'pushState')
    const replaceState = vi.spyOn(window.history, 'replaceState')
    const client = new GitHubClient({ fetch: replay(fixtures.maklaude.responses).fetch })
    client.setToken('ghp_secret')
    await client.listIssues(MAKLAUDE)
    expect(setItem).not.toHaveBeenCalled()
    expect(cookie).not.toHaveBeenCalled()
    expect(pushState).not.toHaveBeenCalled()
    expect(replaceState).not.toHaveBeenCalled()
    expect(window.location.href).not.toContain('ghp_secret')
  })

  it('refuses to follow a pagination link off the API origin', async () => {
    const fetch = vi.fn<FetchLike>(
      async () => new Response('[]', { status: 200, headers: { link: '<https://evil.example/steal>; rel="next"' } }),
    )
    const client = new GitHubClient({ fetch, token: 'ghp_secret' })
    await expect(client.listIssues(MAKLAUDE)).rejects.toThrow(/non-GitHub-API URL/)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
