'use client'

import type { Station, AppSettings } from '@/lib/types'
import HeaderMenu, { menuDividerClass, menuEyebrowClass } from './HeaderMenu'
import { WrenchIcon, PlusIcon } from './Icons'

export default function StationsMenu({
  open,
  onOpenChange,
  stations,
  settings,
  departmentName,
  isLoading,
  onManage,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  stations: Station[]
  settings: AppSettings
  departmentName: string
  isLoading: boolean
  /** Opens the stations modal, optionally focused on one station's edit form. */
  onManage: (stationId?: string) => void
}) {
  return (
    <HeaderMenu
      open={open}
      onOpenChange={onOpenChange}
      label="Stations"
      width={250}
      trigger={({ open: isOpen }) => (
        <span
          className={`flex h-[34px] items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-white transition-colors duration-[120ms] ease-in-out ${
            isOpen ? 'bg-white/10' : 'hover:bg-white/10'
          }`}
        >
          <WrenchIcon size={15} />
          <span className="hidden sm:inline">Stations</span>
          {/* Hidden while loading, or it flashes "0" on every page load. */}
          {!isLoading && <span className="text-[11px] text-white/50">{stations.length}</span>}
        </span>
      )}
    >
      <div className={menuEyebrowClass}>Stations · {departmentName}</div>

      {stations.length === 0 ? (
        <p className="px-2.5 pb-2 text-xs text-ink-faint">No stations yet.</p>
      ) : (
        stations.map((s) => (
          <button
            key={s.id}
            type="button"
            data-menu-item
            role="menuitem"
            onClick={() => { onOpenChange(false); onManage(s.id) }}
            title={`Edit ${s.name}`}
            className="flex h-8 w-full items-center justify-between gap-2 rounded-lg px-2.5 text-menu text-ink transition-colors duration-[120ms] ease-in-out hover:bg-canvas focus:bg-canvas focus:outline-none"
          >
            <span className="truncate">{s.name}</span>
            <span className="flex-none text-xs-plus text-ink-faint">
              req. {settings.skillLabels[s.required_skill_level] ?? s.required_skill_level}
            </span>
          </button>
        ))
      )}

      <div className={menuDividerClass} />

      <button
        type="button"
        data-menu-item
        role="menuitem"
        onClick={() => { onOpenChange(false); onManage() }}
        className="flex h-[34px] w-full items-center gap-2 rounded-lg px-2.5 text-menu font-medium text-wine transition-colors duration-[120ms] ease-in-out hover:bg-canvas focus:bg-canvas focus:outline-none"
      >
        <PlusIcon size={15} />
        Add station
      </button>
    </HeaderMenu>
  )
}
