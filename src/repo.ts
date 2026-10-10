export interface RepoRef {
  owner: string
  name: string
}

// What the published site shows when no `?repo=` is given.
export const DEFAULT_REPO: RepoRef = { owner: 'Sayfan-AI', name: 'MaKlaude' }

const REPO_PATTERN = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/

// Parses an `owner/name` reference. Returns null unless it's well-formed.
export function parseRepo(value: string): RepoRef | null {
  const match = REPO_PATTERN.exec(value.trim())
  if (!match?.[1] || !match[2]) return null
  return { owner: match[1], name: match[2] }
}

// Parses the `?repo=owner/name` query parameter. Returns null when it's
// missing or isn't a well-formed GitHub repository reference.
export function parseRepoParam(search: string): RepoRef | null {
  return parseRepo(new URLSearchParams(search).get('repo') ?? '')
}

// The query string that selects a repo: the inverse of parseRepoParam.
export function repoSearch(repo: RepoRef): string {
  return `?repo=${repo.owner}/${repo.name}`
}

export function sameRepo(a: RepoRef, b: RepoRef): boolean {
  return a.owner.toLowerCase() === b.owner.toLowerCase() && a.name.toLowerCase() === b.name.toLowerCase()
}
