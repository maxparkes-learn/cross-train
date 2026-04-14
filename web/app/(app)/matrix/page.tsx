'use client'

import { useState, useRef, useCallback } from 'react'
import { useApp } from '@/components/AppShell'
import {
  upsertEmployee,
  upsertCompetencies,
  deleteEmployee,
  updateEmployeeAbsence,
  generateId,
  insertAuditLog,
} from '@/lib/db'
import type { Employee } from '@/lib/types'

interface Row {
  id: string | null
  isNew: boolean
  name: string
  certLevel: number
  isPresent: boolean
  competencies: Record<string, number>
  dirty: boolean
}

function buildRows(employees: Employee[], stationIds: string[]): Row[] {
  return employees.map((e) => ({
    id: e.id,
    isNew: false,
    name: e.name,
    certLevel: e.certification_level,
    isPresent: !e.is_absent,
    competencies: Object.fromEntries(stationIds.map((sid) => [sid, e.station_competencies[sid] ?? 0])),
    dirty: false,
  }))
}

export default function MatrixPage() {
  const { stations, employees, settings, refreshEmployees, user } = useApp()
  const [rows, setRows] = useState<Row[]>(() =>
    buildRows(employees, stations.map((s) => s.id)),
  )
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

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
          })
          await upsertCompetencies(empId, updatedRow.competencies)
          if (!updatedRow.id) {
            // New employee saved — assign ID
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
    [refreshEmployees, user.email],
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
      competencies: Object.fromEntries(stations.map((s) => [s.id, 0])),
      dirty: false,
    }
    setRows((prev) => [...prev, newRow])
  }

  const handleDeleteRow = async (index: number) => {
    const row = rows[index]
    if (row.id) {
      if (!confirm(`Delete ${row.name}? This removes all their competency data.`)) return
      await deleteEmployee(row.id)
      await insertAuditLog(user.email ?? '', 'Deleted employee', row.name)
      await refreshEmployees()
    }
    setRows((prev) => prev.filter((_, i) => i !== index))
  }

  if (stations.length === 0) {
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

      {/* Color legend */}
      <div className="flex flex-wrap gap-2 mb-4">
        {[0, 1, 2, 3, 4].map((l) => (
          <span
            key={l}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium text-gray-700 border border-gray-200"
            style={{ backgroundColor: competencyColors[l] }}
          >
            {l} · {skillLabels[l]}
          </span>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-3 py-2.5 text-left font-medium text-gray-600 whitespace-nowrap w-16">
                  Present
                </th>
                <th className="px-3 py-2.5 text-left font-medium text-gray-600 min-w-[140px]">
                  Employee
                </th>
                <th className="px-3 py-2.5 text-left font-medium text-gray-600 whitespace-nowrap min-w-[130px]">
                  Certification
                </th>
                {stations.map((s) => (
                  <th
                    key={s.id}
                    className="px-3 py-2.5 text-center font-medium text-gray-600 whitespace-nowrap min-w-[110px]"
                  >
                    {s.name}
                    <div className="text-xs font-normal text-gray-400">
                      req. {skillLabels[s.required_skill_level]}
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
                  className={`border-b border-gray-100 transition-colors ${
                    !row.isPresent && row.id ? 'bg-gray-50 opacity-60' : 'hover:bg-gray-50/50'
                  }`}
                >
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
                    <input
                      type="text"
                      value={row.name}
                      onChange={(e) => updateRow(i, { name: e.target.value })}
                      placeholder="Employee name"
                      className="w-full text-sm bg-transparent outline-none placeholder-gray-300 focus:placeholder-gray-400"
                    />
                    {saving[row.id ?? `new_${i}`] && (
                      <span className="text-xs text-gray-400">saving…</span>
                    )}
                  </td>

                  {/* Cert */}
                  <td className="px-3 py-2">
                    <select
                      value={row.certLevel}
                      onChange={(e) => updateRow(i, { certLevel: Number(e.target.value) })}
                      className="w-full text-sm bg-transparent outline-none cursor-pointer"
                    >
                      {[0, 1, 2].map((l) => (
                        <option key={l} value={l}>
                          {l} — {certLabels[l]}
                        </option>
                      ))}
                    </select>
                  </td>

                  {/* Station competencies */}
                  {stations.map((s) => {
                    const level = row.competencies[s.id] ?? 0
                    return (
                      <td
                        key={s.id}
                        className="px-2 py-1.5 text-center"
                        style={{ backgroundColor: competencyColors[level] + '80' }}
                      >
                        <select
                          value={level}
                          onChange={(e) =>
                            updateRow(i, {
                              competencies: { ...row.competencies, [s.id]: Number(e.target.value) },
                            })
                          }
                          className="w-full text-xs bg-transparent outline-none cursor-pointer text-center"
                          style={{ backgroundColor: 'transparent' }}
                        >
                          {[0, 1, 2, 3, 4].map((l) => (
                            <option key={l} value={l}>
                              {l} — {skillLabels[l]}
                            </option>
                          ))}
                        </select>
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
                <td colSpan={3 + stations.length + 1} className="px-3 py-2">
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
