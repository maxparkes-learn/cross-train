'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '@/components/AppShell'
import {
  upsertEmployee,
  upsertCompetencies,
  deleteEmployee,
  updateEmployeeAbsence,
  reorderEmployees,
  reorderStations,
  generateId,
  insertAuditLog,
  fetchSetting,
  upsertSetting,
} from '@/lib/db'
import type { Employee, EmployeeGroup } from '@/lib/types'

interface Row {
  id: string | null
  isNew: boolean
  name: string
  certLevel: number
  isPresent: boolean
  competencies: Record<string, number>
  groupIds: string[]
  dirty: boolean
}

type DisplayMode = 'text' | 'circle'

const GROUP_COLORS = ['#6366f1','#3b82f6','#10b981','#f59e0b','#ef4444','#ec4899','#8b5cf6','#14b8a6']

// Converts a pastel/light hex color to a vivid version suitable for circle fills.
// Colors already dark enough (luminance < 0.55) are returned unchanged.
function circleColor(hex: string): string {
  const h = hex.replace('#', '')
  if (h.length !== 6) return hex
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (l < 0.55) return hex
  const d = max - min
  if (d < 0.05) return '#9ca3af'
  const s = d / (1 - Math.abs(2 * l - 1))
  let hue = 0
  if (max === r) hue = ((g - b) / d + 6) % 6
  else if (max === g) hue = (b - r) / d + 2
  else hue = (r - g) / d + 4
  hue *= 60
  const newS = Math.max(s, 0.65)
  const newL = 0.42
  const c = (1 - Math.abs(2 * newL - 1)) * newS
  const x = c * (1 - Math.abs((hue / 60) % 2 - 1))
  const m = newL - c / 2
  let r1 = 0, g1 = 0, b1 = 0
  if (hue < 60) { r1 = c; g1 = x; b1 = 0 }
  else if (hue < 120) { r1 = x; g1 = c; b1 = 0 }
  else if (hue < 180) { r1 = 0; g1 = c; b1 = x }
  else if (hue < 240) { r1 = 0; g1 = x; b1 = c }
  else if (hue < 300) { r1 = x; g1 = 0; b1 = c }
  else { r1 = c; g1 = 0; b1 = x }
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0')
  return `#${toHex(r1)}${toHex(g1)}${toHex(b1)}`
}

function contrastColor(hex: string): string {
  const h = hex.replace('#', '')
  if (h.length !== 6) return '#111827'
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5 ? '#111827' : '#ffffff'
}

function CompetencyCircle({ level, maxLevel, color }: { level: number; maxLevel: number; color: string }) {
  const cx = 12, cy = 12, r = 9

  if (level <= 0) {
    return (
      <svg width={24} height={24} viewBox="0 0 24 24">
        <circle cx={cx} cy={cy} r={r} fill="#ffffff" stroke={color} strokeWidth="1.5" />
      </svg>
    )
  }

  if (level >= maxLevel) {
    return (
      <svg width={24} height={24} viewBox="0 0 24 24">
        <circle cx={cx} cy={cy} r={r} fill={color} stroke={color} strokeWidth="1" />
      </svg>
    )
  }

  const fraction = level / maxLevel
  const angle = fraction * 2 * Math.PI
  const endX = cx + r * Math.sin(angle)
  const endY = cy - r * Math.cos(angle)
  const largeArc = fraction > 0.5 ? 1 : 0
  const sector = `M ${cx} ${cy} L ${cx} ${cy - r} A ${r} ${r} 0 ${largeArc} 1 ${endX} ${endY} Z`

  return (
    <svg width={24} height={24} viewBox="0 0 24 24">
      <circle cx={cx} cy={cy} r={r} fill="#ffffff" stroke={color} strokeWidth="1.5" />
      <path d={sector} fill={color} />
    </svg>
  )
}

// ---- Group Cell ----

interface GroupCellProps {
  row: Row
  rowIndex: number
  groups: EmployeeGroup[]
  onToggleGroup: (rowIndex: number, groupId: string) => void
  onSaveGroups: (groups: EmployeeGroup[]) => Promise<void>
}

function GroupCell({ row, rowIndex, groups, onToggleGroup, onSaveGroups }: GroupCellProps) {
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')
  const [addingNew, setAddingNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(GROUP_COLORS[0])
  const cellRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 })

  const openPopover = () => {
    if (cellRef.current) {
      const rect = cellRef.current.getBoundingClientRect()
      setPopoverPos({ top: rect.bottom + 4, left: rect.left })
    }
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent) => {
      if (
        popoverRef.current?.contains(e.target as Node) ||
        cellRef.current?.contains(e.target as Node)
      ) return
      setOpen(false)
      setEditingId(null)
      setAddingNew(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onScroll = () => setOpen(false)
    window.addEventListener('scroll', onScroll, true)
    return () => window.removeEventListener('scroll', onScroll, true)
  }, [open])

  const startEdit = (g: EmployeeGroup) => {
    setEditingId(g.id)
    setEditName(g.name)
    setEditColor(g.color)
    setAddingNew(false)
  }

  const handleSaveEdit = async () => {
    if (!editingId || !editName.trim()) return
    await onSaveGroups(groups.map(g => g.id === editingId ? { ...g, name: editName.trim(), color: editColor } : g))
    setEditingId(null)
  }

  const handleDelete = async (groupId: string) => {
    if (!confirm('Delete this group? It will be removed from all employees.')) return
    await onSaveGroups(groups.filter(g => g.id !== groupId))
  }

  const handleAddGroup = async () => {
    if (!newName.trim()) return
    const newGroup: EmployeeGroup = { id: generateId('grp'), name: newName.trim(), color: newColor }
    await onSaveGroups([...groups, newGroup])
    setNewName('')
    setNewColor(GROUP_COLORS[0])
    setAddingNew(false)
  }

  const assignedGroups = groups.filter(g => row.groupIds.includes(g.id))

  const colorSwatches = (selected: string, onSelect: (c: string) => void, onCustom: (c: string) => void) => (
    <div className="flex flex-wrap gap-1 items-center">
      {GROUP_COLORS.map(c => (
        <button
          key={c}
          type="button"
          onClick={() => onSelect(c)}
          className={`w-5 h-5 rounded-full border-2 transition-transform ${selected === c ? 'border-gray-700 scale-110' : 'border-transparent hover:scale-105'}`}
          style={{ backgroundColor: c }}
        />
      ))}
      <input
        type="color"
        value={selected}
        onChange={e => onCustom(e.target.value)}
        className="w-5 h-5 rounded cursor-pointer p-0 border-0 bg-transparent"
        title="Custom colour"
      />
    </div>
  )

  return (
    <div ref={cellRef} className="px-2 py-1.5 min-w-[140px]">
      <div
        onClick={openPopover}
        className="flex flex-wrap gap-1 min-h-[26px] cursor-pointer rounded p-0.5 hover:bg-gray-50 transition-colors"
      >
        {assignedGroups.length === 0 ? (
          <span className="text-gray-300 text-xs self-center pl-0.5">—</span>
        ) : (
          assignedGroups.map(g => (
            <span
              key={g.id}
              className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap"
              style={{ backgroundColor: g.color + '1a', color: g.color, border: `1px solid ${g.color}50` }}
            >
              {g.name}
            </span>
          ))
        )}
      </div>

      {open && createPortal(
        <div
          ref={popoverRef}
          className="fixed w-56 bg-white border border-gray-200 rounded-lg shadow-lg py-1 text-sm"
          style={{ top: popoverPos.top, left: popoverPos.left, zIndex: 9999 }}
        >
          {groups.length === 0 && !addingNew && (
            <p className="px-3 py-2 text-xs text-gray-400">No groups yet.</p>
          )}

          {groups.map(g => (
            <div key={g.id}>
              {editingId === g.id ? (
                <div className="px-3 py-2 space-y-2 border-b border-gray-100">
                  <input
                    autoFocus
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleSaveEdit()
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                    className="w-full border border-gray-200 rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                  {colorSwatches(editColor, setEditColor, setEditColor)}
                  <div className="flex gap-1.5">
                    <button onClick={handleSaveEdit} className="flex-1 bg-indigo-600 text-white rounded px-2 py-1 text-xs hover:bg-indigo-700 transition-colors">Save</button>
                    <button onClick={() => setEditingId(null)} className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs hover:bg-gray-50 transition-colors">Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 group/item">
                  <input
                    type="checkbox"
                    checked={row.groupIds.includes(g.id)}
                    onChange={() => onToggleGroup(rowIndex, g.id)}
                    className="w-3.5 h-3.5 accent-indigo-600 cursor-pointer flex-shrink-0"
                  />
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: g.color }} />
                  <span className="flex-1 truncate text-gray-700 text-xs">{g.name}</span>
                  <button
                    onClick={() => startEdit(g)}
                    className="opacity-0 group-hover/item:opacity-100 text-gray-400 hover:text-gray-600 text-xs transition-opacity leading-none"
                  >✎</button>
                  <button
                    onClick={() => handleDelete(g.id)}
                    className="opacity-0 group-hover/item:opacity-100 text-gray-300 hover:text-red-400 text-xs transition-opacity leading-none"
                  >✕</button>
                </div>
              )}
            </div>
          ))}

          <div className={groups.length > 0 ? 'border-t border-gray-100' : ''}>
            {addingNew ? (
              <div className="px-3 py-2 space-y-2">
                <input
                  autoFocus
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleAddGroup()
                    if (e.key === 'Escape') setAddingNew(false)
                  }}
                  placeholder="Group name"
                  className="w-full border border-gray-200 rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-indigo-400"
                />
                {colorSwatches(newColor, setNewColor, setNewColor)}
                <div className="flex gap-1.5">
                  <button onClick={handleAddGroup} className="flex-1 bg-indigo-600 text-white rounded px-2 py-1 text-xs hover:bg-indigo-700 transition-colors">Add</button>
                  <button onClick={() => setAddingNew(false)} className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs hover:bg-gray-50 transition-colors">Cancel</button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => { setAddingNew(true); setEditingId(null) }}
                className="w-full text-left px-3 py-1.5 text-xs text-indigo-600 hover:bg-gray-50 font-medium transition-colors"
              >
                + Add group
              </button>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

// ---- Helpers ----

function buildRows(employees: Employee[], stationIds: string[]): Row[] {
  return employees.map((e) => ({
    id: e.id,
    isNew: false,
    name: e.name,
    certLevel: e.certification_level,
    isPresent: !e.is_absent,
    competencies: Object.fromEntries(stationIds.map((sid) => [sid, e.station_competencies[sid] ?? 0])),
    groupIds: e.group_ids ?? [],
    dirty: false,
  }))
}

export default function MatrixPage() {
  const { stations, employees, settings, refreshEmployees, user, activeDepartment } = useApp()
  const [rows, setRows] = useState<Row[]>(() =>
    buildRows(employees, stations.map((s) => s.id)),
  )
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const [dragRowIdx, setDragRowIdx] = useState<number | null>(null)
  const [dragOverRowIdx, setDragOverRowIdx] = useState<number | null>(null)
  const [displayMode, setDisplayMode] = useState<DisplayMode>(() =>
    (typeof window !== 'undefined' ? (localStorage.getItem('competency-display') as DisplayMode) : null) ?? 'text'
  )
  const [groups, setGroups] = useState<EmployeeGroup[]>([])

  // Load groups for the active department
  useEffect(() => {
    if (!activeDepartment?.id) return
    fetchSetting('employee_groups', activeDepartment.id).then(v => {
      setGroups((v as EmployeeGroup[]) ?? [])
    })
  }, [activeDepartment?.id])

  const saveGroups = async (next: EmployeeGroup[]) => {
    const deletedIds = groups.filter(g => !next.find(n => n.id === g.id)).map(g => g.id)
    setGroups(next)
    if (deletedIds.length > 0) {
      setRows(prev => prev.map(r => ({
        ...r,
        groupIds: r.groupIds.filter(id => !deletedIds.includes(id)),
      })))
    }
    await upsertSetting('employee_groups', next, activeDepartment!.id)
  }

  const handleToggleGroup = (rowIndex: number, groupId: string) => {
    const row = rows[rowIndex]
    const newGroupIds = row.groupIds.includes(groupId)
      ? row.groupIds.filter(id => id !== groupId)
      : [...row.groupIds, groupId]
    updateRow(rowIndex, { groupIds: newGroupIds })
  }

  const toggleDisplayMode = () => {
    setDisplayMode((prev) => {
      const next = prev === 'text' ? 'circle' : 'text'
      localStorage.setItem('competency-display', next)
      return next
    })
  }

  // Local station order for column drag-to-reorder
  const [localStations, setLocalStations] = useState(stations)
  const isDraggingStn = useRef(false)
  const [dragStnIdx, setDragStnIdx] = useState<number | null>(null)
  const [dragOverStnIdx, setDragOverStnIdx] = useState<number | null>(null)

  useEffect(() => {
    if (!isDraggingStn.current) setLocalStations(stations)
  }, [stations])

  // Rebuild rows when employees/stations change (only if no pending changes)
  const prevEmpLen = useRef(employees.length)
  const prevStnLen = useRef(stations.length)
  if (
    prevEmpLen.current !== employees.length ||
    prevStnLen.current !== stations.length
  ) {
    prevEmpLen.current = employees.length
    prevStnLen.current = stations.length
    setRows(buildRows(employees, stations.map((s) => s.id)))
  }

  const { skillLabels, certLabels, competencyColors } = settings
  const skillLevels = Object.keys(skillLabels).map(Number).sort((a, b) => a - b)
  const certLevels = Object.keys(certLabels).map(Number).sort((a, b) => a - b)

  const totalPresent = rows.filter((r) => r.id && r.isPresent).length
  const totalAbsent = rows.filter((r) => r.id && !r.isPresent).length
  const total = rows.filter((r) => r.id).length

  const scheduleSave = useCallback(
    (rowId: string, updatedRow: Row) => {
      if (saveTimers.current[rowId]) clearTimeout(saveTimers.current[rowId])
      saveTimers.current[rowId] = setTimeout(async () => {
        if (!updatedRow.name.trim()) return
        setSaving((s) => ({ ...s, [rowId]: true }))
        try {
          const empId = updatedRow.id ?? generateId('emp')
          await upsertEmployee({
            id: empId,
            name: updatedRow.name.trim(),
            certification_level: updatedRow.certLevel,
            is_absent: !updatedRow.isPresent,
            group_ids: updatedRow.groupIds,
          }, activeDepartment!.id)
          await upsertCompetencies(empId, updatedRow.competencies)
          if (!updatedRow.id) {
            setRows((prev) =>
              prev.map((r) =>
                r === updatedRow ? { ...r, id: empId, isNew: false, dirty: false } : r,
              ),
            )
          } else {
            setRows((prev) =>
              prev.map((r) => (r.id === rowId ? { ...r, dirty: false } : r)),
            )
          }
          await insertAuditLog(user.email ?? '', updatedRow.isNew ? 'Added employee' : 'Updated employee', updatedRow.name)
          await refreshEmployees()
        } finally {
          setSaving((s) => ({ ...s, [rowId]: false }))
        }
      }, 800)
    },
    [refreshEmployees, user.email, activeDepartment],
  )

  const updateRow = (index: number, patch: Partial<Row>) => {
    setRows((prev) => {
      const next = [...prev]
      const updated = { ...next[index], ...patch, dirty: true }
      next[index] = updated
      const key = updated.id ?? `new_${index}`
      scheduleSave(key, updated)
      return next
    })
  }

  const handleAbsenceToggle = async (index: number) => {
    const row = rows[index]
    const newPresent = !row.isPresent
    updateRow(index, { isPresent: newPresent })
    if (row.id) {
      await updateEmployeeAbsence(row.id, !newPresent)
      await insertAuditLog(user.email ?? '', newPresent ? 'Marked present' : 'Marked absent', row.name)
    }
  }

  const addRow = () => {
    const newRow: Row = {
      id: null,
      isNew: true,
      name: '',
      certLevel: 0,
      isPresent: true,
      competencies: Object.fromEntries(localStations.map((s) => [s.id, 0])),
      groupIds: [],
      dirty: false,
    }
    setRows((prev) => [...prev, newRow])
  }

  const handleStnDragStart = (i: number) => { isDraggingStn.current = true; setDragStnIdx(i) }
  const handleStnDragOver = (e: React.DragEvent, i: number) => { e.preventDefault(); e.stopPropagation(); setDragOverStnIdx(i) }
  const handleStnDrop = async (i: number) => {
    if (dragStnIdx === null || dragStnIdx === i) { isDraggingStn.current = false; setDragStnIdx(null); setDragOverStnIdx(null); return }
    const next = [...localStations]
    const [moved] = next.splice(dragStnIdx, 1)
    next.splice(i, 0, moved)
    setLocalStations(next)
    isDraggingStn.current = false
    setDragStnIdx(null)
    setDragOverStnIdx(null)
    await reorderStations(next.map((s) => s.id))
  }

  const handleRowDragStart = (i: number) => setDragRowIdx(i)
  const handleRowDragOver = (e: React.DragEvent, i: number) => { e.preventDefault(); setDragOverRowIdx(i) }
  const handleRowDrop = async (i: number) => {
    if (dragRowIdx === null || dragRowIdx === i) { setDragRowIdx(null); setDragOverRowIdx(null); return }
    const next = [...rows]
    const [moved] = next.splice(dragRowIdx, 1)
    next.splice(i, 0, moved)
    setRows(next)
    setDragRowIdx(null)
    setDragOverRowIdx(null)
    const savedIds = next.filter((r) => r.id).map((r) => r.id as string)
    if (savedIds.length > 0) await reorderEmployees(savedIds)
  }

  const handleDeleteRow = async (index: number) => {
    const row = rows[index]
    if (row.id) {
      if (!confirm(`Archive ${row.name}? They will be removed from the active matrix but their historical rotation and cross-training data will be preserved.`)) return
      await deleteEmployee(row.id)
      await insertAuditLog(user.email ?? '', 'Archived employee', row.name)
      await refreshEmployees()
    }
    setRows((prev) => prev.filter((_, i) => i !== index))
  }

  if (localStations.length === 0) {
    return (
      <div className="max-w-xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Cross-Training Matrix</h1>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-700">
          No stations yet. Add your first station in the sidebar →
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Cross-Training Matrix</h1>
        {total > 0 && (
          <p className="text-sm text-gray-500">
            <span className="font-medium text-gray-700">{totalPresent}</span> present ·{' '}
            <span className="font-medium text-gray-700">{totalAbsent}</span> absent ·{' '}
            <span className="font-medium text-gray-700">{total}</span> total
          </p>
        )}
      </div>

      {/* Color legend + display toggle */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {skillLevels.map((l) => (
          <span
            key={l}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border border-gray-200"
            style={displayMode === 'text'
              ? { backgroundColor: competencyColors[l], color: contrastColor(competencyColors[l]) }
              : undefined}
          >
            {displayMode === 'circle' && (
              <CompetencyCircle level={l} maxLevel={skillLevels[skillLevels.length - 1]} color={circleColor(competencyColors[l])} />
            )}
            {l} · {skillLabels[l]}
          </span>
        ))}
        <button
          onClick={toggleDisplayMode}
          className="ml-auto text-xs border border-gray-200 rounded px-2 py-0.5 text-gray-500 hover:bg-gray-50 transition-colors"
          title="Toggle competency display"
        >
          {displayMode === 'text' ? '◕ Circles' : '☰ Text'}
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="w-6" />
                <th className="px-3 py-2.5 text-left font-medium text-gray-600 whitespace-nowrap w-16">
                  Present
                </th>
                <th className="px-3 py-2.5 text-left font-medium text-gray-600 min-w-[140px]">
                  Employee
                </th>
                <th className="px-3 py-2.5 text-left font-medium text-gray-600 whitespace-nowrap min-w-[130px]">
                  Certification
                </th>
                <th className="px-3 py-2.5 text-left font-medium text-gray-600 min-w-[140px]">
                  Group
                </th>
                {localStations.map((s, i) => (
                  <th
                    key={s.id}
                    draggable
                    onDragStart={() => handleStnDragStart(i)}
                    onDragOver={(e) => handleStnDragOver(e, i)}
                    onDrop={() => handleStnDrop(i)}
                    onDragEnd={() => { isDraggingStn.current = false; setDragStnIdx(null); setDragOverStnIdx(null) }}
                    className={`px-3 py-2.5 text-center font-medium text-gray-600 whitespace-nowrap min-w-[110px] cursor-grab active:cursor-grabbing select-none ${
                      dragOverStnIdx === i && dragStnIdx !== i ? 'border-l-2 border-l-indigo-400' : ''
                    }`}
                  >
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-gray-300 text-xs">⠿</span>
                      {s.name}
                      <div className="text-xs font-normal text-gray-400">
                        req. {skillLabels[s.required_skill_level]}
                      </div>
                    </div>
                  </th>
                ))}
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={row.id ?? `new_${i}`}
                  draggable={!!row.id}
                  onDragStart={() => handleRowDragStart(i)}
                  onDragOver={(e) => handleRowDragOver(e, i)}
                  onDrop={() => handleRowDrop(i)}
                  onDragEnd={() => { setDragRowIdx(null); setDragOverRowIdx(null) }}
                  className={`border-b border-gray-100 transition-colors ${
                    !row.isPresent && row.id ? 'bg-gray-50 opacity-60' : 'hover:bg-gray-50/50'
                  } ${dragOverRowIdx === i && dragRowIdx !== i ? 'border-t-2 border-t-indigo-400' : ''}`}
                >
                  {/* Drag handle */}
                  <td className="pl-2 pr-0 py-2 w-6">
                    {row.id && (
                      <span className="text-gray-300 cursor-grab active:cursor-grabbing text-sm select-none">⠿</span>
                    )}
                  </td>

                  {/* Present */}
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={row.isPresent}
                      onChange={() => handleAbsenceToggle(i)}
                      className="w-4 h-4 accent-indigo-600 cursor-pointer"
                    />
                  </td>

                  {/* Name */}
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={row.name}
                        onChange={(e) => updateRow(i, { name: e.target.value })}
                        placeholder="Employee name"
                        className="flex-1 text-sm bg-transparent outline-none placeholder-gray-300 focus:placeholder-gray-400 min-w-0"
                      />
                      {saving[row.id ?? `new_${i}`] && (
                        <span className="w-3 h-3 border-2 border-gray-200 border-t-indigo-400 rounded-full animate-spin flex-shrink-0" />
                      )}
                    </div>
                  </td>

                  {/* Cert */}
                  <td className="px-3 py-2">
                    <select
                      value={row.certLevel}
                      onChange={(e) => updateRow(i, { certLevel: Number(e.target.value) })}
                      className="w-full text-sm bg-transparent outline-none cursor-pointer"
                    >
                      {certLevels.map((l) => (
                        <option key={l} value={l}>
                          {l} — {certLabels[l]}
                        </option>
                      ))}
                    </select>
                  </td>

                  {/* Group */}
                  <td className="py-0 px-0">
                    <GroupCell
                      row={row}
                      rowIndex={i}
                      groups={groups}
                      onToggleGroup={handleToggleGroup}
                      onSaveGroups={saveGroups}
                    />
                  </td>

                  {/* Station competencies */}
                  {localStations.map((s) => {
                    const level = row.competencies[s.id] ?? 0
                    const maxLevel = skillLevels[skillLevels.length - 1]
                    return (
                      <td
                        key={s.id}
                        className="px-2 py-1.5 text-center"
                        style={displayMode === 'text' ? { backgroundColor: competencyColors[level], color: contrastColor(competencyColors[level]) } : undefined}
                      >
                        {displayMode === 'circle' ? (
                          <div className="relative flex items-center justify-center">
                            <CompetencyCircle level={level} maxLevel={maxLevel} color={circleColor(competencyColors[level])} />
                            <select
                              value={level}
                              onChange={(e) =>
                                updateRow(i, {
                                  competencies: { ...row.competencies, [s.id]: Number(e.target.value) },
                                })
                              }
                              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                            >
                              {skillLevels.map((l) => (
                                <option key={l} value={l}>
                                  {l} — {skillLabels[l]}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <select
                            value={level}
                            onChange={(e) =>
                              updateRow(i, {
                                competencies: { ...row.competencies, [s.id]: Number(e.target.value) },
                              })
                            }
                            className="w-full text-xs bg-transparent outline-none cursor-pointer text-center"
                            style={{ backgroundColor: 'transparent', color: 'inherit' }}
                          >
                            {skillLevels.map((l) => (
                              <option key={l} value={l}>
                                {l} — {skillLabels[l]}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                    )
                  })}

                  {/* Delete */}
                  <td className="px-2 py-2">
                    <button
                      onClick={() => handleDeleteRow(i)}
                      className="text-gray-300 hover:text-red-400 transition-colors text-base leading-none"
                      title="Remove employee"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}

              {/* Add row */}
              <tr>
                <td colSpan={5 + stations.length + 1} className="px-3 py-2">
                  <button
                    onClick={addRow}
                    className="text-sm text-indigo-600 hover:text-indigo-700 font-medium transition-colors"
                  >
                    + Add Employee
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
