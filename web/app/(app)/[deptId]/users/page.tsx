'use client'

import { useState, useEffect } from 'react'
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
} from '@/lib/db'

const ROLE_LABELS: Record<UserRole, string> = {
  superadmin: 'Superadmin',
  admin: 'Admin',
  manager: 'Manager',
}

export default function UsersPage() {
  const { user, userRole, departments } = useApp()
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

  useEffect(() => {
    if (!isAdmin) {
      router.replace('matrix')
      return
    }
    loadUsers()
  }, [isAdmin]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadUsers = async () => {
    setLoading(true)
    const [p, assignments] = await Promise.all([
      fetchAllUserProfiles(),
      fetchAllDepartmentAssignments(),
    ])
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
    setProfiles((prev) => prev.map((p) => p.email === email ? { ...p, role: newRole } : p))
  }

  const handleToggleDept = async (email: string, deptId: string) => {
    const current = deptAssignments[email] ?? new Set()
    if (current.has(deptId)) {
      await removeUserFromDepartment(email, deptId)
      setDeptAssignments((prev) => {
        const next = { ...prev, [email]: new Set(prev[email]) }
        next[email].delete(deptId)
        return next
      })
    } else {
      await assignUserToDepartment(email, deptId)
      setDeptAssignments((prev) => {
        const next = { ...prev, [email]: new Set(prev[email]) }
        next[email].add(deptId)
        return next
      })
    }
  }

  const handleRemove = async (email: string) => {
    if (!confirm(`Remove ${email} from the system?`)) return
    await deleteUserProfile(email)
    setProfiles((prev) => prev.filter((p) => p.email !== email))
    setDeptAssignments((prev) => { const n = { ...prev }; delete n[email]; return n })
  }

  if (!isAdmin) return null

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold text-gray-900">Users</h1>

      {/* Add User */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Add User</h2>
        <div className="flex gap-3">
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
            placeholder="email@company.com"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
          <select
            value={inviteRole}
            onChange={(e) => { setInviteRole(e.target.value as UserRole); setInviteDepts([]) }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
          >
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
            {isSuperAdmin && <option value="superadmin">Superadmin</option>}
          </select>
          <button
            onClick={handleInvite}
            disabled={inviting || !inviteEmail.trim()}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
          >
            {inviting ? 'Adding…' : 'Add'}
          </button>
        </div>

        {inviteRole === 'manager' && departments.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-gray-500 font-medium">Department access</p>
            <div className="flex flex-wrap gap-2">
              {departments.map((d) => (
                <label key={d.id} className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={inviteDepts.includes(d.id)}
                    onChange={(e) =>
                      setInviteDepts((prev) =>
                        e.target.checked ? [...prev, d.id] : prev.filter((id) => id !== d.id),
                      )
                    }
                    className="accent-indigo-600 w-3.5 h-3.5"
                  />
                  <span className="text-sm text-gray-700">{d.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {inviteError && <p className="text-sm text-red-500">{inviteError}</p>}
      </div>

      {/* User List */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
            All Users {!loading && `(${profiles.length})`}
          </h2>
          <button onClick={loadUsers} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
            ↻ Refresh
          </button>
        </div>

        {loading ? (
          <div className="px-6 py-8 text-sm text-gray-400">Loading…</div>
        ) : profiles.length === 0 ? (
          <div className="px-6 py-8 text-sm text-gray-400">No users yet.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {profiles.map((profile) => {
              const isMe = profile.email === user.email
              const isProfileSuperAdmin = profile.role === 'superadmin'
              const canEditRole = !isMe && (isSuperAdmin || !isProfileSuperAdmin)
              const assigned = deptAssignments[profile.email] ?? new Set()

              return (
                <li key={profile.email} className="px-6 py-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="flex-1 text-sm text-gray-900 truncate">
                      {profile.email}
                      {isMe && (
                        <span className="ml-2 text-xs text-gray-400 font-normal">(you)</span>
                      )}
                    </span>

                    {canEditRole ? (
                      <select
                        value={profile.role}
                        onChange={(e) => handleChangeRole(profile.email, e.target.value as UserRole)}
                        className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="manager">Manager</option>
                        <option value="admin">Admin</option>
                        {isSuperAdmin && <option value="superadmin">Superadmin</option>}
                      </select>
                    ) : (
                      <span className={`text-sm font-medium ${
                        isProfileSuperAdmin ? 'text-amber-600' : profile.role === 'admin' ? 'text-indigo-600' : 'text-gray-500'
                      }`}>
                        {ROLE_LABELS[profile.role]}
                      </span>
                    )}

                    {!isMe && (
                      <button
                        onClick={() => handleRemove(profile.email)}
                        className="text-gray-300 hover:text-red-500 transition-colors text-sm"
                        title="Remove user"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  {profile.role === 'manager' && (
                    <div className="flex flex-wrap gap-1.5">
                      {departments.map((d) => {
                        const has = assigned.has(d.id)
                        return (
                          <button
                            key={d.id}
                            onClick={() => handleToggleDept(profile.email, d.id)}
                            className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                              has
                                ? 'bg-indigo-600 border-indigo-600 text-white hover:bg-indigo-700'
                                : 'border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-700'
                            }`}
                          >
                            {d.name}
                          </button>
                        )
                      })}
                      {assigned.size === 0 && (
                        <span className="text-xs text-amber-600 font-medium">no department access</span>
                      )}
                    </div>
                  )}

                  {profile.role !== 'manager' && (
                    <p className="text-xs text-gray-400">Access to all departments</p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
