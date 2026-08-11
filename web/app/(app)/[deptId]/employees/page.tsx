'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useApp } from '@/components/AppShell'
import {
  fetchAllEmployees,
  fetchArchivedEmployees,
  updateEmployeeDepartment,
  updateEmployeeHireDate,
  updateEmployeeName,
  deleteEmployee,
  unarchiveEmployee,
  bulkCreateEmployees,
} from '@/lib/db'
import type { Employee, Department } from '@/lib/types'

// ---- Helpers ----

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

function parseCSVDate(s: string): string | null {
  s = s.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`
  const months: Record<string, string> = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' }
  const long = s.match(/^([a-z]+)\s+(\d{1,2}),?\s+(\d{4})$/i)
  if (long) { const m = months[long[1].toLowerCase().slice(0, 3)]; if (m) return `${long[3]}-${m}-${long[2].padStart(2, '0')}` }
  return null
}

function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim())
  const parseLine = (line: string): string[] => {
    const fields: string[] = []
    let cur = '', inQ = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++ }
        else inQ = !inQ
      } else if (c === ',' && !inQ) { fields.push(cur); cur = '' }
      else cur += c
    }
    fields.push(cur)
    return fields.map(f => f.trim())
  }
  return { headers: parseLine(lines[0]), rows: lines.slice(1).map(parseLine) }
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
  return dp[m][n]
}

function nameVariants(name: string): string[] {
  const n = name.toLowerCase().replace(/[^a-z ]/g, '').trim()
  const tokens = n.split(/\s+/).filter(Boolean)
  if (tokens.length < 2) return [n]
  return [tokens.join(' '), tokens.slice().reverse().join(' ')]
}

function nameSimilarity(a: string, b: string): number {
  const aVars = nameVariants(a)
  const bVars = nameVariants(b)
  let best = 0
  for (const av of aVars) {
    for (const bv of bVars) {
      if (av === bv) return 1
      const dist = levenshtein(av, bv)
      const maxLen = Math.max(av.length, bv.length)
      const score = maxLen === 0 ? 1 : (maxLen - dist) / maxLen
      if (score > best) best = score
    }
  }
  return best
}

// ---- New employee CSV helpers ----

type NewEmpRow = { email: string; name: string; departmentId: string | null; csvDeptName: string | null; hireDate: string | null }

function nameFromEmail(email: string): string {
  const local = email.split('@')[0]
  return local.split('.').map(part =>
    part.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('-')
  ).join(' ')
}

function buildNewEmpRows(text: string, depts: Department[]): NewEmpRow[] | null {
  const csv = parseCSV(text)
  const firstRowHasEmail = csv.headers.some(c => c.includes('@'))

  let allRows: string[][]
  let emailIdx: number, deptIdx: number, hireIdx: number

  if (firstRowHasEmail) {
    // No header row — auto-detect columns from first data row
    allRows = [csv.headers, ...csv.rows]
    emailIdx = csv.headers.findIndex(c => c.includes('@'))
    deptIdx = csv.headers.findIndex(c => depts.some(d => d.name.toLowerCase() === c.toLowerCase()))
    hireIdx = csv.headers.findIndex(c => parseCSVDate(c) !== null)
  } else {
    const h = csv.headers.map(s => s.toLowerCase())
    emailIdx = h.findIndex(s => s.includes('email'))
    deptIdx = h.findIndex(s => /dep(t|artment)/i.test(s))
    hireIdx = h.findIndex(s => s.includes('hire') || s.includes('start'))
    allRows = csv.rows
  }

  if (emailIdx === -1) return null

  const seen = new Set<string>()
  return allRows
    .filter(row => row[emailIdx]?.includes('@'))
    .map(row => {
      const email = row[emailIdx].trim().toLowerCase()
      if (seen.has(email)) return null
      seen.add(email)
      const name = nameFromEmail(email)
      let departmentId: string | null = null
      let csvDeptName: string | null = null
      if (deptIdx !== -1 && row[deptIdx]?.trim()) {
        csvDeptName = row[deptIdx].trim()
        departmentId = depts.find(d => d.name.toLowerCase() === csvDeptName!.toLowerCase())?.id ?? null
      }
      const hireDate = hireIdx !== -1 ? parseCSVDate(row[hireIdx] ?? '') : null
      return { email, name, departmentId, csvDeptName, hireDate }
    })
    .filter((r): r is NewEmpRow => r !== null)
}

// ---- Searchable combobox for BambooHR match selection ----

interface BambooComboboxProps {
  options: BambooEntry[]
  value: number | null
  onChange: (idx: number | null) => void
}

function BambooCombobox({ options, value, onChange }: BambooComboboxProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const selectedName = value !== null ? (options[value]?.name ?? '') : ''
  const displayQuery = open ? query : selectedName

  const filtered = query.trim()
    ? options.filter(o => o.name.toLowerCase().includes(query.toLowerCase()))
    : options

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <input
        type="text"
        value={displayQuery}
        placeholder="— No match —"
        onFocus={() => { setOpen(true); setQuery('') }}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        className="w-full border border-gray-200 rounded px-2 py-1 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400 text-gray-700 placeholder-gray-300"
      />
      {open && (
        <div className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto bg-white border border-gray-200 rounded shadow-lg">
          <button
            onMouseDown={e => { e.preventDefault(); onChange(null); setOpen(false); setQuery('') }}
            className="w-full text-left px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-50 border-b border-gray-100"
          >
            — No match —
          </button>
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-400">No results</p>
          ) : (
            filtered.map((opt) => {
              const idx = options.indexOf(opt)
              return (
                <button
                  key={idx}
                  onMouseDown={e => { e.preventDefault(); onChange(idx); setOpen(false); setQuery('') }}
                  className={`w-full text-left px-3 py-1.5 text-sm hover:bg-indigo-50 ${idx === value ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-gray-700'}`}
                >
                  {opt.name}
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

interface MatchResult {
  employeeId: string
  employeeName: string
  autoMatchIdx: number | null
  confidence: number
}

type BambooEntry = { name: string; hireDate: string }

function buildMatchData(
  employees: Employee[],
  csv: { headers: string[]; rows: string[][] }
): { rows: MatchResult[]; bambooOptions: BambooEntry[] } | null {
  const h = csv.headers.map(s => s.toLowerCase())
  const firstIdx = h.findIndex(s => s.includes('first'))
  const lastIdx = h.findIndex(s => s.includes('last'))
  const fullIdx = h.findIndex(s => s.includes('name') && !s.includes('first') && !s.includes('last'))
  const hireIdx = h.findIndex(s => s.includes('hire') || s.includes('start date'))
  if (hireIdx === -1) return null

  const bambooOptions = csv.rows
    .map(row => {
      let name = ''
      if (firstIdx !== -1 && lastIdx !== -1) name = `${row[firstIdx] ?? ''} ${row[lastIdx] ?? ''}`.trim()
      else if (fullIdx !== -1) name = row[fullIdx] ?? ''
      const hireDate = parseCSVDate(row[hireIdx] ?? '')
      return name && hireDate ? { name, hireDate } : null
    })
    .filter(Boolean) as BambooEntry[]

  if (bambooOptions.length === 0) return null

  const unmatched = employees.filter(emp => !emp.hire_date)
  const rows: MatchResult[] = unmatched.map(emp => {
    let bestIdx: number | null = null
    let bestScore = 0
    bambooOptions.forEach((boo, i) => {
      const score = nameSimilarity(emp.name, boo.name)
      if (score > bestScore) { bestScore = score; bestIdx = i }
    })
    return {
      employeeId: emp.id,
      employeeName: emp.name,
      autoMatchIdx: bestScore >= 0.4 ? bestIdx : null,
      confidence: bestScore,
    }
  }).sort((a, b) => b.confidence - a.confidence)

  return { rows, bambooOptions }
}

// ---- Page ----

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

  // Add new employees from CSV
  const [addOpen, setAddOpen] = useState(false)
  const [addRows, setAddRows] = useState<NewEmpRow[] | null>(null)
  const [addFallbackDeptId, setAddFallbackDeptId] = useState('')
  const [addError, setAddError] = useState('')
  const [addMsg, setAddMsg] = useState('')
  const [adding, setAdding] = useState(false)

  // CSV import state
  const [importOpen, setImportOpen] = useState(false)
  const [matchRows, setMatchRows] = useState<MatchResult[] | null>(null)
  const [bambooOptions, setBambooOptions] = useState<BambooEntry[]>([])
  const [bambooSelections, setBambooSelections] = useState<Record<string, number | null>>({})
  const [updateNames, setUpdateNames] = useState<Set<string>>(new Set())
  const [accepted, setAccepted] = useState<Set<string>>(new Set())
  const [applying, setApplying] = useState(false)
  const [applyMsg, setApplyMsg] = useState('')
  const [csvError, setCsvError] = useState('')

  useEffect(() => {
    if (!isAdmin) { router.replace('matrix'); return }
    loadEmployees()
  }, [isAdmin]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (departments.length > 0) {
      setSelectedDepts(new Set(departments.map((d) => d.id)))
      setAddFallbackDeptId(prev => prev || departments[0].id)
    }
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

  const handleNewEmpUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setAddError(''); setAddMsg(''); setAddRows(null)
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      try {
        const rows = buildNewEmpRows(text, departments)
        if (!rows || rows.length === 0) {
          setAddError('Could not find an email column. Make sure at least one column contains email addresses.')
          return
        }
        setAddRows(rows)
      } catch {
        setAddError('Failed to parse the file. Please check the format.')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleAddEmployees = async () => {
    if (!addRows) return
    setAdding(true); setAddMsg('')
    try {
      const toCreate = addRows.map(r => ({
        name: r.name,
        departmentId: r.departmentId ?? addFallbackDeptId,
        hireDate: r.hireDate,
      }))
      const count = await bulkCreateEmployees(toCreate)
      setAddMsg(`✓ ${count} employee${count !== 1 ? 's' : ''} added.`)
      setAddRows(null)
      await loadEmployees()
    } finally {
      setAdding(false)
    }
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

  const getSelectedBamboo = (m: MatchResult): BambooEntry | null => {
    const idx = m.employeeId in bambooSelections ? bambooSelections[m.employeeId] : m.autoMatchIdx
    return idx !== null && idx !== undefined ? bambooOptions[idx] : null
  }

  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setCsvError('')
    setMatchRows(null)
    setApplyMsg('')
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      try {
        const parsed = parseCSV(text)
        const result = buildMatchData(employees, parsed)
        if (!result) {
          setCsvError('Could not find name and hire date columns. Expected columns like "First Name", "Last Name", "Hire Date".')
          return
        }
        const { rows, bambooOptions: opts } = result
        setMatchRows(rows)
        setBambooOptions(opts)
        const initialSel: Record<string, number | null> = {}
        rows.forEach(r => { if (r.autoMatchIdx !== null) initialSel[r.employeeId] = r.autoMatchIdx })
        setBambooSelections(initialSel)
        setAccepted(new Set(rows.filter(r => r.confidence >= 0.8 && r.autoMatchIdx !== null).map(r => r.employeeId)))
        setUpdateNames(new Set())
      } catch {
        setCsvError('Failed to parse CSV. Please check the file format.')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleApply = async () => {
    if (!matchRows) return
    setApplying(true)
    setApplyMsg('')
    try {
      const toApply = matchRows
        .filter(m => accepted.has(m.employeeId))
        .map(m => ({ m, bamboo: getSelectedBamboo(m) }))
        .filter((x): x is { m: MatchResult; bamboo: BambooEntry } => x.bamboo !== null)

      await Promise.all(toApply.map(({ m, bamboo }) => updateEmployeeHireDate(m.employeeId, bamboo.hireDate)))
      const nameUpdates = toApply.filter(({ m }) => updateNames.has(m.employeeId))
      await Promise.all(nameUpdates.map(({ m, bamboo }) => updateEmployeeName(m.employeeId, bamboo.name)))

      setEmployees(prev => prev.map(e => {
        const hit = toApply.find(({ m }) => m.employeeId === e.id)
        if (!hit) return e
        const nameHit = nameUpdates.find(({ m }) => m.employeeId === e.id)
        return { ...e, hire_date: hit.bamboo.hireDate, name: nameHit ? nameHit.bamboo.name : e.name }
      }))

      const nameCount = nameUpdates.length
      setApplyMsg(`✓ Updated hire dates for ${toApply.length} employee${toApply.length !== 1 ? 's' : ''}${nameCount > 0 ? ` and corrected ${nameCount} name${nameCount !== 1 ? 's' : ''}` : ''}.`)
      setMatchRows(null)
      setBambooSelections({})
      setUpdateNames(new Set())
      setAccepted(new Set())
    } finally {
      setApplying(false)
    }
  }

  const [sort, setSort] = useState<{ col: 'name' | 'department' | 'tenure'; dir: 'asc' | 'desc' }>({ col: 'name', dir: 'asc' })

  const toggleSort = (col: typeof sort.col) => {
    setSort(prev => prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' })
  }

  const nameCounts = employees.reduce<Record<string, number>>((acc, e) => {
    acc[e.name] = (acc[e.name] ?? 0) + 1
    return acc
  }, {})

  const getDeptName = (id: string) => departments.find((d) => d.id === id)?.name ?? id

  const filtered = employees
    .filter((e) => selectedDepts.has(e.department_id))
    .filter((e) => !search || e.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      let cmp = 0
      if (sort.col === 'name') cmp = a.name.localeCompare(b.name)
      else if (sort.col === 'department') cmp = getDeptName(a.department_id).localeCompare(getDeptName(b.department_id))
      else if (sort.col === 'tenure') {
        const mA = a.hire_date ? (new Date().getFullYear() - new Date(a.hire_date).getFullYear()) * 12 + new Date().getMonth() - new Date(a.hire_date).getMonth() : -1
        const mB = b.hire_date ? (new Date().getFullYear() - new Date(b.hire_date).getFullYear()) * 12 + new Date().getMonth() - new Date(b.hire_date).getMonth() : -1
        cmp = mA - mB
      }
      return sort.dir === 'asc' ? cmp : -cmp
    })

  const allSelected = departments.every((d) => selectedDepts.has(d.id))

  if (!isAdmin) return null

  return (
    <div className="max-w-4xl mx-auto space-y-6">
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
                    {(['name', 'department', 'tenure'] as const).map((col) => (
                      <th key={col} onClick={() => toggleSort(col)}
                        className="px-4 py-2.5 text-left font-medium text-gray-500 text-xs cursor-pointer select-none hover:text-gray-700 whitespace-nowrap capitalize">
                        {col}
                        <span className="ml-1 text-gray-300">
                          {sort.col === col ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
                        </span>
                      </th>
                    ))}
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
                        <td className="px-4 py-2.5 text-sm text-gray-500 whitespace-nowrap">
                          {emp.hire_date
                            ? <span title={emp.hire_date}>{formatTenure(emp.hire_date)}</span>
                            : <span className="text-gray-300">—</span>}
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

          {/* Add new employees from CSV */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <button
              onClick={() => { setAddOpen(o => !o); setAddMsg(''); setAddError('') }}
              className="w-full flex items-center justify-between px-5 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
            >
              <span className="text-sm font-semibold text-gray-500">Add New Employees from CSV</span>
              <span className="text-gray-400 text-xs">{addOpen ? '▲' : '▼'}</span>
            </button>

            {addOpen && (
              <div className="p-5 space-y-4">
                {!addRows ? (
                  <div className="space-y-3">
                    <p className="text-sm text-gray-500">
                      Upload a CSV with an <strong>email</strong> column — names are derived automatically from the email address. Include <strong>department</strong> and <strong>hire date</strong> columns to set those too.
                    </p>
                    <label className="inline-flex items-center gap-2 cursor-pointer border border-gray-300 rounded-lg px-4 py-2 text-sm text-gray-700 bg-white hover:bg-gray-50 transition-colors">
                      <span>Choose CSV file</span>
                      <input type="file" accept=".csv,.txt" onChange={handleNewEmpUpload} className="hidden" />
                    </label>
                    {addError && <p className="text-sm text-red-600">{addError}</p>}
                    {addMsg && <p className="text-sm text-green-700 font-medium">{addMsg}</p>}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-gray-600">{addRows.length} employee{addRows.length !== 1 ? 's' : ''} ready to add</p>
                      <button
                        onClick={() => { setAddRows(null); setAddError(''); setAddMsg('') }}
                        className="text-xs text-gray-400 hover:text-gray-600"
                      >
                        ← Upload different file
                      </button>
                    </div>

                    <div className="rounded-lg border border-gray-200 overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-100">
                            <th className="px-3 py-2 text-left font-medium text-gray-500 text-xs">Name</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-500 text-xs">Email</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-500 text-xs">Department</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-500 text-xs">Hire Date</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {addRows.map(row => {
                            const resolvedDept = row.departmentId
                              ? departments.find(d => d.id === row.departmentId)?.name
                              : null
                            const fallbackDept = departments.find(d => d.id === addFallbackDeptId)?.name
                            const isUnmatched = row.csvDeptName && !row.departmentId
                            return (
                              <tr key={row.email} className="hover:bg-gray-50/50">
                                <td className="px-3 py-2 font-medium text-gray-800">{row.name}</td>
                                <td className="px-3 py-2 text-gray-400 text-xs font-mono">{row.email}</td>
                                <td className="px-3 py-2">
                                  {isUnmatched ? (
                                    <span className="text-xs text-amber-500">⚠ &quot;{row.csvDeptName}&quot; not found → {fallbackDept}</span>
                                  ) : (
                                    <span className="text-xs text-gray-600">{resolvedDept ?? fallbackDept}</span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-xs text-gray-500">
                                  {row.hireDate ?? <span className="text-gray-300">—</span>}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>

                    {addRows.some(r => !r.departmentId) && (
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-gray-500 whitespace-nowrap">Fallback department:</label>
                        <select
                          value={addFallbackDeptId}
                          onChange={e => setAddFallbackDeptId(e.target.value)}
                          className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                      </div>
                    )}

                    <div className="flex items-center gap-3">
                      <button
                        onClick={handleAddEmployees}
                        disabled={adding}
                        className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                      >
                        {adding ? 'Adding…' : `Add ${addRows.length} employee${addRows.length !== 1 ? 's' : ''}`}
                      </button>
                    </div>
                    {addMsg && <p className="text-sm text-green-700 font-medium">{addMsg}</p>}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* CSV hire date import */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <button
              onClick={() => setImportOpen((o) => !o)}
              className="w-full flex items-center justify-between px-5 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
            >
              <span className="text-sm font-semibold text-gray-500">Import Hire Dates from CSV</span>
              <span className="text-gray-400 text-xs">{importOpen ? '▲' : '▼'}</span>
            </button>

            {importOpen && (
              <div className="p-5 space-y-4">
                {!matchRows ? (
                  <div className="space-y-3">
                    <p className="text-sm text-gray-600">
                      Export an employee report from BambooHR that includes <strong>First Name</strong>, <strong>Last Name</strong>, and <strong>Hire Date</strong>, then upload it here.
                      Names will be fuzzy-matched — you can override any match before saving.
                    </p>
                    <label className="inline-flex items-center gap-2 cursor-pointer border border-gray-300 rounded-lg px-4 py-2 text-sm text-gray-700 bg-white hover:bg-gray-50 transition-colors">
                      <span>Choose CSV file</span>
                      <input type="file" accept=".csv" onChange={handleCSVUpload} className="hidden" />
                    </label>
                    {csvError && <p className="text-sm text-red-600">{csvError}</p>}
                    {applyMsg && <p className="text-sm text-green-700 font-medium">{applyMsg}</p>}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-gray-600">
                        Review matches below. Use the dropdown to override any auto-match. Check rows to apply.
                      </p>
                      <button
                        onClick={() => { setMatchRows(null); setBambooOptions([]); setBambooSelections({}); setUpdateNames(new Set()); setAccepted(new Set()) }}
                        className="text-xs text-gray-400 hover:text-gray-600"
                      >
                        ← Upload different file
                      </button>
                    </div>

                    <div className="overflow-x-auto rounded-lg border border-gray-200">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-100">
                            <th className="px-3 py-2 text-left font-medium text-gray-500 text-xs w-8">
                              <input type="checkbox"
                                checked={matchRows.length > 0 && accepted.size === matchRows.filter(m => getSelectedBamboo(m) !== null).length}
                                onChange={() => {
                                  const withMatch = matchRows.filter(m => getSelectedBamboo(m) !== null).map(m => m.employeeId)
                                  setAccepted(accepted.size === withMatch.length ? new Set() : new Set(withMatch))
                                }}
                                className="accent-indigo-600 w-3.5 h-3.5" />
                            </th>
                            <th className="px-3 py-2 text-left font-medium text-gray-500 text-xs">Your Employee</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-500 text-xs">BambooHR Match</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-500 text-xs">Conf.</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-500 text-xs">Hire Date</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-500 text-xs">Update Name?</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {matchRows.map((m) => {
                            const bamboo = getSelectedBamboo(m)
                            const isAccepted = accepted.has(m.employeeId)
                            const currentSelIdx = m.employeeId in bambooSelections ? bambooSelections[m.employeeId] : m.autoMatchIdx
                            const nameDiffers = bamboo !== null && bamboo.name.toLowerCase() !== m.employeeName.toLowerCase()
                            const autoConf = m.autoMatchIdx !== null ? Math.round(m.confidence * 100) : null
                            return (
                              <tr key={m.employeeId} className={`transition-colors ${isAccepted ? 'bg-white' : 'bg-gray-50/30'}`}>
                                <td className="px-3 py-2.5">
                                  <input type="checkbox" checked={isAccepted}
                                    disabled={bamboo === null}
                                    onChange={() => {
                                      setAccepted(prev => {
                                        const next = new Set(prev)
                                        next.has(m.employeeId) ? next.delete(m.employeeId) : next.add(m.employeeId)
                                        return next
                                      })
                                    }}
                                    className="accent-indigo-600 w-3.5 h-3.5 disabled:opacity-30" />
                                </td>
                                <td className="px-3 py-2.5 font-medium text-gray-800 whitespace-nowrap">{m.employeeName}</td>
                                <td className="px-3 py-2 min-w-[220px]">
                                  <BambooCombobox
                                    options={bambooOptions}
                                    value={currentSelIdx ?? null}
                                    onChange={(val) => {
                                      setBambooSelections(prev => ({ ...prev, [m.employeeId]: val }))
                                      if (val === null) {
                                        setAccepted(prev => { const next = new Set(prev); next.delete(m.employeeId); return next })
                                        setUpdateNames(prev => { const next = new Set(prev); next.delete(m.employeeId); return next })
                                      } else {
                                        setAccepted(prev => new Set([...prev, m.employeeId]))
                                      }
                                    }}
                                  />
                                </td>
                                <td className="px-3 py-2.5 whitespace-nowrap">
                                  {autoConf !== null ? (
                                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                                      autoConf >= 90 ? 'bg-green-100 text-green-700'
                                      : autoConf >= 70 ? 'bg-amber-100 text-amber-700'
                                      : 'bg-red-100 text-red-700'
                                    }`}>{autoConf}%</span>
                                  ) : (
                                    <span className="text-xs text-gray-300">—</span>
                                  )}
                                </td>
                                <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">
                                  {bamboo ? bamboo.hireDate : <span className="text-gray-300">—</span>}
                                </td>
                                <td className="px-3 py-2.5">
                                  {nameDiffers ? (
                                    <label className="flex items-center gap-1.5 cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={updateNames.has(m.employeeId)}
                                        onChange={() => setUpdateNames(prev => {
                                          const next = new Set(prev)
                                          next.has(m.employeeId) ? next.delete(m.employeeId) : next.add(m.employeeId)
                                          return next
                                        })}
                                        className="accent-indigo-600 w-3.5 h-3.5"
                                      />
                                      <span className="text-xs text-gray-600">→ <span className="font-medium">{bamboo!.name}</span></span>
                                    </label>
                                  ) : (
                                    <span className="text-xs text-gray-300">—</span>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        onClick={handleApply}
                        disabled={applying || accepted.size === 0}
                        className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                      >
                        {applying ? 'Saving…' : `Apply ${accepted.size} match${accepted.size !== 1 ? 'es' : ''}`}
                      </button>
                      <span className="text-xs text-gray-400">{accepted.size} of {matchRows.length} selected</span>
                    </div>
                  </div>
                )}
              </div>
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
