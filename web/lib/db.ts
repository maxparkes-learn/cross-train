import { createClient } from '@/lib/supabase/client'
import type {
  Station,
  Employee,
  AssignmentLog,
  CrossTrainingLog,
  AuditLog,
  AppSettings,
  Department,
  UserProfile,
  UserRole,
  CompetencyChange,
  CompetencyChangeMap,
} from './types'
import {
  DEFAULT_SKILL_LABELS,
  DEFAULT_CERT_LABELS,
  DEFAULT_COMPETENCY_COLORS,
  ADMIN_EMAIL,
} from './types'

// ---- Departments ----

export async function fetchDepartments(): Promise<Department[]> {
  const db = createClient()
  const { data, error } = await db.from('departments').select('*').order('name')
  if (error) throw error
  return data
}

export async function createDepartment(name: string): Promise<Department> {
  const db = createClient()
  const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  const { data, error } = await db.from('departments').insert({ id, name: name.trim() }).select().single()
  if (error) throw error
  return data
}

export async function deleteDepartment(id: string): Promise<void> {
  const db = createClient()
  const { error } = await db.from('departments').delete().eq('id', id)
  if (error) throw error
}

export async function renameDepartment(id: string, name: string): Promise<void> {
  const db = createClient()
  const { error } = await db.from('departments').update({ name: name.trim() }).eq('id', id)
  if (error) throw error
}

// ---- User Profiles ----

/**
 * Ensures a profile row exists and stamps the user as active.
 *
 * Called from the authenticated layout, so this runs on every page load. That is
 * what makes last_seen_at meaningful — unlike last_sign_in_at, which a persisted
 * session never re-triggers. The timestamp comes from the server rather than the
 * browser, so it cannot be skewed by a user's machine clock.
 *
 * Writing on every page load is deliberate and cheap here: there are a couple of
 * dozen users, and it costs no extra round trip because the existing insert/update
 * pair already ran.
 */
/**
 * Resolves a signed-in account against the invite list.
 *
 * Access is invite-only: returns null when the account has no profile, and the caller
 * is expected to eject them. This deliberately no longer creates a profile on sight —
 * doing so silently granted the manager role to any @clutch.ca account that merely
 * opened the app, which is how employee records ended up in the Users tab.
 *
 * For an invited account it refreshes display_name from Google and stamps activity.
 */
export async function syncSignedInUser(
  email: string,
  displayName: string,
): Promise<UserProfile | null> {
  const db = createClient()

  let profile = await fetchUserProfile(email)

  // Anti-lockout escape hatch. Sign-in now depends on a profile row existing, so
  // without this the owner losing their own row would lock everyone out of the app
  // permanently with no recovery path short of the SQL editor.
  if (!profile && email === ADMIN_EMAIL) {
    await db
      .from('user_profiles')
      .insert({ email, display_name: displayName, role: 'superadmin' })
    profile = await fetchUserProfile(email)
  }

  if (!profile) return null

  if (profile.display_name !== displayName) {
    await db.from('user_profiles').update({ display_name: displayName }).eq('email', email)
  }
  await touchLastSeen(email)

  return profile
}

/**
 * Stamps the user as active. Deliberately a separate, failure-tolerant write rather
 * than part of the insert above: if this ships before the migration adds the column,
 * PostgREST rejects the whole row, and folding it in would mean a brand-new user
 * silently gets no profile row at all. Keeping it separate makes deploy order
 * irrelevant — pre-migration this no-ops and everything else behaves as before.
 *
 * The timestamp is the server's, since this is called from a server component, so a
 * user's machine clock cannot skew it.
 */
async function touchLastSeen(email: string): Promise<void> {
  const db = createClient()
  const { error } = await db
    .from('user_profiles')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('email', email)
  if (error) console.error('last_seen_at update failed', error)
}

/**
 * Records a real OAuth authentication: stamps last_sign_in_at and appends to the
 * login log. Call this only from the auth callback, never from a page load.
 *
 * Best-effort — a failure here must not block the user from getting into the app,
 * so nothing throws. The profile row is guaranteed to exist: the callback only reaches
 * this after syncSignedInUser has confirmed the account is invited.
 */
export async function recordSignIn(email: string): Promise<void> {
  const db = createClient()
  const now = new Date().toISOString()
  try {
    const [profileResult, eventResult] = await Promise.all([
      db.from('user_profiles').update({ last_sign_in_at: now, last_seen_at: now }).eq('email', email),
      db.from('login_events').insert({ user_email: email }),
    ])
    if (profileResult.error) console.error('last_sign_in_at update failed', profileResult.error)
    if (eventResult.error) console.error('login_events insert failed', eventResult.error)
  } catch (err) {
    console.error('recordSignIn failed', err)
  }
}

/**
 * Total recorded sign-ins per user email.
 *
 * Counts client-side over the whole log, matching the aggregation style used
 * elsewhere in this file. Safe because login_events records authentications rather
 * than page loads, so it grows by a handful of rows a month for a couple of dozen
 * users. Never throws — this only enriches a tooltip.
 */
export async function fetchSignInCounts(): Promise<Record<string, number>> {
  const db = createClient()
  try {
    const { data, error } = await db.from('login_events').select('user_email')
    if (error) throw error

    const counts: Record<string, number> = {}
    for (const row of (data ?? []) as { user_email: string }[]) {
      counts[row.user_email] = (counts[row.user_email] ?? 0) + 1
    }
    return counts
  } catch (err) {
    console.error('fetchSignInCounts failed', err)
    return {}
  }
}

/**
 * Returns null only when no such profile exists, and throws on any other failure.
 *
 * That distinction is load-bearing now that access is invite-only: null means "not
 * invited" and gets the account signed out, so quietly returning null for a transient
 * database error would eject legitimate users during a blip. maybeSingle() gives 0
 * rows without treating it as an error, leaving real errors to surface as errors.
 */
export async function fetchUserProfile(email: string): Promise<UserProfile | null> {
  const db = createClient()
  const { data, error } = await db
    .from('user_profiles')
    .select('*')
    .eq('email', email)
    .maybeSingle()
  if (error) throw error
  return data as UserProfile | null
}

export async function fetchAllUserProfiles(): Promise<UserProfile[]> {
  const db = createClient()
  const { data, error } = await db.from('user_profiles').select('*').order('email')
  if (error) throw error
  return data as UserProfile[]
}

export async function inviteUser(email: string, role: UserRole, deptIds: string[]): Promise<void> {
  const db = createClient()
  const cleanEmail = email.trim().toLowerCase()
  const { error } = await db
    .from('user_profiles')
    .insert({ email: cleanEmail, display_name: cleanEmail.split('@')[0], role })
  if (error) {
    // Already exists — update role
    await db.from('user_profiles').update({ role }).eq('email', cleanEmail)
  }
  if (deptIds.length > 0) {
    await db.from('department_users').upsert(
      deptIds.map((deptId) => ({ department_id: deptId, user_email: cleanEmail })),
      { ignoreDuplicates: true },
    )
  }
}

export async function updateUserRole(email: string, role: UserRole): Promise<void> {
  const db = createClient()
  const { error } = await db.from('user_profiles').update({ role }).eq('email', email)
  if (error) throw error
}

// ---- Department Access ----

export async function fetchUserDepartments(email: string): Promise<Department[]> {
  const db = createClient()
  const { data, error } = await db
    .from('department_users')
    .select('departments(*)')
    .eq('user_email', email)
  if (error) throw error
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => row.departments as Department).filter(Boolean)
}

export async function fetchAllDepartmentAssignments(): Promise<Array<{ department_id: string; user_email: string }>> {
  const db = createClient()
  const { data, error } = await db.from('department_users').select('*')
  if (error) throw error
  return data ?? []
}

export async function assignUserToDepartment(email: string, deptId: string): Promise<void> {
  const db = createClient()
  const { error } = await db.from('department_users').upsert({ department_id: deptId, user_email: email })
  if (error) throw error
}

export async function removeUserFromDepartment(email: string, deptId: string): Promise<void> {
  const db = createClient()
  const { error } = await db.from('department_users').delete().eq('department_id', deptId).eq('user_email', email)
  if (error) throw error
}

/**
 * Revokes a person's access to the app: removes their department assignments and their
 * profile row, so they can no longer sign in (access is invite-only).
 *
 * This does NOT touch the `employees` table. Employees and app users are entirely
 * separate records — employees have no email column and are never joined to profiles —
 * so someone's employee entry, competencies and cross-training history all survive this
 * untouched. Named for what it does, because "delete user profile" reads like erasing
 * the person.
 */
export async function revokeAppAccess(email: string): Promise<void> {
  const db = createClient()
  await db.from('department_users').delete().eq('user_email', email)
  const { error } = await db.from('user_profiles').delete().eq('email', email)
  if (error) throw error
}

// ---- Stations ----

export async function fetchStations(deptId: string): Promise<Station[]> {
  const db = createClient()
  const { data, error } = await db.from('stations').select('*').eq('department_id', deptId).order('sort_order').order('name')
  if (error) throw error
  return data
}

export async function upsertStation(station: Partial<Station> & { id: string }, deptId: string): Promise<Station> {
  const db = createClient()
  const { data, error } = await db
    .from('stations')
    .upsert({ ...station, department_id: deptId })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteStation(stationId: string): Promise<void> {
  const db = createClient()
  const { error } = await db.from('stations').delete().eq('id', stationId)
  if (error) throw error
}

// ---- Employees ----

export async function fetchEmployees(deptId: string): Promise<Employee[]> {
  const db = createClient()
  const { data: empRows, error: empError } = await db.from('employees').select('*').or(`department_id.eq.${deptId},secondary_department_ids.cs.{${deptId}}`).eq('is_archived', false).order('sort_order').order('name')
  if (empError) throw empError

  const { data: compRows, error: compError } = await db.from('competencies').select('*').in('employee_id', empRows.map((e) => e.id))
  if (compError) throw compError

  const compByEmployee: Record<string, Record<string, number>> = {}
  for (const c of compRows) {
    if (!compByEmployee[c.employee_id]) compByEmployee[c.employee_id] = {}
    compByEmployee[c.employee_id][c.station_id] = c.level
  }

  return empRows.map((e) => ({
    ...e,
    station_competencies: compByEmployee[e.id] ?? {},
  }))
}

export async function upsertEmployee(employee: Partial<Employee> & { id: string }, deptId?: string): Promise<void> {
  const db = createClient()
  const { station_competencies: _, secondary_department_ids: __, ...row } = employee as Employee
  const data = deptId
    ? { ...row, is_archived: row.is_archived ?? false, department_id: deptId }
    : { ...row, is_archived: row.is_archived ?? false }
  const { error } = await db.from('employees').upsert(data)
  if (error) throw error
}

export async function fetchAllEmployees(): Promise<Employee[]> {
  const db = createClient()
  const { data: empRows, error: empError } = await db.from('employees').select('*').eq('is_archived', false).order('name')
  if (empError) throw empError
  return empRows.map((e) => ({ ...e, station_competencies: {} }))
}

export async function fetchAllEmployeesWithCompetencies(): Promise<Employee[]> {
  const db = createClient()
  const { data: empRows, error: empError } = await db.from('employees').select('*').eq('is_archived', false).order('name')
  if (empError) throw empError

  const { data: compRows, error: compError } = await db
    .from('competencies').select('*')
    .in('employee_id', empRows.map((e) => e.id))
  if (compError) throw compError

  const compByEmployee: Record<string, Record<string, number>> = {}
  for (const c of compRows) {
    if (!compByEmployee[c.employee_id]) compByEmployee[c.employee_id] = {}
    compByEmployee[c.employee_id][c.station_id] = c.level
  }
  return empRows.map((e) => ({ ...e, station_competencies: compByEmployee[e.id] ?? {} }))
}

export async function fetchAllStations(): Promise<Station[]> {
  const db = createClient()
  const { data, error } = await db.from('stations').select('*').order('name')
  if (error) throw error
  return data
}

export async function fetchArchivedEmployees(): Promise<Employee[]> {
  const db = createClient()
  const { data, error } = await db.from('employees').select('*').eq('is_archived', true).order('name')
  if (error) throw error
  return data.map((e) => ({ ...e, station_competencies: {} }))
}

export async function unarchiveEmployee(employeeId: string): Promise<void> {
  const db = createClient()
  const { error } = await db.from('employees').update({ is_archived: false }).eq('id', employeeId)
  if (error) throw error
}

export async function reorderEmployees(orderedIds: string[]): Promise<void> {
  const db = createClient()
  await Promise.all(
    orderedIds.map((id, index) => db.from('employees').update({ sort_order: index }).eq('id', id))
  )
}

export async function reorderStations(orderedIds: string[]): Promise<void> {
  const db = createClient()
  await Promise.all(
    orderedIds.map((id, index) => db.from('stations').update({ sort_order: index }).eq('id', id))
  )
}

export async function updateEmployeeDepartment(employeeId: string, deptId: string): Promise<void> {
  const db = createClient()
  const { error } = await db.from('employees').update({ department_id: deptId }).eq('id', employeeId)
  if (error) throw error
}

export async function deleteEmployee(employeeId: string): Promise<void> {
  const db = createClient()
  const { error } = await db.from('employees').update({ is_archived: true }).eq('id', employeeId)
  if (error) throw error
}

export async function addEmployeeToSecondaryDepartment(employeeId: string, deptId: string): Promise<void> {
  const db = createClient()
  const { data: emp } = await db.from('employees').select('secondary_department_ids').eq('id', employeeId).single()
  const current: string[] = emp?.secondary_department_ids ?? []
  if (current.includes(deptId)) return
  const { error } = await db.from('employees').update({ secondary_department_ids: [...current, deptId] }).eq('id', employeeId)
  if (error) throw error
}

export async function removeEmployeeFromSecondaryDepartment(employeeId: string, deptId: string): Promise<void> {
  const db = createClient()
  const { data: emp } = await db.from('employees').select('secondary_department_ids').eq('id', employeeId).single()
  const current: string[] = emp?.secondary_department_ids ?? []
  const { error } = await db.from('employees').update({ secondary_department_ids: current.filter(id => id !== deptId) }).eq('id', employeeId)
  if (error) throw error
}

export async function fetchAllEmployeesBasic(): Promise<Pick<Employee, 'id' | 'name' | 'department_id' | 'secondary_department_ids'>[]> {
  const db = createClient()
  const { data, error } = await db.from('employees').select('id, name, department_id, secondary_department_ids').eq('is_archived', false).order('name')
  if (error) throw error
  return data ?? []
}

export async function updateEmployeeName(employeeId: string, name: string): Promise<void> {
  const db = createClient()
  const { error } = await db.from('employees').update({ name }).eq('id', employeeId)
  if (error) throw error
}

export async function updateEmployeeHireDate(employeeId: string, hireDate: string): Promise<void> {
  const db = createClient()
  const { error } = await db.from('employees').update({ hire_date: hireDate }).eq('id', employeeId)
  if (error) throw error
}

export async function updateEmployeeAbsence(employeeId: string, isAbsent: boolean): Promise<void> {
  const db = createClient()
  const { error } = await db
    .from('employees')
    .update({ is_absent: isAbsent })
    .eq('id', employeeId)
  if (error) throw error
}

// ---- Competencies ----

/**
 * Writes an employee's competency levels, recording any genuine changes to
 * competency_changes.
 *
 * The caller passes the employee's ENTIRE station map on every debounced save --
 * including saves triggered by a pure name, certification or group edit -- so this
 * diffs against current state and writes only what actually changed. Without the
 * diff, a single keystroke in the name field would rewrite every station row and
 * log a history entry for each one.
 *
 * Previous levels are read from the database rather than taken from the caller,
 * because the caller's React state is stale by construction: the save is
 * 800ms-debounced and the matrix never rebuilds its rows from the server after an
 * edit. Trusting it would let one user's stale tab both overwrite another user's
 * change and log a transition that never happened.
 *
 * Returns the history rows it wrote, carrying the server's changed_at, so the UI
 * can update optimistically with the persisted value rather than a guess.
 */
export async function upsertCompetencies(
  employeeId: string,
  competencies: Record<string, number>,
  actor?: { email: string; stations: Pick<Station, 'id' | 'name' | 'department_id'>[] },
): Promise<CompetencyChange[]> {
  const db = createClient()
  const stationIds = Object.keys(competencies)
  if (stationIds.length === 0) return []

  const { data: existingRows, error: readError } = await db
    .from('competencies')
    .select('station_id, level')
    .eq('employee_id', employeeId)
    .in('station_id', stationIds)
  if (readError) throw readError

  const previous = new Map<string, number>(
    (existingRows ?? []).map((r: { station_id: string; level: number }) => [r.station_id, r.level]),
  )

  // A missing row and a level of 0 are already equivalent to every reader in the
  // app (all of them use `?? 0`), so going from "no row" to 0 is not a change.
  const changedIds = stationIds.filter((stationId) => {
    const prev = previous.get(stationId)
    const next = competencies[stationId] ?? 0
    return prev === undefined ? next !== 0 : prev !== next
  })
  if (changedIds.length === 0) return []

  // Upsert rather than delete-then-insert. The old approach issued two separate
  // requests, so a closed tab or dropped connection between them permanently
  // destroyed every competency row for the employee.
  const { error: writeError } = await db.from('competencies').upsert(
    changedIds.map((stationId) => ({
      employee_id: employeeId,
      station_id: stationId,
      level: competencies[stationId] ?? 0,
    })),
    { onConflict: 'employee_id,station_id' },
  )
  if (writeError) throw writeError

  if (!actor) return []

  const stationById = new Map(actor.stations.map((s) => [s.id, s]))
  const historyRows = changedIds.map((stationId) => {
    const station = stationById.get(stationId)
    return {
      employee_id: employeeId,
      station_id: stationId,
      station_name: station?.name ?? stationId,
      department_id: station?.department_id ?? null,
      old_level: previous.get(stationId) ?? null,
      new_level: competencies[stationId] ?? 0,
      changed_by: actor.email || 'unknown',
    }
  })

  // Best-effort. The competency write above has already committed, so throwing
  // here would abandon the caller's remaining work over a missing history row.
  // Unlike insertAuditLog, the failure is at least logged rather than discarded.
  const { data: inserted, error: historyError } = await db
    .from('competency_changes')
    .insert(historyRows)
    .select()
  if (historyError) {
    console.error('competency_changes insert failed', historyError)
    return []
  }
  return (inserted ?? []) as CompetencyChange[]
}

/**
 * Each employee's most recent competency change, keyed by employee_id.
 *
 * Reads the latest_competency_changes view, which collapses the log to one row per
 * employee in Postgres. Fetched unfiltered: the result is bounded by the number of
 * employees regardless of log size, and the cross-department Needs Attention page
 * needs all of them.
 *
 * Never throws. This runs inside AppShell's Promise.all, where a rejection would
 * skip setIsLoading(false) and leave the whole app on its loading screen. If the
 * migration has not been run yet, callers get {} and the column renders dashes.
 */
export async function fetchLatestCompetencyChanges(): Promise<CompetencyChangeMap> {
  const db = createClient()
  try {
    const { data, error } = await db.from('latest_competency_changes').select('*')
    if (error) throw error

    const map: CompetencyChangeMap = {}
    for (const row of (data ?? []) as CompetencyChange[]) map[row.employee_id] = row
    return map
  } catch (err) {
    console.error('fetchLatestCompetencyChanges failed', err)
    return {}
  }
}

// ---- Settings ----

export async function fetchSettings(deptId: string): Promise<AppSettings> {
  const db = createClient()
  const { data, error } = await db.from('settings').select('*').eq('department_id', deptId)
  if (error) throw error

  const map: Record<string, unknown> = {}
  for (const row of data ?? []) map[row.key] = row.value

  const toIntKeys = (obj: unknown, defaults: Record<number, string>): Record<number, string> => {
    if (!obj || typeof obj !== 'object') return { ...defaults }
    return Object.fromEntries(
      Object.entries(obj as Record<string, string>).map(([k, v]) => [parseInt(k), v]),
    )
  }

  return {
    skillLabels: toIntKeys(map.skill_labels, DEFAULT_SKILL_LABELS),
    certLabels: toIntKeys(map.cert_labels, DEFAULT_CERT_LABELS),
    competencyColors: toIntKeys(map.competency_colors, DEFAULT_COMPETENCY_COLORS),
  }
}

export async function upsertSetting(key: string, value: unknown, deptId: string): Promise<void> {
  const db = createClient()
  const { error } = await db.from('settings').upsert({ department_id: deptId, key, value })
  if (error) throw error
}

export async function fetchSetting(key: string, deptId: string): Promise<unknown> {
  const db = createClient()
  const { data } = await db.from('settings').select('value').eq('department_id', deptId).eq('key', key).single()
  return data?.value ?? null
}

// ---- Assignment Logs ----

export async function upsertAssignmentLogs(logs: Omit<AssignmentLog, 'id' | 'created_at'>[]): Promise<void> {
  if (logs.length === 0) return
  const db = createClient()
  const { error } = await db
    .from('assignment_logs')
    .upsert(logs, { onConflict: 'log_date,employee_id,station_id' })
  if (error) throw error
}

export async function fetchAllAssignmentLogs(sinceDate?: string): Promise<AssignmentLog[]> {
  const db = createClient()
  let query = db.from('assignment_logs').select('*').order('log_date', { ascending: false })
  if (sinceDate) query = query.gte('log_date', sinceDate)
  const { data, error } = await query
  if (error) throw error
  return data
}

// ---- Cross-Training Logs ----

export async function upsertCrossTrainingLogs(
  logs: Omit<CrossTrainingLog, 'id' | 'created_at'>[],
): Promise<void> {
  if (logs.length === 0) return
  const db = createClient()
  const { error } = await db
    .from('cross_training_logs')
    .upsert(logs, { onConflict: 'log_date,trainer_id,trainee_id,station_id' })
  if (error) throw error
}

export async function fetchAllCrossTrainingLogs(sinceDate?: string): Promise<CrossTrainingLog[]> {
  const db = createClient()
  let query = db
    .from('cross_training_logs')
    .select('*')
    .order('log_date', { ascending: false })
  if (sinceDate) query = query.gte('log_date', sinceDate)
  const { data, error } = await query
  if (error) throw error
  return data
}

// ---- Audit Logs ----

export async function insertAuditLog(userEmail: string, action: string, details = ''): Promise<void> {
  const db = createClient()
  await db.from('audit_logs').insert({ user_email: userEmail, action, details })
}

export async function fetchAuditLogs(limit = 50): Promise<AuditLog[]> {
  const db = createClient()
  const { data, error } = await db
    .from('audit_logs')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data
}

// ---- Bulk create employees ----

export async function bulkCreateEmployees(
  rows: Array<{ name: string; departmentId: string; hireDate: string | null }>
): Promise<number> {
  const db = createClient()
  let created = 0
  for (const { name, departmentId, hireDate } of rows) {
    if (!name.trim() || !departmentId) continue
    const id = generateId('emp')
    const record: Record<string, unknown> = {
      id,
      name: name.trim(),
      department_id: departmentId,
      certification_level: 0,
      is_absent: false,
      is_archived: false,
      is_lead: false,
      group_ids: [],
      sort_order: 9999,
    }
    if (hireDate) record.hire_date = hireDate
    const { error } = await db.from('employees').insert(record)
    if (!error) created++
  }
  return created
}

// ---- Bulk invite ----

export async function bulkInviteManagers(rows: { email: string; deptId: string }[]): Promise<number> {
  const db = createClient()
  let imported = 0
  for (const { email: rawEmail, deptId } of rows) {
    const email = rawEmail.trim().toLowerCase()
    if (!email || !email.includes('@') || !deptId) continue
    // Insert profile only if new — preserves existing role
    await db.from('user_profiles').insert({ email, display_name: email.split('@')[0], role: 'manager' })
    // Assign to dept (no-op if already assigned)
    await db.from('department_users').upsert({ department_id: deptId, user_email: email }, { ignoreDuplicates: true })
    imported++
  }
  return imported
}

// ---- Pending users ----

export async function fetchPendingUserCount(): Promise<number> {
  const db = createClient()
  const { data: profiles } = await db.from('user_profiles').select('email').eq('role', 'manager')
  if (!profiles || profiles.length === 0) return 0
  const { data: assigned } = await db.from('department_users').select('user_email')
  const assignedEmails = new Set((assigned ?? []).map((r: { user_email: string }) => r.user_email))
  return profiles.filter((p: { email: string }) => !assignedEmails.has(p.email)).length
}

// ---- Helpers ----

export function generateId(prefix: string): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `${prefix}_${hex}`
}
