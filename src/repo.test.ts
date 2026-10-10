import { describe, expect, it } from 'vitest'
import { parseRepo, parseRepoParam, repoSearch, sameRepo } from './repo'

describe('parseRepoParam', () => {
  it('parses owner/name', () => {
    expect(parseRepoParam('?repo=Sayfan-AI/MaKlaude')).toEqual({
      owner: 'Sayfan-AI',
      name: 'MaKlaude',
    })
  })

  it('accepts dots, dashes and underscores in the repo name', () => {
    expect(parseRepoParam('?repo=a/b.c_d-e')).toEqual({ owner: 'a', name: 'b.c_d-e' })
  })

  it('returns null when the parameter is missing or empty', () => {
    expect(parseRepoParam('')).toBeNull()
    expect(parseRepoParam('?repo=')).toBeNull()
  })

  it('returns null for malformed values', () => {
    expect(parseRepoParam('?repo=noslash')).toBeNull()
    expect(parseRepoParam('?repo=a/b/c')).toBeNull()
    expect(parseRepoParam('?repo=/b')).toBeNull()
  })
})

describe('parseRepo', () => {
  it('trims and parses owner/name', () => {
    expect(parseRepo('  Sayfan-AI/MaKlaude ')).toEqual({ owner: 'Sayfan-AI', name: 'MaKlaude' })
  })

  it('rejects anything else', () => {
    expect(parseRepo('')).toBeNull()
    expect(parseRepo('https://github.com/a/b')).toBeNull()
  })
})

describe('repoSearch and sameRepo', () => {
  it('round-trips through parseRepoParam', () => {
    const repo = { owner: 'Sayfan-AI', name: 'genesis-dashboard' }
    expect(parseRepoParam(repoSearch(repo))).toEqual(repo)
  })

  it('compares case-insensitively, as GitHub does', () => {
    expect(sameRepo({ owner: 'sayfan-ai', name: 'maklaude' }, { owner: 'Sayfan-AI', name: 'MaKlaude' })).toBe(true)
    expect(sameRepo({ owner: 'a', name: 'b' }, { owner: 'a', name: 'c' })).toBe(false)
  })
})
