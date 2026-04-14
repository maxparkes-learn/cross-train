import { createClient } from '@/lib/supabase/client'
import type {
  Station,
  Employee,
  AssignmentLog,
  CrossTrainingLog,
  AuditLog,
  AppSettings,
} from './types'
import {
  DEFAULT_SKILL_LABELS,
  DEFAULT_CERT_LABELS,
  DEFAULT_COMPETENCY_COLORS,
} from './types'

// ---- Stations ----

export async function fetchStations(): Promise<Station[]> {
  const db = createClient()
  const { data, error } = await db.from('stations').select('*').order('name')
  if (error) throw error
  return data
}

export async function upsertStation(station: Partial<Station> & { id: string }): Promise<Station> {
  const db = createClient()
  const { data, error } = await db.from('stations').upsert(station).select().single()
  if (error) throw error
  return data
}

export async function deleteStation(stationId: string): Promise<void> {
  const db = createClient()
  const { error } = await db.from('stations').delete().eq('id', stationId)
  if (error) throw error
}

// ---- Employees ----

export async function fetchEmployees(): Promise<Employee[]> {
  const db = createClient()
  const { data: empRows, error: empError } = await db.from('employees').select('*').order('name')
  if (empError) throw empError

  const { data: compRows, error: compError } = await db.from('competencies').select('*')
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

export async function upsertEmployee(employee: Partial<Employee> & { id: string }): Promise<void> {
  const db = createClient()
  const { station_competencies: _, ...row } = employee as Employee
  const { error } = await db.from('employees').upsert(row)
  if (error) throw error
}

export async function deleteEmployee(employeeId: string): Promise<void> {
  const db = createClient()
  const { error } = await db.from('employees').delete().eq('id', employeeId)
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

export async function fetchSettings(): Promise<AppSettings> {
  const db = createClient()
  const { data, error } = await db.from('settings').select('*')
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

export async function upsertSetting(key: string, value: unknown): Promise<void> {
  const db = createClient()
  const { error } = await db.from('settings').upsert({ key, value })
  if (error) throw error
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
