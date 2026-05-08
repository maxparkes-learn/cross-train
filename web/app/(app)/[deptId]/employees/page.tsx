'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useApp } from '@/components/AppShell'
import {
  fetchAllEmployees,
  fetchArchivedEmployees,
  updateEmployeeDepartment,
  deleteEmployee,
  unarchiveEmployee,
} from '@/lib/db'
import type { Employee } from '@/lib/types'

export default function EmployeesPage() {
  const { userRole, departments } = useApp()
  const router = useRouter()
  const isAdmin = userRole === 'admin' || userRole === 'superadmin'

  const [employees, setEmployees] = useState<Employee[]>([])
  const [archived, setArchived] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDepts, setSelectedDepts] = useState<Set<string>>(new Set())
  const [filterOpen, setFilterOpen] = useState(false)
  const [archivedOpen, setArchivedOpen] = useState(false)
  const [search, setSearch] = useState('')
  const filterRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isAdmin) { router.replace('matrix'); return }
    loadEmployees()
  }, [isAdmin]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (departments.length > 0) setSelectedDepts(new Set(departments.map((d) => d.id)))
  }, [departments])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const loadEmployees = async () => {
    setLoading(true)
    const [active, arch] = await Promise.all([fetchAllEmployees(), fetchArchivedEmployees()])
    setEmployees(active)
    setArchived(arch)
    setLoading(false)
  }

  const handleChangeDept = async (emp: Employee, newDeptId: string) => {
    await updateEmployeeDepartment(emp.id, newDeptId)
    setEmployees((prev) => prev.map((e) => e.id === emp.id ? { ...e, department_id: newDeptId } : e))
  }

  const handleArchive = async (emp: Employee) => {
    if (!confirm(`Archive ${emp.name}? They won't appear in any department.`)) return
    await deleteEmployee(emp.id)
    setEmployees((prev) => prev.filter((e) => e.id !== emp.id))
    setArchived((prev) => [...prev, { ...emp, is_archived: true }].sort((a, b) => a.name.localeCompare(b.name)))
  }

  const handleUnarchive = async (emp: Employee) => {
    await unarchiveEmployee(emp.id)
    setArchived((prev) => prev.filter((e) => e.id !== emp.id))
    setEmployees((prev) => [...prev, { ...emp, is_archived: false }].sort((a, b) => a.name.localeCompare(b.name)))
  }

  const toggleDept = (deptId: string) => {
    setSelectedDepts((prev) => {
      const next = new Set(prev)
      next.has(deptId) ? next.delete(deptId) : next.add(deptId)
      return next
    })
  }

  const nameCounts = employees.reduce<Record<string, number>>((acc, e) => {
    acc[e.name] = (acc[e.name] ?? 0) + 1
    return acc
  }, {})

  const filtered = employees
    .filter((e) => selectedDepts.has(e.department_id))
    .filter((e) => !search || e.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name))

  const allSelected = departments.every((d) => selectedDepts.has(d.id))

  if (!isAdmin) return null

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">
          Employees
          {!loading && <span className="ml-2 text-base font-normal text-gray-400">({filtered.length})</span>}
        </h1>
        <button onClick={loadEmployees} className="text-sm text-gray-400 hover:text-gray-600 transition-colors px-2">
          ↻
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <div className="space-y-4">
          {/* Search + filter row */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search employees…"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-gray-400"
            />
            <div className="relative" ref={filterRef}>
              <button
                onClick={() => setFilterOpen((o) => !o)}
                className="flex items-center gap-2 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white hover:bg-gray-50 transition-colors whitespace-nowrap"
              >
                <span className="text-gray-700">
                  {allSelected ? 'All depts' : `${selectedDepts.size} dept${selectedDepts.size !== 1 ? 's' : ''}`}
                </span>
                <span className="text-gray-400 text-xs">{filterOpen ? '▲' : '▼'}</span>
              </button>
              {filterOpen && (
                <div className="absolute right-0 mt-1 w-52 bg-white border border-gray-200 rounded-lg shadow-lg z-10 py-1">
                  <button
                    onClick={() => setSelectedDepts(allSelected ? new Set() : new Set(departments.map((d) => d.id)))}
                    className="w-full text-left px-3 py-2 text-sm text-indigo-600 hover:bg-gray-50 font-medium border-b border-gray-100"
                  >
                    {allSelected ? 'Deselect all' : 'Select all'}
                  </button>
                  {departments.map((d) => (
                    <label key={d.id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedDepts.has(d.id)}
                        onChange={() => toggleDept(d.id)}
                        className="accent-indigo-600 w-3.5 h-3.5"
                      />
                      <span className="text-sm text-gray-700">{d.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Active employees table */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {filtered.length === 0 ? (
              <p className="px-5 py-4 text-sm text-gray-400">
                {search ? 'No employees match your search.' : 'No employees match the current filter.'}
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="px-4 py-2.5 text-left font-medium text-gray-500 text-xs">Name</th>
                    <th className="px-4 py-2.5 text-left font-medium text-gray-500 text-xs">Department</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((emp) => {
                    const isDuplicate = (nameCounts[emp.name] ?? 0) > 1
                    return (
                      <tr key={emp.id} className="hover:bg-gray-50/50">
                        <td className="px-4 py-2.5">
                          <span className="text-gray-900">{emp.name}</span>
                          {isDuplicate && (
                            <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">
                              duplicate
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <select
                            value={emp.department_id}
                            onChange={(e) => handleChangeDept(emp, e.target.value)}
                            className="border border-gray-200 rounded-md px-2 py-1 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-700"
                          >
                            {departments.map((d) => (
                              <option key={d.id} value={d.id}>{d.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <button
                            onClick={() => handleArchive(emp)}
                            className="text-gray-300 hover:text-red-500 transition-colors"
                            title="Archive employee"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Archived section */}
          {archived.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <button
                onClick={() => setArchivedOpen((o) => !o)}
                className="w-full flex items-center justify-between px-5 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
              >
                <span className="text-sm font-semibold text-gray-500">
                  Archived
                  <span className="ml-2 font-normal text-gray-400">({archived.length})</span>
                </span>
                <span className="text-gray-400 text-xs">{archivedOpen ? '▲' : '▼'}</span>
              </button>
              {archivedOpen && (
                <ul className="divide-y divide-gray-100">
                  {archived.map((emp) => {
                    const deptName = departments.find((d) => d.id === emp.department_id)?.name ?? emp.department_id
                    return (
                      <li key={emp.id} className="flex items-center gap-3 px-5 py-3">
                        <span className="flex-1 text-sm text-gray-400 truncate">{emp.name}</span>
                        <span className="text-xs text-gray-400">{deptName}</span>
                        <button
                          onClick={() => handleUnarchive(emp)}
                          className="text-xs text-indigo-500 hover:text-indigo-700 transition-colors font-medium"
                        >
                          Restore
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
