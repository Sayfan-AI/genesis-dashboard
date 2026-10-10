// @vitest-environment node
// Runs the jq predicate embedded in genesis-merge.yml against PR shapes taken
// from real `gh pr list --json author,...` output, so the rule is tested as
// written in the workflow rather than as a copy of it.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const WORKFLOW = join(import.meta.dirname, '..', '.github', 'workflows', 'genesis-merge.yml')

function predicate(): string {
  const yaml = readFileSync(WORKFLOW, 'utf8')
  const m = /cat > \/tmp\/ready\.jq <<'JQ'\n([\s\S]*?)\n\s*JQ\n/.exec(yaml)
  if (!m) throw new Error('ready.jq heredoc not found in genesis-merge.yml')
  return m[1]
}

const green = [{ name: 'check', status: 'COMPLETED', conclusion: 'SUCCESS' }]

function pr(number: number, author: { login: string; is_bot?: boolean }, extra = {}) {
  return {
    number,
    title: `PR ${String(number)}`,
    isDraft: false,
    mergeable: 'MERGEABLE',
    createdAt: `2026-10-0${String(number)}T00:00:00Z`,
    author,
    statusCheckRollup: green,
    ...extra,
  }
}

function ready(prs: unknown[]): number[] {
  const r = spawnSync('jq', ['-c', predicate()], { input: JSON.stringify(prs), encoding: 'utf8' })
  expect(r.status, r.stderr).toBe(0)
  return (JSON.parse(r.stdout) as { number: number }[]).map((p) => p.number)
}

describe('genesis-merge.yml ready predicate', () => {
  it('selects a GitHub App author the way gh pr list reports it', () => {
    expect(ready([pr(1, { login: 'app/genesis-dev-bot', is_bot: true })])).toEqual([1])
  })

  it('never selects a human author', () => {
    expect(ready([pr(1, { login: 'the-gigi', is_bot: false })])).toEqual([])
  })

  it('refuses drafts, red checks, and empty rollups even from the bot', () => {
    const bot = { login: 'app/genesis-dev-bot', is_bot: true }
    expect(
      ready([
        pr(1, bot, { isDraft: true }),
        pr(2, bot, { statusCheckRollup: [{ name: 'check', status: 'COMPLETED', conclusion: 'FAILURE' }] }),
        pr(3, bot, { statusCheckRollup: [] }),
        pr(4, bot),
      ]),
    ).toEqual([4])
  })
})
