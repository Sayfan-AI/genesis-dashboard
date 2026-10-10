// The one query definition for a repo's dashboard. The main pane and the side
// panel's badges share it, so a repo loaded for its badges opens instantly and
// the selected repo's badges cost nothing extra.
import { queryOptions } from '@tanstack/react-query'
import { GitHubError, type GitHubClient } from '../github/client'
import type { RepoRef } from '../repo'
import { loadDashboard } from './load'

// `now` fixes the clock, for tests; otherwise each load uses the time it ran.
export function dashboardQuery(client: GitHubClient, repo: RepoRef, now?: Date) {
  return queryOptions({
    queryKey: ['dashboard', repo.owner, repo.name],
    queryFn: () => loadDashboard(client, repo, now ?? new Date()),
    // Every load spends the visitor's 60 requests/hour, so loads happen on
    // open and on Refresh, not whenever the tab regains focus.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    // A missing repo or a spent budget won't fix itself in a second.
    retry: (failures, error) => !(error instanceof GitHubError && error.kind !== 'http') && failures < 2,
  })
}
