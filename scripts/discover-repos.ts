// Writes the side panel's list of dev systems at build time:
//
//   node scripts/discover-repos.ts [--org Sayfan-AI] [--out public/repos.json]
//   node scripts/discover-repos.ts --record src/discovery/fixtures/Sayfan-AI.json
//
// Discovery runs here rather than in the browser so it never spends the
// visitor's 60 requests/hour. The deploy workflow runs it on every deploy and
// on the daily rebuild. Set GITHUB_TOKEN for a higher rate limit.
//
// Private repositories are dropped from the output even when the token can see
// them: the file is published. They show up in the browser only when a visitor
// pastes a token with access.
//
// --record writes the API responses as a test fixture instead. It always runs
// unauthenticated, so a recording can't capture a private repository's name.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { parseArgs } from 'node:util'
import { GitHubClient } from '../src/github/client.ts'
import type { Fixture } from '../src/github/fixtures.ts'
import { discoverDevSystems, publishedList } from '../src/discovery/discover.ts'
import { recorder } from './recorder.ts'

const { values } = parseArgs({
  options: {
    org: { type: 'string', default: 'Sayfan-AI' },
    out: { type: 'string', default: 'public/repos.json' },
    record: { type: 'string' },
  },
})
const org = values.org

function write(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
}

if (values.record) {
  const { fetch, responses } = recorder()
  const found = await discoverDevSystems(new GitHubClient({ fetch }), org)
  const fixture: Fixture = { repo: org, recordedAt: new Date().toISOString(), responses }
  write(values.record, fixture)
  console.log(`${org}: recorded ${Object.keys(responses).length} responses, ${found.length} dev systems`)
} else {
  const client = new GitHubClient({ token: process.env.GITHUB_TOKEN || null })
  const found = await discoverDevSystems(client, org)
  const list = publishedList(org, found, new Date())
  write(values.out, list)
  const dropped = found.length - list.repos.length
  console.log(`${org}: ${list.repos.map((repo) => repo.name).join(', ') || 'no dev systems'}${dropped ? ` (${dropped} private left out)` : ''}`)
}
