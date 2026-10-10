// Human-readable durations for the dashboard: "4d 2h", "3h", "20m".
import { DAY_MS, HOUR_MS } from './derive/config'

const MINUTE_MS = 60 * 1000

// The two largest units, so a long wait reads "4d 2h" rather than "4d 2h 13m".
export function formatDuration(ms: number): string {
  const total = Math.max(0, ms)
  const days = Math.floor(total / DAY_MS)
  const hours = Math.floor((total % DAY_MS) / HOUR_MS)
  const minutes = Math.floor((total % HOUR_MS) / MINUTE_MS)
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  if (minutes > 0) return `${minutes}m`
  return 'just now'
}

export function formatAgo(since: string | Date, now: Date): string {
  const ms = now.getTime() - (typeof since === 'string' ? Date.parse(since) : since.getTime())
  const text = formatDuration(ms)
  return text === 'just now' ? text : `${text} ago`
}
