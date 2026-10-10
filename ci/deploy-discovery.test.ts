// @vitest-environment node
// The side panel's list is only as fresh as the last deploy, so discovery has
// to run in the deploy job, before the build, on every trigger that deploys.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..')
const deploy = readFileSync(join(root, '.github', 'workflows', 'deploy.yml'), 'utf8')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }

describe('deploy wiring for org discovery', () => {
  it('runs discovery before the build', () => {
    const discover = deploy.indexOf('run: npm run discover')
    const build = deploy.indexOf('run: npm run build')
    expect(discover).toBeGreaterThan(-1)
    expect(discover).toBeLessThan(build)
  })

  it('deploys on push to main and on a daily schedule', () => {
    expect(deploy).toMatch(/push:\s*\n\s*branches: \[main\]/)
    expect(deploy).toMatch(/schedule:\s*\n\s*- cron: '\d+ \d+ \* \* \*'/)
  })

  it('writes the file Vite publishes', () => {
    expect(pkg.scripts.discover).toBe('node scripts/discover-repos.ts')
    expect(readFileSync(join(root, 'scripts', 'discover-repos.ts'), 'utf8')).toContain("default: 'public/repos.json'")
  })
})
