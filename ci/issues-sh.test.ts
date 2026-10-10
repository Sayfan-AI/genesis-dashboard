// @vitest-environment node
// Exercises .genesis/scripts/issues.sh against a fake `gh` on PATH, so the
// selection and reporting rules are checked without touching GitHub.
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SCRIPT = join(import.meta.dirname, '..', '.genesis', 'scripts', 'issues.sh')

// `gh api <path>` serves fixture files, `gh issue list --jq` applies the filter
// to issues.json the way gh would, and writes are logged rather than performed.
const FAKE_GH = `#!/usr/bin/env bash
set -euo pipefail
D="$FAKE_GH_DIR"
echo "$*" >> "$D/calls.log"
case "$1 \${2:-}" in
  "api "*)
    case "$2" in
      *issues/comments*) cat "$D/comments.json" ;;
      *) cat "$D/issue-\${2##*/}.json" ;;
    esac ;;
  "issue list")
    JQ=""
    while [ $# -gt 0 ]; do [ "$1" = "--jq" ] && JQ="$2"; shift; done
    jq -r "$JQ" "$D/issues.json" ;;
  "issue view") echo 0 ;;
  "issue comment")
    while [ $# -gt 0 ]; do [ "$1" = "--body" ] && printf '%s\\n' "$2" >> "$D/bodies.log"; shift; done ;;
  "issue edit") ;;
  *) echo "fake gh: unhandled: $*" >&2; exit 1 ;;
esac
`

let dir: string

function run(...args: string[]) {
  return spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, FAKE_GH_DIR: dir, GENESIS_SESSION: 'test-session' },
  })
}

function fixture(name: string, value: unknown) {
  writeFileSync(join(dir, name), JSON.stringify(value))
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
const human = { login: 'the-gigi', type: 'User' }

function comment(issue: number, body: string, at: string, user = human) {
  return {
    issue_url: `https://api.github.com/repos/o/r/issues/${issue}`,
    html_url: `https://github.com/o/r/issues/${issue}#c`,
    created_at: at,
    user,
    body,
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'issues-sh-'))
  writeFileSync(join(dir, 'gh'), FAKE_GH)
  chmodSync(join(dir, 'gh'), 0o755)
  writeFileSync(join(dir, 'calls.log'), '')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('issues.sh unanswered-comments', () => {
  it('ignores claim and release notes even when a human token posted them', () => {
    fixture('comments.json', [
      comment(1, 'Claimed by session `s`. <!-- genesis-claim session=s -->', minutesAgo(30)),
      comment(2, 'Claim released: done. `in-progress` is off. <!-- genesis-release -->', minutesAgo(20)),
      comment(3, 'Please also add a README section.', minutesAgo(10)),
    ])
    for (const n of [1, 2, 3]) fixture(`issue-${n}.json`, { state: 'open', title: `issue ${n}` })

    const out = run('unanswered-comments')
    expect(out.status).toBe(0)
    expect(out.stdout).toContain('#3 ')
    expect(out.stdout).not.toMatch(/^#1 /m)
    expect(out.stdout).not.toMatch(/^#2 /m)
  })
})

describe('issues.sh release', () => {
  it('marks the release note so unanswered-comments can skip it', () => {
    expect(run('release', '--id', '7', '--reason', 'testing').status).toBe(0)
    expect(readFileSync(join(dir, 'bodies.log'), 'utf8')).toContain('<!-- genesis-release -->')
  })

  it('keeps the release marker distinct from the claim marker', () => {
    // claim_rows treats `<!-- genesis-claim ` as a live claim; a release note
    // matching it would read as a fresh claim by a session named "-->".
    run('release', '--id', '7', '--reason', 'testing')
    expect(readFileSync(join(dir, 'bodies.log'), 'utf8')).not.toContain('<!-- genesis-claim ')
  })
})

describe('issues.sh next', () => {
  const issue = (number: number, labels: string[], minutes: number) => ({
    number,
    createdAt: minutesAgo(minutes),
    labels: ['milestone:1', ...labels].map((name) => ({ name })),
  })

  it('skips needs:evolver and needs:human issues', () => {
    fixture('issues.json', [
      issue(16, ['needs:evolver'], 300),
      issue(17, ['needs:human'], 200),
      issue(18, [], 100),
    ])
    const out = run('next', '--milestone', '1')
    expect(out.status).toBe(0)
    expect(out.stdout.trim()).toBe('18')
  })

  it('exits 3 when only routed issues remain', () => {
    fixture('issues.json', [issue(16, ['needs:evolver'], 300)])
    const out = run('next', '--milestone', '1')
    expect(out.status).toBe(3)
    expect(out.stdout).toBe('')
  })
})

// Fail loudly rather than skip: without jq the `next` tests can't mean anything.
execFileSync('jq', ['--version'])
