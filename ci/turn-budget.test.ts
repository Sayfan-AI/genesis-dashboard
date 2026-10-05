// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkWorkflow, stepBlocks } from './turn-budget'

const WORKFLOWS_DIR = join(import.meta.dirname, '..', '.github', 'workflows')
const FIXTURES_DIR = join(import.meta.dirname, 'fixtures')

function check(dir: string, file: string) {
  return checkWorkflow(basename(file, extname(file)), readFileSync(join(dir, file), 'utf8'))
}

const workflowFiles = readdirSync(WORKFLOWS_DIR).filter((f) => /\.ya?ml$/.test(f))

describe('turn budgets in .github/workflows', () => {
  it.each(workflowFiles)('%s passes', (file) => {
    expect(check(WORKFLOWS_DIR, file)).toEqual([])
  })

  it('finds the Claude steps it is meant to guard', () => {
    // If the scanner silently stopped seeing steps, every workflow would pass.
    const guarded = workflowFiles.filter((file) =>
      stepBlocks(readFileSync(join(WORKFLOWS_DIR, file), 'utf8')).some((s) =>
        s.text.includes('anthropics/claude-code-action'),
      ),
    )
    expect(guarded).toEqual(
      expect.arrayContaining([
        'genesis-ci-failure.yml',
        'genesis-events.yml',
        'genesis-evolver.yml',
        'genesis-orchestrator.yml',
      ]),
    )
  })
})

describe('checkWorkflow', () => {
  it('fails an orchestrator-class step below the floor', () => {
    expect(check(FIXTURES_DIR, 'below-floor.yml')).toEqual([
      expect.objectContaining({ job: 'run', message: '--max-turns 10 is below the orchestrator-class floor of 30' }),
    ])
  })

  it('fails an action step with no --max-turns', () => {
    expect(check(FIXTURES_DIR, 'no-max-turns.yml')).toEqual([
      expect.objectContaining({ message: 'invokes Claude without --max-turns (narrow class, floor 1)' }),
    ])
  })

  it('fails a CLI step with no --max-turns', () => {
    expect(check(FIXTURES_DIR, 'cli-no-max-turns.yml')).toEqual([
      expect.objectContaining({ step: 'Ask Claude', message: expect.stringContaining('without --max-turns') }),
    ])
  })

  it('applies the orchestrator floor by workflow name', () => {
    const source = readFileSync(join(FIXTURES_DIR, 'no-max-turns.yml'), 'utf8').replace(
      '"--allowedTools Read"',
      '"--max-turns 20 --allowedTools Read"',
    )
    expect(checkWorkflow('genesis-events', source)).toHaveLength(1)
    expect(checkWorkflow('something-narrow', source)).toEqual([])
  })

  it('ignores --max-turns that only appears in a comment', () => {
    const source = readFileSync(join(FIXTURES_DIR, 'no-max-turns.yml'), 'utf8').replace(
      '          claude_args:',
      '          # pass --max-turns 40 here\n          claude_args:',
    )
    expect(checkWorkflow('no-max-turns', source)).toHaveLength(1)
  })

  it('rejects a non-numeric budget', () => {
    const source = readFileSync(join(FIXTURES_DIR, 'below-floor.yml'), 'utf8').replace('--max-turns 10', '--max-turns ${{ vars.TURNS }}')
    expect(checkWorkflow('below-floor', source)).toEqual([
      expect.objectContaining({ message: expect.stringContaining('below the orchestrator-class floor') }),
    ])
  })

  it('tracks steps across multiple jobs', () => {
    const source = [
      'jobs:',
      '  first:',
      '    steps:',
      '      - run: echo hi',
      '  second:',
      '    steps:',
      '    - name: Ask',
      '      run: claude -p "hi"',
      '',
    ].join('\n')
    expect(checkWorkflow('multi', source)).toEqual([
      expect.objectContaining({ job: 'second', step: 'Ask' }),
    ])
  })
})
