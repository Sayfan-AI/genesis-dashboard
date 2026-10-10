// The main pane: a header with the repo and API budget, then either the four
// sections or the one degraded state that explains why they aren't there.
import type { ReactNode } from 'react'
import type { DashboardData } from '../dashboard/load'
import { formatResetTime, GitHubError, type RateLimit } from '../github/client'
import { formatAgo } from '../format'
import type { RepoRef } from '../repo'
import { ActivitySection, GatesSection, PullsSection, RoadmapSection } from './Sections'

export type DashboardState =
  | { kind: 'loading' }
  | { kind: 'error'; error: unknown }
  | { kind: 'ready'; data: DashboardData; refreshError?: unknown }

export interface DashboardProps {
  repo: RepoRef
  state: DashboardState
  rateLimit: RateLimit | null
  now: Date
  refreshing?: boolean
  onRefresh?: () => void
}

function Budget({ rateLimit }: { rateLimit: RateLimit | null }) {
  if (!rateLimit) return <span className="text-slate-400">API: budget unknown</span>
  const low = rateLimit.remaining < rateLimit.limit / 10
  return (
    <span className={low ? 'font-semibold text-red-700' : 'text-slate-600'}>
      API: {rateLimit.remaining}/{rateLimit.limit} left, resets {formatResetTime(rateLimit.resetAt)}
    </span>
  )
}

export function Header({ repo, state, rateLimit, now, refreshing, onRefresh }: DashboardProps) {
  const fullName = `${repo.owner}/${repo.name}`
  return (
    <header className="border-b border-slate-200 px-6 py-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-mono text-lg font-semibold">{fullName}</h2>
        <Budget rateLimit={rateLimit} />
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-4 text-sm text-slate-500">
        <a href={`https://github.com/${fullName}`} className="hover:underline">
          github.com/{fullName}
        </a>
        <span className="flex items-center gap-3">
          {state.kind === 'ready' && <span>refreshed {formatAgo(state.data.loadedAt, now)}</span>}
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing || !onRefresh}
            className="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-100 disabled:opacity-50"
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </span>
      </div>
    </header>
  )
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div role="alert" className="m-6 rounded border border-amber-300 bg-amber-50 p-4 text-sm">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-slate-700">{children}</p>
    </div>
  )
}

function ErrorNotice({ repo, error }: { repo: RepoRef; error: unknown }) {
  const fullName = `${repo.owner}/${repo.name}`
  if (error instanceof GitHubError && error.kind === 'not-found') {
    return (
      <Notice title="Repository not found">
        GitHub has no repository named <span className="font-mono">{fullName}</span> that this page can see. Check the
        spelling. A private repository only shows up with a token that has access to it.
      </Notice>
    )
  }
  if (error instanceof GitHubError && error.kind === 'rate-limited') {
    return (
      <Notice title="Rate limited">
        GitHub&apos;s API budget for this browser is used up
        {error.resetAt ? `, and resets at ${formatResetTime(error.resetAt)}` : ''}. Nothing is lost: reload after that,
        or paste a read-only token for a higher limit.
      </Notice>
    )
  }
  const message = error instanceof Error ? error.message : String(error)
  return <Notice title="Couldn't load this repository">{message}</Notice>
}

export function Dashboard(props: DashboardProps) {
  const { repo, state, now } = props
  return (
    <div>
      <Header {...props} />
      {state.kind === 'loading' && <p className="px-6 py-4 text-sm text-slate-500">Loading…</p>}
      {state.kind === 'error' && <ErrorNotice repo={repo} error={state.error} />}
      {state.kind === 'ready' && (
        <>
          {state.refreshError != null && <ErrorNotice repo={repo} error={state.refreshError} />}
          {state.data.truncated && (
            <p className="px-6 pt-3 text-xs text-amber-700">
              This repository has more issues than one load reads, so the oldest are left out of the counts.
            </p>
          )}
          <GatesSection gates={state.data.gates} />
          <PullsSection pulls={state.data.pulls} now={now} />
          <RoadmapSection roadmap={state.data.roadmap} />
          <ActivitySection activity={state.data.activity} now={now} />
        </>
      )}
    </div>
  )
}
