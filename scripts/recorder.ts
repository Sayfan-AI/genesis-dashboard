// A fetch that records what it returns, for the fixture-writing scripts. The
// recorded responses replay through src/github/fixtures.ts in tests.
import { API_ORIGIN, type FetchLike } from '../src/github/client.ts'
import type { RecordedResponse } from '../src/github/fixtures.ts'

// Fields the client never reads and that would bloat the fixtures: issue
// bodies, reactions, nested repo objects, file contents, and the API's many
// *_url links.
const DROPPED_KEYS = new Set(['body', 'reactions', 'node_id', 'performed_via_github_app', 'repo', 'output', 'app', 'organization', 'content'])

function slim(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(slim)
  if (value === null || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (DROPPED_KEYS.has(key)) continue
    if (key.endsWith('_url') && key !== 'html_url') continue
    if (key === 'url') continue
    out[key] = slim(child)
  }
  // Users and apps appear everywhere; the login is all anything reads.
  if (typeof out.login === 'string') return { login: out.login, type: out.type }
  return out
}

export interface Recorder {
  fetch: FetchLike
  // Keyed by request path and query, without the API origin.
  responses: Record<string, RecordedResponse>
}

export function recorder(): Recorder {
  const responses: Record<string, RecordedResponse> = {}
  const recordingFetch: FetchLike = async (url, init) => {
    const response = await fetch(url, init)
    if (response.status !== 304) {
      responses[url.slice(API_ORIGIN.length)] = {
        status: response.status,
        etag: response.headers.get('etag'),
        link: response.headers.get('link'),
        body: slim(await response.clone().json()),
      }
    }
    return response
  }
  return { fetch: recordingFetch, responses }
}
