'use client'

import {
  formatCompactDate,
  formatDateTime,
  formatDaysAgo,
  isStale,
  STALE_COMPETENCY_DAYS,
} from '@/lib/format'

/**
 * View model for one Last Update cell.
 *
 * Station name and skill labels arrive already resolved, because only the calling
 * page knows which department's configured labels apply.
 */
export interface LastUpdatedInfo {
  changedAt: string
  changedByEmail: string
  stationName: string
  oldLabel: string
  newLabel: string
}

/** The three tooltip lines. Exported so the same text can feed the sr-only copy. */
export function composeLastUpdatedTitle(info: LastUpdatedInfo): string {
  return [
    `${formatDateTime(info.changedAt)} (${formatDaysAgo(info.changedAt)})`,
    `by ${info.changedByEmail || 'unknown'}`,
    `${info.stationName}: ${info.oldLabel} → ${info.newLabel}`,
  ].join('\n')
}

/**
 * Shows when an employee's competency was last changed, with the date, the person
 * who changed it, and the level transition on hover.
 *
 * `info` is null when nothing has been recorded for that employee yet, which renders
 * a neutral dash and never a warning — keeping the warning meaningful as a genuine
 * staleness signal rather than a marker for missing history.
 */
export default function LastUpdatedCell({
  info,
  staleAfterDays = STALE_COMPETENCY_DAYS,
}: {
  info: LastUpdatedInfo | null
  staleAfterDays?: number
}) {
  if (!info) {
    return (
      <span className="text-gray-300" title="No competency changes recorded">
        —
      </span>
    )
  }

  const title = composeLastUpdatedTitle(info)

  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap" title={title}>
      <span>{formatCompactDate(info.changedAt)}</span>
      {isStale(info.changedAt, staleAfterDays) && (
        <span className="text-xs text-amber-500" aria-hidden="true">
          ⚠
        </span>
      )}
      {/* A native title is not keyboard-reachable and is announced inconsistently,
          so the same text is exposed to screen readers directly. */}
      <span className="sr-only">{title.split('\n').join(' · ')}</span>
    </span>
  )
}
