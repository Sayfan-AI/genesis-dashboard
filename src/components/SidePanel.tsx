// The side panel: every dev system in the org with its badges, an "Other repo"
// field for anything outside the list, and the optional in-memory token.
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { dashboardQuery } from '../dashboard/query'
import { deriveBadges, nextBadgeLoad, type BadgeLoadState, type Badges } from '../derive/badges'
import { byName, type DevSystem } from '../discovery/discover'
import type { GitHubClient } from '../github/client'
import { parseRepo, sameRepo, type RepoRef } from '../repo'

export type ListState = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; org: string; repos: DevSystem[] }

export type PrivateState = { kind: 'no-token' } | { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; repos: DevSystem[] }

export interface SidePanelProps {
  client: GitHubClient
  list: ListState
  privateRepos: PrivateState
  selected: RepoRef
  // The selected repo has loaded or failed, so other repos' badges may start.
  selectedSettled: boolean
  onSelect: (repo: RepoRef) => void
  onToken: (token: string | null) => void
  hasToken: boolean
  // Fixes the clock for badge loads, for tests.
  now?: Date
}

function refOf(repo: DevSystem): RepoRef {
  const [owner = '', name = ''] = repo.fullName.split('/')
  return { owner, name }
}

// The published list plus whatever a pasted token revealed, without duplicates.
function panelEntries(list: ListState, privateRepos: PrivateState): DevSystem[] {
  const entries = list.kind === 'ready' ? [...list.repos] : []
  if (privateRepos.kind === 'ready') {
    for (const repo of privateRepos.repos) {
      if (!entries.some((entry) => entry.fullName.toLowerCase() === repo.fullName.toLowerCase())) entries.push(repo)
    }
  }
  return entries.sort(byName)
}

function BadgeRow({ badges, state }: { badges: Badges | null; state: 'pending' | 'loaded' | 'error' }) {
  // `·` until a repo's badges have loaded, as the mockup has it.
  const show = (value: string) => (state === 'loaded' ? value : state === 'error' ? '?' : '·')
  return (
    <span className="mt-0.5 flex gap-3 pl-4 text-xs text-slate-500" data-badges={state}>
      <span className={badges && badges.gates > 0 ? 'font-semibold text-amber-700' : undefined}>
        gates {show(String(badges?.gates))}
      </span>
      <span className={badges && badges.stalled > 0 ? 'font-semibold text-red-700' : undefined}>
        stalled {show(String(badges?.stalled))}
      </span>
      <span>{show(badges?.milestone != null ? `M${badges.milestone}` : '--')}</span>
    </span>
  )
}

function OtherRepo({ onSelect }: { onSelect: (repo: RepoRef) => void }) {
  const [value, setValue] = useState('')
  const [invalid, setInvalid] = useState(false)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const repo = parseRepo(value)
    setInvalid(repo === null)
    if (repo) onSelect(repo)
  }
  return (
    <form onSubmit={submit} className="text-sm">
      <label htmlFor="other-repo" className="block text-xs font-semibold text-slate-500">
        Other repo
      </label>
      <input
        id="other-repo"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="owner/name"
        aria-invalid={invalid || undefined}
        className="mt-1 w-full rounded border border-slate-300 px-2 py-1 font-mono"
      />
      {invalid && <p className="mt-1 text-xs text-red-700">Use the form owner/name.</p>}
    </form>
  )
}

function TokenField({ hasToken, onToken }: { hasToken: boolean; onToken: (token: string | null) => void }) {
  const [value, setValue] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onToken(value.trim() || null)
  }
  const clear = () => {
    setValue('')
    onToken(null)
  }
  return (
    <form onSubmit={submit} className="text-sm">
      <label htmlFor="token" className="block text-xs font-semibold text-slate-500">
        Token (optional, memory only)
      </label>
      <div className="mt-1 flex gap-1">
        {/* Never persisted: it lives in this tab's memory and goes only to api.github.com. */}
        <input
          id="token"
          type="password"
          autoComplete="off"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 font-mono"
        />
        <button type="submit" className="rounded border border-slate-300 px-2 hover:bg-slate-100">
          Use
        </button>
        {hasToken && (
          <button type="button" onClick={clear} className="rounded border border-slate-300 px-2 hover:bg-slate-100">
            Clear
          </button>
        )}
      </div>
    </form>
  )
}

function PrivateNote({ state }: { state: PrivateState }) {
  const text =
    state.kind === 'no-token'
      ? 'Private dev systems appear when you paste a token with access.'
      : state.kind === 'loading'
        ? 'Looking for private dev systems…'
        : state.kind === 'error'
          ? "Couldn't list private dev systems with this token."
          : state.repos.length === 0
            ? 'This token sees no private dev systems.'
            : null
  return text ? <p className="text-xs text-slate-400">{text}</p> : null
}

export function SidePanel({ client, list, privateRepos, selected, selectedSettled, onSelect, onToken, hasToken, now }: SidePanelProps) {
  const entries = panelEntries(list, privateRepos)
  const isSelected = entries.map((repo) => sameRepo(refOf(repo), selected))

  // Badge loads share the dashboard query, so the selected repo's badges come
  // from its own load and a repo loaded for badges opens without refetching.
  // The useQueries subscription below re-renders on every change, so these
  // reads stay current.
  const queryClient = useQueryClient()
  const states: BadgeLoadState[] = entries.map((repo, i) => {
    if (isSelected[i]) return 'settled'
    const state = queryClient.getQueryState(dashboardQuery(client, refOf(repo)).queryKey)
    if (!state) return 'idle'
    if (state.status !== 'pending') return 'settled'
    return state.fetchStatus === 'fetching' ? 'loading' : 'idle'
  })
  const next = nextBadgeLoad(states, selectedSettled, client.rateLimit?.remaining ?? null)
  const results = useQueries({
    queries: entries.map((repo, i) => ({
      ...dashboardQuery(client, refOf(repo), now),
      // The selected repo's query is the main pane's to run.
      enabled: !isSelected[i] && (states[i] !== 'idle' || i === next),
    })),
  })

  return (
    <nav aria-label="Dev systems" className="flex flex-col gap-4 border-r border-slate-200 p-4 md:w-72 md:shrink-0">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Dev systems{list.kind === 'ready' ? ` (${list.org})` : ''}
      </h2>
      {list.kind === 'loading' && <p className="text-sm text-slate-500">Loading dev systems…</p>}
      {list.kind === 'error' && (
        <p className="text-sm text-slate-500">No dev-system list in this build. Other repo still works.</p>
      )}
      {list.kind === 'ready' && entries.length === 0 && <p className="text-sm text-slate-500">No dev systems found.</p>}
      {entries.length > 0 && (
        <ul className="space-y-2">
          {entries.map((repo, i) => {
            const result = results[i]
            const state = result?.data ? 'loaded' : result?.isError ? 'error' : 'pending'
            return (
              <li key={repo.fullName}>
                <button
                  type="button"
                  onClick={() => onSelect(refOf(repo))}
                  aria-current={isSelected[i] || undefined}
                  className={`w-full rounded px-2 py-1 text-left hover:bg-slate-100 ${isSelected[i] ? 'bg-slate-100' : ''}`}
                >
                  <span className="flex items-baseline gap-1 text-sm">
                    <span className="w-3 text-slate-400">{isSelected[i] ? '>' : ''}</span>
                    <span className={isSelected[i] ? 'font-semibold' : undefined}>{repo.name}</span>
                    {repo.private && <span className="text-xs text-slate-400">private</span>}
                  </span>
                  <BadgeRow badges={result?.data ? deriveBadges(result.data) : null} state={state} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <PrivateNote state={privateRepos} />
      <OtherRepo onSelect={onSelect} />
      <TokenField hasToken={hasToken} onToken={onToken} />
    </nav>
  )
}
