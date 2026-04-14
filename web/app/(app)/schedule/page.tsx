'use client'

import { useState } from 'react'
import { useApp } from '@/components/AppShell'
import {
  generateSchedule,
  applyOverrides,
  buildRotationStats,
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
} from '@/lib/db'

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

export default function SchedulePage() {
  const { stations, employees, settings, user } = useApp()
  const { skillLabels, certLabels } = settings

  const [scenarioName, setScenarioName] = useState('Balanced')
  const [schedule, setSchedule] = useState<Record<string, Assignment> | null>(null)
  const [activeScenario, setActiveScenario] = useState('')
  const [generating, setGenerating] = useState(false)
  const [overrideMode, setOverrideMode] = useState(false)
  const [overrides, setOverrides] = useState<Record<string, Record<number, string>>>({})
  const [ctAssignments, setCtAssignments] = useState<CrossTrainingAssignment[]>([])
  const [finalizeDate, setFinalizeDate] = useState(todayStr())
  const [defaultHours, setDefaultHours] = useState(8)
  const [finalizing, setFinalizing] = useState(false)
  const [finalizeMsg, setFinalizeMsg] = useState('')
  const [applyError, setApplyError] = useState<string[]>([])

  const absentIds = new Set(employees.filter((e) => e.is_absent).map((e) => e.id))
  const stationsMap = new Map(stations.map((s) => [s.id, s]))
  const employeesMap = new Map(employees.map((e) => [e.id, e]))

  const handleGenerate = async () => {
    setGenerating(true)
    setFinalizeMsg('')
    setApplyError([])
    try {
      const logs = await fetchAllAssignmentLogs()
      const newSchedule = generateSchedule(stations, employees, absentIds, logs, scenarioName)
      setSchedule(newSchedule)
      setActiveScenario(scenarioName)
      setOverrideMode(false)
      setOverrides({})
      setCtAssignments([])
      await insertAuditLog(user.email ?? '', 'Generated schedule', scenarioName)
    } finally {
      setGenerating(false)
    }
  }

  const handleApplyOverrides = () => {
    if (!schedule) return
    const { assignments: newAssign, conflicts } = applyOverrides(
      schedule,
      stations,
      overrides,
      employees,
      absentIds,
    )
    if (conflicts.length > 0) {
      setApplyError(conflicts)
      return
    }
    setApplyError([])
    setSchedule(newAssign)
    setOverrideMode(false)
    setOverrides({})
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
      await insertAuditLog(
        user.email ?? '',
        'Finalized day',
        `${finalizeDate} — ${assignLogs.length} assignments`,
      )
      setFinalizeMsg(`Day finalized: ${assignLogs.length} assignments recorded for ${finalizeDate}`)
      setSchedule(null)
      setCtAssignments([])
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
        .map((id) => {
          const emp = employeesMap.get(id)
          if (!emp) return ''
          const comp = emp.station_competencies[a.station_id] ?? 0
          return `${emp.name} (${skillLabels[comp]})`
        })
        .join(', ')
      return [
        station?.name ?? a.station_id,
        skillLabels[station?.required_skill_level ?? 0],
        certLabels[station?.required_certification ?? 0],
        assigned || '—',
        `${a.assigned_employee_ids.length}/${station?.required_headcount ?? 1}`,
        a.is_fully_staffed ? 'Staffed' : 'Understaffed',
      ]
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

  // Compute metrics
  const assignedIds = new Set(
    schedule ? Object.values(schedule).flatMap((a) => a.assigned_employee_ids) : [],
  )
  const presentEmployees = new Set(employees.filter((e) => !e.is_absent).map((e) => e.id))
  const unassignedIds = [...presentEmployees].filter((id) => !assignedIds.has(id))
  const totalStations = schedule ? Object.keys(schedule).length : 0
  const filledStations = schedule ? Object.values(schedule).filter((a) => a.is_fully_staffed).length : 0
  const understaffedStations = totalStations - filledStations

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Schedule</h1>

      {/* Controls */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-48">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Scheduling Strategy
            </label>
            <select
              value={scenarioName}
              onChange={(e) => setScenarioName(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {Object.keys(SCENARIOS).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">{SCENARIO_DESCRIPTIONS[scenarioName]}</p>
          </div>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
          >
            {generating ? 'Generating…' : 'Generate Schedule'}
          </button>
        </div>
      </div>

      {schedule && (
        <>
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
                <p
                  className={`text-2xl font-bold ${
                    m.bad ? 'text-red-600' : m.good ? 'text-green-600' : 'text-gray-900'
                  }`}
                >
                  {m.value}
                </p>
              </div>
            ))}
          </div>

          {/* Schedule table */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-gray-900">Assignments</h2>
                {activeScenario && (
                  <p className="text-xs text-gray-500">Strategy: {activeScenario}</p>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleGeneratePDF}
                  className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Download PDF
                </button>
                {!overrideMode && (
                  <button
                    onClick={() => setOverrideMode(true)}
                    className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 text-gray-600 hover:bg-gray-50 transition-colors"
                  >
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
                    const assignedNames = a.assigned_employee_ids
                      .map((id) => {
                        const emp = employeesMap.get(id)
                        if (!emp) return null
                        const comp = emp.station_competencies[a.station_id] ?? 0
                        const cert = certLabels[emp.certification_level]
                        return `${emp.name} (C:${comp}, ${cert})`
                      })
                      .filter(Boolean)
                      .join(', ')

                    return (
                      <tr key={a.station_id} className="border-b border-gray-100 hover:bg-gray-50/50">
                        <td className="px-4 py-2.5 font-medium">{station.name}</td>
                        <td className="px-4 py-2.5 text-gray-600">
                          {skillLabels[station.required_skill_level]}
                        </td>
                        <td className="px-4 py-2.5 text-gray-600">
                          {certLabels[station.required_certification]}
                        </td>
                        <td className="px-4 py-2.5 text-gray-600">{assignedNames || '—'}</td>
                        <td className="px-4 py-2.5 text-center">
                          {a.assigned_employee_ids.length}/{station.required_headcount}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {a.is_fully_staffed ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                              ✓ Staffed
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-medium">
                              ⚠ Understaffed
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Manual override */}
          {overrideMode && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-gray-900">Adjust Assignments</h2>
                  <p className="text-xs text-gray-500">Only qualified employees are shown per station</p>
                </div>
                <button
                  onClick={() => { setOverrideMode(false); setApplyError([]) }}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  Cancel
                </button>
              </div>

              {applyError.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 space-y-1">
                  {applyError.map((e, i) => <p key={i}>{e}</p>)}
                </div>
              )}

              <div className="space-y-4">
                {Object.values(schedule).map((a) => {
                  const station = stationsMap.get(a.station_id)
                  if (!station) return null
                  const allAssignedIds = new Set(
                    Object.values(schedule).flatMap((x) => x.assigned_employee_ids),
                  )
                  const currentSlots = overrides[a.station_id] ?? Object.fromEntries(
                    a.assigned_employee_ids.map((id, i) => [i, id]),
                  )

                  return (
                    <div key={a.station_id} className="border border-gray-100 rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <span className={a.is_fully_staffed ? 'text-green-500' : 'text-amber-500'}>●</span>
                        <h3 className="font-medium text-gray-900">{station.name}</h3>
                        <span className="text-xs text-gray-400">
                          ({a.assigned_employee_ids.length}/{station.required_headcount})
                        </span>
                      </div>
                      <div className="space-y-2">
                        {Array.from({ length: station.required_headcount }, (_, slotIdx) => {
                          const currentEmpId = currentSlots[slotIdx] ?? '__unassigned__'
                          const qualified = employees.filter(
                            (emp) =>
                              !emp.is_absent &&
                              checkEmployeeIsQualified(emp, station) &&
                              (emp.id === currentEmpId || !allAssignedIds.has(emp.id) || emp.id === currentSlots[slotIdx]),
                          )

                          return (
                            <div key={slotIdx} className="flex items-center gap-2">
                              <span className="text-xs text-gray-400 w-12">Slot {slotIdx + 1}</span>
                              <select
                                value={currentEmpId}
                                onChange={(e) =>
                                  setOverrides((prev) => ({
                                    ...prev,
                                    [a.station_id]: {
                                      ...prev[a.station_id],
                                      [slotIdx]: e.target.value,
                                    },
                                  }))
                                }
                                className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                              >
                                <option value="__unassigned__">(Unassigned)</option>
                                {qualified.map((emp) => {
                                  const comp = emp.station_competencies[a.station_id] ?? 0
                                  return (
                                    <option key={emp.id} value={emp.id}>
                                      {emp.name} (Comp: {comp} — {skillLabels[comp]})
                                    </option>
                                  )
                                })}
                              </select>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>

              <button
                onClick={handleApplyOverrides}
                className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
              >
                Apply Changes
              </button>
            </div>
          )}

          {/* Cross-training assignments */}
          {unassignedIds.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4">
              <div>
                <h2 className="font-semibold text-gray-900">Cross-Training Assignments</h2>
                <p className="text-xs text-gray-500">
                  Assign unassigned employees to train on-line staff at their station
                </p>
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
                      return [{
                        station_id: a.station_id,
                        station_name: stationsMap.get(a.station_id)?.name ?? '',
                        trainee_id: assignedId,
                        trainee_name: assignedEmp.name,
                        trainee_level: assignedComp,
                        trainer_level: trainerComp,
                      }]
                    }
                    return []
                  })
                })

                const claimedTrainees = new Map(
                  ctAssignments.map((ct) => [ct.trainee_id, ct.trainer_id]),
                )
                const currentCt = ctAssignments.find((ct) => ct.trainer_id === empId)
                const availableRecs = recs.filter((r) => {
                  const claimed = claimedTrainees.get(r.trainee_id)
                  return !claimed || claimed === empId
                })

                return (
                  <div key={empId} className="border border-gray-100 rounded-lg p-4">
                    <p className="font-medium text-gray-900 mb-2">
                      {emp.name}{' '}
                      <span className="text-xs text-gray-400 font-normal">
                        ({certLabels[emp.certification_level]})
                      </span>
                    </p>

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
                            const rec = recs.find(
                              (r) => r.trainee_id === traineeId && r.station_id === stationId,
                            )
                            if (!rec) return filtered
                            return [
                              ...filtered,
                              {
                                trainer_id: empId,
                                trainer_name: emp.name,
                                trainee_id: rec.trainee_id,
                                trainee_name: rec.trainee_name,
                                station_id: rec.station_id,
                                station_name: rec.station_name,
                              },
                            ]
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
                  <div className="px-4 py-2 bg-gray-50 text-xs font-medium text-gray-600">
                    Active Cross-Training Pairings
                  </div>
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
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4">
            <div>
              <h2 className="font-semibold text-gray-900">Finalize Day</h2>
              <p className="text-xs text-gray-500">
                Commit today&apos;s assignments to the rotation history log
              </p>
            </div>

            <div className="flex flex-wrap gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                <input
                  type="date"
                  value={finalizeDate}
                  onChange={(e) => setFinalizeDate(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Default shift hours
                </label>
                <input
                  type="number"
                  min={0.5}
                  max={24}
                  step={0.5}
                  value={defaultHours}
                  onChange={(e) => setDefaultHours(Number(e.target.value))}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-24 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            {finalizeMsg && (
              <div
                className={`p-3 rounded-lg text-sm ${
                  finalizeMsg.startsWith('Error')
                    ? 'bg-red-50 border border-red-200 text-red-700'
                    : 'bg-green-50 border border-green-200 text-green-700'
                }`}
              >
                {finalizeMsg}
              </div>
            )}

            <button
              onClick={handleFinalizeDay}
              disabled={finalizing}
              className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
            >
              {finalizing ? 'Finalizing…' : 'Finalize Day'}
            </button>
          </div>
        </>
      )}

      {!schedule && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-700">
          Click &quot;Generate Schedule&quot; to assign employees to stations.
        </div>
      )}
    </div>
  )
}
