'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { UserProfile, UserRole } from '@/lib/types'
import { useApp } from '@/components/AppShell'
import {
  fetchAllUserProfiles,
  fetchAllDepartmentAssignments,
  inviteUser,
  updateUserRole,
  assignUserToDepartment,
  removeUserFromDepartment,
  deleteUserProfile,
  bulkInviteManagers,
} from '@/lib/db'

type BulkRow = { email: string; deptId: string | null; csvDeptName: string | null }

function parseCsvRows(text: string, depts: Array<{ id: string; name: string }>): BulkRow[] {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (lines.length === 0) return []

  const splitLine = (line: string) => line.split(',').map(c => c.trim().replace(/^["']|["']$/g, ''))

  let emailCol = -1, deptCol = -1, startLine = 0
  const firstCells = splitLine(lines[0])
  const firstRowHasEmail = firstCells.some(c => c.includes('@'))

  if (!firstRowHasEmail) {
    // Treat first row as header
    emailCol = firstCells.findIndex(c => /^e-?mails?$/i.test(c))
    if (emailCol < 0) emailCol = 0
    deptCol = firstCells.findIndex(c => /^dep(t|artment)s?$/i.test(c))
    startLine = 1
  } else {
    // No header — email is whichever cell has @, no dept column
    emailCol = -1
    deptCol = -1
    startLine = 0
  }

  const seen = new Set<string>()
  const rows: BulkRow[] = []

  for (let i = startLine; i < lines.length; i++) {
    const cells = splitLine(lines[i])
    const email = (emailCol >= 0 ? cells[emailCol] : cells.find(c => c.includes('@')) ?? '')
      .toLowerCase().trim()
    if (!email || !email.includes('@') || !email.includes('.')) continue
    if (seen.has(email)) continue
    seen.add(email)

    let csvDeptName: string | null = null
    let deptId: string | null = null
    if (deptCol >= 0 && cells[deptCol]?.trim()) {
      csvDeptName = cells[deptCol].trim()
      deptId = depts.find(d => d.name.toLowerCase() === csvDeptName!.toLowerCase())?.id ?? null
    }

    rows.push({ email, deptId, csvDeptName })
  }

  return rows
}

const ROLE_COLORS: Record<UserRole, string> = {
  superadmin: 'bg-amber-100 text-amber-700',
  admin: 'bg-indigo-100 text-indigo-700',
  manager: 'bg-gray-100 text-gray-600',
}

export default function UsersPage() {
  const { user, userRole, departments, activeDepartment } = useApp()
  const router = useRouter()
  const isAdmin = userRole === 'admin' || userRole === 'superadmin'
  const isSuperAdmin = userRole === 'superadmin'

  const [profiles, setProfiles] = useState<UserProfile[]>([])
  const [deptAssignments, setDeptAssignments] = useState<Record<string, Set<string>>>({})
  const [loading, setLoading] = useState(true)

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<UserRole>('manager')
  const [inviteDepts, setInviteDepts] = useState<string[]>([])
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState('')

  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [bulkPreview, setBulkPreview] = useState<BulkRow[]>([])
  const [bulkDeptId, setBulkDeptId] = useState<string>('')
  const [bulkImporting, setBulkImporting] = useState(false)
  const [bulkResult, setBulkResult] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isAdmin) { router.replace('matrix'); return }
    loadUsers()
  }, [isAdmin]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!bulkDeptId && activeDepartment?.id) setBulkDeptId(activeDepartment.id)
  }, [activeDepartment?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadUsers = async () => {
    setLoading(true)
    const [p, assignments] = await Promise.all([fetchAllUserProfiles(), fetchAllDepartmentAssignments()])
    setProfiles(p)
    const map: Record<string, Set<string>> = {}
    for (const { user_email, department_id } of assignments) {
      if (!map[user_email]) map[user_email] = new Set()
      map[user_email].add(department_id)
    }
    setDeptAssignments(map)
    setLoading(false)
  }

  const handleInvite = async () => {
    setInviteError('')
    const clean = inviteEmail.trim().toLowerCase()
    if (!clean) return
    if (!clean.includes('@')) { setInviteError('Enter a valid email address.'); return }
    setInviting(true)
    try {
      await inviteUser(clean, inviteRole, inviteRole === 'manager' ? inviteDepts : [])
      setInviteEmail('')
      setInviteRole('manager')
      setInviteDepts([])
      await loadUsers()
    } catch {
      setInviteError('Failed to add user. Try again.')
    } finally {
      setInviting(false)
    }
  }

  const handleChangeRole = async (email: string, newRole: UserRole) => {
    await updateUserRole(email, newRole)
    setProfiles(prev => prev.map(p => p.email === email ? { ...p, role: newRole } : p))
  }

  const handleToggleDept = async (email: string, deptId: string) => {
    const current = deptAssignments[email] ?? new Set()
    if (current.has(deptId)) {
      await removeUserFromDepartment(email, deptId)
      setDeptAssignments(prev => {
        const next = { ...prev, [email]: new Set(prev[email]) }
        next[email].delete(deptId)
        return next
      })
    } else {
      await assignUserToDepartment(email, deptId)
      setDeptAssignments(prev => {
        const next = { ...prev, [email]: new Set(prev[email]) }
        next[email].add(deptId)
        return next
      })
    }
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      setBulkText(text)
      setBulkPreview(parseCsvRows(text, departments))
      setBulkResult('')
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleBulkImport = async () => {
    if (bulkPreview.length === 0) return
    setBulkImporting(true)
    setBulkResult('')
    try {
      const rows = bulkPreview
        .map(r => ({ email: r.email, deptId: r.deptId ?? bulkDeptId }))
        .filter(r => r.deptId)
      const count = await bulkInviteManagers(rows)
      setBulkResult(`${count} user${count !== 1 ? 's' : ''} imported successfully.`)
      setBulkText('')
      setBulkPreview([])
      await loadUsers()
    } catch {
      setBulkResult('Import failed. Please try again.')
    } finally {
      setBulkImporting(false)
    }
  }

  const handleRemove = async (email: string) => {
    if (!confirm(`Remove ${email} from the system?`)) return
    await deleteUserProfile(email)
    setProfiles(prev => prev.filter(p => p.email !== email))
    setDeptAssignments(prev => { const n = { ...prev }; delete n[email]; return n })
  }

  if (!isAdmin) return null

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">
          Users
          {!loading && <span className="ml-2 text-base font-normal text-gray-400">({profiles.length})</span>}
        </h1>
        <button onClick={loadUsers} className="text-sm text-gray-400 hover:text-gray-600 transition-colors px-2">↻</button>
      </div>

      {/* Add User */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Add User</p>
        <div className="flex gap-2">
          <input
            type="email"
            value={inviteEmail}
            onChange={e => setInviteEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleInvite()}
            placeholder="email@company.com"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <select
            value={inviteRole}
            onChange={e => { setInviteRole(e.target.value as UserRole); setInviteDepts([]) }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
          >
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
            {isSuperAdmin && <option value="superadmin">Superadmin</option>}
          </select>
          <button
            onClick={handleInvite}
            disabled={inviting || !inviteEmail.trim()}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors whitespace-nowrap"
          >
            {inviting ? 'Adding…' : 'Add'}
          </button>
        </div>

        {inviteRole === 'manager' && departments.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs text-gray-400">Initial edit access <span className="text-gray-300">(can change later)</span></p>
            <div className="flex flex-wrap gap-1.5">
              {departments.map(d => (
                <button
                  key={d.id}
                  onClick={() => setInviteDepts(prev => prev.includes(d.id) ? prev.filter(id => id !== d.id) : [...prev, d.id])}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    inviteDepts.includes(d.id)
                      ? 'bg-indigo-600 border-indigo-600 text-white'
                      : 'border-gray-300 text-gray-500 hover:border-gray-400'
                  }`}
                >
                  {d.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {inviteError && <p className="text-sm text-red-500">{inviteError}</p>}
      </div>

      {/* Bulk Import */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <button
          onClick={() => { setBulkOpen(o => !o); setBulkResult('') }}
          className="w-full flex items-center justify-between text-left"
        >
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Bulk Import from CSV</p>
          <span className="text-xs text-gray-400">{bulkOpen ? '▲' : '▼'}</span>
        </button>

        {bulkOpen && (
          <div className="mt-4 space-y-3">
            <p className="text-xs text-gray-400">
              Upload a CSV or paste below. Include a <code className="bg-gray-100 px-1 rounded">department</code> column to assign each person to a specific department, or use the fallback dropdown for everyone.
              <span className="block mt-1 text-gray-300">Example: <span className="font-mono">email,department</span></span>
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt"
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Upload file
              </button>
              <span className="text-xs text-gray-300">or paste below</span>
              {bulkText && (
                <button
                  onClick={() => { setBulkText(''); setBulkPreview([]); setBulkResult('') }}
                  className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >
                  Clear
                </button>
              )}
            </div>

            <textarea
              value={bulkText}
              onChange={e => { setBulkText(e.target.value); setBulkPreview(parseCsvRows(e.target.value, departments)); setBulkResult('') }}
              placeholder={"email,department\nalice@company.com,Assembly\nbob@company.com,Quality"}
              rows={4}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono resize-y"
            />

            {bulkPreview.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs text-gray-500 font-medium">{bulkPreview.length} row{bulkPreview.length !== 1 ? 's' : ''} detected</p>
                <div className="max-h-48 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-50">
                  {bulkPreview.map(row => {
                    const resolvedDept = row.deptId
                      ? departments.find(d => d.id === row.deptId)?.name
                      : null
                    const fallbackDept = departments.find(d => d.id === bulkDeptId)?.name
                    const isUnmatched = row.csvDeptName && !row.deptId
                    return (
                      <div key={row.email} className="flex items-center justify-between px-3 py-1.5 bg-white hover:bg-gray-50">
                        <span className="text-xs text-gray-700 font-mono">{row.email}</span>
                        <span className={`text-xs ml-3 whitespace-nowrap ${
                          isUnmatched ? 'text-amber-500' : 'text-gray-400'
                        }`}>
                          {isUnmatched
                            ? `⚠ "${row.csvDeptName}" not found`
                            : resolvedDept
                              ? `→ ${resolvedDept}`
                              : `→ ${fallbackDept ?? '(no dept)'}`
                          }
                        </span>
                      </div>
                    )
                  })}
                </div>
                {bulkPreview.some(r => r.csvDeptName && !r.deptId) && (
                  <p className="text-xs text-amber-500">⚠ Rows with unmatched departments will use the fallback below.</p>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500 whitespace-nowrap">
                  {bulkPreview.some(r => !r.deptId) ? 'Fallback department:' : 'Department:'}
                </label>
                <select
                  value={bulkDeptId}
                  onChange={e => setBulkDeptId(e.target.value)}
                  className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {departments.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>

              <button
                onClick={handleBulkImport}
                disabled={bulkPreview.length === 0 || bulkImporting || !bulkDeptId}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors whitespace-nowrap"
              >
                {bulkImporting ? 'Importing…' : `Import ${bulkPreview.length > 0 ? bulkPreview.length : ''} user${bulkPreview.length !== 1 ? 's' : ''}`}
              </button>
            </div>

            {bulkResult && (
              <p className={`text-sm font-medium ${bulkResult.includes('failed') ? 'text-red-500' : 'text-green-600'}`}>
                {bulkResult}
              </p>
            )}
          </div>
        )}
      </div>

      {/* User Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <p className="px-5 py-8 text-sm text-gray-400">Loading…</p>
        ) : profiles.length === 0 ? (
          <p className="px-5 py-8 text-sm text-gray-400">No users yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-2.5 text-left font-medium text-gray-500 text-xs">User</th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-500 text-xs">Role</th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-500 text-xs">
                  Department Access
                  <span className="ml-1.5 font-normal text-gray-400">· managers always have view; set edit per department</span>
                </th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {profiles.map(profile => {
                const isMe = profile.email === user.email
                const isProfileSuperAdmin = profile.role === 'superadmin'
                const canEditRole = !isMe && (isSuperAdmin || !isProfileSuperAdmin)
                const assigned = deptAssignments[profile.email] ?? new Set()
                const isManager = profile.role === 'manager'

                return (
                  <tr key={profile.email} className="hover:bg-gray-50/50 align-top">
                    <td className="px-4 py-3">
                      <span className="text-gray-900 font-medium">{profile.display_name}</span>
                      <span className="ml-1.5 text-xs text-gray-400">{profile.email}</span>
                      {isMe && <span className="ml-1.5 text-xs text-gray-300">(you)</span>}
                    </td>

                    <td className="px-4 py-3 whitespace-nowrap">
                      {canEditRole ? (
                        <select
                          value={profile.role}
                          onChange={e => handleChangeRole(profile.email, e.target.value as UserRole)}
                          className="border border-gray-200 rounded-md px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-700"
                        >
                          <option value="manager">Manager</option>
                          <option value="admin">Admin</option>
                          {isSuperAdmin && <option value="superadmin">Superadmin</option>}
                        </select>
                      ) : (
                        <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_COLORS[profile.role]}`}>
                          {profile.role === 'superadmin' ? 'Superadmin' : profile.role === 'admin' ? 'Admin' : 'Manager'}
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-2.5">
                      {isManager ? (
                        <div className="space-y-1 py-0.5">
                          {departments.map(d => {
                            const hasEdit = assigned.has(d.id)
                            return (
                              <div key={d.id} className="flex items-center gap-2">
                                <span className="text-xs text-gray-600 w-28 truncate">{d.name}</span>
                                <div className="inline-flex rounded border border-gray-200 overflow-hidden text-xs">
                                  <button
                                    onClick={() => hasEdit && handleToggleDept(profile.email, d.id)}
                                    className={`px-2.5 py-0.5 transition-colors ${
                                      !hasEdit
                                        ? 'bg-gray-100 text-gray-700 font-medium'
                                        : 'text-gray-400 hover:bg-gray-50'
                                    }`}
                                  >
                                    View
                                  </button>
                                  <button
                                    onClick={() => !hasEdit && handleToggleDept(profile.email, d.id)}
                                    className={`px-2.5 py-0.5 border-l border-gray-200 transition-colors ${
                                      hasEdit
                                        ? 'bg-indigo-600 text-white font-medium'
                                        : 'text-gray-400 hover:text-indigo-600 hover:bg-indigo-50'
                                    }`}
                                  >
                                    Edit
                                  </button>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">All departments</span>
                      )}
                    </td>

                    <td className="px-3 py-3 text-right">
                      {!isMe && (
                        <button
                          onClick={() => handleRemove(profile.email)}
                          className="text-gray-300 hover:text-red-500 transition-colors"
                          title="Remove user"
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
