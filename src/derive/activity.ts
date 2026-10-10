// Recent activity: what merged, closed, and opened within the window.
import type { Issue } from '../github/client'
import { DEFAULT_THRESHOLDS, elapsedMs, type Thresholds } from './config'

export interface Activity {
  // The start of the window, ISO.
  since: string
  // Pull requests that merged. Each list is newest first.
  merged: Issue[]
  // Issues that closed, and pull requests that closed without merging.
  closed: Issue[]
  // Issues and pull requests that opened.
  opened: Issue[]
}

export function deriveActivity(issues: Issue[], now: Date, thresholds: Thresholds = DEFAULT_THRESHOLDS): Activity {
  // Inclusive at both ends. Anything after `now` is left out, so a historical
  // `now` replays what the page would have shown then.
  const inWindow = (ts: string | null): ts is string => {
    if (ts === null) return false
    const age = elapsedMs(ts, now)
    return age >= 0 && age <= thresholds.activityWindowMs
  }
  const newestBy = (key: (issue: Issue) => string) => (a: Issue, b: Issue) =>
    Date.parse(key(b)) - Date.parse(key(a)) || b.number - a.number

  const merged = issues.filter((i) => inWindow(i.mergedAt)).sort(newestBy((i) => i.mergedAt ?? ''))
  const closed = issues
    .filter((i) => i.mergedAt === null && i.state === 'closed' && inWindow(i.closedAt))
    .sort(newestBy((i) => i.closedAt ?? ''))
  const opened = issues.filter((i) => inWindow(i.createdAt)).sort(newestBy((i) => i.createdAt))
  return { since: new Date(now.getTime() - thresholds.activityWindowMs).toISOString(), merged, closed, opened }
}
