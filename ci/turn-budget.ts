// Enforces CLAUDE.md's Turn Budgets rule: every workflow step that invokes
// Claude passes an explicit `--max-turns`, at or above its class floor.
//
// Workflow files are scanned by indentation rather than parsed as YAML: steps
// are always `- ` list items under a `steps:` key, which is all this needs, and
// it keeps the check free of a parser dependency.

export const ORCHESTRATOR_FLOOR = 30

// Workflows named in CLAUDE.md as orchestrator class. genesis-ci-failure isn't
// in that sentence, but it runs the orchestrator agent, so the agent-reference
// check below puts it in the same class.
const ORCHESTRATOR_WORKFLOWS = new Set(['genesis-orchestrator', 'genesis-events', 'genesis-evolver'])

// A step that tells Claude to run one of these agents does open-ended work and
// spends from the orchestrator-class budget, whatever the workflow is called.
const ORCHESTRATOR_AGENT = /\.claude\/agents\/(orchestrator|evolver)\.md/

const CLAUDE_ACTION = /^\s*(-\s+)?uses:\s*["']?anthropics\/claude-code-action(@|["'\s]|$)/m
const CLAUDE_CLI = /(^|[\s;&|(])(claude|npx\s+(-y\s+)?@anthropic-ai\/claude-code)\s+-/m
const MAX_TURNS = /--max-turns(?:=|\s+)([^\s"']+)/

export type BudgetClass = 'orchestrator' | 'narrow'

export interface Violation {
  workflow: string
  job: string
  step: string
  message: string
}

export interface StepBlock {
  job: string
  name: string
  /** The step's source with full-line comments removed. */
  text: string
}

const indentOf = (line: string): number => line.length - line.trimStart().length
const isBlankOrComment = (line: string): boolean => /^\s*(#.*)?$/.test(line)

export function stepBlocks(source: string): StepBlock[] {
  const lines = source.split('\n')
  const blocks: StepBlock[] = []
  let jobsIndent = -1
  let jobIndent = -1
  let job = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (isBlankOrComment(line)) continue
    const indent = indentOf(line)

    if (/^jobs:\s*$/.test(line)) {
      jobsIndent = indent
      jobIndent = -1
      continue
    }
    if (jobsIndent < 0) continue
    if (indent <= jobsIndent) {
      jobsIndent = -1
      continue
    }
    if (jobIndent < 0) jobIndent = indent
    if (indent === jobIndent) {
      job = line.trim().replace(/:.*$/, '')
      continue
    }

    if (!/^\s*steps:\s*$/.test(line)) continue
    const stepsIndent = indent
    let current: string[] | null = null
    let itemIndent = -1
    const flush = () => {
      if (!current) return
      const text = current.join('\n')
      const name = /^\s*(-\s+)?name:\s*(.+)$/m.exec(text)?.[2]?.replace(/^["']|["']$/g, '') ?? ''
      blocks.push({ job, name: name || `#${blocks.filter((b) => b.job === job).length + 1}`, text })
    }
    for (i = i + 1; i < lines.length; i++) {
      const stepLine = lines[i] ?? ''
      if (isBlankOrComment(stepLine)) continue
      const stepIndent = indentOf(stepLine)
      if (stepIndent <= stepsIndent && !stepLine.trimStart().startsWith('- ')) break
      if (itemIndent < 0) itemIndent = stepIndent
      if (stepIndent < itemIndent) break
      if (stepIndent === itemIndent && stepLine.trimStart().startsWith('- ')) {
        flush()
        current = []
      }
      current?.push(stepLine)
    }
    flush()
    i-- // let the outer loop see the line that ended this steps list
  }
  return blocks
}

export function invokesClaude(step: StepBlock): boolean {
  return CLAUDE_ACTION.test(step.text) || CLAUDE_CLI.test(step.text)
}

export function classify(workflow: string, step: StepBlock): BudgetClass {
  if (ORCHESTRATOR_WORKFLOWS.has(workflow)) return 'orchestrator'
  return ORCHESTRATOR_AGENT.test(step.text) ? 'orchestrator' : 'narrow'
}

export function floorFor(budgetClass: BudgetClass): number {
  return budgetClass === 'orchestrator' ? ORCHESTRATOR_FLOOR : 1
}

/** `workflow` is the file's basename without extension, e.g. `genesis-events`. */
export function checkWorkflow(workflow: string, source: string): Violation[] {
  const violations: Violation[] = []
  for (const step of stepBlocks(source)) {
    if (!invokesClaude(step)) continue
    const where = { workflow, job: step.job, step: step.name }
    const budgetClass = classify(workflow, step)
    const floor = floorFor(budgetClass)
    const match = MAX_TURNS.exec(step.text)
    if (!match) {
      violations.push({ ...where, message: `invokes Claude without --max-turns (${budgetClass} class, floor ${floor})` })
      continue
    }
    const value = match[1] ?? ''
    const turns = /^\d+$/.test(value) ? Number(value) : NaN
    if (!(turns >= floor)) {
      violations.push({ ...where, message: `--max-turns ${value} is below the ${budgetClass}-class floor of ${floor}` })
    }
  }
  return violations
}
