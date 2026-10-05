import { describe, expect, it } from 'vitest'
import { parseRepoParam } from './repo'

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
