// Loads the repos.json that scripts/discover-repos.ts wrote into the build.
import { parseRepoList, type RepoList } from './discover'

export async function fetchRepoList(url = `${import.meta.env.BASE_URL}repos.json`): Promise<RepoList> {
  // Same-origin static file, not the GitHub API: it costs no rate limit.
  const response = await fetch(url, { method: 'GET' })
  if (!response.ok) throw new Error(`repos.json returned ${response.status}`)
  return parseRepoList(await response.json())
}
