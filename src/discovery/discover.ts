// Finding the Genesis dev systems in an organization, and the repos.json that
// carries the published list to the browser.
//
// This file has no runtime imports so scripts/discover-repos.ts can load it
// directly with Node's type stripping.
import type { GitHubClient } from '../github/client'

// A repository is a dev system when it has this file. The framework repo has
// `.genesis/` content but no config.toml, so it isn't one.
export const GENESIS_MARKER = '.genesis/config.toml'

export interface DevSystem {
  name: string
  fullName: string
  private: boolean
}

export interface RepoList {
  org: string
  generatedAt: string
  repos: DevSystem[]
}

// One call per page of the org listing, plus one per repository to look for
// the marker. Sorted by name, case-insensitively, so the order doesn't depend
// on what GitHub returned first.
export async function discoverDevSystems(
  client: Pick<GitHubClient, 'listOrgRepos' | 'hasFile'>,
  org: string,
): Promise<DevSystem[]> {
  const repos = await client.listOrgRepos(org)
  const marked = await Promise.all(
    repos.map(async (repo) => ((await client.hasFile({ owner: org, name: repo.name }, GENESIS_MARKER)) ? repo : null)),
  )
  return marked
    .filter((repo) => repo !== null)
    .map((repo) => ({ name: repo.name, fullName: repo.fullName, private: repo.private }))
    .sort(byName)
}

// The list the build publishes. Private repositories are left out even when
// the build's token can see them, because the file is public.
export function publishedList(org: string, found: DevSystem[], generatedAt: Date): RepoList {
  return { org, generatedAt: generatedAt.toISOString(), repos: found.filter((repo) => !repo.private) }
}

export function byName(a: DevSystem, b: DevSystem): number {
  return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
}

// Reads a repos.json body. Throws on anything that isn't one, so a corrupt
// file reads as "no list" rather than as an empty org.
export function parseRepoList(value: unknown): RepoList {
  if (typeof value !== 'object' || value === null) throw new Error('repos.json is not an object')
  const { org, generatedAt, repos } = value as Record<string, unknown>
  if (typeof org !== 'string' || typeof generatedAt !== 'string' || !Array.isArray(repos)) {
    throw new Error('repos.json is missing org, generatedAt, or repos')
  }
  return {
    org,
    generatedAt,
    repos: repos.map((repo: unknown) => {
      const { name, fullName, private: isPrivate } = (repo ?? {}) as Record<string, unknown>
      if (typeof name !== 'string' || typeof fullName !== 'string' || typeof isPrivate !== 'boolean') {
        throw new Error('repos.json has a malformed entry')
      }
      return { name, fullName, private: isPrivate }
    }),
  }
}
