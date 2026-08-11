'use client'

import { useState, useEffect, useRef } from 'react'
import { useApp } from '@/components/AppShell'
import { fetchAllEmployeesWithCompetencies, fetchAllStations } from '@/lib/db'
import { DEFAULT_SKILL_LABELS, DEFAULT_COMPETENCY_COLORS } from '@/lib/types'
import type { Employee, Station } from '@/lib/types'

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

function calcMonths(hireDate: string): number {
  const hired = new Date(hireDate)
  const now = new Date()
  return (now.getFullYear() - hired.getFullYear()) * 12 + (now.getMonth() - hired.getMonth())
}

function contrastColor(hex: string): string {
  const h = hex.replace('#', '')
  if (h.length !== 6) return '#111827'
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5 ? '#111827' : '#ffffff'
}

export default function AttentionPage() {
  const { departments } = useApp()

  const [employees, setEmployees] = useState<Employee[]>([])
  const [stations, setStations] = useState<Station[]>([])
  const [loading, setLoading] = useState(true)

  const [tenureMonths, setTenureMonths] = useState(12)
  const [compThreshold, setCompThreshold] = useState(3)
  const [selectedDepts, setSelectedDepts] = useState<Set<string>>(new Set())
  const [deptFilterOpen, setDeptFilterOpen] = useState(false)
  const deptFilterRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    Promise.all([fetchAllEmployeesWithCompetencies(), fetchAllStations()]).then(([emps, stns]) => {
      setEmployees(emps)
      setStations(stns)
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    if (departments.length > 0) setSelectedDepts(new Set(departments.map((d) => d.id)))
  }, [departments])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (deptFilterRef.current && !deptFilterRef.current.contains(e.target as Node)) {
        setDeptFilterOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const [sort, setSort] = useState<{ col: 'name' | 'department' | 'tenure' | 'level' | 'stations'; dir: 'asc' | 'desc' }>({ col: 'name', dir: 'asc' })

  const stationsByDept = stations.reduce<Record<string, Station[]>>((acc, s) => {
    if (!acc[s.department_id]) acc[s.department_id] = []
    acc[s.department_id].push(s)
    return acc
  }, {})

  const deptName = (id: string) => departments.find((d) => d.id === id)?.name ?? id
  const allDeptsSelected = departments.every((d) => selectedDepts.has(d.id))
  const skillLevels = Object.keys(DEFAULT_SKILL_LABELS).map(Number).sort((a, b) => a - b).filter(l => l > 0)

  const toggleSort = (col: typeof sort.col) => {
    setSort(prev => prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' })
  }

  const SortTh = ({ col, label }: { col: typeof sort.col; label: string }) => (
    <th
      onClick={() => toggleSort(col)}
      className="px-4 py-2.5 text-left font-medium text-gray-500 text-xs cursor-pointer select-none hover:text-gray-700 whitespace-nowrap"
    >
      {label}
      <span className="ml-1 text-gray-300">
        {sort.col === col ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
      </span>
    </th>
  )

  const flagged = employees
    .filter((emp) => {
      if (emp.is_lead || !emp.hire_date) return false
      if (!selectedDepts.has(emp.department_id)) return false
      if (calcMonths(emp.hire_date) < tenureMonths) return false
      const maxLevel = Object.values(emp.station_competencies).reduce((m, l) => Math.max(m, l), 0)
      return maxLevel < compThreshold
    })
    .sort((a, b) => {
      const deptStationsA = stationsByDept[a.department_id] ?? []
      const deptStationsB = stationsByDept[b.department_id] ?? []
      const maxA = Object.values(a.station_competencies).reduce((m, l) => Math.max(m, l), 0)
      const maxB = Object.values(b.station_competencies).reduce((m, l) => Math.max(m, l), 0)
      const trainedA = deptStationsA.filter((s) => (a.station_competencies[s.id] ?? 0) >= 2).length
      const trainedB = deptStationsB.filter((s) => (b.station_competencies[s.id] ?? 0) >= 2).length
      let cmp = 0
      if (sort.col === 'name') cmp = a.name.localeCompare(b.name)
      else if (sort.col === 'department') cmp = deptName(a.department_id).localeCompare(deptName(b.department_id))
      else if (sort.col === 'tenure') cmp = calcMonths(a.hire_date!) - calcMonths(b.hire_date!)
      else if (sort.col === 'level') cmp = maxA - maxB
      else if (sort.col === 'stations') cmp = (deptStationsA.length ? trainedA / deptStationsA.length : 0) - (deptStationsB.length ? trainedB / deptStationsB.length : 0)
      return sort.dir === 'asc' ? cmp : -cmp
    })

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Needs Attention</h1>
        <p className="text-sm text-gray-400 mt-1">
          Employees who have been with the company long enough but haven't reached the expected competency level.
        </p>
      </div>

      {/* Controls */}
      <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 flex flex-wrap items-end gap-5">
        {/* Tenure threshold */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Minimum tenure</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={120}
              value={tenureMonths}
              onChange={(e) => setTenureMonths(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-16 border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-700 text-center"
            />
            <span className="text-sm text-gray-500">months</span>
          </div>
        </div>

        {/* Competency threshold */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Must not have reached</label>
          <select
            value={compThreshold}
            onChange={(e) => setCompThreshold(Number(e.target.value))}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-700"
          >
            {skillLevels.map((l) => (
              <option key={l} value={l}>{DEFAULT_SKILL_LABELS[l]} (level {l})</option>
            ))}
          </select>
        </div>

        {/* Department filter */}
        <div className="flex flex-col gap-1" ref={deptFilterRef}>
          <label className="text-xs font-medium text-gray-500">Departments</label>
          <div className="relative">
            <button
              onClick={() => setDeptFilterOpen((o) => !o)}
              className="flex items-center gap-2 border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white hover:bg-gray-50 transition-colors whitespace-nowrap"
            >
              <span className="text-gray-700">
                {allDeptsSelected ? 'All departments' : `${selectedDepts.size} dept${selectedDepts.size !== 1 ? 's' : ''}`}
              </span>
              <span className="text-gray-400 text-xs">{deptFilterOpen ? '▲' : '▼'}</span>
            </button>
            {deptFilterOpen && (
              <div className="absolute left-0 mt-1 w-52 bg-white border border-gray-200 rounded-lg shadow-lg z-10 py-1">
                <button
                  onClick={() => setSelectedDepts(allDeptsSelected ? new Set() : new Set(departments.map((d) => d.id)))}
                  className="w-full text-left px-3 py-2 text-sm text-indigo-600 hover:bg-gray-50 font-medium border-b border-gray-100"
                >
                  {allDeptsSelected ? 'Deselect all' : 'Select all'}
                </button>
                {departments.map((d) => (
                  <label key={d.id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedDepts.has(d.id)}
                      onChange={() => setSelectedDepts((prev) => {
                        const next = new Set(prev)
                        next.has(d.id) ? next.delete(d.id) : next.add(d.id)
                        return next
                      })}
                      className="accent-indigo-600 w-3.5 h-3.5"
                    />
                    <span className="text-sm text-gray-700">{d.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="ml-auto flex items-end pb-0.5">
          <span className="text-sm font-semibold text-gray-500">
            {loading ? '…' : flagged.length} employee{flagged.length !== 1 ? 's' : ''} flagged
          </span>
        </div>
      </div>

      {/* Results */}
      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : flagged.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 px-5 py-10 text-center">
          <p className="text-gray-400 text-sm">No employees flagged with the current filters.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <SortTh col="name" label="Name" />
                <SortTh col="department" label="Department" />
                <SortTh col="tenure" label="Tenure" />
                <SortTh col="level" label="Highest Level" />
                <SortTh col="stations" label="Stations Trained" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {flagged.map((emp) => {
                const maxLevel = Object.values(emp.station_competencies).reduce((m, l) => Math.max(m, l), 0)
                const color = DEFAULT_COMPETENCY_COLORS[maxLevel] ?? '#E8E8E8'
                const deptStations = stationsByDept[emp.department_id] ?? []
                const trainedCount = deptStations.filter((s) => (emp.station_competencies[s.id] ?? 0) >= 2).length
                return (
                  <tr key={emp.id} className="hover:bg-gray-50/50">
                    <td className="px-4 py-3 font-medium text-gray-900">{emp.name}</td>
                    <td className="px-4 py-3 text-gray-500">{deptName(emp.department_id)}</td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                      {emp.hire_date ? formatTenure(emp.hire_date) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="inline-block text-xs font-medium px-2 py-0.5 rounded"
                        style={{ backgroundColor: color, color: contrastColor(color) }}
                      >
                        {DEFAULT_SKILL_LABELS[maxLevel] ?? `Level ${maxLevel}`}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {deptStations.length > 0
                        ? `${trainedCount} of ${deptStations.length}`
                        : <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
