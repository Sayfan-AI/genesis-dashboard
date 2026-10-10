import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import { GitHubClient, type FetchLike } from './github/client'
import { fixtures, replay, type Fixture } from './github/fixtures'

function renderApp(search: string, fetch: FetchLike, now: Date) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const client = new GitHubClient({ fetch })
  render(
    <QueryClientProvider client={queryClient}>
      {/* No panel entries here, so only the selected repo spends requests. SidePanel.test.tsx covers the panel. */}
      <App search={search} client={client} now={now} loadRepoList={async () => ({ org: 'Sayfan-AI', generatedAt: '', repos: [] })} />
    </QueryClientProvider>,
  )
  return { client }
}

function renderFixture(search: string, fixture: Fixture, now = new Date(fixture.recordedAt)) {
  const recording = replay(fixture.responses, { rateLimit: { limit: 60, remaining: 50, reset: 1_800_000_000 } })
  renderApp(search, recording.fetch, now)
  return recording
}

const region = (name: RegExp) => screen.getByRole('region', { name })

describe('App against recorded fixtures', () => {
  it('renders every section for MaKlaude', async () => {
    const recording = renderFixture('?repo=Sayfan-AI/MaKlaude', fixtures.maklaude)
    const roadmap = await screen.findByRole('region', { name: /roadmap/i })
    expect(screen.getByRole('heading', { name: 'Sayfan-AI/MaKlaude' })).toBeInTheDocument()
    expect(screen.getByText(/API: \d+\/60 left, resets \d\d:\d\d/)).toBeInTheDocument()
    expect(screen.getByText('refreshed just now')).toBeInTheDocument()

    // Milestones 1-5 done and 6 active at 19/21 (see src/derive/roadmap.test.ts).
    const statuses = within(roadmap)
      .getAllByRole('listitem')
      .map((li) => li.getAttribute('data-status'))
    expect(statuses).toEqual(['done', 'done', 'done', 'done', 'done', 'active'])
    expect(screen.getByRole('progressbar', { name: 'Milestone 6 progress' })).toHaveAttribute('aria-valuenow', '19')

    expect(within(region(/gates/i)).getByText('Nothing is waiting on you.')).toBeInTheDocument()
    expect(within(region(/pull requests/i)).getByText('No open pull requests.')).toBeInTheDocument()
    // MaKlaude has been quiet since 2026-08-22, so the window is empty.
    expect(within(region(/recent activity/i)).getByText(/Nothing merged, closed, or opened/)).toBeInTheDocument()

    // Read-only, end to end: every request the page made was a GET.
    expect(recording.calls.length).toBeGreaterThan(0)
    expect(recording.calls.every((call) => call.init.method === 'GET')).toBe(true)
  })

  it('replays MaKlaude activity from a historical now', async () => {
    renderFixture('?repo=Sayfan-AI/MaKlaude', fixtures.maklaude, new Date('2026-08-23T00:00:00Z'))
    const activity = await screen.findByRole('region', { name: /recent activity/i })
    const kinds = new Set(within(activity).getAllByRole('listitem').map((li) => li.getAttribute('data-kind')))
    expect(kinds).toEqual(new Set(['merged', 'closed', 'opened']))
  })

  it('renders this repo too', async () => {
    renderFixture('?repo=Sayfan-AI/genesis-dashboard', fixtures.genesisDashboard)
    const roadmap = await screen.findByRole('region', { name: /roadmap/i })
    expect(screen.getByRole('heading', { name: 'Sayfan-AI/genesis-dashboard' })).toBeInTheDocument()
    expect(within(roadmap).getAllByRole('listitem').map((li) => li.getAttribute('data-status'))).toEqual(['active'])
    expect(screen.getByRole('progressbar', { name: 'Milestone 1 progress' })).toHaveAttribute('aria-valuenow', '3')
  })

  it('defaults to MaKlaude when no repo is given', async () => {
    renderFixture('', fixtures.maklaude)
    expect(await screen.findByRole('region', { name: /roadmap/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Sayfan-AI/MaKlaude' })).toBeInTheDocument()
  })

  it('refreshes on demand, and an unchanged repo comes back from the ETag cache', async () => {
    const recording = renderFixture('?repo=Sayfan-AI/genesis-dashboard', fixtures.genesisDashboard)
    await screen.findByRole('region', { name: /roadmap/i })
    const first = recording.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(recording.calls.length).toBe(first * 2))
    await screen.findByRole('button', { name: 'Refresh' })
    expect(recording.calls.slice(first).every((c) => c.init.headers['If-None-Match'])).toBe(true)
    expect(screen.getByRole('progressbar', { name: 'Milestone 1 progress' })).toBeInTheDocument()
  })
})

describe('App degraded states', () => {
  const now = new Date('2026-10-10T12:00:00Z')

  it('explains a repo that does not exist', async () => {
    const recording = replay({})
    renderApp('?repo=Sayfan-AI/no-such-repo', recording.fetch, now)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Repository not found')
    expect(alert).toHaveTextContent('Sayfan-AI/no-such-repo')
    // The repo lookup goes first, so a missing repo costs one request.
    expect(recording.calls).toHaveLength(1)
    expect(screen.queryByRole('region', { name: /roadmap/i })).not.toBeInTheDocument()
  })

  it('shows when the rate limit resets', async () => {
    const reset = new Date(2026, 9, 10, 14, 5)
    const fetch: FetchLike = async () =>
      new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
        status: 403,
        headers: {
          'x-ratelimit-limit': '60',
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(reset.getTime() / 1000),
        },
      })
    renderApp('?repo=Sayfan-AI/MaKlaude', fetch, now)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Rate limited')
    expect(alert).toHaveTextContent('resets at 14:05')
    expect(screen.getByText('API: 0/60 left, resets 14:05')).toBeInTheDocument()
  })

  it('renders an empty repo with every section in its empty state', async () => {
    const recording = replay({
      '/repos/o/empty': { status: 200, etag: null, link: null, body: { full_name: 'o/empty', default_branch: 'main', private: false, html_url: 'https://github.com/o/empty' } },
      '/repos/o/empty/issues?state=all&per_page=100': { status: 200, etag: null, link: null, body: [] },
      '/repos/o/empty/pulls?state=open&per_page=100': { status: 200, etag: null, link: null, body: [] },
    })
    renderApp('?repo=o/empty', recording.fetch, now)
    expect(await screen.findByText(/No milestones yet/)).toBeInTheDocument()
    expect(screen.getByText('Nothing is waiting on you.')).toBeInTheDocument()
    expect(screen.getByText('No open pull requests.')).toBeInTheDocument()
    expect(screen.getByText('Nothing merged, closed, or opened in the last 7d.')).toBeInTheDocument()
  })

  it('shows a loading state before the first response', () => {
    const fetch: FetchLike = () => new Promise(() => {})
    renderApp('?repo=Sayfan-AI/MaKlaude', fetch, now)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(screen.getByText('API: budget unknown')).toBeInTheDocument()
  })
})
