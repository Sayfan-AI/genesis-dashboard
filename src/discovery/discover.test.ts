import { describe, expect, it } from 'vitest'
import { GitHubClient, GitHubError, type FetchLike } from '../github/client'
import { fixtures, replay } from '../github/fixtures'
import { discoverDevSystems, GENESIS_MARKER, parseRepoList, publishedList } from './discover'

describe('discoverDevSystems against the recorded Sayfan-AI org', () => {
  it('keeps the repos with a .genesis/config.toml, sorted by name', async () => {
    const recording = replay(fixtures.sayfanOrg.responses)
    const found = await discoverDevSystems(new GitHubClient({ fetch: recording.fetch }), 'Sayfan-AI')
    // genesis is the framework (no config.toml) and ai-six has no .genesis/.
    expect(found.map((repo) => repo.name)).toEqual(['genesis-dashboard', 'genesis-e2e-tictactoe', 'MaKlaude', 'ronny-learns-ai'])
    expect(found[0]).toEqual({ name: 'genesis-dashboard', fullName: 'Sayfan-AI/genesis-dashboard', private: false })
    // One listing call plus one marker lookup per repository, all reads.
    expect(recording.calls).toHaveLength(1 + 6)
    expect(recording.calls.every((call) => call.init.method === 'GET')).toBe(true)
    expect(recording.calls.slice(1).every((call) => call.url.endsWith(`/contents/${GENESIS_MARKER}`))).toBe(true)
  })

  it('keeps private repos, flagged, when the caller can see them', async () => {
    const client = {
      listOrgRepos: async () => [
        { name: 'open', fullName: 'o/open', private: false, archived: false },
        { name: 'Hidden', fullName: 'o/Hidden', private: true, archived: false },
      ],
      hasFile: async () => true,
    }
    expect(await discoverDevSystems(client, 'o')).toEqual([
      { name: 'Hidden', fullName: 'o/Hidden', private: true },
      { name: 'open', fullName: 'o/open', private: false },
    ])
  })

  it('finds nothing in an org with no dev systems', async () => {
    const fetch = replay({ '/orgs/o/repos?type=all&sort=full_name&per_page=100': { status: 200, etag: null, link: null, body: [] } }).fetch
    expect(await discoverDevSystems(new GitHubClient({ fetch }), 'o')).toEqual([])
  })

  it('fails loudly on a missing org or a spent budget rather than reporting no dev systems', async () => {
    await expect(discoverDevSystems(new GitHubClient({ fetch: replay({}).fetch }), 'nope')).rejects.toMatchObject({ kind: 'not-found' })
    const limited: FetchLike = async () =>
      new Response('{}', { status: 403, headers: { 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' } })
    await expect(discoverDevSystems(new GitHubClient({ fetch: limited }), 'Sayfan-AI')).rejects.toBeInstanceOf(GitHubError)
  })
})

describe('publishedList', () => {
  it('leaves private dev systems out of the published file', () => {
    const found = [
      { name: 'Hidden', fullName: 'o/Hidden', private: true },
      { name: 'open', fullName: 'o/open', private: false },
    ]
    expect(publishedList('o', found, new Date('2026-10-10T00:00:00Z'))).toEqual({
      org: 'o',
      generatedAt: '2026-10-10T00:00:00.000Z',
      repos: [{ name: 'open', fullName: 'o/open', private: false }],
    })
  })
})

describe('parseRepoList', () => {
  it('reads a well-formed repos.json', () => {
    const list = { org: 'o', generatedAt: '2026-10-10T00:00:00Z', repos: [{ name: 'r', fullName: 'o/r', private: false }] }
    expect(parseRepoList(list)).toEqual(list)
  })

  it('rejects anything else', () => {
    expect(() => parseRepoList(null)).toThrow()
    expect(() => parseRepoList({ org: 'o', repos: [] })).toThrow()
    expect(() => parseRepoList({ org: 'o', generatedAt: '', repos: [{ name: 'r' }] })).toThrow()
  })
})
