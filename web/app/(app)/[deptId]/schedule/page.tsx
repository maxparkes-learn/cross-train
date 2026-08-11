'use client'

import { useState, useEffect, useRef } from 'react'
import { useApp } from '@/components/AppShell'
import {
  generateSchedule,
  SCENARIOS,
  SCENARIO_DESCRIPTIONS,
  checkEmployeeIsQualified,
} from '@/lib/scheduler'
import type { Assignment, CrossTrainingAssignment } from '@/lib/types'
import {
  fetchAllAssignmentLogs,
  upsertAssignmentLogs,
  upsertCrossTrainingLogs,
  insertAuditLog,
  upsertSetting,
  fetchSetting,
} from '@/lib/db'

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

export default function SchedulePage() {
  const { stations, employees, settings, user, activeDepartment, hasEditAccess, userRole } = useApp()
  const { skillLabels, certLabels } = settings

  const [scenarioName, setScenarioName] = useState('Balanced')
  const [schedule, setSchedule] = useState<Record<string, Assignment> | null>(null)
  const [activeScenario, setActiveScenario] = useState('')
  const [generating, setGenerating] = useState(false)
  const [editMode, setEditMode] = useState(false)
  // employee_id → station_id ('' = unassigned)
  const [gridAssignments, setGridAssignments] = useState<Record<string, string>>({})
  const [ctAssignments, setCtAssignments] = useState<CrossTrainingAssignment[]>([])
  const [finalizeDate, setFinalizeDate] = useState(todayStr())
  const [defaultHours, setDefaultHours] = useState(8)
  const [finalizing, setFinalizing] = useState(false)
  const [finalizeMsg, setFinalizeMsg] = useState('')
  const [finalized, setFinalized] = useState(false)

  type SchedulePreset = { name: string; gridAssignments: Record<string, string> }
  const [presets, setPresets] = useState<SchedulePreset[]>([])
  const [savePresetOpen, setSavePresetOpen] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [loadPresetOpen, setLoadPresetOpen] = useState(false)
  const savePresetRef = useRef<HTMLDivElement>(null)
  const loadPresetRef = useRef<HTMLDivElement>(null)

  const draftLoaded = useRef(false)
  const draftSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load draft + presets on mount
  useEffect(() => {
    if (!activeDepartment?.id) return
    const deptId = activeDepartment.id
    fetchSetting('schedule_draft', deptId).then(v => {
      if (v && typeof v === 'object') {
        const draft = v as {
          date: string
          schedule: Record<string, Assignment> | null
          activeScenario: string
          editMode: boolean
          gridAssignments: Record<string, string>
          ctAssignments: CrossTrainingAssignment[]
          finalized: boolean
        }
        if (draft.date === todayStr() && draft.schedule !== null) {
          setSchedule(draft.schedule)
          setActiveScenario(draft.activeScenario ?? '')
          setEditMode(draft.editMode ?? false)
          setGridAssignments(draft.gridAssignments ?? {})
          setCtAssignments(draft.ctAssignments ?? [])
          setFinalized(draft.finalized ?? false)
        }
      }
      draftLoaded.current = true
    })
    // Load named presets; migrate legacy schedule_default if needed
    fetchSetting('schedule_presets', deptId).then(async v => {
      if (Array.isArray(v)) {
        setPresets(v as SchedulePreset[])
      } else {
        // Migrate old single default
        const old = await fetchSetting('schedule_default', deptId)
        if (old && typeof old === 'object') {
          const migrated: SchedulePreset[] = [{ name: 'Default', gridAssignments: old as Record<string, string> }]
          setPresets(migrated)
          await upsertSetting('schedule_presets', migrated, deptId)
          await upsertSetting('schedule_default', null, deptId)
        }
      }
    })
  }, [activeDepartment?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save draft whenever schedule state changes
  useEffect(() => {
    if (!draftLoaded.current || !activeDepartment?.id) return
    if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current)
    draftSaveTimer.current = setTimeout(() => {
      upsertSetting('schedule_draft', {
        date: todayStr(),
        schedule,
        activeScenario,
        editMode,
        gridAssignments,
        ctAssignments,
        finalized,
      }, activeDepartment.id)
    }, 800)
    return () => { if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current) }
  }, [schedule, activeScenario, editMode, gridAssignments, ctAssignments, finalized, activeDepartment?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const absentIds = new Set(employees.filter((e) => e.is_absent).map((e) => e.id))
  const stationsMap = new Map(stations.map((s) => [s.id, s]))
  const employeesMap = new Map(employees.map((e) => [e.id, e]))
  const presentEmployees = employees.filter((e) => !e.is_absent)

  function buildEmptySchedule(): Record<string, Assignment> {
    const s: Record<string, Assignment> = {}
    for (const station of stations) {
      s[station.id] = { station_id: station.id, assigned_employee_ids: [], is_fully_staffed: false, unfilled_slots: station.required_headcount }
    }
    return s
  }

  function gridToSchedule(grid: Record<string, string>): Record<string, Assignment> {
    const result: Record<string, Assignment> = {}
    for (const station of stations) {
      const ids = presentEmployees.filter((e) => grid[e.id] === station.id).map((e) => e.id)
      result[station.id] = {
        station_id: station.id,
        assigned_employee_ids: ids,
        is_fully_staffed: ids.length >= station.required_headcount,
        unfilled_slots: Math.max(0, station.required_headcount - ids.length),
      }
    }
    return result
  }

  function scheduleToGrid(sched: Record<string, Assignment>): Record<string, string> {
    return Object.fromEntries(
      Object.values(sched).flatMap((a) => a.assigned_employee_ids.map((empId) => [empId, a.station_id]))
    )
  }

  // Click-outside handlers for preset popovers
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (savePresetRef.current && !savePresetRef.current.contains(e.target as Node)) setSavePresetOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (loadPresetRef.current && !loadPresetRef.current.contains(e.target as Node)) setLoadPresetOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSavePreset = async () => {
    const trimmed = presetName.trim()
    if (!trimmed || !schedule || !activeDepartment) return
    const grid = scheduleToGrid(schedule)
    const updated = [...presets.filter(p => p.name !== trimmed), { name: trimmed, gridAssignments: grid }]
    setPresets(updated)
    await upsertSetting('schedule_presets', updated, activeDepartment.id)
    setSavePresetOpen(false)
    setPresetName('')
  }

  const handleLoadPreset = (preset: SchedulePreset) => {
    const validEmpIds = new Set(presentEmployees.map((e) => e.id))
    const validStationIds = new Set(stations.map((s) => s.id))
    const filtered: Record<string, string> = {}
    for (const [empId, stnId] of Object.entries(preset.gridAssignments)) {
      if (validEmpIds.has(empId) && validStationIds.has(stnId)) filtered[empId] = stnId
    }
    setSchedule(buildEmptySchedule())
    setActiveScenario(preset.name)
    setEditMode(true)
    setGridAssignments(filtered)
    setCtAssignments([])
    setFinalized(false)
    setFinalizeMsg('')
    setLoadPresetOpen(false)
  }

  const handleDeletePreset = async (name: string) => {
    if (!activeDepartment) return
    const updated = presets.filter(p => p.name !== name)
    setPresets(updated)
    await upsertSetting('schedule_presets', updated, activeDepartment.id)
  }

  const handleReset = () => {
    setSchedule(null)
    setActiveScenario('')
    setEditMode(false)
    setGridAssignments({})
    setCtAssignments([])
    setFinalized(false)
    setFinalizeMsg('')
  }

  const handleAssignManually = () => {
    setSchedule(buildEmptySchedule())
    setActiveScenario('Manual')
    setEditMode(true)
    setGridAssignments({})
    setCtAssignments([])
    setFinalized(false)
    setFinalizeMsg('')
  }

  const handleGenerate = async () => {
    setGenerating(true)
    setFinalizeMsg('')
    try {
      const logs = await fetchAllAssignmentLogs()
      const newSchedule = generateSchedule(stations, employees, absentIds, logs, scenarioName)
      setSchedule(newSchedule)
      setActiveScenario(scenarioName)
      setEditMode(false)
      setGridAssignments({})
      setCtAssignments([])
      setFinalized(false)
      await insertAuditLog(user.email ?? '', 'Generated schedule', scenarioName)
    } finally {
      setGenerating(false)
    }
  }

  const handleEnterEdit = () => {
    if (!schedule) return
    if (finalized && !confirm(
      `This schedule was already finalized for ${finalizeDate}. Editing will require re-finalizing to update the history log. Continue?`
    )) return
    setGridAssignments(scheduleToGrid(schedule))
    setEditMode(true)
    setFinalized(false)
  }

  const handleApplyGrid = () => {
    setSchedule(gridToSchedule(gridAssignments))
    setEditMode(false)
  }

  const handleToggleCell = (empId: string, stationId: string) => {
    setGridAssignments((prev) => {
      if (prev[empId] === stationId) {
        const next = { ...prev }
        delete next[empId]
        return next
      }
      return { ...prev, [empId]: stationId }
    })
  }

  const handleFinalizeDay = async () => {
    if (!schedule) return
    setFinalizing(true)
    setFinalizeMsg('')
    try {
      const assignLogs = Object.values(schedule).flatMap((a) =>
        a.assigned_employee_ids.map((empId) => ({
          log_date: finalizeDate,
          employee_id: empId,
          station_id: a.station_id,
          hours: defaultHours,
        })),
      )
      const ctLogs = ctAssignments.map((ct) => ({
        log_date: finalizeDate,
        trainer_id: ct.trainer_id,
        trainee_id: ct.trainee_id,
        station_id: ct.station_id,
        hours: defaultHours,
      }))
      await upsertAssignmentLogs(assignLogs)
      if (ctLogs.length > 0) await upsertCrossTrainingLogs(ctLogs)
      await insertAuditLog(user.email ?? '', 'Finalized day', `${finalizeDate} — ${assignLogs.length} assignments`)
      setFinalized(true)
      setFinalizeMsg('')
    } catch (e) {
      setFinalizeMsg(`Error: ${String(e)}`)
    } finally {
      setFinalizing(false)
    }
  }

  const handleGeneratePDF = async () => {
    if (!schedule) return
    const { jsPDF } = await import('jspdf')
    const autoTable = (await import('jspdf-autotable')).default
    const doc = new jsPDF()
    doc.setFontSize(16)
    doc.text('Rotation & Safety Management System', 14, 18)
    doc.setFontSize(11)
    doc.setTextColor(100)
    doc.text(`Schedule — ${finalizeDate}`, 14, 26)
    doc.text(`Strategy: ${activeScenario}`, 14, 33)
    doc.setTextColor(0)
    const rows = Object.values(schedule).map((a) => {
      const station = stationsMap.get(a.station_id)
      const assigned = a.assigned_employee_ids
        .map((id) => { const emp = employeesMap.get(id); if (!emp) return ''; const comp = emp.station_competencies[a.station_id] ?? 0; return `${emp.name} (${skillLabels[comp]})` })
        .join(', ')
      return [station?.name ?? a.station_id, skillLabels[station?.required_skill_level ?? 0], certLabels[station?.required_certification ?? 0], assigned || '—', `${a.assigned_employee_ids.length}/${station?.required_headcount ?? 1}`, a.is_fully_staffed ? 'Staffed' : 'Understaffed']
    })
    autoTable(doc, {
      startY: 40,
      head: [['Station', 'Req. Competency', 'Req. Cert.', 'Assigned', 'Filled', 'Status']],
      body: rows,
      styles: { fontSize: 9 },
      headStyles: { fillColor: [79, 70, 229] },
      didDrawCell: (data) => {
        if (data.column.index === 5 && data.section === 'body') {
          const cell = data.cell
          const text = String(cell.text)
          if (text.includes('Understaffed')) {
            doc.setFillColor(254, 202, 202)
            doc.rect(cell.x, cell.y, cell.width, cell.height, 'F')
            doc.setTextColor(153, 27, 27)
            doc.setFontSize(9)
            doc.text(text, cell.x + 2, cell.y + cell.height / 2 + 1)
            doc.setTextColor(0)
          }
        }
      },
    })
    doc.save(`schedule_${finalizeDate}.pdf`)
  }

  if (!stations.length || !employees.length) {
    return (
      <div className="max-w-xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Schedule</h1>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-700">
          Add stations and employees in the Cross-Training Matrix first.
        </div>
      </div>
    )
  }

  const assignedIds = new Set(schedule ? Object.values(schedule).flatMap((a) => a.assigned_employee_ids) : [])
  const unassignedIds = [...presentEmployees.map((e) => e.id)].filter((id) => !assignedIds.has(id))
  const totalStations = schedule ? Object.keys(schedule).length : 0
  const filledStations = schedule ? Object.values(schedule).filter((a) => a.is_fully_staffed).length : 0
  const understaffedStations = totalStations - filledStations

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Schedule</h1>
        {userRole === 'manager' && (
          <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${
            hasEditAccess ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-500'
          }`}>
            {hasEditAccess ? 'Edit' : 'View only'}
          </span>
        )}
      </div>

      {/* Controls */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="flex flex-wrap items-end gap-3">
          {hasEditAccess && (
            <>
              <div className="flex-1 min-w-48">
                <label className="block text-sm font-medium text-gray-700 mb-1">Scheduling Strategy</label>
                <select
                  value={scenarioName}
                  onChange={(e) => setScenarioName(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {Object.keys(SCENARIOS).map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <button onClick={handleGenerate} disabled={generating} className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors">
                {generating ? 'Generating…' : 'Generate Schedule'}
              </button>
              <button onClick={handleAssignManually} className="border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium px-5 py-2 rounded-lg transition-colors">
                Assign Manually
              </button>
            </>
          )}

          {/* Preset buttons — only when a schedule exists and user has edit access */}
          {schedule && hasEditAccess && (
            <>
              {/* Load Preset */}
              {presets.length > 0 && (
                <div className="relative" ref={loadPresetRef}>
                  <button
                    onClick={() => setLoadPresetOpen(o => !o)}
                    className="border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                  >
                    Load Preset ▼
                  </button>
                  {loadPresetOpen && (
                    <div className="absolute left-0 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
                      {presets.map(p => (
                        <div key={p.name} className="flex items-center gap-1 px-2 py-1 hover:bg-gray-50">
                          <button
                            onClick={() => handleLoadPreset(p)}
                            className="flex-1 text-left text-sm text-gray-700 px-1 py-0.5 truncate"
                          >
                            {p.name}
                          </button>
                          <button
                            onClick={() => handleDeletePreset(p.name)}
                            className="text-gray-300 hover:text-red-500 transition-colors px-1 text-xs flex-shrink-0"
                            title="Delete preset"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Save as Preset */}
              <div className="relative" ref={savePresetRef}>
                <button
                  onClick={() => { setSavePresetOpen(o => !o); setPresetName('') }}
                  className="border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  Save as Preset
                </button>
                {savePresetOpen && (
                  <div className="absolute left-0 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-20 p-3 space-y-2">
                    <input
                      autoFocus
                      type="text"
                      value={presetName}
                      onChange={e => setPresetName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleSavePreset(); if (e.key === 'Escape') setSavePresetOpen(false) }}
                      placeholder="e.g. Monday AM"
                      className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <button
                      onClick={handleSavePreset}
                      disabled={!presetName.trim()}
                      className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-medium px-3 py-1.5 rounded-md transition-colors"
                    >
                      Save
                    </button>
                  </div>
                )}
              </div>

              <button onClick={handleReset} className="border border-red-200 hover:bg-red-50 text-red-500 text-sm font-medium px-5 py-2 rounded-lg transition-colors ml-auto">
                Reset ×
              </button>
            </>
          )}
        </div>
        {hasEditAccess && (
          <div className="mt-2">
            <p className="text-xs text-gray-500">{SCENARIO_DESCRIPTIONS[scenarioName]}</p>
          </div>
        )}
      </div>

      {schedule && (
        <>
          {/* Finalized banner */}
          {finalized && (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700">
              <span className="text-green-500 font-bold">✓</span>
              <span>Finalized for <strong>{finalizeDate}</strong> — {Object.values(schedule).reduce((n, a) => n + a.assigned_employee_ids.length, 0)} assignments recorded.</span>
              <span className="ml-auto text-xs text-green-500">Click &quot;Edit Assignments&quot; to make changes</span>
            </div>
          )}

          {/* Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Total Stations', value: totalStations },
              { label: 'Fully Staffed', value: filledStations, good: true },
              { label: 'Understaffed', value: understaffedStations, bad: understaffedStations > 0 },
              { label: 'Unassigned', value: unassignedIds.length },
            ].map((m) => (
              <div key={m.label} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                <p className="text-xs text-gray-500">{m.label}</p>
                <p className={`text-2xl font-bold ${m.bad ? 'text-red-600' : m.good ? 'text-green-600' : 'text-gray-900'}`}>{m.value}</p>
              </div>
            ))}
          </div>

          {/* Assignments table */}
          {!editMode && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-gray-900">Assignments</h2>
                  {activeScenario === 'Manual' && <p className="text-xs text-gray-500">Manually assigned</p>}
                  {activeScenario && activeScenario !== 'Manual' && Object.keys(SCENARIOS).includes(activeScenario) && (
                    <p className="text-xs text-gray-500">Strategy: {activeScenario}</p>
                  )}
                  {activeScenario && activeScenario !== 'Manual' && !Object.keys(SCENARIOS).includes(activeScenario) && (
                    <p className="text-xs text-gray-500">Preset: {activeScenario}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button onClick={handleGeneratePDF} className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 text-gray-600 hover:bg-gray-50 transition-colors">
                    Download PDF
                  </button>
                  {hasEditAccess && (
                    <button onClick={handleEnterEdit} className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 text-gray-600 hover:bg-gray-50 transition-colors">
                      Edit Assignments
                    </button>
                  )}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="px-4 py-2.5 text-left font-medium text-gray-600">Station</th>
                      <th className="px-4 py-2.5 text-left font-medium text-gray-600">Req. Competency</th>
                      <th className="px-4 py-2.5 text-left font-medium text-gray-600">Req. Cert.</th>
                      <th className="px-4 py-2.5 text-left font-medium text-gray-600">Assigned</th>
                      <th className="px-4 py-2.5 text-center font-medium text-gray-600">Filled</th>
                      <th className="px-4 py-2.5 text-center font-medium text-gray-600">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.values(schedule).map((a) => {
                      const station = stationsMap.get(a.station_id)
                      if (!station) return null
                      const assignedNames = a.assigned_employee_ids.map((id) => {
                        const emp = employeesMap.get(id)
                        if (!emp) return null
                        const comp = emp.station_competencies[a.station_id] ?? 0
                        return `${emp.name} (C:${comp}, ${certLabels[emp.certification_level]})`
                      }).filter(Boolean).join(', ')
                      return (
                        <tr key={a.station_id} className="border-b border-gray-100 hover:bg-gray-50/50">
                          <td className="px-4 py-2.5 font-medium">{station.name}</td>
                          <td className="px-4 py-2.5 text-gray-600">{skillLabels[station.required_skill_level]}</td>
                          <td className="px-4 py-2.5 text-gray-600">{certLabels[station.required_certification]}</td>
                          <td className="px-4 py-2.5 text-gray-600">{assignedNames || '—'}</td>
                          <td className="px-4 py-2.5 text-center">{a.assigned_employee_ids.length}/{station.required_headcount}</td>
                          <td className="px-4 py-2.5 text-center">
                            {a.is_fully_staffed
                              ? <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-medium">✓ Staffed</span>
                              : <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-medium">⚠ Understaffed</span>
                            }
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Assignment grid */}
          {editMode && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-gray-900">Assign Employees</h2>
                  <p className="text-xs text-gray-500">Click a cell to assign · grayed = unqualified or already assigned</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={handleApplyGrid} className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors">
                    Apply Changes
                  </button>
                  <button onClick={() => setEditMode(false)} className="text-sm text-gray-500 hover:text-gray-700 px-1">
                    Cancel
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="px-4 py-2.5 text-left font-medium text-gray-600 min-w-[140px] sticky left-0 bg-gray-50">Employee</th>
                      <th className="px-3 py-2.5 text-left font-medium text-gray-600 whitespace-nowrap">Cert.</th>
                      {stations.map((s) => (
                        <th key={s.id} className="px-3 py-2.5 text-center font-medium text-gray-600 whitespace-nowrap min-w-[90px]">
                          <div className="flex flex-col items-center gap-0.5">
                            <span>{s.name}</span>
                            <span className="text-xs font-normal text-gray-400">need {s.required_headcount}</span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {presentEmployees.map((emp) => {
                      const assignedStation = gridAssignments[emp.id]
                      return (
                        <tr key={emp.id} className="border-b border-gray-100 hover:bg-gray-50/30">
                          <td className="px-4 py-2 font-medium text-gray-900 sticky left-0 bg-white">{emp.name}</td>
                          <td className="px-3 py-2 text-gray-500 text-xs whitespace-nowrap">{certLabels[emp.certification_level]}</td>
                          {stations.map((s) => {
                            const isAssignedHere = assignedStation === s.id
                            const isAssignedElsewhere = assignedStation && assignedStation !== s.id
                            const isQualified = checkEmployeeIsQualified(emp, s)
                            const isDisabled = !isQualified || !!isAssignedElsewhere

                            return (
                              <td key={s.id} className="px-2 py-1.5 text-center">
                                <button
                                  disabled={isDisabled}
                                  onClick={() => handleToggleCell(emp.id, s.id)}
                                  title={
                                    isAssignedElsewhere
                                      ? `Assigned to ${stationsMap.get(assignedStation!)?.name}`
                                      : !isQualified
                                      ? 'Not qualified for this station'
                                      : isAssignedHere
                                      ? 'Click to unassign'
                                      : 'Click to assign'
                                  }
                                  className={`w-8 h-8 rounded-full border-2 transition-colors mx-auto flex items-center justify-center ${
                                    isAssignedHere
                                      ? 'bg-indigo-600 border-indigo-600 text-white'
                                      : isDisabled
                                      ? 'border-gray-100 bg-gray-50 cursor-not-allowed'
                                      : 'border-gray-300 hover:border-indigo-400 hover:bg-indigo-50 cursor-pointer'
                                  }`}
                                >
                                  {isAssignedHere && <span className="text-xs font-bold">✓</span>}
                                </button>
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })}
                    {/* Headcount footer */}
                    <tr className="border-t border-gray-200 bg-gray-50">
                      <td className="px-4 py-2 text-xs font-medium text-gray-500 sticky left-0 bg-gray-50" colSpan={2}>Filled</td>
                      {stations.map((s) => {
                        const count = presentEmployees.filter((e) => gridAssignments[e.id] === s.id).length
                        const full = count >= s.required_headcount
                        return (
                          <td key={s.id} className="px-2 py-2 text-center text-xs font-medium">
                            <span className={full ? 'text-green-600' : count > 0 ? 'text-amber-600' : 'text-gray-400'}>
                              {count}/{s.required_headcount}
                            </span>
                          </td>
                        )
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Cross-training assignments */}
          {!editMode && hasEditAccess && unassignedIds.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4">
              <div>
                <h2 className="font-semibold text-gray-900">Cross-Training Assignments</h2>
                <p className="text-xs text-gray-500">Assign unassigned employees to train on-line staff at their station</p>
              </div>
              {unassignedIds.map((empId) => {
                const emp = employeesMap.get(empId)
                if (!emp) return null
                const recs = Object.values(schedule).flatMap((a) => {
                  const trainerComp = emp.station_competencies[a.station_id] ?? 0
                  if (trainerComp === 0) return []
                  return a.assigned_employee_ids.flatMap((assignedId) => {
                    const assignedEmp = employeesMap.get(assignedId)
                    if (!assignedEmp) return []
                    const assignedComp = assignedEmp.station_competencies[a.station_id] ?? 0
                    if (trainerComp > assignedComp) {
                      return [{ station_id: a.station_id, station_name: stationsMap.get(a.station_id)?.name ?? '', trainee_id: assignedId, trainee_name: assignedEmp.name, trainee_level: assignedComp, trainer_level: trainerComp }]
                    }
                    return []
                  })
                })
                const claimedTrainees = new Map(ctAssignments.map((ct) => [ct.trainee_id, ct.trainer_id]))
                const currentCt = ctAssignments.find((ct) => ct.trainer_id === empId)
                const availableRecs = recs.filter((r) => { const claimed = claimedTrainees.get(r.trainee_id); return !claimed || claimed === empId })
                return (
                  <div key={empId} className="border border-gray-100 rounded-lg p-4">
                    <p className="font-medium text-gray-900 mb-2">{emp.name} <span className="text-xs text-gray-400 font-normal">({certLabels[emp.certification_level]})</span></p>
                    {availableRecs.length === 0 ? (
                      <p className="text-sm text-gray-400">No cross-training opportunities available</p>
                    ) : (
                      <select
                        value={currentCt ? `${currentCt.trainee_id}__${currentCt.station_id}` : ''}
                        onChange={(e) => {
                          const val = e.target.value
                          setCtAssignments((prev) => {
                            const filtered = prev.filter((ct) => ct.trainer_id !== empId)
                            if (!val) return filtered
                            const [traineeId, stationId] = val.split('__')
                            const rec = recs.find((r) => r.trainee_id === traineeId && r.station_id === stationId)
                            if (!rec) return filtered
                            return [...filtered, { trainer_id: empId, trainer_name: emp.name, trainee_id: rec.trainee_id, trainee_name: rec.trainee_name, station_id: rec.station_id, station_name: rec.station_name }]
                          })
                        }}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      >
                        <option value="">— Not assigned —</option>
                        {availableRecs.map((r) => (
                          <option key={`${r.trainee_id}__${r.station_id}`} value={`${r.trainee_id}__${r.station_id}`}>
                            Train {r.trainee_name} at {r.station_name} ({skillLabels[r.trainee_level]} → {skillLabels[r.trainer_level]})
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )
              })}
              {ctAssignments.length > 0 && (
                <div className="border border-gray-100 rounded-lg overflow-hidden">
                  <div className="px-4 py-2 bg-gray-50 text-xs font-medium text-gray-600">Active Cross-Training Pairings</div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="px-4 py-2 text-left font-medium text-gray-600">Trainer</th>
                        <th className="px-4 py-2 text-left font-medium text-gray-600">Trainee</th>
                        <th className="px-4 py-2 text-left font-medium text-gray-600">Station</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ctAssignments.map((ct) => (
                        <tr key={`${ct.trainer_id}_${ct.trainee_id}`} className="border-b border-gray-100">
                          <td className="px-4 py-2">{ct.trainer_name}</td>
                          <td className="px-4 py-2">{ct.trainee_name}</td>
                          <td className="px-4 py-2">{ct.station_name}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Finalize day */}
          {!editMode && hasEditAccess && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4">
              <div>
                <h2 className="font-semibold text-gray-900">Finalize Day</h2>
                <p className="text-xs text-gray-500">
                  {finalized ? 'Re-submit to update the history log with any changes' : 'Commit today\'s assignments to the rotation history log'}
                </p>
              </div>
              <div className="flex flex-wrap gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                  <input type="date" value={finalizeDate} onChange={(e) => setFinalizeDate(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Default shift hours</label>
                  <input type="number" min={0.5} max={24} step={0.5} value={defaultHours} onChange={(e) => setDefaultHours(Number(e.target.value))} className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-24 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
              {finalizeMsg && (
                <div className={`p-3 rounded-lg text-sm ${finalizeMsg.startsWith('Error') ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-green-50 border border-green-200 text-green-700'}`}>
                  {finalizeMsg}
                </div>
              )}
              <button onClick={handleFinalizeDay} disabled={finalizing} className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors">
                {finalizing ? 'Finalizing…' : finalized ? 'Re-Finalize Day' : 'Finalize Day'}
              </button>
            </div>
          )}
        </>
      )}

      {!schedule && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-700">
          {hasEditAccess
            ? 'Click "Generate Schedule" to assign employees to stations, or use "Assign Manually" to build one from scratch.'
            : 'No schedule has been generated for today yet.'}
        </div>
      )}
    </div>
  )
}
