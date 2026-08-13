'use client'

import { useRouter } from 'next/navigation'
import type { Department } from '@/lib/types'
import HeaderMenu from './HeaderMenu'
import { ChevronDownIcon, CheckIcon } from './Icons'

/** The seven page segments that live under /[deptId]. */
const NAV_SEGMENTS = ['matrix', 'schedule', 'rotation', 'attention', 'activity', 'users', 'employees']

export default function DeptMenu({
  open,
  onOpenChange,
  departments,
  activeDepartment,
  activeDeptId,
  pathname,
  isAdmin,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  departments: Department[]
  activeDepartment: Department | null
  activeDeptId: string
  pathname: string
  isAdmin: boolean
}) {
  const router = useRouter()

  const handleSelect = (id: string) => {
    onOpenChange(false)
    if (id === activeDeptId) return

    // Stay on the same page type rather than always dumping the user on /matrix, as
    // the old buried <select> did. The switcher is now permanent global chrome, so it
    // gets used far more often and the forced redirect is much more noticeable.
    // /activity hard-redirects non-admins during render, so route around it.
    const seg = pathname.split('/')[2]
    const keepable = NAV_SEGMENTS.includes(seg) && !(seg === 'activity' && !isAdmin)
    router.push(keepable ? `/${id}/${seg}` : `/${id}/matrix`)
  }

  return (
    <HeaderMenu
      open={open}
      onOpenChange={onOpenChange}
      label="Switch department"
      width={220}
      trigger={({ open: isOpen }) => (
        <span
          className={`flex h-[34px] items-center gap-1.5 rounded-lg border border-white/20 px-2.5 text-[13px] font-medium text-white transition-colors duration-[120ms] ease-in-out ${
            isOpen ? 'bg-white/[0.14]' : 'bg-white/[0.08] hover:bg-white/[0.14]'
          }`}
        >
          <span className="hidden text-white/55 sm:inline">Dept</span>
          <span className="max-w-[140px] truncate">{activeDepartment?.name ?? activeDeptId}</span>
          <ChevronDownIcon
            size={14}
            className={`text-white/70 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          />
        </span>
      )}
    >
      {departments.map((d) => {
        const active = d.id === activeDeptId
        return (
          <button
            key={d.id}
            type="button"
            data-menu-item
            role="menuitem"
            onClick={() => handleSelect(d.id)}
            className={`flex h-[34px] w-full items-center justify-between gap-2 rounded-lg px-2.5 text-menu transition-colors duration-[120ms] ease-in-out hover:bg-canvas focus:bg-canvas focus:outline-none ${
              active ? 'font-bold text-ink' : 'text-ink-muted'
            }`}
          >
            <span className="truncate">{d.name}</span>
            {active && <CheckIcon size={15} className="flex-none text-brand" />}
          </button>
        )
      })}
    </HeaderMenu>
  )
}
