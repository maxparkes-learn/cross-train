export interface Station {
  id: string
  name: string
  required_skill_level: number
  required_headcount: number
  required_certification: number
  sort_order: number
  created_at?: string
}

export interface EmployeeGroup {
  id: string
  name: string
  color: string
}

export const DEFAULT_EMPLOYEE_GROUPS: EmployeeGroup[] = []

export interface Employee {
  id: string
  name: string
  certification_level: number
  is_absent: boolean
  is_archived: boolean
  department_id: string
  sort_order: number
  station_competencies: Record<string, number>
  group_ids: string[]
  created_at?: string
}

export interface Competency {
  employee_id: string
  station_id: string
  level: number
}

export interface Assignment {
  station_id: string
  assigned_employee_ids: string[]
  is_fully_staffed: boolean
  unfilled_slots: number
}

export interface AssignmentLog {
  id?: number
  log_date: string
  employee_id: string
  station_id: string
  hours: number
  created_at?: string
}

export interface CrossTrainingLog {
  id?: number
  log_date: string
  trainer_id: string
  trainee_id: string
  station_id: string
  hours: number
  created_at?: string
}

export interface AuditLog {
  id?: number
  timestamp: string
  user_email: string
  action: string
  details: string
}

export interface AppSettings {
  skillLabels: Record<number, string>
  certLabels: Record<number, string>
  competencyColors: Record<number, string>
}

export interface RotationStats {
  employee_id: string
  station_id: string
  total_hours: number
  days_since_last: number
  assignment_count: number
}

export interface CrossTrainingAssignment {
  trainer_id: string
  trainer_name: string
  trainee_id: string
  trainee_name: string
  station_id: string
  station_name: string
}

export const DEFAULT_SKILL_LABELS: Record<number, string> = {
  0: 'N/A',
  1: 'General',
  2: 'Intermediate',
  3: 'Licensed',
  4: 'Trainer',
}

export const DEFAULT_CERT_LABELS: Record<number, string> = {
  0: 'None',
  1: 'Apprentice',
  2: 'Licensed Mechanic',
}

export const DEFAULT_COMPETENCY_COLORS: Record<number, string> = {
  0: '#E8E8E8',
  1: '#F8D7DA',
  2: '#FFE5B4',
  3: '#D4EDDA',
  4: '#28A745',
}

export interface Department {
  id: string
  name: string
  created_at?: string
}

export type UserRole = 'superadmin' | 'admin' | 'manager'

export interface UserProfile {
  email: string
  display_name: string
  role: UserRole
  created_at?: string
}

export const ADMIN_EMAIL = 'max.parkes@clutch.ca'
export const ALLOWED_DOMAIN = 'clutch.ca'
