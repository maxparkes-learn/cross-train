'use client'

import { useState, useEffect } from 'react'
import type { User } from '@supabase/supabase-js'
import type { Station, AppSettings, Department, UserRole } from '@/lib/types'
import HeaderMenu from './HeaderMenu'
import NavLinks, { type NavItem } from './NavLinks'
import DeptMenu from './DeptMenu'
import StationsMenu from './StationsMenu'
import AccountMenu from './AccountMenu'
import StationsModal from './StationsModal'
import SettingsModal from './SettingsModal'
import DepartmentsModal from './DepartmentsModal'
import { MenuIcon } from './Icons'

type MenuId = 'dept' | 'stations' | 'account' | 'mobileNav'
type ModalId = 'stations' | 'settings' | 'departments'

/**
 * The 56px top bar that replaced the left sidebar.
 *
 * Holds which menu and which modal are open. A single `openMenu` value is what makes
 * "only one dropdown at a time" fall out of the state shape rather than needing any
 * coordination between the menus.
 *
 * Fed entirely by props, exactly as Sidebar was, so AppShell's context value is
 * untouched and the six other pages have zero blast radius.
 */
export default function HeaderBar({
  navItems,
  pathname,
  stations,
  settings,
  user,
  userRole,
  isAdmin,
  departments,
  activeDepartment,
  activeDeptId,
  isLoading,
  onSignOut,
  onStationsChange,
  onSettingsChange,
  onDepartmentsChange,
  canTogglePreview = false,
  previewAsManager = false,
  onTogglePreview,
  pendingUserCount = 0,
}: {
  navItems: NavItem[]
  pathname: string
  stations: Station[]
  settings: AppSettings
  user: User
  userRole: UserRole
  isAdmin: boolean
  departments: Department[]
  activeDepartment: Department | null
  activeDeptId: string
  isLoading: boolean
  onSignOut: () => void
  onStationsChange: () => Promise<void>
  onSettingsChange: (s: AppSettings) => void
  onDepartmentsChange: () => Promise<void>
  canTogglePreview?: boolean
  previewAsManager?: boolean
  onTogglePreview?: () => void
  pendingUserCount?: number
}) {
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null)
  const [activeModal, setActiveModal] = useState<ModalId | null>(null)
  const [stationEditId, setStationEditId] = useState<string | null>(null)

  // Close the mobile sheet on navigation — the old drawer never did, so it hung open
  // over the newly loaded page.
  useEffect(() => {
    setOpenMenu(null)
  }, [pathname])

  const toggle = (id: MenuId) => (open: boolean) => setOpenMenu(open ? id : null)

  const departmentName = activeDepartment?.name ?? activeDeptId

  const openStations = (stationId?: string) => {
    setStationEditId(stationId ?? null)
    setActiveModal('stations')
  }

  return (
    <>
      <header className="z-40 flex h-14 flex-none items-center gap-2 bg-plum px-5 text-white">
        {/* Hamburger sits before the brand, per the handoff. */}
        <div className="flex-none nav:hidden">
          <HeaderMenu
            open={openMenu === 'mobileNav'}
            onOpenChange={toggle('mobileNav')}
            label="Menu"
            width={260}
            trigger={({ open }) => (
              <span
                className={`relative flex h-[34px] w-[34px] items-center justify-center rounded-lg transition-colors duration-[120ms] ease-in-out ${
                  open ? 'bg-white/10' : 'hover:bg-white/10'
                }`}
              >
                <MenuIcon size={18} />
                {/* Mirrors the old collapsed rail: without this, the pending-invite
                    signal disappears entirely below the nav breakpoint. */}
                {pendingUserCount > 0 && (
                  <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-amber-400" />
                )}
              </span>
            )}
          >
            <NavLinks
              navItems={navItems}
              pathname={pathname}
              pendingUserCount={pendingUserCount}
              variant="sheet"
              onNavigate={() => setOpenMenu(null)}
            />
          </HeaderMenu>
        </div>

        <div className="flex flex-none items-center gap-[9px] pr-1">
          <span
            aria-hidden="true"
            className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px] bg-brand text-[18px] font-bold leading-none text-white"
          >
            c
          </span>
          <span className="hidden whitespace-nowrap text-sm font-bold sm:inline">
            Rotation &amp; Safety
          </span>
        </div>

        <span aria-hidden="true" className="hidden h-6 w-px flex-none bg-white/15 nav:block" />

        <NavLinks
          navItems={navItems}
          pathname={pathname}
          pendingUserCount={pendingUserCount}
          variant="bar"
        />

        <div className="min-w-[8px] flex-1" />

        <DeptMenu
          open={openMenu === 'dept'}
          onOpenChange={toggle('dept')}
          departments={departments}
          activeDepartment={activeDepartment}
          activeDeptId={activeDeptId}
          pathname={pathname}
          isAdmin={isAdmin}
        />

        <StationsMenu
          open={openMenu === 'stations'}
          onOpenChange={toggle('stations')}
          stations={stations}
          settings={settings}
          departmentName={departmentName}
          isLoading={isLoading}
          onManage={openStations}
        />

        <AccountMenu
          open={openMenu === 'account'}
          onOpenChange={toggle('account')}
          user={user}
          userRole={userRole}
          isAdmin={isAdmin}
          canTogglePreview={canTogglePreview}
          previewAsManager={previewAsManager}
          onTogglePreview={onTogglePreview}
          onOpenSettings={() => setActiveModal('settings')}
          onOpenDepartments={() => setActiveModal('departments')}
          onSignOut={onSignOut}
        />
      </header>

      <StationsModal
        open={activeModal === 'stations'}
        onClose={() => { setActiveModal(null); setStationEditId(null) }}
        stations={stations}
        settings={settings}
        activeDeptId={activeDeptId}
        departmentName={departmentName}
        onStationsChange={onStationsChange}
        initialEditId={stationEditId}
      />

      {/* Keyed by department so a switch cannot carry drafts across. */}
      <SettingsModal
        key={activeDeptId}
        open={activeModal === 'settings'}
        onClose={() => setActiveModal(null)}
        settings={settings}
        activeDeptId={activeDeptId}
        departmentName={departmentName}
        onSettingsChange={onSettingsChange}
      />

      <DepartmentsModal
        open={activeModal === 'departments'}
        onClose={() => setActiveModal(null)}
        departments={departments}
        activeDeptId={activeDeptId}
        onDepartmentsChange={onDepartmentsChange}
      />
    </>
  )
}
