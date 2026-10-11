// Loads the dashboard in headless Chrome and prints what a person would see,
// plus every GitHub API request the page made:
//
//   node scripts/live-check.ts [--repo owner/name] [--base URL]
//                              [--token-env VAR] [--wait ms] [--screenshot file.png]
//
// --base defaults to the published site. For a local build, run
// `npm run build && npm run preview` and pass --base http://localhost:4173/genesis-dashboard/.
// --token-env names an environment variable whose value is typed into the token
// field and submitted, e.g. `GDTOK=$(gh auth token) node scripts/live-check.ts --token-env GDTOK`.
// The token is redacted from everything printed.
//
// Exit codes: 0 ok; 1 the page made a non-GET request to the GitHub API (the
// dashboard is read-only); 2 Chrome or the page didn't load.
//
// Why this exists: every live verification in milestone 1 (issues #8, #9, #10,
// #23) rebuilt the same throwaway Playwright script in /tmp, and each one first
// failed on `chromium.launch()` because Playwright's bundled Chromium isn't
// installed. This drives the installed Chrome over the DevTools protocol with
// Node's built-in WebSocket, so it needs no dependency and no browser download.
// Set CHROME to the binary if it isn't in a standard place.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    repo: { type: 'string' },
    base: { type: 'string', default: 'https://sayfan-ai.github.io/genesis-dashboard/' },
    'token-env': { type: 'string' },
    wait: { type: 'string', default: '6000' },
    screenshot: { type: 'string' },
  },
})

function fail(message: string): never {
  console.error(`live-check: ${message}`)
  process.exit(2)
}

const tokenVar = values['token-env']
const token = tokenVar ? process.env[tokenVar] : undefined
if (tokenVar && !token) fail(`$${tokenVar} is empty`)
const redact = (s: string): string => (token ? s.split(token).join('<token>') : s)
const url = values.base + (values.repo ? `?repo=${values.repo}` : '')
const waitMs = Number(values.wait)

const chromePath =
  process.env.CHROME ??
  [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].find((p) => existsSync(p))
if (!chromePath) fail('no Chrome found; set CHROME to its binary')

const profile = mkdtempSync(join(tmpdir(), 'live-check-'))
const chrome = spawn(
  chromePath,
  ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--window-size=1400,1000', 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'] },
)
const cleanup = () => {
  chrome.kill()
  rmSync(profile, { recursive: true, force: true })
}

const browserWs = await new Promise<string>((resolve, reject) => {
  let buffer = ''
  const timer = setTimeout(() => reject(new Error('Chrome printed no DevTools URL within 15s')), 15000)
  chrome.stderr.on('data', (chunk: Buffer) => {
    buffer += chunk.toString()
    const match = /DevTools listening on (ws:\/\/\S+)/.exec(buffer)
    if (match?.[1]) {
      clearTimeout(timer)
      resolve(match[1])
    }
  })
  chrome.on('exit', (code) => reject(new Error(`Chrome exited (${code}): ${buffer.slice(-500)}`)))
}).catch((e: unknown) => {
  cleanup()
  fail(String(e))
})

type Message = { id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: { message: string } }

const targets = (await (await fetch(`http://${new URL(browserWs).host}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[]
const pageTarget = targets.find((t) => t.type === 'page')
if (!pageTarget) {
  cleanup()
  fail('Chrome opened no page target')
}

const ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.onopen = resolve
  ws.onerror = reject
})
let nextId = 1
const pending = new Map<number, { resolve: (r: Record<string, unknown>) => void; reject: (e: Error) => void }>()
const listeners: ((m: Message) => void)[] = []
ws.onmessage = (event: MessageEvent) => {
  const message = JSON.parse(String(event.data)) as Message
  if (message.id !== undefined) {
    const waiter = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) waiter?.reject(new Error(message.error.message))
    else waiter?.resolve(message.result ?? {})
  } else {
    for (const listener of listeners) listener(message)
  }
}
const send = (method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> =>
  new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async <T>(expression: string): Promise<T> => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  return (result.result as { value: T }).value
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const methods = new Map<string, string>()
const requests: { method: string; status: number; url: string }[] = []
const consoleErrors: string[] = []
let loaded = false
listeners.push((m) => {
  const p = m.params ?? {}
  if (m.method === 'Network.requestWillBeSent') {
    const request = p.request as { method: string }
    methods.set(p.requestId as string, request.method)
  } else if (m.method === 'Network.responseReceived') {
    const response = p.response as { url: string; status: number }
    if (response.url.includes('api.github.com')) {
      requests.push({ method: methods.get(p.requestId as string) ?? '?', status: response.status, url: response.url })
    }
  } else if (m.method === 'Runtime.consoleAPICalled' && p.type === 'error') {
    const args = p.args as { value?: unknown; description?: string }[]
    consoleErrors.push(args.map((a) => a.description ?? String(a.value)).join(' '))
  } else if (m.method === 'Runtime.exceptionThrown') {
    const details = p.exceptionDetails as { text: string; exception?: { description?: string } }
    consoleErrors.push(details.exception?.description ?? details.text)
  } else if (m.method === 'Page.loadEventFired') {
    loaded = true
  }
})

try {
  await Promise.all([send('Network.enable'), send('Runtime.enable'), send('Page.enable')])
  const nav = await send('Page.navigate', { url })
  if (nav.errorText) throw new Error(`couldn't load ${url}: ${String(nav.errorText)}`)
  for (let waited = 0; !loaded && waited < 30000; waited += 100) await sleep(100)
  if (!loaded) throw new Error(`${url} didn't finish loading within 30s`)

  if (token) {
    await sleep(1000)
    const found = await evaluate<boolean>(`(() => { const el = document.querySelector('#token'); if (!el) return false; el.focus(); return true })()`)
    if (!found) throw new Error('no #token field on the page')
    await send('Input.insertText', { text: token })
    await evaluate(`document.querySelector('#token').form.requestSubmit()`)
  }
  await sleep(waitMs)

  const alerts = await evaluate<string[]>(`[...document.querySelectorAll('[role=alert]')].map((e) => e.innerText)`)
  const body = await evaluate<string>('document.body.innerText')
  const storage = await evaluate<unknown>('[Object.keys(localStorage), Object.keys(sessionStorage), document.cookie]')
  if (values.screenshot) {
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
    writeFileSync(values.screenshot, Buffer.from(shot.data as string, 'base64'))
  }

  console.log(`URL: ${url}${token ? ' (token submitted)' : ''}`)
  console.log(`\n=== Alerts (${alerts.length})`)
  for (const a of alerts) console.log(redact(a))
  console.log('\n=== Page text')
  console.log(redact(body))
  console.log(`\n=== GitHub API requests (${requests.length})`)
  for (const r of requests) console.log(`${r.method} ${r.status} ${redact(r.url)}`)
  console.log(`\n=== Console errors (${consoleErrors.length})`)
  for (const e of consoleErrors) console.log(redact(e))
  console.log(`\n=== Storage [localStorage keys, sessionStorage keys, cookie]: ${redact(JSON.stringify(storage))}`)
} catch (e) {
  ws.close()
  cleanup()
  fail(redact(String(e)))
}
ws.close()
cleanup()

const writes = requests.filter((r) => r.method !== 'GET')
if (writes.length > 0) {
  console.error(`\nlive-check: ${writes.length} non-GET request(s) to the GitHub API; the dashboard must be read-only`)
  process.exit(1)
}
