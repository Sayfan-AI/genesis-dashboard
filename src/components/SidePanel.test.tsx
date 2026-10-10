import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import type { RepoList } from '../discovery/discover'
import { GitHubClient, type FetchLike } from '../github/client'
import { fixtures, replay, type RecordedResponse } from '../github/fixtures'

const now = new Date(fixtures.genesisDashboard.recordedAt)

// The list the build would publish today: discovery run over the recorded org.
const LIST: RepoList = {
  org: 'Sayfan-AI',
  generatedAt: '2026-10-10T00:00:00Z',
  repos: ['genesis-dashboard', 'genesis-e2e-tictactoe', 'MaKlaude', 'ronny-learns-ai'].map((name) => ({
    name,
    fullName: `Sayfan-AI/${name}`,
    private: false,
  })),
}

// MaKlaude and this repo are recorded; the other two answer 404, which is
// enough to show a badge that couldn't load.
const RECORDED = { ...fixtures.maklaude.responses, ...fixtures.genesisDashboard.responses }

function renderPanel({
  search = '?repo=Sayfan-AI/MaKlaude',
  fetch = replay(RECORDED).fetch,
  loadRepoList = async () => LIST,
}: { search?: string; fetch?: FetchLike; loadRepoList?: () => Promise<RepoList> } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <App search={search} client={new GitHubClient({ fetch })} now={now} loadRepoList={loadRepoList} />
    </QueryClientProvider>,
  )
}

const panel = () => screen.getByRole('navigation', { name: 'Dev systems' })
const entry = (name: string) => within(panel()).getByRole('button', { name: new RegExp(`^>?${name}`) })
const badges = (name: string) => entry(name).querySelector('[data-badges]')

afterEach(() => {
  window.history.replaceState(null, '', '/')
  vi.unstubAllGlobals()
})

describe('side panel', () => {
  it('lists every discovered dev system and marks the selected one', async () => {
    renderPanel()
    await within(panel()).findByRole('button', { name: /MaKlaude/ })
    expect(within(panel()).getByText('Dev systems (Sayfan-AI)')).toBeInTheDocument()
    const names = within(panel())
      .getAllByRole('listitem')
      .map((li) => li.textContent)
    expect(names.map((text) => text?.match(/^>?([\w-]+?)gates/)?.[1])).toEqual([
      'genesis-dashboard',
      'genesis-e2e-tictactoe',
      'MaKlaude',
      'ronny-learns-ai',
    ])
    expect(entry('MaKlaude')).toHaveAttribute('aria-current', 'true')
    expect(entry('genesis-dashboard')).not.toHaveAttribute('aria-current')
  })

  it('loads badges lazily: the selected repo first, then the rest one at a time', async () => {
    const recording = replay(RECORDED)
    // The selected repo answers slowly, so loading anything alongside it would
    // show up as interleaved requests.
    const slow: FetchLike = async (url, init) => {
      if (!url.includes('/repos/Sayfan-AI/') || url.includes('MaKlaude')) await new Promise((r) => setTimeout(r, 20))
      return recording.fetch(url, init)
    }
    renderPanel({ fetch: slow })
    await waitFor(() => expect(badges('MaKlaude')).toHaveAttribute('data-badges', 'loaded'))
    expect(badges('MaKlaude')).toHaveTextContent('gates 0stalled 0M6')

    await waitFor(() => expect(badges('ronny-learns-ai')).toHaveAttribute('data-badges', 'error'))
    expect(badges('genesis-dashboard')).toHaveAttribute('data-badges', 'loaded')
    expect(badges('genesis-dashboard')).toHaveTextContent('M1')
    expect(badges('genesis-e2e-tictactoe')).toHaveTextContent('gates ?stalled ??')

    // Every MaKlaude request went out before any other repo's, and the others
    // went in panel order.
    const repos = recording.calls.map((call) => /\/repos\/Sayfan-AI\/([^/?]+)/.exec(call.url)?.[1] ?? 'MaKlaude')
    const firstOf = (name: string) => repos.indexOf(name)
    expect(repos.lastIndexOf('MaKlaude')).toBeLessThan(firstOf('genesis-dashboard'))
    expect(firstOf('genesis-dashboard')).toBeLessThan(firstOf('genesis-e2e-tictactoe'))
    expect(firstOf('genesis-e2e-tictactoe')).toBeLessThan(firstOf('ronny-learns-ai'))
  })

  it('shows · until a badge loads, and stops loading badges at the budget reserve', async () => {
    // MaKlaude's load spends 5 requests, leaving 10: the reserve.
    const recording = replay(RECORDED, { rateLimit: { limit: 60, remaining: 15, reset: 1_800_000_000 } })
    renderPanel({ fetch: recording.fetch })
    await waitFor(() => expect(badges('MaKlaude')).toHaveAttribute('data-badges', 'loaded'))
    await screen.findByRole('region', { name: /roadmap/i })
    expect(badges('genesis-dashboard')).toHaveAttribute('data-badges', 'pending')
    expect(badges('genesis-dashboard')).toHaveTextContent('gates ·stalled ··')
    expect(recording.calls.every((call) => call.url.includes('MaKlaude') || call.url.includes('/repositories/'))).toBe(true)
  })

  it('selecting an entry loads its dashboard and updates the URL, from the badge cache', async () => {
    const recording = replay(RECORDED)
    renderPanel({ fetch: recording.fetch })
    await waitFor(() => expect(badges('genesis-dashboard')).toHaveAttribute('data-badges', 'loaded'))
    const spent = recording.calls.length

    fireEvent.click(entry('genesis-dashboard'))
    expect(await screen.findByRole('heading', { name: 'Sayfan-AI/genesis-dashboard' })).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Milestone 1 progress' })).toBeInTheDocument()
    expect(entry('genesis-dashboard')).toHaveAttribute('aria-current', 'true')
    expect(window.location.search).toBe('?repo=Sayfan-AI/genesis-dashboard')
    // Its badges already loaded it, so opening it costs nothing.
    expect(recording.calls.length).toBe(spent)
  })

  it('opens a repo outside the list from the Other repo field', async () => {
    renderPanel()
    await screen.findByRole('region', { name: /roadmap/i })
    const field = screen.getByLabelText('Other repo')
    fireEvent.change(field, { target: { value: 'not a repo' } })
    fireEvent.submit(field)
    expect(screen.getByText('Use the form owner/name.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Sayfan-AI/MaKlaude' })).toBeInTheDocument()

    fireEvent.change(field, { target: { value: 'someone/elsewhere' } })
    fireEvent.submit(field)
    expect(await screen.findByRole('heading', { name: 'someone/elsewhere' })).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('Repository not found')
    expect(window.location.search).toBe('?repo=someone/elsewhere')
  })

  it('loads the default list from repos.json when no loader is given', async () => {
    // Regression: passing the loader straight to useQuery handed it the query
    // context as its URL argument, so the built site fetched "[object Object]".
    const fetch = vi.fn(async () => new Response(JSON.stringify(LIST)))
    vi.stubGlobal('fetch', fetch)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <App search="?repo=Sayfan-AI/MaKlaude" client={new GitHubClient({ fetch: replay(RECORDED).fetch })} now={now} />
      </QueryClientProvider>,
    )
    expect(await within(panel()).findByText('Dev systems (Sayfan-AI)')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith(`${import.meta.env.BASE_URL}repos.json`, { method: 'GET' })
  })

  it('degrades to Other repo when the build has no list', async () => {
    renderPanel({ loadRepoList: async () => Promise.reject(new Error('404')) })
    expect(await within(panel()).findByText(/No dev-system list in this build/)).toBeInTheDocument()
    expect(screen.getByLabelText('Other repo')).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: /roadmap/i })).toBeInTheDocument()
  })
})

describe('side panel: private dev systems', () => {
  const ORG_LISTING = '/orgs/Sayfan-AI/repos?type=all&sort=full_name&per_page=100'
  const ok = (body: unknown): RecordedResponse => ({ status: 200, etag: null, link: null, body })

  // What the API returns to a token with access to one private dev system.
  function withToken(): { fetch: FetchLike; authorized: string[] } {
    const authorized: string[] = []
    const privateResponses: Record<string, RecordedResponse> = {
      ...fixtures.sayfanOrg.responses,
      [ORG_LISTING]: ok([
        ...(fixtures.sayfanOrg.responses[ORG_LISTING]?.body as object[]),
        { name: 'secret-system', full_name: 'Sayfan-AI/secret-system', private: true, archived: false },
      ]),
      '/repos/Sayfan-AI/secret-system/contents/.genesis/config.toml': ok({ name: 'config.toml' }),
    }
    const anonymous = replay(RECORDED).fetch
    const authed = replay({ ...RECORDED, ...privateResponses }).fetch
    const fetch: FetchLike = (url, init) => {
      const header = new Headers(init.headers).get('authorization')
      if (header) authorized.push(url)
      return (header === 'Bearer ghp_test' ? authed : anonymous)(url, init)
    }
    return { fetch, authorized }
  }

  it('leaves private dev systems out until a token is pasted, then shows them', async () => {
    const { fetch, authorized } = withToken()
    renderPanel({ fetch })
    await screen.findByRole('region', { name: /roadmap/i })
    expect(within(panel()).getByText('Private dev systems appear when you paste a token with access.')).toBeInTheDocument()
    expect(within(panel()).queryByText('secret-system')).not.toBeInTheDocument()
    expect(authorized).toEqual([])

    const field = screen.getByLabelText('Token (optional, memory only)')
    expect(field).toHaveAttribute('type', 'password')
    fireEvent.change(field, { target: { value: ' ghp_test ' } })
    fireEvent.submit(field)

    expect(await within(panel()).findByText('secret-system')).toBeInTheDocument()
    expect(within(entry('secret-system')).getByText('private')).toBeInTheDocument()
    expect(authorized).toContain(`https://api.github.com${ORG_LISTING}`)
    // Memory only: the token is in no URL, no storage, and no cookie.
    expect(window.location.href).not.toContain('ghp_test')
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain('ghp_test')
    expect(document.cookie).not.toContain('ghp_test')

    fireEvent.click(within(panel()).getByRole('button', { name: 'Clear' }))
    await waitFor(() => expect(within(panel()).queryByText('secret-system')).not.toBeInTheDocument())
    expect(within(panel()).getByText('Private dev systems appear when you paste a token with access.')).toBeInTheDocument()
  })

  it('says so when the token sees no private dev systems', async () => {
    renderPanel({ fetch: replay({ ...RECORDED, ...fixtures.sayfanOrg.responses }).fetch })
    await screen.findByRole('region', { name: /roadmap/i })
    const field = screen.getByLabelText('Token (optional, memory only)')
    fireEvent.change(field, { target: { value: 'ghp_other' } })
    fireEvent.submit(field)
    expect(await within(panel()).findByText('This token sees no private dev systems.')).toBeInTheDocument()
  })
})
