'use client'

import Link from 'next/link'

export interface NavItem {
  href: string
  label: string
  icon: string
}

/**
 * Exact match with trailing-slash normalisation.
 *
 * The old sidebar used `===` in its expanded tree and `startsWith` in the collapsed
 * rail. Those agree today only because all seven routes are leaves; `startsWith`
 * would false-positive on a nested route. One helper, used everywhere, removes the
 * inconsistency without changing any currently rendered output.
 */
export function isNavActive(pathname: string, href: string): boolean {
  const strip = (s: string) => (s.length > 1 && s.endsWith('/') ? s.slice(0, -1) : s)
  return strip(pathname) === strip(href)
}

/** The amber pending-invite count. The only signal that users await department access. */
function PendingBadge({ count }: { count: number }) {
  return (
    <span className="ml-1.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold leading-none text-ink">
      {count}
    </span>
  )
}

export default function NavLinks({
  navItems,
  pathname,
  pendingUserCount,
  variant,
  onNavigate,
}: {
  navItems: NavItem[]
  pathname: string
  pendingUserCount: number
  /** 'bar' = inline pills in the header; 'sheet' = stacked rows in the mobile menu. */
  variant: 'bar' | 'sheet'
  onNavigate?: () => void
}) {
  if (variant === 'sheet') {
    return (
      <div className="p-1.5">
        {navItems.map((item) => {
          const active = isNavActive(pathname, item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              data-menu-item
              role="menuitem"
              aria-current={active ? 'page' : undefined}
              onClick={onNavigate}
              className={`flex h-10 items-center gap-2.5 rounded-lg px-3 text-[13px] transition-colors duration-[120ms] ease-in-out ${
                active ? 'bg-brand font-bold text-white' : 'text-ink-muted hover:bg-canvas'
              }`}
            >
              <span aria-hidden="true" className="text-sm">{item.icon}</span>
              {item.label}
              {item.label === 'Users' && pendingUserCount > 0 && <PendingBadge count={pendingUserCount} />}
            </Link>
          )
        })}
      </div>
    )
  }

  return (
    <nav aria-label="Main" className="hidden flex-none items-center gap-0.5 nav:flex">
      {navItems.map((item) => {
        const active = isNavActive(pathname, item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`flex h-[34px] items-center rounded-lg px-3 text-[13px] transition-colors duration-[120ms] ease-in-out ${
              active
                ? 'bg-brand font-bold text-white'
                : 'font-medium text-white/75 hover:bg-white/10 hover:text-white'
            }`}
          >
            {item.label}
            {item.label === 'Users' && pendingUserCount > 0 && <PendingBadge count={pendingUserCount} />}
          </Link>
        )
      })}
    </nav>
  )
}
