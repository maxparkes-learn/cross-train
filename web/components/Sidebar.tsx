'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import type { Station, AppSettings, Department, UserRole } from '@/lib/types'
import { DEFAULT_SKILL_LABELS, DEFAULT_CERT_LABELS, DEFAULT_COMPETENCY_COLORS } from '@/lib/types'
import {
  upsertStation,
  deleteStation,
  reorderStations,
  generateId,
  upsertSetting,
  createDepartment,
  deleteDepartment,
  renameDepartment,
} from '@/lib/db'

interface NavItem { href: string; label: string; icon: string }

interface SidebarProps {
  navItems: NavItem[]
  pathname: string
  stations: Station[]
  settings: AppSettings
  user: User
  userRole: UserRole
  departments: Department[]
  activeDepartment: Department | null
  activeDeptId: string
  onSignOut: () => void
  onStationsChange: () => Promise<void>
  onSettingsChange: (s: AppSettings) => void
  onDepartmentsChange: () => Promise<void>
  collapsed: boolean
  onToggleCollapsed: () => void
  canTogglePreview?: boolean
  previewAsManager?: boolean
  onTogglePreview?: () => void
  pendingUserCount?: number
}

export default function Sidebar({
  navItems,
  pathname,
  stations,
  settings,
  user,
  userRole,
  departments,
  activeDepartment,
  activeDeptId,
  onSignOut,
  onStationsChange,
  onSettingsChange,
  onDepartmentsChange,
  collapsed,
  onToggleCollapsed,
  canTogglePreview = false,
  previewAsManager = false,
  onTogglePreview,
  pendingUserCount = 0,
}: SidebarProps) {
  const router = useRouter()
  const isAdmin = userRole === 'admin' || userRole === 'superadmin'
  const isSuperAdmin = userRole === 'superadmin'

  // Panel open states
  const [stationsOpen, setStationsOpen] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [deptsOpen, setDeptsOpen] = useState(false)

  // Station drag-to-reorder
  const [localStations, setLocalStations] = useState(stations)
  const isDraggingStn = useRef(false)
  const [dragStnIdx, setDragStnIdx] = useState<number | null>(null)
  const [dragOverStnIdx, setDragOverStnIdx] = useState<number | null>(null)

  useEffect(() => {
    if (!isDraggingStn.current) setLocalStations(stations)
  }, [stations])

  // Add station form
  const [newName, setNewName] = useState('')
  const [newSkill, setNewSkill] = useState(0)
  const [newCert, setNewCert] = useState(0)
  const [newHeadcount, setNewHeadcount] = useState(1)
  const [adding, setAdding] = useState(false)

  // Edit station
  const [editingStationId, setEditingStationId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editSkill, setEditSkill] = useState(0)
  const [editCert, setEditCert] = useState(0)
  const [editHeadcount, setEditHeadcount] = useState(1)
  const [savingStation, setSavingStation] = useState(false)

  // Settings form
  const [localSkillLabels, setLocalSkillLabels] = useState<Record<number, string>>(() => ({ ...settings.skillLabels }))
  const [localCertLabels, setLocalCertLabels] = useState<Record<number, string>>(() => ({ ...settings.certLabels }))
  const [localColors, setLocalColors] = useState<Record<number, string>>(() => ({ ...settings.competencyColors }))
  const [saving, setSaving] = useState(false)

  // Add department form
  const [newDeptName, setNewDeptName] = useState('')
  const [addingDept, setAddingDept] = useState(false)

  // Edit department name
  const [editingDeptId, setEditingDeptId] = useState<string | null>(null)
  const [editDeptName, setEditDeptName] = useState('')
  const [savingDept, setSavingDept] = useState(false)

  // Sync local settings when dept changes
  useEffect(() => {
    setLocalSkillLabels({ ...settings.skillLabels })
    setLocalCertLabels({ ...settings.certLabels })
    setLocalColors({ ...settings.competencyColors })
  }, [settings])

  // Derived sorted level arrays
  const skillLevels = Object.keys(localSkillLabels).map(Number).sort((a, b) => a - b)
  const certLevels = Object.keys(localCertLabels).map(Number).sort((a, b) => a - b)
  const settingsSkillLevels = Object.keys(settings.skillLabels).map(Number).sort((a, b) => a - b)
  const settingsCertLevels = Object.keys(settings.certLabels).map(Number).sort((a, b) => a - b)

  const handleStnDragStart = (i: number) => { isDraggingStn.current = true; setDragStnIdx(i) }
  const handleStnDragOver = (e: React.DragEvent, i: number) => { e.preventDefault(); setDragOverStnIdx(i) }
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

  const handleAddStation = async () => {
    if (!newName.trim()) return
    setAdding(true)
    try {
      await upsertStation(
        { id: generateId('stn'), name: newName.trim(), required_skill_level: newSkill, required_certification: newCert, required_headcount: newHeadcount },
        activeDeptId,
      )
      setNewName(''); setNewSkill(0); setNewCert(0); setNewHeadcount(1)
      await onStationsChange()
    } finally {
      setAdding(false)
    }
  }

  const handleStartEditStation = (s: Station) => {
    setEditingStationId(s.id)
    setEditName(s.name)
    setEditSkill(s.required_skill_level)
    setEditCert(s.required_certification)
    setEditHeadcount(s.required_headcount)
  }

  const handleSaveStation = async () => {
    if (!editName.trim() || !editingStationId) return
    setSavingStation(true)
    try {
      await upsertStation(
        { id: editingStationId, name: editName.trim(), required_skill_level: editSkill, required_certification: editCert, required_headcount: editHeadcount },
        activeDeptId,
      )
      setEditingStationId(null)
      await onStationsChange()
    } finally {
      setSavingStation(false)
    }
  }

  const handleDeleteStation = async (id: string) => {
    if (!confirm('Delete this station? This will also remove all competency data for this station.')) return
    await deleteStation(id)
    await onStationsChange()
  }

  const handleSaveSettings = async () => {
    setSaving(true)
    try {
      await Promise.all([
        upsertSetting('skill_labels', localSkillLabels, activeDeptId),
        upsertSetting('cert_labels', localCertLabels, activeDeptId),
        upsertSetting('competency_colors', localColors, activeDeptId),
      ])
      onSettingsChange({ skillLabels: { ...localSkillLabels }, certLabels: { ...localCertLabels }, competencyColors: { ...localColors } })
    } finally {
      setSaving(false)
    }
  }

  const handleResetSettings = async () => {
    const reset = { skillLabels: { ...DEFAULT_SKILL_LABELS }, certLabels: { ...DEFAULT_CERT_LABELS }, competencyColors: { ...DEFAULT_COMPETENCY_COLORS } }
    setLocalSkillLabels({ ...DEFAULT_SKILL_LABELS })
    setLocalCertLabels({ ...DEFAULT_CERT_LABELS })
    setLocalColors({ ...DEFAULT_COMPETENCY_COLORS })
    await Promise.all([
      upsertSetting('skill_labels', reset.skillLabels, activeDeptId),
      upsertSetting('cert_labels', reset.certLabels, activeDeptId),
      upsertSetting('competency_colors', reset.competencyColors, activeDeptId),
    ])
    onSettingsChange(reset)
  }

  const handleAddSkillLevel = () => {
    const next = Math.max(...skillLevels) + 1
    setLocalSkillLabels((p) => ({ ...p, [next]: `Level ${next}` }))
    setLocalColors((p) => ({ ...p, [next]: '#B8D4F8' }))
  }

  const handleRemoveSkillLevel = (l: number) => {
    if (l === 0) return
    setLocalSkillLabels((p) => { const n = { ...p }; delete n[l]; return n })
    setLocalColors((p) => { const n = { ...p }; delete n[l]; return n })
  }

  const handleAddCertLevel = () => {
    const next = Math.max(...certLevels) + 1
    setLocalCertLabels((p) => ({ ...p, [next]: `Level ${next}` }))
  }

  const handleRemoveCertLevel = (l: number) => {
    if (l === 0) return
    setLocalCertLabels((p) => { const n = { ...p }; delete n[l]; return n })
  }

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

  // ---- Collapsed view ----

  if (collapsed) {
    return (
      <div className="flex flex-col h-full items-center py-3 gap-1">
        <button
          onClick={onToggleCollapsed}
          title="Expand sidebar"
          className="w-10 h-10 flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors mb-1"
        >
          <span className="text-lg">🏭</span>
        </button>

        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            title={item.label}
            className={`relative w-10 h-10 flex items-center justify-center rounded-lg text-lg transition-colors ${
              pathname.startsWith(item.href)
                ? 'bg-white/10 text-white'
                : 'text-gray-400 hover:bg-white/5 hover:text-white'
            }`}
          >
            {item.icon}
            {item.label === 'Users' && pendingUserCount > 0 && (
              <span className="absolute top-1 right-1 w-2 h-2 bg-amber-400 rounded-full" />
            )}
          </Link>
        ))}

        <div className="mt-auto">
          <button
            onClick={onSignOut}
            title="Sign out"
            className="w-10 h-10 flex items-center justify-center rounded-lg text-gray-500 hover:text-white hover:bg-white/10 transition-colors text-sm"
          >
            ↪
          </button>
        </div>
      </div>
    )
  }

  // ---- Expanded view ----

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-5 py-4 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <span className="text-xl">🏭</span>
          <span className="font-semibold text-sm leading-tight flex-1">
            Rotation &amp; Safety
            <br />
            <span className="text-gray-400 text-xs font-normal">Management System</span>
          </span>
          <button
            onClick={onToggleCollapsed}
            title="Collapse sidebar"
            className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-gray-500 hover:text-white hover:bg-white/10 transition-colors text-xs"
          >
            ‹
          </button>
        </div>
      </div>

      {/* Department switcher */}
      <div className="px-4 py-3 border-b border-gray-800">
        <label className="text-xs text-gray-500 uppercase tracking-wider">Department</label>
        <select
          value={activeDeptId}
          onChange={(e) => router.push(`/${e.target.value}/matrix`)}
          className="mt-1 w-full bg-gray-800 text-white text-sm rounded-lg px-3 py-2 border border-gray-600 focus:outline-none focus:border-gray-400"
        >
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </div>

      {/* Nav */}
      <nav className="px-3 py-3 space-y-0.5">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
              pathname === item.href
                ? 'bg-white/10 text-white font-medium'
                : 'text-gray-400 hover:bg-white/5 hover:text-white'
            }`}
          >
            <span>{item.icon}</span>
            <span className="flex-1">{item.label}</span>
            {item.label === 'Users' && pendingUserCount > 0 && (
              <span className="text-xs font-bold bg-amber-400 text-gray-900 rounded-full px-1.5 py-0.5 leading-none min-w-[18px] text-center">
                {pendingUserCount}
              </span>
            )}
          </Link>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-2">

        {/* Stations */}
        <div className="border border-gray-700 rounded-lg overflow-hidden">
          <button
            onClick={() => setStationsOpen((o) => !o)}
            className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium text-gray-300 hover:text-white"
          >
            <span>🏭 Stations ({localStations.length})</span>
            <span className="text-gray-500">{stationsOpen ? '▲' : '▼'}</span>
          </button>
          {stationsOpen && (
            <div className="px-3 pb-3 space-y-3 border-t border-gray-700 pt-3">
              {localStations.length > 0 && (
                <div className="space-y-1">
                  {localStations.map((s, i) => (
                    <div
                      key={s.id}
                      draggable={editingStationId !== s.id}
                      onDragStart={() => handleStnDragStart(i)}
                      onDragOver={(e) => handleStnDragOver(e, i)}
                      onDrop={() => handleStnDrop(i)}
                      onDragEnd={() => { isDraggingStn.current = false; setDragStnIdx(null); setDragOverStnIdx(null) }}
                      className={dragOverStnIdx === i && dragStnIdx !== i ? 'border-t border-indigo-500' : ''}
                    >
                      {editingStationId === s.id ? (
                        <div className="space-y-2 bg-gray-800/50 rounded p-2">
                          <input
                            type="text" value={editName} onChange={(e) => setEditName(e.target.value)}
                            autoFocus
                            className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-gray-400"
                          />
                          <div className="grid grid-cols-2 gap-1.5">
                            <div>
                              <label className="text-xs text-gray-500">Competency</label>
                              <select value={editSkill} onChange={(e) => setEditSkill(Number(e.target.value))}
                                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-white focus:outline-none">
                                {settingsSkillLevels.map((l) => <option key={l} value={l}>{l} - {settings.skillLabels[l]}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="text-xs text-gray-500">Certification</label>
                              <select value={editCert} onChange={(e) => setEditCert(Number(e.target.value))}
                                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-white focus:outline-none">
                                {settingsCertLevels.map((l) => <option key={l} value={l}>{l} - {settings.certLabels[l]}</option>)}
                              </select>
                            </div>
                          </div>
                          <div>
                            <label className="text-xs text-gray-500">Headcount</label>
                            <input type="number" min={1} max={20} value={editHeadcount} onChange={(e) => setEditHeadcount(Number(e.target.value))}
                              className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-white focus:outline-none" />
                          </div>
                          <div className="flex gap-1.5">
                            <button onClick={handleSaveStation} disabled={savingStation || !editName.trim()}
                              className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium rounded py-1 transition-colors">
                              {savingStation ? 'Saving…' : 'Save'}
                            </button>
                            <button onClick={() => setEditingStationId(null)}
                              className="flex-1 bg-gray-700 hover:bg-gray-600 text-white text-xs font-medium rounded py-1 transition-colors">
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between text-xs text-gray-400 group py-0.5">
                          <span className="mr-1 cursor-grab active:cursor-grabbing select-none text-gray-600">⠿</span>
                          <span className="truncate flex-1">{s.name}</span>
                          <div className="flex items-center gap-1 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => handleStartEditStation(s)} className="text-gray-400 hover:text-white">✎</button>
                            <button onClick={() => handleDeleteStation(s.id)} className="text-red-400 hover:text-red-300">✕</button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="space-y-2 pt-1 border-t border-gray-700">
                <p className="text-xs text-gray-500 font-medium">Add Station</p>
                <input
                  type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
                  placeholder="Station name" onKeyDown={(e) => e.key === 'Enter' && handleAddStation()}
                  className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-gray-400"
                />
                <div className="grid grid-cols-2 gap-1.5">
                  <div>
                    <label className="text-xs text-gray-500">Competency</label>
                    <select value={newSkill} onChange={(e) => setNewSkill(Number(e.target.value))}
                      className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-white focus:outline-none">
                      {settingsSkillLevels.map((l) => <option key={l} value={l}>{l} - {settings.skillLabels[l]}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Certification</label>
                    <select value={newCert} onChange={(e) => setNewCert(Number(e.target.value))}
                      className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-white focus:outline-none">
                      {settingsCertLevels.map((l) => <option key={l} value={l}>{l} - {settings.certLabels[l]}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Headcount</label>
                  <input type="number" min={1} max={20} value={newHeadcount} onChange={(e) => setNewHeadcount(Number(e.target.value))}
                    className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-white focus:outline-none" />
                </div>
                <button onClick={handleAddStation} disabled={adding || !newName.trim()}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium rounded py-1.5 transition-colors">
                  {adding ? 'Adding…' : '+ Add Station'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Settings */}
        <div className="border border-gray-700 rounded-lg overflow-hidden">
          <button onClick={() => setSettingsOpen((o) => !o)}
            className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium text-gray-300 hover:text-white">
            <span>⚙️ Settings</span>
            <span className="text-gray-500">{settingsOpen ? '▲' : '▼'}</span>
          </button>
          {settingsOpen && (
            <div className="px-3 pb-3 space-y-4 border-t border-gray-700 pt-3">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-gray-400 font-medium">Competency Labels</p>
                  <button onClick={handleAddSkillLevel} className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">+ Add</button>
                </div>
                {skillLevels.map((l) => (
                  <div key={l} className="flex items-center gap-2 mb-1 group">
                    <span className="text-xs text-gray-500 w-5">{l}</span>
                    <input value={localSkillLabels[l] ?? ''} onChange={(e) => setLocalSkillLabels((p) => ({ ...p, [l]: e.target.value }))}
                      className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-white focus:outline-none" />
                    {l > 0 && (
                      <button onClick={() => handleRemoveSkillLevel(l)} className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 text-xs transition-opacity">✕</button>
                    )}
                  </div>
                ))}
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-gray-400 font-medium">Certification Labels</p>
                  <button onClick={handleAddCertLevel} className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">+ Add</button>
                </div>
                {certLevels.map((l) => (
                  <div key={l} className="flex items-center gap-2 mb-1 group">
                    <span className="text-xs text-gray-500 w-5">{l}</span>
                    <input value={localCertLabels[l] ?? ''} onChange={(e) => setLocalCertLabels((p) => ({ ...p, [l]: e.target.value }))}
                      className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-white focus:outline-none" />
                    {l > 0 && (
                      <button onClick={() => handleRemoveCertLevel(l)} className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 text-xs transition-opacity">✕</button>
                    )}
                  </div>
                ))}
              </div>
              <div>
                <p className="text-xs text-gray-400 font-medium mb-2">Competency Colors</p>
                {skillLevels.map((l) => (
                  <div key={l} className="flex items-center gap-2 mb-1">
                    <span className="text-xs text-gray-500 w-5">{l}</span>
                    <input type="color" value={localColors[l] ?? '#E8E8E8'} onChange={(e) => setLocalColors((p) => ({ ...p, [l]: e.target.value }))}
                      className="w-8 h-6 rounded border border-gray-600 cursor-pointer bg-transparent" />
                    <span className="flex-1 h-6 rounded text-xs flex items-center px-2" style={{ backgroundColor: localColors[l] }}>
                      {localSkillLabels[l]}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <button onClick={handleSaveSettings} disabled={saving}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium rounded py-1.5 transition-colors">
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button onClick={handleResetSettings}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 text-white text-xs font-medium rounded py-1.5 transition-colors">
                  Reset
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Departments (admin only) */}
        {isAdmin && (
          <div className="border border-gray-700 rounded-lg overflow-hidden">
            <button onClick={() => setDeptsOpen((o) => !o)}
              className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium text-gray-300 hover:text-white">
              <span>🏢 Departments</span>
              <span className="text-gray-500">{deptsOpen ? '▲' : '▼'}</span>
            </button>
            {deptsOpen && (
              <div className="px-3 pb-3 space-y-3 border-t border-gray-700 pt-3">
                {departments.length > 0 && (
                  <div className="space-y-1">
                    {departments.map((d) => (
                      <div key={d.id}>
                        {editingDeptId === d.id ? (
                          <div className="flex items-center gap-1">
                            <input
                              autoFocus
                              value={editDeptName}
                              onChange={(e) => setEditDeptName(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveRenameDept(); if (e.key === 'Escape') setEditingDeptId(null) }}
                              className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-gray-400"
                            />
                            <button onClick={handleSaveRenameDept} disabled={savingDept || !editDeptName.trim()}
                              className="text-indigo-400 hover:text-indigo-300 disabled:opacity-50 text-xs">✓</button>
                            <button onClick={() => setEditingDeptId(null)} className="text-gray-500 hover:text-gray-300 text-xs">✕</button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between text-xs text-gray-400 group">
                            <span className={`truncate flex-1 ${d.id === activeDeptId ? 'text-white font-medium' : ''}`}>{d.name}</span>
                            <div className="flex items-center gap-1 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => handleStartEditDept(d)} className="text-gray-400 hover:text-white">✎</button>
                              {departments.length > 1 && (
                                <button onClick={() => handleDeleteDepartment(d)} className="text-red-400 hover:text-red-300">✕</button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <div className="space-y-2 pt-1 border-t border-gray-700">
                  <p className="text-xs text-gray-500 font-medium">Add Department</p>
                  <input type="text" value={newDeptName} onChange={(e) => setNewDeptName(e.target.value)}
                    placeholder="Department name" onKeyDown={(e) => e.key === 'Enter' && handleAddDepartment()}
                    className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-gray-400" />
                  <button onClick={handleAddDepartment} disabled={addingDept || !newDeptName.trim()}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium rounded py-1.5 transition-colors">
                    {addingDept ? 'Adding…' : '+ Add Department'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

      </div>

      {/* User footer */}
      <div className="px-4 py-3 border-t border-gray-800 space-y-2">
        {canTogglePreview && (
          <button
            onClick={onTogglePreview}
            className={`w-full text-left text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
              previewAsManager
                ? 'bg-amber-500/20 border-amber-500/40 text-amber-300 hover:bg-amber-500/30'
                : 'border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-600'
            }`}
          >
            {previewAsManager ? '✕ Exit Manager Preview' : '👁 Preview as Manager'}
          </button>
        )}
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <span className="text-xs text-gray-400 truncate block">{user.email}</span>
            <span className={`text-xs ${
              isSuperAdmin ? 'text-amber-400' : userRole === 'admin' ? 'text-indigo-400' : 'text-gray-600'
            }`}>
              {previewAsManager ? 'Manager (preview)' : userRole === 'superadmin' ? 'Superadmin' : userRole === 'admin' ? 'Admin' : 'Manager'}
            </span>
          </div>
          <button onClick={onSignOut}
            className="text-xs text-gray-500 hover:text-white transition-colors ml-2 shrink-0">
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
