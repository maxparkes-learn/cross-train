'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Department } from '@/lib/types'
import { createDepartment, deleteDepartment, renameDepartment } from '@/lib/db'
import Modal, { inputClass, primaryButtonClass, outlineButtonClass } from './Modal'
import { PlusIcon, XIcon } from './Icons'

/**
 * Department create / rename / delete, lifted from the old sidebar panel.
 * Handlers and confirm copy moved verbatim. Admin-only, as before.
 */
export default function DepartmentsModal({
  open,
  onClose,
  departments,
  activeDeptId,
  onDepartmentsChange,
}: {
  open: boolean
  onClose: () => void
  departments: Department[]
  activeDeptId: string
  onDepartmentsChange: () => Promise<void>
}) {
  const router = useRouter()

  const [newDeptName, setNewDeptName] = useState('')
  const [addingDept, setAddingDept] = useState(false)
  const [editingDeptId, setEditingDeptId] = useState<string | null>(null)
  const [editDeptName, setEditDeptName] = useState('')
  const [savingDept, setSavingDept] = useState(false)

  const handleAddDepartment = async () => {
    if (!newDeptName.trim()) return
    setAddingDept(true)
    try {
      await createDepartment(newDeptName.trim())
      setNewDeptName('')
      await onDepartmentsChange()
    } finally {
      setAddingDept(false)
    }
  }

  const handleDeleteDepartment = async (dept: Department) => {
    if (!confirm(`Delete "${dept.name}"? This will permanently remove all its stations and settings. Employee history is preserved.`)) return
    await deleteDepartment(dept.id)
    await onDepartmentsChange()
    if (dept.id === activeDeptId) router.push('/')
  }

  const handleStartEditDept = (dept: Department) => {
    setEditingDeptId(dept.id)
    setEditDeptName(dept.name)
  }

  const handleSaveRenameDept = async () => {
    if (!editDeptName.trim() || !editingDeptId) return
    setSavingDept(true)
    try {
      await renameDepartment(editingDeptId, editDeptName.trim())
      setEditingDeptId(null)
      await onDepartmentsChange()
    } finally {
      setSavingDept(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Departments" width={520}>
      <div className="space-y-1">
        {departments.map((d) => (
          <div key={d.id} className="group flex h-11 items-center gap-2 rounded-lg px-2 transition-colors duration-[120ms] hover:bg-canvas">
            {editingDeptId === d.id ? (
              <>
                <input
                  autoFocus
                  value={editDeptName}
                  onChange={(e) => setEditDeptName(e.target.value)}
                  onKeyDown={(e) => {
                    // Escape must not bubble to the modal, or cancelling a rename
                    // would close the whole dialog.
                    if (e.key === 'Escape') { e.stopPropagation(); setEditingDeptId(null) }
                    if (e.key === 'Enter') handleSaveRenameDept()
                  }}
                  className={inputClass}
                />
                <button
                  onClick={handleSaveRenameDept}
                  disabled={savingDept || !editDeptName.trim()}
                  className="flex-none rounded-md px-2 py-1 text-xs font-medium text-brand hover:text-brand-hover disabled:opacity-50"
                >
                  {savingDept ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={() => setEditingDeptId(null)}
                  className="flex-none rounded-md px-2 py-1 text-xs font-medium text-ink-faint hover:text-ink"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <span
                  className={`min-w-0 flex-1 truncate text-[13px] ${
                    d.id === activeDeptId ? 'font-semibold text-ink' : 'text-ink-muted'
                  }`}
                >
                  {d.name}
                  {d.id === activeDeptId && (
                    <span className="ml-2 text-2xs font-medium uppercase tracking-[0.06em] text-wine">current</span>
                  )}
                </span>
                <button
                  onClick={() => handleStartEditDept(d)}
                  className="flex-none rounded-md px-2 py-1 text-xs font-medium text-ink-faint opacity-0 transition-opacity duration-[120ms] hover:text-ink focus:opacity-100 group-hover:opacity-100"
                >
                  Rename
                </button>
                {departments.length > 1 && (
                  <button
                    onClick={() => handleDeleteDepartment(d)}
                    aria-label={`Delete ${d.name}`}
                    className="flex-none rounded-md p-1 text-ink-faint opacity-0 transition-opacity duration-[120ms] hover:text-red-500 focus:opacity-100 group-hover:opacity-100"
                  >
                    <XIcon size={14} />
                  </button>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      <div className="mt-5 rounded-xl border border-line-soft bg-canvas p-3">
        <h3 className="mb-2 text-[13px] font-semibold text-ink">Add department</h3>
        <div className="flex items-center gap-2">
          <input
            value={newDeptName}
            onChange={(e) => setNewDeptName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddDepartment()}
            placeholder="Department name"
            className={inputClass}
          />
          <button
            onClick={handleAddDepartment}
            disabled={addingDept || !newDeptName.trim()}
            className={`${primaryButtonClass} flex-none gap-1.5`}
          >
            <PlusIcon size={15} />
            {addingDept ? 'Adding…' : 'Add'}
          </button>
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <button onClick={onClose} className={outlineButtonClass}>Done</button>
      </div>
    </Modal>
  )
}
