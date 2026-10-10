// Records GitHub API fixtures for the client tests:
//
//   node scripts/record-fixtures.ts [owner/name ...]
//
// It drives the real client through a recording fetch, so the fixtures hold
// exactly the requests the client makes. Set GITHUB_TOKEN to record with a
// higher rate limit. Only record public repos: fixtures are committed.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { API_ORIGIN, GitHubClient, type FetchLike } from '../src/github/client.ts'
import type { Fixture, RecordedResponse } from '../src/github/fixtures.ts'

const DEFAULT_REPOS = ['Sayfan-AI/MaKlaude', 'Sayfan-AI/genesis-dashboard']
const OUT_DIR = join(import.meta.dirname, '..', 'src', 'github', 'fixtures')

// Fields the client never reads and that would bloat the fixtures: issue
// bodies, reactions, nested repo objects, and the API's many *_url links.
const DROPPED_KEYS = new Set(['body', 'reactions', 'node_id', 'performed_via_github_app', 'repo', 'output', 'app', 'organization'])

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

async function record(fullName: string): Promise<Fixture> {
  const [owner, name] = fullName.split('/')
  if (!owner || !name) throw new Error(`not owner/name: ${fullName}`)
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
  const client = new GitHubClient({ fetch: recordingFetch, token: process.env.GITHUB_TOKEN ?? null })
  const ref = { owner, name }
  const repo = await client.getRepo(ref)
  if (repo.private) throw new Error(`${fullName} is private; fixtures are committed`)
  await client.listIssues(ref)
  const pulls = await client.listOpenPulls(ref)
  for (const pull of pulls) await client.listCheckRuns(ref, pull.headSha)
  // Recorded even with no open PRs, so there's always a real check-runs shape.
  await client.listCheckRuns(ref, repo.defaultBranch)
  console.log(`${fullName}: ${Object.keys(responses).length} responses, rate limit remaining ${client.rateLimit?.remaining}`)
  return { repo: fullName, recordedAt: new Date().toISOString(), responses }
}

const repos = process.argv.slice(2)
mkdirSync(OUT_DIR, { recursive: true })
for (const fullName of repos.length ? repos : DEFAULT_REPOS) {
  const fixture = await record(fullName)
  const file = join(OUT_DIR, `${fullName.replace('/', '__')}.json`)
  writeFileSync(file, JSON.stringify(fixture, null, 2) + '\n')
}
