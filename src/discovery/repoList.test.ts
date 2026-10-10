import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchRepoList } from './repoList'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchRepoList', () => {
  const list = { org: 'Sayfan-AI', generatedAt: '2026-10-10T00:00:00Z', repos: [] }

  it("reads repos.json from the site's base path", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(list)))
    vi.stubGlobal('fetch', fetch)
    expect(await fetchRepoList()).toEqual(list)
    expect(fetch).toHaveBeenCalledWith(`${import.meta.env.BASE_URL}repos.json`, { method: 'GET' })
  })

  it('fails when the build has no repos.json', async () => {
    vi.stubGlobal('fetch', async () => new Response('not found', { status: 404 }))
    await expect(fetchRepoList()).rejects.toThrow('repos.json returned 404')
  })
})
