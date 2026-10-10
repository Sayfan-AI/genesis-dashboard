import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Dashboard, type DashboardState } from './components/Dashboard'
import { loadDashboard } from './dashboard/load'
import { GitHubClient, GitHubError } from './github/client'
import { DEFAULT_REPO, parseRepoParam } from './repo'

const MINUTE_MS = 60 * 1000

export interface AppProps {
  search?: string
  client?: GitHubClient
  // Fixes the clock, for tests. Without it the page ticks once a minute so
  // "waiting" and "refreshed" times stay current.
  now?: Date
}

function useNow(fixed: Date | undefined): Date {
  const [now, setNow] = useState(() => fixed ?? new Date())
  useEffect(() => {
    if (fixed) return
    const timer = setInterval(() => setNow(new Date()), MINUTE_MS)
    return () => clearInterval(timer)
  }, [fixed])
  return fixed ?? now
}

export function App({ search = window.location.search, client: given, now: fixedNow }: AppProps) {
  const [client] = useState(() => given ?? new GitHubClient())
  const repo = parseRepoParam(search) ?? DEFAULT_REPO
  const now = useNow(fixedNow)

  const query = useQuery({
    queryKey: ['dashboard', repo.owner, repo.name],
    queryFn: () => loadDashboard(client, repo, fixedNow ?? new Date()),
    // Every load spends the visitor's 60 requests/hour, so loads happen on
    // open and on Refresh, not whenever the tab regains focus.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    // A missing repo or a spent budget won't fix itself in a second.
    retry: (failures, error) => !(error instanceof GitHubError && error.kind !== 'http') && failures < 2,
  })

  // A failed refresh keeps showing the last good data, with the error on top.
  const state: DashboardState = query.data
    ? { kind: 'ready', data: query.data, refreshError: query.error }
    : query.isError
      ? { kind: 'error', error: query.error }
      : { kind: 'loading' }

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <main className="mx-auto max-w-5xl">
        <h1 className="px-6 pt-6 text-sm font-bold uppercase tracking-widest text-slate-400">Genesis Dashboard</h1>
        <Dashboard
          repo={repo}
          state={state}
          rateLimit={client.rateLimit}
          now={now}
          refreshing={query.isFetching}
          onRefresh={() => void query.refetch()}
        />
      </main>
    </div>
  )
}
