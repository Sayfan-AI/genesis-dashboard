// Recorded GitHub API responses, and a fake fetch that replays them. Tests run
// the real client against these, offline. scripts/record-fixtures.ts writes the
// files under ./fixtures/.
import type { FetchLike, GetInit } from './client'
import { API_ORIGIN } from './client'
import maklaude from './fixtures/Sayfan-AI__MaKlaude.json'
import genesisDashboard from './fixtures/Sayfan-AI__genesis-dashboard.json'
import sayfanOrg from '../discovery/fixtures/Sayfan-AI.json'

export interface RecordedResponse {
  status: number
  etag: string | null
  link: string | null
  body: unknown
}

export interface Fixture {
  repo: string
  recordedAt: string
  // Keyed by request path and query, without the API origin.
  responses: Record<string, RecordedResponse>
}

export const fixtures = {
  maklaude: maklaude as Fixture,
  genesisDashboard: genesisDashboard as Fixture,
  // The Sayfan-AI org listing and a marker-file lookup per repository, written
  // by `node scripts/discover-repos.ts --record`.
  sayfanOrg: sayfanOrg as Fixture,
}

export interface ReplayOptions {
  // Rate-limit headers to report. Defaults to an unauthenticated budget.
  rateLimit?: { limit: number; remaining: number; reset: number }
}

export interface Replay {
  fetch: FetchLike
  // Every request the client made, in order.
  calls: { url: string; init: GetInit }[]
}

// A fetch that serves recorded responses: 304 when the request's If-None-Match
// matches the recorded ETag, 404 for any path that wasn't recorded.
export function replay(responses: Record<string, RecordedResponse>, options: ReplayOptions = {}): Replay {
  const calls: Replay['calls'] = []
  const rate = { limit: 60, remaining: 60, reset: 1_800_000_000, ...options.rateLimit }
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init })
    rate.remaining = Math.max(0, rate.remaining - 1)
    const headers = new Headers({
      'x-ratelimit-limit': String(rate.limit),
      'x-ratelimit-remaining': String(rate.remaining),
      'x-ratelimit-reset': String(rate.reset),
    })
    const recorded = responses[url.slice(API_ORIGIN.length)]
    if (!recorded) {
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404, headers })
    }
    if (recorded.link) headers.set('link', recorded.link)
    if (recorded.etag) headers.set('etag', recorded.etag)
    const ifNoneMatch = new Headers(init.headers).get('if-none-match')
    if (recorded.etag && ifNoneMatch === recorded.etag) {
      return new Response(null, { status: 304, headers })
    }
    return new Response(JSON.stringify(recorded.body), { status: recorded.status, headers })
  }
  return { fetch, calls }
}
