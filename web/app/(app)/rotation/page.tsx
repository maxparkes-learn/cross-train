'use client'

import { useState, useEffect } from 'react'
import { useApp } from '@/components/AppShell'
import { buildRotationStats } from '@/lib/scheduler'
import { fetchAllAssignmentLogs, fetchAllCrossTrainingLogs } from '@/lib/db'
import type { AssignmentLog, CrossTrainingLog } from '@/lib/types'

type Preset = 'Past 7 days' | 'Past 2 weeks' | 'Past month' | 'Year to date' | 'Custom'

function toDateStr(d: Date) {
  return d.toISOString().split('T')[0]
}

function subtractDays(days: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d
}

function startOfYear(): Date {
  const d = new Date()
  return new Date(d.getFullYear(), 0, 1)
}

export default function RotationPage() {
  const { stations, employees, settings } = useApp()
  const { skillLabels } = settings

  const [preset, setPreset] = useState<Preset>('Past month')
  const [customStart, setCustomStart] = useState(toDateStr(subtractDays(30)))
  const [customEnd, setCustomEnd] = useState(toDateStr(new Date()))
  const [logs, setLogs] = useState<AssignmentLog[]>([])
  const [ctLogs, setCtLogs] = useState<CrossTrainingLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const [al, cl] = await Promise.all([fetchAllAssignmentLogs(), fetchAllCrossTrainingLogs()])
      setLogs(al)
      setCtLogs(cl)
      setLoading(false)
    }
    load()
  }, [])

  const today = toDateStr(new Date())

  const getDateRange = (): { start: string; end: string; windowDays: number } => {
    if (preset === 'Custom') {
      const days = Math.max(
        1,
        Math.floor(
          (new Date(customEnd).getTime() - new Date(customStart).getTime()) / 86400000,
        ),
      )
      return { start: customStart, end: customEnd, windowDays: days }
    }
    const presetDays: Record<Preset, number> = {
      'Past 7 days': 7,
      'Past 2 weeks': 14,
      'Past month': 30,
      'Year to date': Math.max(1, Math.floor((new Date().getTime() - startOfYear().getTime()) / 86400000)),
      Custom: 30,
    }
    const days = presetDays[preset]
    return {
      start: toDateStr(subtractDays(days)),
      end: today,
      windowDays: days,
    }
  }

  const { start, end, windowDays } = getDateRange()
  const rotationStats = buildRotationStats(logs, windowDays)

  const filteredCtLogs = ctLogs.filter((c) => c.log_date >= start && c.log_date <= end)

  const stationsMap = new Map(stations.map((s) => [s.id, s]))
  const employeesMap = new Map(employees.map((e) => [e.id, e]))

  const handleGeneratePDF = async () => {
    const { jsPDF } = await import('jspdf')
    const autoTable = (await import('jspdf-autotable')).default
    const doc = new jsPDF({ orientation: 'landscape' })

    doc.setFontSize(16)
    doc.text('Rotation Dashboard', 14, 18)
    doc.setFontSize(10)
    doc.setTextColor(100)
    doc.text(`Period: ${start} to ${end}`, 14, 26)
    doc.setTextColor(0)

    const head = ['Employee', ...stations.map((s) => s.name)]
    const body = employees.map((emp) => {
      const row = [emp.name]
      for (const s of stations) {
        const key = `${emp.id}__${s.id}`
        const rs = rotationStats.get(key)
        row.push(rs ? `${rs.total_hours}h / ${rs.days_since_last}d ago` : '—')
      }
      return row
    })

    autoTable(doc, {
      startY: 32,
      head: [head],
      body,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [79, 70, 229] },
    })

    doc.save(`rotation_${start}_${end}.pdf`)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
        Loading rotation data…
      </div>
    )
  }

  if (!stations.length || !employees.length) {
    return (
      <div className="max-w-xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Rotation Dashboard</h1>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-700">
          Add stations and employees first.
        </div>
      </div>
    )
  }

  if (logs.length === 0) {
    return (
      <div className="max-w-xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Rotation Dashboard</h1>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-700">
          No assignment history yet. Finalize some days in the Schedule tab to see rotation data here.
        </div>
      </div>
    )
  }

  // Cross-training summary
  interface TrainerInfo { hours: number; trainees: Set<string> }
  const trainerHours: Record<string, Record<string, TrainerInfo>> = {}
  const traineeHours: Record<string, Record<string, number>> = {}

  for (const ct of filteredCtLogs) {
    if (!trainerHours[ct.trainer_id]) trainerHours[ct.trainer_id] = {}
    if (!trainerHours[ct.trainer_id][ct.station_id]) {
      trainerHours[ct.trainer_id][ct.station_id] = { hours: 0, trainees: new Set() }
    }
    trainerHours[ct.trainer_id][ct.station_id].hours += ct.hours
    trainerHours[ct.trainer_id][ct.station_id].trainees.add(ct.trainee_id)

    if (!traineeHours[ct.trainee_id]) traineeHours[ct.trainee_id] = {}
    if (!traineeHours[ct.trainee_id][ct.station_id]) traineeHours[ct.trainee_id][ct.station_id] = 0
    traineeHours[ct.trainee_id][ct.station_id] += ct.hours
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Rotation Dashboard</h1>

      {/* Date range controls */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date Range</label>
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value as Preset)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {(['Past 7 days', 'Past 2 weeks', 'Past month', 'Year to date', 'Custom'] as Preset[]).map(
                (p) => <option key={p} value={p}>{p}</option>,
              )}
            </select>
          </div>

          {preset === 'Custom' ? (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start</label>
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End</label>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-500 self-end pb-2">
              {new Date(start).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })} —{' '}
              {new Date(end).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          )}

          <button
            onClick={handleGeneratePDF}
            className="self-end border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Download PDF
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          Total hours / days since last assignment per cell
        </p>
      </div>

      {/* Rotation matrix */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-2.5 text-left font-medium text-gray-600 sticky left-0 bg-gray-50">
                  Employee
                </th>
                {stations.map((s) => (
                  <th key={s.id} className="px-4 py-2.5 text-center font-medium text-gray-600 whitespace-nowrap">
                    {s.name}
                    <div className="text-xs font-normal text-gray-400">
                      req. {skillLabels[s.required_skill_level]}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <tr key={emp.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                  <td className="px-4 py-2.5 font-medium text-gray-900 sticky left-0 bg-white">
                    {emp.name}
                  </td>
                  {stations.map((s) => {
                    const key = `${emp.id}__${s.id}`
                    const rs = rotationStats.get(key)
                    return (
                      <td key={s.id} className="px-4 py-2.5 text-center text-gray-600 whitespace-nowrap">
                        {rs ? (
                          <span>
                            <span className="font-medium">{rs.total_hours}h</span>
                            <span className="text-gray-400 text-xs"> / {rs.days_since_last}d ago</span>
                          </span>
                        ) : (
                          <span className="text-gray-300">— / —</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cross-training hours */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4">
        <h2 className="font-semibold text-gray-900">Cross-Training Hours</h2>

        {filteredCtLogs.length === 0 ? (
          <p className="text-sm text-gray-400">No cross-training sessions recorded in this date range.</p>
        ) : (
          <>
            {/* Trainer summary */}
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-2">Hours Delivered (by Trainer)</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="px-4 py-2 text-left font-medium text-gray-600">Trainer</th>
                      <th className="px-4 py-2 text-center font-medium text-gray-600">Total Hours</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-600">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(trainerHours).map(([trainerId, stationsData]) => {
                      const trainer = employeesMap.get(trainerId)
                      if (!trainer) return null
                      const total = Object.values(stationsData).reduce((s, v) => s + v.hours, 0)
                      const details = Object.entries(stationsData)
                        .map(([sid, info]) => {
                          const sname = stationsMap.get(sid)?.name ?? sid
                          const traineeNames = [...info.trainees]
                            .map((tid) => employeesMap.get(tid)?.name ?? tid)
                            .join(', ')
                          return `${sname}: ${info.hours}h (${traineeNames})`
                        })
                        .join(' | ')
                      return (
                        <tr key={trainerId} className="border-b border-gray-100">
                          <td className="px-4 py-2.5 font-medium">{trainer.name}</td>
                          <td className="px-4 py-2.5 text-center">{total}h</td>
                          <td className="px-4 py-2.5 text-gray-500 text-xs">{details}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Trainee summary */}
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-2">Hours Received (by Trainee)</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="px-4 py-2 text-left font-medium text-gray-600">Trainee</th>
                      <th className="px-4 py-2 text-center font-medium text-gray-600">Total Hours</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-600">Stations</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(traineeHours).map(([traineeId, stationsData]) => {
                      const trainee = employeesMap.get(traineeId)
                      if (!trainee) return null
                      const total = Object.values(stationsData).reduce((s, v) => s + v, 0)
                      const details = Object.entries(stationsData)
                        .map(([sid, h]) => `${stationsMap.get(sid)?.name ?? sid}: ${h}h`)
                        .join(' | ')
                      return (
                        <tr key={traineeId} className="border-b border-gray-100">
                          <td className="px-4 py-2.5 font-medium">{trainee.name}</td>
                          <td className="px-4 py-2.5 text-center">{total}h</td>
                          <td className="px-4 py-2.5 text-gray-500 text-xs">{details}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
