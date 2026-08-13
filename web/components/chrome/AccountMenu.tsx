'use client'

import type { User } from '@supabase/supabase-js'
import type { UserRole } from '@/lib/types'
import HeaderMenu, { menuItemClass, menuDividerClass } from './HeaderMenu'
import { ChevronDownIcon, EyeIcon, SettingsIcon, BuildingIcon } from './Icons'

/** "max.parkes@clutch.ca" → "MP". Guards emails with no dot and empty locals. */
function initialsFor(email: string | undefined): string {
  const local = (email ?? '').split('@')[0]
  if (!local) return '?'
  const parts = local.split(/[._-]+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

function roleLabel(userRole: UserRole, previewAsManager: boolean): string {
  if (previewAsManager) return 'Manager (preview)'
  if (userRole === 'superadmin') return 'Superadmin'
  if (userRole === 'admin') return 'Admin'
  return 'Manager'
}

export default function AccountMenu({
  open,
  onOpenChange,
  user,
  userRole,
  isAdmin,
  canTogglePreview,
  previewAsManager,
  onTogglePreview,
  onOpenSettings,
  onOpenDepartments,
  onSignOut,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: User
  userRole: UserRole
  /** effectiveIsAdmin — gates the Departments row, matching the old sidebar. */
  isAdmin: boolean
  /** The real isAdmin, so the toggle doesn't hide itself once engaged. */
  canTogglePreview: boolean
  previewAsManager: boolean
  onTogglePreview?: () => void
  onOpenSettings: () => void
  onOpenDepartments: () => void
  onSignOut: () => void
}) {
  return (
    <HeaderMenu
      open={open}
      onOpenChange={onOpenChange}
      label="Account"
      width={240}
      trigger={({ open: isOpen }) => (
        <span
          className={`flex h-[34px] items-center gap-1.5 rounded-full pl-0.5 pr-1.5 transition-colors duration-[120ms] ease-in-out ${
            isOpen ? 'bg-white/10' : 'hover:bg-white/10'
          }`}
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand text-[11px] font-bold text-white">
            {initialsFor(user.email)}
          </span>
          <ChevronDownIcon
            size={13}
            className={`text-white/70 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          />
        </span>
      )}
    >
      <div className="flex flex-col gap-0.5 border-b border-line-soft px-2.5 pb-2.5 pt-2">
        <span className="truncate text-[13px] font-medium text-ink">{user.email}</span>
        <span className="text-[11px] font-medium text-wine">{roleLabel(userRole, previewAsManager)}</span>
      </div>

      <div className="pt-1.5">
        {canTogglePreview && onTogglePreview && (
          <button
            type="button"
            data-menu-item
            role="menuitem"
            // Close first: toggling can navigate (the activity page redirects
            // non-admins during render), which would unmount this menu mid-update.
            onClick={() => { onOpenChange(false); onTogglePreview() }}
            className={menuItemClass}
          >
            <EyeIcon size={15} className="flex-none" />
            {previewAsManager ? 'Exit manager preview' : 'Preview as manager'}
          </button>
        )}

        <button
          type="button"
          data-menu-item
          role="menuitem"
          onClick={() => { onOpenChange(false); onOpenSettings() }}
          className={menuItemClass}
        >
          <SettingsIcon size={15} className="flex-none" />
          Settings
        </button>

        {isAdmin && (
          <button
            type="button"
            data-menu-item
            role="menuitem"
            onClick={() => { onOpenChange(false); onOpenDepartments() }}
            className={menuItemClass}
          >
            <BuildingIcon size={15} className="flex-none" />
            Departments
          </button>
        )}

        <div className={menuDividerClass} />

        <button
          type="button"
          data-menu-item
          role="menuitem"
          onClick={onSignOut}
          className={menuItemClass}
        >
          Sign out
        </button>
      </div>
    </HeaderMenu>
  )
}
