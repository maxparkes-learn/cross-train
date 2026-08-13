'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { XIcon } from './Icons'

/**
 * Shared modal for the panels lifted out of the old sidebar.
 *
 * Sits at z-60 deliberately: the matrix page already portals an employee picker at
 * z-50 to the same document.body, and at equal z-index paint order falls to DOM
 * order — a coin flip. Header modals must always win.
 *
 * `onRequestClose` lets a caller veto closing (the settings editor uses it to confirm
 * before discarding unsaved label and colour drafts, which a plain unmount would
 * silently destroy).
 */
export default function Modal({
  open,
  onClose,
  onRequestClose,
  title,
  description,
  width = 520,
  children,
}: {
  open: boolean
  onClose: () => void
  /** Return false to block the close. Applies to Escape and backdrop clicks. */
  onRequestClose?: () => boolean
  title: string
  description?: string
  width?: number
  children: React.ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  const attemptClose = () => {
    if (onRequestClose && !onRequestClose()) return
    onClose()
  }

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        attemptClose()
        return
      }
      // Focus trap: keep Tab inside the dialog.
      if (e.key !== 'Tab') return
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable || focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onRequestClose, onClose])

  // Move focus into the dialog on open so keyboard users start inside it.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      panelRef.current
        ?.querySelector<HTMLElement>(
          'input:not([disabled]), button:not([disabled]), select:not([disabled])',
        )
        ?.focus()
    }, 0)
    return () => clearTimeout(t)
  }, [open])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-[rgba(39,39,39,0.45)]"
        onClick={attemptClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ width }}
        className="relative flex max-h-[80vh] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-menu"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line-soft px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-ink-faint">{description}</p>}
          </div>
          <button
            type="button"
            onClick={attemptClose}
            aria-label="Close"
            className="-mr-1 -mt-1 rounded-lg p-1.5 text-ink-faint transition-colors duration-[120ms] hover:bg-canvas hover:text-ink"
          >
            <XIcon size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

/** Shared control styling so the three lifted panels stay visually consistent. */
export const fieldLabelClass = 'mb-1 block text-2xs font-medium uppercase tracking-[0.06em] text-ink-faint'

export const inputClass =
  'h-9 w-full rounded-lg border border-line px-2.5 text-[13px] text-ink outline-none transition-shadow duration-[120ms] placeholder:text-ink-faint focus:border-brand focus:shadow-focus'

export const primaryButtonClass =
  'inline-flex h-9 items-center justify-center rounded-lg bg-brand px-3.5 text-[13px] font-medium text-white transition-colors duration-[120ms] hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50'

export const outlineButtonClass =
  'inline-flex h-9 items-center justify-center rounded-lg border border-line px-3.5 text-[13px] font-medium text-ink-muted transition-colors duration-[120ms] hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50'
