export interface RepoRef {
  owner: string
  name: string
}

const REPO_PATTERN = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/

// Parses the `?repo=owner/name` query parameter. Returns null when it's
// missing or isn't a well-formed GitHub repository reference.
export function parseRepoParam(search: string): RepoRef | null {
  const value = new URLSearchParams(search).get('repo')?.trim()
  if (!value) return null
  const match = REPO_PATTERN.exec(value)
  if (!match?.[1] || !match[2]) return null
  return { owner: match[1], name: match[2] }
}
