// The four main-pane sections. Each takes already-derived data and renders it;
// none of them computes anything that a test in src/derive/ doesn't cover.
import type { ReactNode } from 'react'
import type { Activity } from '../derive/activity'
import { DEFAULT_THRESHOLDS, elapsedMs, type Thresholds } from '../derive/config'
import type { Gate } from '../derive/gates'
import type { CiState, PullStatus, Stall } from '../derive/pulls'
import type { Milestone, Roadmap } from '../derive/roadmap'
import type { Issue } from '../github/client'
import { formatAgo, formatDuration } from '../format'

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  const id = `section-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`
  return (
    <section aria-labelledby={id} className="border-b border-slate-200 px-6 py-4">
      <h2 id={id} className="flex items-baseline justify-between text-sm font-semibold uppercase tracking-wide text-slate-500">
        <span>{title}</span>
        {count !== undefined && <span aria-label={`${count} items`}>{count}</span>}
      </h2>
      <div className="mt-2">{children}</div>
    </section>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-slate-500">{children}</p>
}

function Ref({ issue }: { issue: Pick<Issue, 'number' | 'htmlUrl' | 'isPullRequest'> }) {
  return (
    <a href={issue.htmlUrl} className="font-mono text-sky-700 hover:underline">
      {issue.isPullRequest ? 'PR' : 'issue'} #{issue.number}
    </a>
  )
}

export function GatesSection({ gates, thresholds = DEFAULT_THRESHOLDS }: { gates: Gate[]; thresholds?: Thresholds }) {
  return (
    <Section title="Gates waiting on you" count={gates.length}>
      {gates.length === 0 ? (
        <Empty>Nothing is waiting on you.</Empty>
      ) : (
        <>
          <ul className="space-y-1 text-sm">
            {gates.map((gate) => (
              <li key={gate.issue.number} className="flex gap-3" data-aging={gate.aging || undefined}>
                <span className="w-3 font-bold text-red-600" aria-label={gate.aging ? 'aging' : undefined}>
                  {gate.aging ? '!' : ''}
                </span>
                <Ref issue={gate.issue} />
                <span className="flex-1">
                  {gate.issue.title}
                  {gate.automationFailure && <span className="ml-2 text-xs text-amber-700">failed run</span>}
                </span>
                <span className="text-slate-500">waiting {formatDuration(gate.waitingMs)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-400">! = aging, open more than {formatDuration(thresholds.gateAgingMs)}</p>
        </>
      )}
    </Section>
  )
}

const CI_LABEL: Record<CiState, string> = {
  none: 'no checks yet',
  pending: 'CI running',
  passing: 'CI green',
  failing: 'CI red',
}

const CI_CLASS: Record<CiState, string> = {
  none: 'text-slate-500',
  pending: 'text-amber-700',
  passing: 'text-green-700',
  failing: 'text-red-700',
}

const STALL_LABEL: Record<Stall, string> = {
  'green-unmerged': 'stalled: green, not merged',
  'red-untouched': 'stalled: red, nobody on it',
}

export function PullsSection({ pulls, now }: { pulls: PullStatus[]; now: Date }) {
  return (
    <Section title="Pull requests" count={pulls.length}>
      {pulls.length === 0 ? (
        <Empty>No open pull requests.</Empty>
      ) : (
        <ul className="space-y-1 text-sm">
          {pulls.map(({ pull, ci, stall }) => (
            <li
              key={pull.number}
              className={`flex gap-3 ${stall ? 'rounded bg-red-50 font-medium' : ''}`}
              data-stall={stall ?? undefined}
            >
              <Ref issue={{ number: pull.number, htmlUrl: pull.htmlUrl, isPullRequest: true }} />
              <span className="flex-1">
                {pull.title}
                {pull.draft && <span className="ml-2 text-xs text-slate-400">draft</span>}
              </span>
              <span className={CI_CLASS[ci]}>{CI_LABEL[ci]}</span>
              <span className="text-slate-500">open {formatDuration(elapsedMs(pull.createdAt, now))}</span>
              {stall && <span className="text-red-700">{STALL_LABEL[stall]}</span>}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function MilestoneRow({ milestone }: { milestone: Milestone }) {
  const { closed, total } = milestone.progress
  const percent = total === 0 ? 0 : Math.round((closed / total) * 100)
  return (
    <li className="flex items-center gap-3" data-status={milestone.status}>
      <span className="w-10 font-mono">M{milestone.number}</span>
      <span className="flex-1">{milestone.name ?? `Milestone ${milestone.number}`}</span>
      <span className={milestone.status === 'active' ? 'font-semibold text-sky-700' : 'text-slate-500'}>
        {milestone.status}
      </span>
      {milestone.status === 'active' && (
        <span className="flex items-center gap-2">
          <span
            role="progressbar"
            aria-label={`Milestone ${milestone.number} progress`}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={closed}
            className="block h-2 w-32 overflow-hidden rounded bg-slate-200"
          >
            <span className="block h-full bg-sky-600" style={{ width: `${percent}%` }} />
          </span>
          <span className="font-mono">
            {closed}/{total}
          </span>
        </span>
      )}
    </li>
  )
}

export function RoadmapSection({ roadmap }: { roadmap: Roadmap }) {
  return (
    <Section title="Roadmap">
      {roadmap.milestones.length === 0 ? (
        <Empty>
          No milestones yet. They appear once issues carry <span className="font-mono">milestone:N</span> labels.
        </Empty>
      ) : (
        <ul className="space-y-1 text-sm">
          {roadmap.milestones.map((milestone) => (
            <MilestoneRow key={milestone.number} milestone={milestone} />
          ))}
        </ul>
      )}
    </Section>
  )
}

type ActivityKind = 'merged' | 'closed' | 'opened'

export function ActivitySection({
  activity,
  now,
  thresholds = DEFAULT_THRESHOLDS,
}: {
  activity: Activity
  now: Date
  thresholds?: Thresholds
}) {
  const rows: { kind: ActivityKind; issue: Issue; at: string }[] = [
    ...activity.merged.map((issue) => ({ kind: 'merged' as const, issue, at: issue.mergedAt ?? issue.updatedAt })),
    ...activity.closed.map((issue) => ({ kind: 'closed' as const, issue, at: issue.closedAt ?? issue.updatedAt })),
    ...activity.opened.map((issue) => ({ kind: 'opened' as const, issue, at: issue.createdAt })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.issue.number - a.issue.number)
  const window = formatDuration(thresholds.activityWindowMs)
  return (
    <Section title={`Recent activity (last ${window})`}>
      {rows.length === 0 ? (
        <Empty>Nothing merged, closed, or opened in the last {window}.</Empty>
      ) : (
        <ul className="space-y-1 text-sm">
          {rows.map(({ kind, issue, at }) => (
            <li key={`${kind}-${issue.number}`} className="flex gap-3" data-kind={kind}>
              <span className="w-14 text-slate-500">{kind}</span>
              <Ref issue={issue} />
              <span className="flex-1">{issue.title}</span>
              <span className="text-slate-500">{formatAgo(at, now)}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
