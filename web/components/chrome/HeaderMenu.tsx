'use client'

import { useEffect, useRef } from 'react'

/**
 * The dropdown primitive shared by every header menu.
 *
 * Fully controlled: the parent holds a single "which menu is open" value, so
 * "only one open at a time" falls out of the state shape rather than needing any
 * coordination between menus.
 *
 * Anchored with absolute positioning inside a relative wrapper rather than portalled.
 * The header never scrolls, so there is nothing to drift from — and this avoids the
 * portal pattern used elsewhere in the app, where the position is computed once on
 * open and never updated.
 */
export default function HeaderMenu({
  open,
  onOpenChange,
  label,
  trigger,
  width,
  align = 'end',
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Accessible name for the trigger. */
  label: string
  trigger: (state: { open: boolean }) => React.ReactNode
  width: number
  align?: 'start' | 'end'
  children: React.ReactNode
}) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Close on outside click. The trigger MUST be excluded from the hit test: without
  // that, clicking it while open fires this handler and the trigger's own toggle, and
  // the menu closes then instantly reopens. Same shape as the matrix's FilterButton.
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (panelRef.current?.contains(target)) return
      if (triggerRef.current?.contains(target)) return
      onOpenChange(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, onOpenChange])

  // Escape closes and returns focus to the trigger, so keyboard users are not dumped
  // at the top of the document.
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onOpenChange(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onOpenChange])

  /** Roving focus over the panel's items, so the menu is usable without a mouse. */
  const onPanelKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>('[data-menu-item]:not([disabled])') ?? [],
    )
    if (items.length === 0) return

    const current = items.indexOf(document.activeElement as HTMLElement)
    let next = -1
    if (e.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length
    else if (e.key === 'ArrowUp') next = current <= 0 ? items.length - 1 : current - 1
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = items.length - 1
    else if (e.key === 'Tab') {
      // Tabbing out of a menu should close it rather than leave it hanging open.
      onOpenChange(false)
      return
    }

    if (next >= 0) {
      e.preventDefault()
      items[next].focus()
    }
  }

  return (
    <div className="relative flex-none">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => onOpenChange(!open)}
        className="block"
      >
        {trigger({ open })}
      </button>

      {open && (
        <div
          ref={panelRef}
          role="menu"
          aria-label={label}
          onKeyDown={onPanelKeyDown}
          style={{ width }}
          // Self-scrolling so a long list (an 8-station department, 16 departments)
          // is never clipped by the app shell's overflow-hidden root.
          className="absolute right-0 top-[calc(100%+8px)] z-50 max-h-[calc(100vh-72px)] overflow-y-auto rounded-xl border border-line-soft bg-white p-1.5 shadow-menu"
        >
          {children}
        </div>
      )}
    </div>
  )
}

/** Shared row styling for menu items, so every menu matches without duplication. */
export const menuItemClass =
  'flex h-[34px] w-full items-center gap-2 rounded-lg px-2.5 text-menu text-ink-muted transition-colors duration-[120ms] ease-in-out hover:bg-canvas focus:bg-canvas focus:outline-none'

export const menuDividerClass = 'my-1.5 h-px bg-line-soft'

export const menuEyebrowClass =
  'px-2.5 pb-1.5 pt-2 text-2xs font-medium uppercase tracking-[0.06em] text-ink-faint'
