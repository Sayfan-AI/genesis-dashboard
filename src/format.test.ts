import { describe, expect, it } from 'vitest'
import { DAY_MS, HOUR_MS } from './derive/config'
import { formatAgo, formatDuration } from './format'

describe('formatDuration', () => {
  it('shows the two largest units', () => {
    expect(formatDuration(4 * DAY_MS + 2 * HOUR_MS + 13 * 60_000)).toBe('4d 2h')
    expect(formatDuration(3 * HOUR_MS)).toBe('3h')
    expect(formatDuration(5 * HOUR_MS + 20 * 60_000)).toBe('5h 20m')
    expect(formatDuration(20 * 60_000)).toBe('20m')
    expect(formatDuration(7 * DAY_MS)).toBe('7d')
  })

  it('treats under a minute and negative spans as just now', () => {
    expect(formatDuration(30_000)).toBe('just now')
    expect(formatDuration(-HOUR_MS)).toBe('just now')
  })
})

describe('formatAgo', () => {
  it('measures from a timestamp to now', () => {
    const now = new Date('2026-10-10T12:00:00Z')
    expect(formatAgo('2026-10-10T06:00:00Z', now)).toBe('6h ago')
    expect(formatAgo(new Date('2026-10-08T12:00:00Z'), now)).toBe('2d ago')
    expect(formatAgo(now, now)).toBe('just now')
  })
})
