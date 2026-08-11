const LOCALE = 'en-CA'
const TIME_ZONE = 'America/Toronto'

/**
 * Days after which a competency record is treated as stale, showing a warning in
 * the Last Update column. Exported as a constant and threaded through as a named
 * default parameter (matching buildRotationStats' rollingWindowDays) so the
 * threshold is never inlined as a bare number at a call site.
 */
export const STALE_COMPETENCY_DAYS = 14

/** "Jul 28", or "Dec 31, 2025" when the date falls outside the current year. */
export function formatCompactDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso

  const yearOf = (x: Date) => x.toLocaleDateString(LOCALE, { timeZone: TIME_ZONE, year: 'numeric' })
  const opts: Intl.DateTimeFormatOptions = { timeZone: TIME_ZONE, month: 'short', day: 'numeric' }
  if (yearOf(d) !== yearOf(now)) opts.year = 'numeric'

  return d.toLocaleDateString(LOCALE, opts)
}

/** "Jul 28, 2026, 10:32 a.m." — same convention as the Activity Log. */
export function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(LOCALE, {
      timeZone: TIME_ZONE,
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  } catch {
    return iso
  }
}

/**
 * Whole days elapsed, both ends normalised to midnight — same approach as
 * buildRotationStats. Normalisation happens in the machine's timezone while
 * display uses America/Toronto, so a user outside Toronto can see the threshold
 * shift by a day near midnight. Not worth an Intl round-trip to fix.
 */
export function daysSince(iso: string, now: Date = new Date()): number {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return 0

  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  then.setHours(0, 0, 0, 0)

  return Math.floor((today.getTime() - then.getTime()) / 86400000)
}

/** "Longer than two weeks ago" — strictly greater than the threshold. */
export function isStale(
  iso: string,
  staleAfterDays: number = STALE_COMPETENCY_DAYS,
  now: Date = new Date(),
): boolean {
  return daysSince(iso, now) > staleAfterDays
}

/** "today" / "yesterday" / "12 days ago" — used to explain the staleness warning. */
export function formatDaysAgo(iso: string, now: Date = new Date()): string {
  const days = daysSince(iso, now)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}
