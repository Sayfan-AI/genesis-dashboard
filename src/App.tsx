import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Dashboard, type DashboardState } from './components/Dashboard'
import { SidePanel, type ListState, type PrivateState } from './components/SidePanel'
import { dashboardQuery } from './dashboard/query'
import { discoverDevSystems, type RepoList } from './discovery/discover'
import { fetchRepoList } from './discovery/repoList'
import { GitHubClient } from './github/client'
import { DEFAULT_REPO, parseRepoParam, repoSearch, sameRepo, type RepoRef } from './repo'

const MINUTE_MS = 60 * 1000

export interface AppProps {
  search?: string
  client?: GitHubClient
  // Fixes the clock, for tests. Without it the page ticks once a minute so
  // "waiting" and "refreshed" times stay current.
  now?: Date
  // Where the side panel's list comes from. Defaults to the build's repos.json.
  loadRepoList?: () => Promise<RepoList>
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

export function App({
  search = window.location.search,
  client: given,
  now: fixedNow,
  loadRepoList = fetchRepoList,
}: AppProps) {
  const queryClient = useQueryClient()
  const [client] = useState(() => given ?? new GitHubClient())
  const [repo, setRepo] = useState<RepoRef>(() => parseRepoParam(search) ?? DEFAULT_REPO)
  // Bumped on every token change, so queries keyed on it see the new token.
  const [tokenVersion, setTokenVersion] = useState(0)
  const [hasToken, setHasToken] = useState(client.hasToken)
  const now = useNow(fixedNow)

  // Back and forward move between selected repos.
  useEffect(() => {
    const onPop = () => setRepo(parseRepoParam(window.location.search) ?? DEFAULT_REPO)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const select = (next: RepoRef) => {
    if (sameRepo(next, repo)) return
    setRepo(next)
    window.history.pushState(null, '', repoSearch(next))
  }

  const setToken = (token: string | null) => {
    client.setToken(token)
    setHasToken(client.hasToken)
    setTokenVersion((version) => version + 1)
    // A repo that failed without a token may load with one.
    void queryClient.resetQueries({ queryKey: ['dashboard'], predicate: (query) => query.state.status === 'error' })
  }

  const query = useQuery(dashboardQuery(client, repo, fixedNow))

  const listQuery = useQuery({ queryKey: ['repo-list'], queryFn: () => loadRepoList(), staleTime: Infinity, retry: false })
  const org = listQuery.data?.org ?? DEFAULT_REPO.owner
  // With a token, discovery runs in the browser too, to find the private dev
  // systems the published list leaves out.
  const privateQuery = useQuery({
    queryKey: ['private-dev-systems', org, tokenVersion],
    queryFn: async () => (await discoverDevSystems(client, org)).filter((found) => found.private),
    enabled: hasToken,
    staleTime: Infinity,
    retry: false,
  })

  const list: ListState = listQuery.data
    ? { kind: 'ready', org: listQuery.data.org, repos: listQuery.data.repos }
    : listQuery.isError
      ? { kind: 'error' }
      : { kind: 'loading' }
  const privateRepos: PrivateState = !hasToken
    ? { kind: 'no-token' }
    : privateQuery.data
      ? { kind: 'ready', repos: privateQuery.data }
      : privateQuery.isError
        ? { kind: 'error' }
        : { kind: 'loading' }

  // A failed refresh keeps showing the last good data, with the error on top.
  const state: DashboardState = query.data
    ? { kind: 'ready', data: query.data, refreshError: query.error }
    : query.isError
      ? { kind: 'error', error: query.error }
      : { kind: 'loading' }

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <h1 className="border-b border-slate-200 px-6 py-3 text-sm font-bold uppercase tracking-widest text-slate-400">
        Genesis Dashboard
      </h1>
      <div className="flex flex-col md:flex-row">
        <SidePanel
          client={client}
          list={list}
          privateRepos={privateRepos}
          selected={repo}
          selectedSettled={!query.isPending}
          onSelect={select}
          onToken={setToken}
          hasToken={hasToken}
          now={fixedNow}
        />
        <main className="min-w-0 flex-1">
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
    </div>
  )
}
