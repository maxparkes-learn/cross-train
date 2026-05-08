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
} from './types'
import {
  DEFAULT_SKILL_LABELS,
  DEFAULT_CERT_LABELS,
  DEFAULT_COMPETENCY_COLORS,
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

// ---- User Profiles ----

export async function upsertUserProfile(email: string, displayName: string): Promise<void> {
  const db = createClient()
  // Insert if new (preserves role for pre-invited users); update display_name if exists
  const { error } = await db
    .from('user_profiles')
    .insert({ email, display_name: displayName, role: 'manager' })
  if (error) {
    // Already exists — update display_name only, leave role untouched
    await db.from('user_profiles').update({ display_name: displayName }).eq('email', email)
  }
}

export async function fetchUserProfile(email: string): Promise<UserProfile | null> {
  const db = createClient()
  const { data } = await db.from('user_profiles').select('*').eq('email', email).single()
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

export async function deleteUserProfile(email: string): Promise<void> {
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
  const { data: empRows, error: empError } = await db.from('employees').select('*').eq('department_id', deptId).eq('is_archived', false).order('sort_order').order('name')
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

export async function upsertEmployee(employee: Partial<Employee> & { id: string }, deptId: string): Promise<void> {
  const db = createClient()
  const { station_competencies: _, ...row } = employee as Employee
  const { error } = await db.from('employees').upsert({ ...row, is_archived: row.is_archived ?? false, department_id: deptId })
  if (error) throw error
}

export async function fetchAllEmployees(): Promise<Employee[]> {
  const db = createClient()
  const { data: empRows, error: empError } = await db.from('employees').select('*').eq('is_archived', false).order('name')
  if (empError) throw empError
  return empRows.map((e) => ({ ...e, station_competencies: {} }))
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

export async function updateEmployeeAbsence(employeeId: string, isAbsent: boolean): Promise<void> {
  const db = createClient()
  const { error } = await db
    .from('employees')
    .update({ is_absent: isAbsent })
    .eq('id', employeeId)
  if (error) throw error
}

// ---- Competencies ----

export async function upsertCompetencies(
  employeeId: string,
  competencies: Record<string, number>,
): Promise<void> {
  const db = createClient()
  const { error: deleteError } = await db
    .from('competencies')
    .delete()
    .eq('employee_id', employeeId)
  if (deleteError) throw deleteError

  const rows = Object.entries(competencies).map(([stationId, level]) => ({
    employee_id: employeeId,
    station_id: stationId,
    level,
  }))

  if (rows.length > 0) {
    const { error } = await db.from('competencies').insert(rows)
    if (error) throw error
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

// ---- Helpers ----

export function generateId(prefix: string): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `${prefix}_${hex}`
}
