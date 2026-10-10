// Records GitHub API fixtures for the client tests:
//
//   node scripts/record-fixtures.ts [owner/name ...]
//
// It drives the real client through a recording fetch, so the fixtures hold
// exactly the requests the client makes. Set GITHUB_TOKEN to record with a
// higher rate limit. Only record public repos: fixtures are committed.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { GitHubClient } from '../src/github/client.ts'
import type { Fixture } from '../src/github/fixtures.ts'
import { recorder } from './recorder.ts'

const DEFAULT_REPOS = ['Sayfan-AI/MaKlaude', 'Sayfan-AI/genesis-dashboard']
const OUT_DIR = join(import.meta.dirname, '..', 'src', 'github', 'fixtures')

async function record(fullName: string): Promise<Fixture> {
  const [owner, name] = fullName.split('/')
  if (!owner || !name) throw new Error(`not owner/name: ${fullName}`)
  const { fetch: recordingFetch, responses } = recorder()
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
