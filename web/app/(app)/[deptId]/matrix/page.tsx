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
  addEmployeeToSecondaryDepartment,
  removeEmployeeFromSecondaryDepartment,
  fetchAllEmployeesBasic,
} from '@/lib/db'
import LastUpdatedCell, { type LastUpdatedInfo } from '@/components/LastUpdatedCell'
import type { Employee, EmployeeGroup } from '@/lib/types'

interface Row {
  id: string | null
  isNew: boolean
  isHomeDept: boolean
  homeDeptId: string
  name: string
  certLevel: number
  isPresent: boolean
  isLead: boolean
  hireDate: string | null
  competencies: Record<string, number>
  groupIds: string[]
  dirty: boolean
}

function formatTenure(hireDate: string): string {
  const hired = new Date(hireDate)
  const now = new Date()
  const months = (now.getFullYear() - hired.getFullYear()) * 12 + (now.getMonth() - hired.getMonth())
  if (months < 1) return '< 1 month'
  if (months < 12) return `${months} month${months !== 1 ? 's' : ''}`
  const years = Math.floor(months / 12)
  const rem = months % 12
  if (rem === 0) return `${years} year${years !== 1 ? 's' : ''}`
  return `${years} year${years !== 1 ? 's' : ''}, ${rem} month${rem !== 1 ? 's' : ''}`
}

type DisplayMode = 'text' | 'circle'

const GROUP_COLORS = ['#6366f1','#3b82f6','#10b981','#f59e0b','#ef4444','#ec4899','#8b5cf6','#14b8a6']

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
  if (level <= 0) return (
    <svg width={24} height={24} viewBox="0 0 24 24">
      <circle cx={cx} cy={cy} r={r} fill="#ffffff" stroke={color} strokeWidth="1.5" />
    </svg>
  )
  if (level >= maxLevel) return (
    <svg width={24} height={24} viewBox="0 0 24 24">
      <circle cx={cx} cy={cy} r={r} fill={color} stroke={color} strokeWidth="1" />
    </svg>
  )
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

// ---- Column header filter button ----

interface FilterOption {
  value: string
  label: string
  color?: string
}

function FilterButton({
  options,
  selected,
  onChange,
  onHide,
}: {
  options: FilterOption[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
  onHide?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const isActive = selected.size > 0

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom + 4, left: rect.left })
    }
    setOpen(o => !o)
  }

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node))
        setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = () => setOpen(false)
    window.addEventListener('scroll', handler, true)
    return () => window.removeEventListener('scroll', handler, true)
  }, [open])

  const isChecked = (value: string) => selected.size === 0 || selected.has(value)

  const toggle = (value: string) => {
    const allValues = options.map(o => o.value)
    if (selected.size === 0) {
      // All shown → uncheck one → show everything except this
      onChange(new Set(allValues.filter(v => v !== value)))
    } else {
      const next = new Set(selected)
      if (next.has(value)) {
        next.delete(value)
        if (next.size === 0) onChange(new Set()) // last unchecked → reset
        else onChange(next)
      } else {
        next.add(value)
        if (next.size === allValues.length) onChange(new Set()) // all checked → reset
        else onChange(next)
      }
    }
  }

  return (
    <>
      <span className="relative inline-flex items-center">
        <button
          ref={btnRef}
          onClick={handleOpen}
          className={`ml-1 leading-none transition-colors ${
            isActive ? 'text-indigo-500' : 'text-gray-400 hover:text-gray-600'
          }`}
          style={{ fontSize: 10 }}
        >
          ▼
        </button>
        {isActive && (
          <span className="absolute -top-1 -right-1.5 w-1.5 h-1.5 rounded-full bg-indigo-500 pointer-events-none" />
        )}
      </span>
      {open && createPortal(
        <div
          ref={popRef}
          className="fixed bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[160px]"
          style={{ top: pos.top, left: pos.left, zIndex: 9999 }}
        >
          <div className="flex items-center justify-between px-3 py-1 border-b border-gray-100">
            <button
              onClick={() => onChange(new Set())}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
            >
              Select all
            </button>
            {isActive && (
              <button
                onClick={() => { onChange(new Set()); setOpen(false) }}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                Clear ×
              </button>
            )}
          </div>
          {options.length === 0 ? (
            <p className="text-xs text-gray-400 px-3 py-2">No options available</p>
          ) : options.map(opt => (
            <label key={opt.value} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer">
              <input
                type="checkbox"
                checked={isChecked(opt.value)}
                onChange={() => toggle(opt.value)}
                className="w-3.5 h-3.5 accent-indigo-600 flex-shrink-0"
              />
              {opt.color && (
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: opt.color }} />
              )}
              <span className="text-xs text-gray-700 truncate">{opt.label}</span>
            </label>
          ))}
          {onHide && (
            <div className="border-t border-gray-100 mt-1 pt-1">
              <button
                onClick={() => { onHide(); setOpen(false) }}
                className="w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-50"
              >
                Hide column
              </button>
            </div>
          )}
        </div>,
        document.body
      )}
    </>
  )
}

// ---- Group cell ----

interface GroupCellProps {
  row: Row
  rowIndex: number
  groups: EmployeeGroup[]
  onToggleGroup: (rowIndex: number, groupId: string) => void
  onSaveGroups: (groups: EmployeeGroup[]) => Promise<void>
  readOnly?: boolean
}

function GroupCell({ row, rowIndex, groups, onToggleGroup, onSaveGroups, readOnly = false }: GroupCellProps) {
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
      if (popoverRef.current?.contains(e.target as Node) || cellRef.current?.contains(e.target as Node)) return
      setOpen(false); setEditingId(null); setAddingNew(false)
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

  const startEdit = (g: EmployeeGroup) => { setEditingId(g.id); setEditName(g.name); setEditColor(g.color); setAddingNew(false) }

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
    setNewName(''); setNewColor(GROUP_COLORS[0]); setAddingNew(false)
  }

  const swatches = (selected: string, onSelect: (c: string) => void) => (
    <div className="flex flex-wrap gap-1 items-center">
      {GROUP_COLORS.map(c => (
        <button key={c} type="button" onClick={() => onSelect(c)}
          className={`w-5 h-5 rounded-full border-2 transition-transform ${selected === c ? 'border-gray-700 scale-110' : 'border-transparent hover:scale-105'}`}
          style={{ backgroundColor: c }} />
      ))}
      <input type="color" value={selected} onChange={e => onSelect(e.target.value)}
        className="w-5 h-5 rounded cursor-pointer p-0 border-0 bg-transparent" title="Custom colour" />
    </div>
  )

  const assignedGroups = groups.filter(g => row.groupIds.includes(g.id))

  return (
    <div ref={cellRef} className="px-2 py-1.5">
      <div onClick={readOnly ? undefined : openPopover} className={`flex flex-wrap gap-1 min-h-[26px] rounded p-0.5 transition-colors ${readOnly ? '' : 'cursor-pointer hover:bg-gray-50'}`}>
        {assignedGroups.length === 0
          ? <span className="text-gray-300 text-xs self-center pl-0.5">—</span>
          : assignedGroups.map(g => (
            <span key={g.id} className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap"
              style={{ backgroundColor: g.color + '1a', color: g.color, border: `1px solid ${g.color}50` }}>
              {g.name}
            </span>
          ))
        }
      </div>

      {open && createPortal(
        <div ref={popoverRef} className="fixed w-56 bg-white border border-gray-200 rounded-lg shadow-lg py-1 text-sm"
          style={{ top: popoverPos.top, left: popoverPos.left, zIndex: 9999 }}>
          {groups.length === 0 && !addingNew && <p className="px-3 py-2 text-xs text-gray-400">No groups yet.</p>}
          {groups.map(g => (
            <div key={g.id}>
              {editingId === g.id ? (
                <div className="px-3 py-2 space-y-2 border-b border-gray-100">
                  <input autoFocus value={editName} onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(); if (e.key === 'Escape') setEditingId(null) }}
                    className="w-full border border-gray-200 rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-indigo-400" />
                  {swatches(editColor, setEditColor)}
                  <div className="flex gap-1.5">
                    <button onClick={handleSaveEdit} className="flex-1 bg-indigo-600 text-white rounded px-2 py-1 text-xs hover:bg-indigo-700 transition-colors">Save</button>
                    <button onClick={() => setEditingId(null)} className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs hover:bg-gray-50 transition-colors">Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 group/item">
                  <input type="checkbox" checked={row.groupIds.includes(g.id)} onChange={() => onToggleGroup(rowIndex, g.id)}
                    className="w-3.5 h-3.5 accent-indigo-600 cursor-pointer flex-shrink-0" />
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: g.color }} />
                  <span className="flex-1 truncate text-gray-700 text-xs">{g.name}</span>
                  <button onClick={() => startEdit(g)} className="opacity-0 group-hover/item:opacity-100 text-gray-400 hover:text-gray-600 text-xs transition-opacity leading-none">✎</button>
                  <button onClick={() => handleDelete(g.id)} className="opacity-0 group-hover/item:opacity-100 text-gray-300 hover:text-red-400 text-xs transition-opacity leading-none">✕</button>
                </div>
              )}
            </div>
          ))}
          <div className={groups.length > 0 ? 'border-t border-gray-100' : ''}>
            {addingNew ? (
              <div className="px-3 py-2 space-y-2">
                <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddGroup(); if (e.key === 'Escape') setAddingNew(false) }}
                  placeholder="Group name"
                  className="w-full border border-gray-200 rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-indigo-400" />
                {swatches(newColor, setNewColor)}
                <div className="flex gap-1.5">
                  <button onClick={handleAddGroup} className="flex-1 bg-indigo-600 text-white rounded px-2 py-1 text-xs hover:bg-indigo-700 transition-colors">Add</button>
                  <button onClick={() => setAddingNew(false)} className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs hover:bg-gray-50 transition-colors">Cancel</button>
                </div>
              </div>
            ) : (
              <button onClick={() => { setAddingNew(true); setEditingId(null) }}
                className="w-full text-left px-3 py-1.5 text-xs text-indigo-600 hover:bg-gray-50 font-medium transition-colors">
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

function buildRows(employees: Employee[], stationIds: string[], currentDeptId: string): Row[] {
  return employees.map((e) => ({
    id: e.id,
    isNew: false,
    isHomeDept: e.department_id === currentDeptId,
    homeDeptId: e.department_id,
    name: e.name,
    certLevel: e.certification_level,
    isPresent: !e.is_absent,
    isLead: e.is_lead ?? false,
    hireDate: e.hire_date ?? null,
    competencies: Object.fromEntries(stationIds.map((sid) => [sid, e.station_competencies[sid] ?? 0])),
    groupIds: e.group_ids ?? [],
    dirty: false,
  }))
}

export default function MatrixPage() {
  const { stations, employees, settings, refreshEmployees, user, activeDepartment, hasEditAccess, userRole, departments, competencyChanges, applyCompetencyChanges } = useApp()
  const [rows, setRows] = useState<Row[]>(() =>
    buildRows(employees, stations.map((s) => s.id), activeDepartment?.id ?? ''),
  )
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const [dragRowIdx, setDragRowIdx] = useState<number | null>(null)
  const [dragOverRowIdx, setDragOverRowIdx] = useState<number | null>(null)
  const [displayMode, setDisplayMode] = useState<DisplayMode>(() =>
    (typeof window !== 'undefined' ? (localStorage.getItem('competency-display') as DisplayMode) : null) ?? 'text'
  )
  const [groups, setGroups] = useState<EmployeeGroup[]>([])
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set())
  const [restoreOpen, setRestoreOpen] = useState(false)
  const restoreRef = useRef<HTMLDivElement>(null)

  // Column header filters — empty Set means "all shown" (no filter)
  const [presenceFilter, setPresenceFilter] = useState<Set<string>>(new Set())
  const [employeeFilter, setEmployeeFilter] = useState<Set<string>>(new Set())
  const [certFilter, setCertFilter] = useState<Set<string>>(new Set())
  const [groupFilter, setGroupFilter] = useState<Set<string>>(new Set())
  const [stationFilters, setStationFilters] = useState<Record<string, Set<string>>>({})
  const [filterName, setFilterName] = useState('')
  const [matrixSort, setMatrixSort] = useState<{ col: string | null; dir: 'asc' | 'desc' }>({ col: null, dir: 'asc' })

  type BasicEmployee = Pick<Employee, 'id' | 'name' | 'department_id' | 'secondary_department_ids'>
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerEmployees, setPickerEmployees] = useState<BasicEmployee[]>([])
  const [pickerSearch, setPickerSearch] = useState('')
  const [addingFromDept, setAddingFromDept] = useState(false)

  const hasFilters = filterName !== '' || presenceFilter.size > 0 || employeeFilter.size > 0 ||
    certFilter.size > 0 || groupFilter.size > 0 || Object.values(stationFilters).some(s => s.size > 0)

  const clearFilters = () => {
    setFilterName(''); setPresenceFilter(new Set()); setEmployeeFilter(new Set())
    setCertFilter(new Set()); setGroupFilter(new Set()); setStationFilters({})
  }

  const toggleMatrixSort = (col: string) => {
    setMatrixSort(prev => prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' })
  }

  const sortInd = (col: string) => (
    <span className={`ml-0.5 text-[10px] ${matrixSort.col === col ? 'text-indigo-500' : 'text-gray-300'}`}>
      {matrixSort.col === col ? (matrixSort.dir === 'asc' ? '▲' : '▼') : '↕'}
    </span>
  )

  // Load groups and hidden columns for the active department
  useEffect(() => {
    if (!activeDepartment?.id) return
    fetchSetting('employee_groups', activeDepartment.id).then(v => {
      setGroups((v as EmployeeGroup[]) ?? [])
    })
    fetchSetting('hidden_columns', activeDepartment.id).then(v => {
      setHiddenColumns(new Set((v as string[]) ?? []))
    })
  }, [activeDepartment?.id])

  useEffect(() => {
    if (!restoreOpen) return
    const handler = (e: MouseEvent) => {
      if (!restoreRef.current?.contains(e.target as Node)) setRestoreOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [restoreOpen])

  const saveGroups = async (next: EmployeeGroup[]) => {
    const deletedIds = groups.filter(g => !next.find(n => n.id === g.id)).map(g => g.id)
    setGroups(next)
    if (deletedIds.length > 0) {
      setRows(prev => prev.map(r => ({ ...r, groupIds: r.groupIds.filter(id => !deletedIds.includes(id)) })))
    }
    await upsertSetting('employee_groups', next, activeDepartment!.id)
  }

  const saveHiddenColumns = async (next: Set<string>) => {
    setHiddenColumns(next)
    await upsertSetting('hidden_columns', [...next], activeDepartment!.id)
  }

  const columnLabel = (id: string): string => {
    if (id === 'present') return 'Present'
    if (id === 'certification') return 'Certification'
    if (id === 'group') return 'Group'
    return localStations.find(s => s.id === id)?.name ?? id
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

  const [localStations, setLocalStations] = useState(stations)
  const isDraggingStn = useRef(false)
  const [dragStnIdx, setDragStnIdx] = useState<number | null>(null)
  const [dragOverStnIdx, setDragOverStnIdx] = useState<number | null>(null)

  useEffect(() => {
    if (!isDraggingStn.current) setLocalStations(stations)
  }, [stations])

  const prevEmpLen = useRef(employees.length)
  const prevStnLen = useRef(stations.length)
  if (prevEmpLen.current !== employees.length || prevStnLen.current !== stations.length) {
    prevEmpLen.current = employees.length
    prevStnLen.current = stations.length
    setRows(buildRows(employees, stations.map((s) => s.id), activeDepartment?.id ?? ''))
  }

  const { skillLabels, certLabels, competencyColors } = settings
  const skillLevels = Object.keys(skillLabels).map(Number).sort((a, b) => a - b)
  const certLevels = Object.keys(certLabels).map(Number).sort((a, b) => a - b)

  const levelLabel = (level: number | null) =>
    level === null ? 'not set' : skillLabels[level] ?? `Level ${level}`

  /**
   * Reads straight from context rather than from `rows`, which is only rebuilt when
   * the employee count changes and so never picks up new server fields.
   */
  const lastUpdatedInfo = (employeeId: string | null): LastUpdatedInfo | null => {
    const change = employeeId ? competencyChanges[employeeId] : null
    if (!change) return null
    return {
      changedAt: change.changed_at,
      changedByEmail: change.changed_by,
      // The snapshot, not a lookup in localStations: a shared employee's most recent
      // change may be at a station in another department, which this page never loads.
      stationName: change.station_name,
      oldLabel: levelLabel(change.old_level),
      newLabel: levelLabel(change.new_level),
    }
  }

  const lastUpdatedAt = (employeeId: string | null) => {
    const change = employeeId ? competencyChanges[employeeId] : null
    return change ? new Date(change.changed_at).getTime() : -1
  }

  /**
   * Hire date read from context, for the same reason as above: `rows` is only rebuilt
   * when the employee count changes, so a hire-date import — which changes no counts —
   * would otherwise never appear here. Falls back to the row's own value for a new
   * employee that has not been saved yet and so is not in context.
   */
  const hireDateById = new Map(employees.map((e) => [e.id, e.hire_date ?? null]))
  const hireDateOf = (row: { id: string | null; hireDate: string | null }) =>
    (row.id ? hireDateById.get(row.id) : null) ?? row.hireDate

  const totalPresent = rows.filter((r) => r.id && r.isPresent).length
  const totalAbsent = rows.filter((r) => r.id && !r.isPresent).length
  const total = rows.filter((r) => r.id).length

  const visibleRows = rows
    .map((r, originalIndex) => ({ ...r, originalIndex }))
    .filter(r => {
      if (filterName && !r.name.toLowerCase().includes(filterName.toLowerCase())) return false
      if (presenceFilter.size > 0 && !presenceFilter.has(r.isPresent ? 'present' : 'absent')) return false
      if (employeeFilter.size > 0 && !employeeFilter.has(r.id ?? '')) return false
      if (certFilter.size > 0 && !certFilter.has(String(r.certLevel))) return false
      if (groupFilter.size > 0 && !r.groupIds.some(id => groupFilter.has(id))) return false
      for (const [stnId, lvls] of Object.entries(stationFilters)) {
        if (lvls.size > 0 && !lvls.has(String(r.competencies[stnId] ?? 0))) return false
      }
      return true
    })
    .sort((a, b) => {
      const col = matrixSort.col
      if (!col) return 0
      const toMonths = (d: string | null) => {
        if (!d) return -1
        const h = new Date(d), n = new Date()
        return (n.getFullYear() - h.getFullYear()) * 12 + n.getMonth() - h.getMonth()
      }
      let cmp = 0
      if (col === 'name') cmp = a.name.localeCompare(b.name)
      else if (col === 'present') cmp = (a.isPresent ? 0 : 1) - (b.isPresent ? 0 : 1)
      else if (col === 'certification') cmp = a.certLevel - b.certLevel
      else if (col === 'group') {
        const gA = a.groupIds[0] ? (groups.find(g => g.id === a.groupIds[0])?.name ?? '') : ''
        const gB = b.groupIds[0] ? (groups.find(g => g.id === b.groupIds[0])?.name ?? '') : ''
        cmp = gA.localeCompare(gB)
      }
      else if (col === 'tenure') cmp = toMonths(hireDateOf(a)) - toMonths(hireDateOf(b))
      // Needs an explicit branch: the fallback below treats any unrecognised column
      // as a station id, which would make this header a silent no-op. Employees with
      // no recorded change sort first ascending, matching the tenure convention above.
      else if (col === 'lastUpdate') cmp = lastUpdatedAt(a.id) - lastUpdatedAt(b.id)
      else cmp = (a.competencies[col] ?? 0) - (b.competencies[col] ?? 0)
      return matrixSort.dir === 'asc' ? cmp : -cmp
    })

  // Every department's matrix must render identically. With the default table-auto
  // layout the browser sized each column from its content, so Parts-AM's long
  // "Extra jobs / Credit Invoices upload" station took 374px next to 178px
  // neighbours, Body's two stations stretched to 372px each, and narrow windows
  // squeezed the level labels until they clipped. table-fixed plus these widths
  // removes all three. Derived from the same visibility predicate that decides
  // which cells render, so the two cannot desync.
  const STATION_COL_W = 170
  const cols: number[] = [
    28, // drag handle
    ...(hiddenColumns.has('present') ? [] : [52]),
    200, // employee
    110, // tenure
    105, // last update
    ...(hiddenColumns.has('certification') ? [] : [145]),
    ...(hiddenColumns.has('group') ? [] : [175]),
    ...localStations.filter((s) => !hiddenColumns.has(s.id)).map(() => STATION_COL_W),
    36, // delete
  ]
  const tableWidth = cols.reduce((a, b) => a + b, 0)

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
            is_lead: updatedRow.isLead,
            group_ids: updatedRow.groupIds,
          }, updatedRow.isHomeDept ? activeDepartment!.id : undefined)
          // Returns only genuinely changed stations, carrying the server's timestamp,
          // so the Last Update cell reflects the persisted value without a refetch.
          const changes = await upsertCompetencies(empId, updatedRow.competencies, {
            email: user.email ?? '',
            stations: localStations,
          })
          applyCompetencyChanges(changes)
          if (!updatedRow.id) {
            setRows((prev) => prev.map((r) => r === updatedRow ? { ...r, id: empId, isNew: false, dirty: false } : r))
          } else {
            setRows((prev) => prev.map((r) => r.id === rowId ? { ...r, dirty: false } : r))
          }
          await insertAuditLog(user.email ?? '', updatedRow.isNew ? 'Added employee' : 'Updated employee', updatedRow.name)
          await refreshEmployees()
        } finally {
          setSaving((s) => ({ ...s, [rowId]: false }))
        }
      }, 800)
    },
    // Recreating this callback does not cancel pending saves; the timers live in a ref.
    [refreshEmployees, user.email, activeDepartment, localStations, applyCompetencyChanges],
  )

  const updateRow = (index: number, patch: Partial<Row>) => {
    setRows((prev) => {
      const next = [...prev]
      const updated = { ...next[index], ...patch, dirty: true }
      next[index] = updated
      scheduleSave(updated.id ?? `new_${index}`, updated)
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
    setRows((prev) => [...prev, {
      id: null, isNew: true, isHomeDept: true, homeDeptId: activeDepartment?.id ?? '',
      name: '', certLevel: 0, isPresent: true, isLead: false, hireDate: null,
      competencies: Object.fromEntries(localStations.map((s) => [s.id, 0])),
      groupIds: [], dirty: false,
    }])
  }

  const handleStnDragStart = (i: number) => { isDraggingStn.current = true; setDragStnIdx(i) }
  const handleStnDragOver = (e: React.DragEvent, i: number) => { e.preventDefault(); e.stopPropagation(); setDragOverStnIdx(i) }
  const handleStnDrop = async (i: number) => {
    if (dragStnIdx === null || dragStnIdx === i) { isDraggingStn.current = false; setDragStnIdx(null); setDragOverStnIdx(null); return }
    const next = [...localStations]; const [moved] = next.splice(dragStnIdx, 1); next.splice(i, 0, moved)
    setLocalStations(next); isDraggingStn.current = false; setDragStnIdx(null); setDragOverStnIdx(null)
    await reorderStations(next.map((s) => s.id))
  }

  const handleRowDragStart = (i: number) => setDragRowIdx(i)
  const handleRowDragOver = (e: React.DragEvent, i: number) => { e.preventDefault(); setDragOverRowIdx(i) }
  const handleRowDrop = async (i: number) => {
    if (dragRowIdx === null || dragRowIdx === i) { setDragRowIdx(null); setDragOverRowIdx(null); return }
    const next = [...rows]; const [moved] = next.splice(dragRowIdx, 1); next.splice(i, 0, moved)
    setRows(next); setDragRowIdx(null); setDragOverRowIdx(null)
    const savedIds = next.filter((r) => r.id).map((r) => r.id as string)
    if (savedIds.length > 0) await reorderEmployees(savedIds)
  }

  const handleDeleteRow = async (index: number) => {
    const row = rows[index]
    if (row.id) {
      if (row.isHomeDept) {
        if (!confirm(`Archive ${row.name}? They will be removed from the active matrix but their historical rotation and cross-training data will be preserved.`)) return
        await deleteEmployee(row.id)
        await insertAuditLog(user.email ?? '', 'Archived employee', row.name)
      } else {
        if (!confirm(`Remove ${row.name} from this department? Their home department data and history are unaffected.`)) return
        await removeEmployeeFromSecondaryDepartment(row.id, activeDepartment!.id)
      }
      await refreshEmployees()
    }
    setRows((prev) => prev.filter((_, i) => i !== index))
  }

  const openPicker = async () => {
    const currentDeptId = activeDepartment?.id ?? ''
    const all = await fetchAllEmployeesBasic()
    setPickerEmployees(all.filter(e =>
      e.department_id !== currentDeptId &&
      !(e.secondary_department_ids?.includes(currentDeptId))
    ))
    setPickerSearch('')
    setPickerOpen(true)
  }

  const handleAddFromDept = async (emp: BasicEmployee) => {
    if (!activeDepartment || addingFromDept) return
    setAddingFromDept(true)
    try {
      await addEmployeeToSecondaryDepartment(emp.id, activeDepartment.id)
      await refreshEmployees()
      setPickerOpen(false)
      setPickerSearch('')
    } finally {
      setAddingFromDept(false)
    }
  }

  if (localStations.length === 0) {
    return (
      <div className="max-w-xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Cross-Training Matrix</h1>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-700">
          No stations yet. Add your first station from the Stations menu in the header.
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">Cross-Training Matrix</h1>
          {userRole === 'manager' && (
            <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${
              hasEditAccess ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-500'
            }`}>
              {hasEditAccess ? 'Edit' : 'View only'}
            </span>
          )}
        </div>
        {total > 0 && (
          <p className="text-sm text-gray-500">
            <span className="font-medium text-gray-700">{totalPresent}</span> present ·{' '}
            <span className="font-medium text-gray-700">{totalAbsent}</span> absent ·{' '}
            <span className="font-medium text-gray-700">{total}</span> total
          </p>
        )}
      </div>

      {/* Legend + search + display toggle */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {skillLevels.map((l) => (
          <span key={l}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border border-gray-200"
            style={displayMode === 'text' ? { backgroundColor: competencyColors[l], color: contrastColor(competencyColors[l]) } : undefined}
          >
            {displayMode === 'circle' && <CompetencyCircle level={l} maxLevel={skillLevels[skillLevels.length - 1]} color={circleColor(competencyColors[l])} />}
            {l} · {skillLabels[l]}
          </span>
        ))}
        <button onClick={toggleDisplayMode}
          className="ml-auto text-xs border border-gray-200 rounded px-2 py-0.5 text-gray-500 hover:bg-gray-50 transition-colors"
          title="Toggle competency display">
          {displayMode === 'text' ? '◕ Circles' : '☰ Text'}
        </button>
      </div>

      {/* Search + hidden columns restore + clear */}
      <div className="flex items-center gap-3 mb-3">
        <input
          type="text"
          value={filterName}
          onChange={e => setFilterName(e.target.value)}
          placeholder="Search employees…"
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400 placeholder-gray-400 w-56"
        />
        {hiddenColumns.size > 0 && (
          <div className="relative" ref={restoreRef}>
            <button
              onClick={() => setRestoreOpen(o => !o)}
              className="text-xs border border-gray-300 rounded-lg px-2.5 py-1.5 bg-white text-gray-600 hover:bg-gray-50 transition-colors whitespace-nowrap"
            >
              {hiddenColumns.size} hidden ▼
            </button>
            {restoreOpen && (
              <div className="absolute left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-20 min-w-[160px]">
                <button
                  onClick={() => { saveHiddenColumns(new Set()); setRestoreOpen(false) }}
                  className="w-full text-left px-3 py-1.5 text-xs text-indigo-600 font-medium border-b border-gray-100 hover:bg-gray-50"
                >
                  Show all
                </button>
                {[...hiddenColumns].map(id => (
                  <div key={id} className="flex items-center justify-between px-3 py-1.5 hover:bg-gray-50">
                    <span className="text-xs text-gray-600">{columnLabel(id)}</span>
                    <button
                      onClick={() => { const n = new Set(hiddenColumns); n.delete(id); saveHiddenColumns(n) }}
                      className="text-xs text-indigo-500 hover:text-indigo-700 ml-3 font-medium"
                    >
                      Show
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {hasFilters && (
          <>
            <span className="text-xs text-gray-400">{visibleRows.filter(r => r.id).length} of {total}</span>
            <button onClick={clearFilters} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
              Clear all filters ×
            </button>
          </>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="text-sm border-collapse table-fixed" style={{ width: tableWidth }}>
            <colgroup>
              {cols.map((w, i) => (
                <col key={i} style={{ width: w }} />
              ))}
            </colgroup>
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="w-6" />

                {/* Present */}
                {!hiddenColumns.has('present') && (
                  <th className="px-3 py-2.5 text-left font-medium text-gray-600 whitespace-nowrap w-16">
                    <span className="inline-flex items-center gap-0.5">
                      <button onClick={() => toggleMatrixSort('present')} className="hover:text-gray-900 transition-colors">
                        Present{sortInd('present')}
                      </button>
                      <FilterButton
                        options={[
                          { value: 'present', label: 'Present' },
                          { value: 'absent', label: 'Absent' },
                        ]}
                        selected={presenceFilter}
                        onChange={setPresenceFilter}
                        onHide={() => saveHiddenColumns(new Set([...hiddenColumns, 'present']))}
                      />
                    </span>
                  </th>
                )}

                {/* Employee */}
                <th className="px-3 py-2.5 text-left font-medium text-gray-600">
                  <span className="inline-flex items-center gap-0.5">
                    <button onClick={() => toggleMatrixSort('name')} className="hover:text-gray-900 transition-colors">
                      Employee{sortInd('name')}
                    </button>
                    <FilterButton
                      options={rows.filter(r => r.id).map(r => ({ value: r.id!, label: r.name || '(unnamed)' }))}
                      selected={employeeFilter}
                      onChange={setEmployeeFilter}
                    />
                  </span>
                </th>

                {/* Tenure */}
                <th className="px-3 py-2.5 text-left font-medium text-gray-600 whitespace-nowrap">
                  <button onClick={() => toggleMatrixSort('tenure')} className="hover:text-gray-900 transition-colors">
                    Tenure{sortInd('tenure')}
                  </button>
                </th>

                {/* Last Update — read-only, visible to every role, like Tenure */}
                <th className="px-3 py-2.5 text-left font-medium text-gray-600 whitespace-nowrap">
                  <button onClick={() => toggleMatrixSort('lastUpdate')} className="hover:text-gray-900 transition-colors">
                    Last Update{sortInd('lastUpdate')}
                  </button>
                </th>

                {/* Certification */}
                {!hiddenColumns.has('certification') && (
                  <th className="px-3 py-2.5 text-left font-medium text-gray-600 whitespace-nowrap">
                    <span className="inline-flex items-center gap-0.5">
                      <button onClick={() => toggleMatrixSort('certification')} className="hover:text-gray-900 transition-colors">
                        Certification{sortInd('certification')}
                      </button>
                      <FilterButton
                        options={certLevels.map(l => ({ value: String(l), label: `${certLabels[l]}` }))}
                        selected={certFilter}
                        onChange={setCertFilter}
                        onHide={() => saveHiddenColumns(new Set([...hiddenColumns, 'certification']))}
                      />
                    </span>
                  </th>
                )}

                {/* Group */}
                {!hiddenColumns.has('group') && (
                  <th className="px-3 py-2.5 text-left font-medium text-gray-600">
                    <span className="inline-flex items-center gap-0.5">
                      <button onClick={() => toggleMatrixSort('group')} className="hover:text-gray-900 transition-colors">
                        Group{sortInd('group')}
                      </button>
                      <FilterButton
                        options={groups.map(g => ({ value: g.id, label: g.name, color: g.color }))}
                        selected={groupFilter}
                        onChange={setGroupFilter}
                        onHide={() => saveHiddenColumns(new Set([...hiddenColumns, 'group']))}
                      />
                    </span>
                  </th>
                )}

                {/* Stations */}
                {localStations.map((s, i) => hiddenColumns.has(s.id) ? null : (
                  <th key={s.id} draggable={hasEditAccess}
                    onDragStart={hasEditAccess ? () => handleStnDragStart(i) : undefined}
                    onDragOver={hasEditAccess ? (e) => handleStnDragOver(e, i) : undefined}
                    onDrop={hasEditAccess ? () => handleStnDrop(i) : undefined}
                    onDragEnd={hasEditAccess ? () => { isDraggingStn.current = false; setDragStnIdx(null); setDragOverStnIdx(null) } : undefined}
                    className={`px-2 py-2.5 text-center font-medium text-gray-600 leading-tight select-none ${
                      hasEditAccess ? 'cursor-grab active:cursor-grabbing' : ''
                    } ${dragOverStnIdx === i && dragStnIdx !== i ? 'border-l-2 border-l-indigo-400' : ''
                    }`}
                  >
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-gray-300 text-xs">⠿</span>
                      <span className="inline-flex items-center gap-0.5">
                        <button onClick={(e) => { e.stopPropagation(); toggleMatrixSort(s.id) }} className="hover:text-gray-900 transition-colors cursor-pointer">
                          {s.name}{sortInd(s.id)}
                        </button>
                        <FilterButton
                          options={skillLevels.map(l => ({ value: String(l), label: `${skillLabels[l]}` }))}
                          selected={stationFilters[s.id] ?? new Set()}
                          onChange={(next) => setStationFilters(prev => ({ ...prev, [s.id]: next }))}
                          onHide={() => saveHiddenColumns(new Set([...hiddenColumns, s.id]))}
                        />
                      </span>
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
              {visibleRows.map((row) => {
                const i = row.originalIndex
                return (
                  <tr key={row.id ?? `new_${i}`}
                    draggable={hasEditAccess && !!row.id && !hasFilters && !matrixSort.col}
                    onDragStart={hasEditAccess ? () => handleRowDragStart(i) : undefined}
                    onDragOver={hasEditAccess ? (e) => handleRowDragOver(e, i) : undefined}
                    onDrop={hasEditAccess ? () => handleRowDrop(i) : undefined}
                    onDragEnd={hasEditAccess ? () => { setDragRowIdx(null); setDragOverRowIdx(null) } : undefined}
                    className={`border-b border-gray-100 transition-colors ${
                      row.isLead ? 'bg-amber-50/40' : (!row.isPresent && row.id ? 'bg-gray-50 opacity-60' : 'hover:bg-gray-50/50')
                    } ${dragOverRowIdx === i && dragRowIdx !== i ? 'border-t-2 border-t-indigo-400' : ''}`}
                  >
                    <td className="pl-2 pr-0 py-2 w-6">
                      {hasEditAccess && row.id && !hasFilters && !matrixSort.col && (
                        <span className="text-gray-300 cursor-grab active:cursor-grabbing text-sm select-none">⠿</span>
                      )}
                    </td>

                    {!hiddenColumns.has('present') && (
                      <td className="px-3 py-2 text-center">
                        <input type="checkbox" checked={row.isPresent}
                          onChange={hasEditAccess ? () => handleAbsenceToggle(i) : undefined}
                          disabled={!hasEditAccess}
                          className={`w-4 h-4 accent-indigo-600 ${hasEditAccess ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`} />
                      </td>
                    )}

                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        {hasEditAccess ? (
                          <>
                            <button
                              onClick={() => updateRow(i, { isLead: !row.isLead })}
                              title={row.isLead ? 'Remove lead status' : 'Mark as team lead'}
                              className="flex-shrink-0 text-base leading-none transition-opacity hover:opacity-60"
                              style={{ opacity: row.isLead ? 1 : 0.15 }}
                            >
                              👑
                            </button>
                            <input type="text" value={row.name} onChange={(e) => updateRow(i, { name: e.target.value })}
                              placeholder="Employee name"
                              className="flex-1 text-sm bg-transparent outline-none placeholder-gray-300 focus:placeholder-gray-400 min-w-0" />
                            {saving[row.id ?? `new_${i}`] && (
                              <span className="w-3 h-3 border-2 border-gray-200 border-t-indigo-400 rounded-full animate-spin flex-shrink-0" />
                            )}
                            {!row.isHomeDept && (() => {
                              const homeDeptName = departments.find(d => d.id === row.homeDeptId)?.name
                              return homeDeptName ? (
                                <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-500 border border-blue-100 whitespace-nowrap flex-shrink-0">
                                  {homeDeptName}
                                </span>
                              ) : null
                            })()}
                          </>
                        ) : (
                          <>
                            {row.isLead && <span className="flex-shrink-0 text-base leading-none">👑</span>}
                            <span className="text-sm text-gray-900">{row.name}</span>
                            {!row.isHomeDept && (() => {
                              const homeDeptName = departments.find(d => d.id === row.homeDeptId)?.name
                              return homeDeptName ? (
                                <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-500 border border-blue-100 whitespace-nowrap flex-shrink-0">
                                  {homeDeptName}
                                </span>
                              ) : null
                            })()}
                          </>
                        )}
                      </div>
                    </td>

                    <td className="px-3 py-2 whitespace-nowrap overflow-hidden text-ellipsis text-xs text-gray-400">
                      {(() => {
                        const hired = hireDateOf(row)
                        return hired ? formatTenure(hired) : <span className="text-gray-200">—</span>
                      })()}
                    </td>

                    <td className="px-3 py-2 whitespace-nowrap overflow-hidden text-ellipsis text-xs text-gray-400">
                      <LastUpdatedCell info={lastUpdatedInfo(row.id)} />
                    </td>

                    {!hiddenColumns.has('certification') && (
                      <td className="px-3 py-2">
                        {hasEditAccess ? (
                          <select value={row.certLevel} onChange={(e) => updateRow(i, { certLevel: Number(e.target.value) })}
                            className="w-full text-sm bg-transparent outline-none cursor-pointer">
                            {certLevels.map((l) => (
                              <option key={l} value={l}>{certLabels[l]}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-sm text-gray-600">{certLabels[row.certLevel]}</span>
                        )}
                      </td>
                    )}

                    {!hiddenColumns.has('group') && (
                      <td className="py-0 px-0">
                        <GroupCell row={row} rowIndex={i} groups={groups}
                          onToggleGroup={handleToggleGroup} onSaveGroups={saveGroups}
                          readOnly={!hasEditAccess} />
                      </td>
                    )}

                    {localStations.map((s) => {
                      if (hiddenColumns.has(s.id)) return null
                      const level = row.competencies[s.id] ?? 0
                      const maxLevel = skillLevels[skillLevels.length - 1]
                      return (
                        <td key={s.id} className="px-2 py-1.5 text-center"
                          style={displayMode === 'text' ? { backgroundColor: competencyColors[level], color: contrastColor(competencyColors[level]) } : undefined}>
                          {hasEditAccess ? (
                            displayMode === 'circle' ? (
                              <div className="relative flex items-center justify-center">
                                <CompetencyCircle level={level} maxLevel={maxLevel} color={circleColor(competencyColors[level])} />
                                <select value={level}
                                  onChange={(e) => updateRow(i, { competencies: { ...row.competencies, [s.id]: Number(e.target.value) } })}
                                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full">
                                  {skillLevels.map((l) => <option key={l} value={l}>{l} — {skillLabels[l]}</option>)}
                                </select>
                              </div>
                            ) : (
                              <select value={level}
                                onChange={(e) => updateRow(i, { competencies: { ...row.competencies, [s.id]: Number(e.target.value) } })}
                                className="w-full text-xs bg-transparent outline-none cursor-pointer text-center"
                                style={{ backgroundColor: 'transparent', color: 'inherit' }}>
                                {skillLevels.map((l) => <option key={l} value={l}>{l} — {skillLabels[l]}</option>)}
                              </select>
                            )
                          ) : (
                            displayMode === 'circle' ? (
                              <div className="flex items-center justify-center">
                                <CompetencyCircle level={level} maxLevel={maxLevel} color={circleColor(competencyColors[level])} />
                              </div>
                            ) : (
                              <span className="text-xs" style={{ color: 'inherit' }}>{level} — {skillLabels[level]}</span>
                            )
                          )}
                        </td>
                      )
                    })}

                    <td className="px-2 py-2">
                      {hasEditAccess && (
                        <button onClick={() => handleDeleteRow(i)}
                          className="text-gray-300 hover:text-red-400 transition-colors text-base leading-none" title="Remove employee">
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}

              {hasEditAccess && (
                <tr>
                  <td colSpan={cols.length} className="px-3 py-2">
                    <button onClick={addRow} className="text-sm text-indigo-600 hover:text-indigo-700 font-medium transition-colors">
                      + Add Employee
                    </button>
                    <button onClick={openPicker} className="text-sm text-gray-400 hover:text-indigo-600 font-medium transition-colors ml-3">
                      + Add from another dept
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {pickerOpen && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setPickerOpen(false)} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md mx-4 flex flex-col overflow-hidden max-h-[70vh]">
            <div className="px-4 pt-4 pb-3 border-b border-gray-100">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-semibold text-gray-900">Add Employee from Another Dept</h2>
                <button onClick={() => setPickerOpen(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
              </div>
              <input
                type="text"
                value={pickerSearch}
                onChange={e => setPickerSearch(e.target.value)}
                placeholder="Search by name…"
                autoFocus
                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-400 placeholder-gray-400"
              />
            </div>
            <div className="overflow-y-auto flex-1">
              {(() => {
                const filtered = pickerEmployees.filter(e =>
                  !pickerSearch.trim() || e.name.toLowerCase().includes(pickerSearch.toLowerCase())
                )
                if (filtered.length === 0) return (
                  <p className="text-sm text-gray-400 text-center py-8">No employees found</p>
                )
                return filtered.map(emp => {
                  const homeDeptName = departments.find(d => d.id === emp.department_id)?.name ?? emp.department_id
                  return (
                    <button
                      key={emp.id}
                      onClick={() => handleAddFromDept(emp)}
                      disabled={addingFromDept}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-indigo-50 transition-colors text-left border-b border-gray-50 last:border-0 disabled:opacity-50"
                    >
                      <span className="text-sm font-medium text-gray-900">{emp.name}</span>
                      <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-500 border border-blue-100 whitespace-nowrap ml-3">
                        {homeDeptName}
                      </span>
                    </button>
                  )
                })
              })()}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
