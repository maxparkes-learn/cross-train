import type { Station, Employee, Assignment, AssignmentLog, RotationStats } from './types'

export interface ScenarioWeights {
  name: string
  skill_weight: number
  recency_weight: number
  fatigue_weight: number
  invert_skill: boolean
}

export const SCENARIOS: Record<string, ScenarioWeights> = {
  Balanced: { name: 'Balanced', skill_weight: 0.4, recency_weight: 0.35, fatigue_weight: 0.25, invert_skill: false },
  'Max Competency': { name: 'Max Competency', skill_weight: 0.75, recency_weight: 0.1, fatigue_weight: 0.15, invert_skill: false },
  'Cross-Training': { name: 'Cross-Training', skill_weight: 0.1, recency_weight: 0.55, fatigue_weight: 0.35, invert_skill: true },
  'Fatigue Aware': { name: 'Fatigue Aware', skill_weight: 0.3, recency_weight: 0.25, fatigue_weight: 0.45, invert_skill: false },
  'Fresh Rotation': { name: 'Fresh Rotation', skill_weight: 0.2, recency_weight: 0.6, fatigue_weight: 0.2, invert_skill: false },
}

export const SCENARIO_DESCRIPTIONS: Record<string, string> = {
  Balanced: 'Default — balances skill, rotation, and fatigue evenly',
  'Max Competency': 'Assigns the most skilled employee to each station',
  'Cross-Training': 'Prioritizes less-experienced (but qualified) employees to build new skills',
  'Fatigue Aware': 'Spreads hours evenly to minimize burnout',
  'Fresh Rotation': 'Maximizes rotation — assigns employees to stations they haven\'t worked recently',
}

export function buildRotationStats(
  logs: AssignmentLog[],
  rollingWindowDays = 30,
): Map<string, RotationStats> {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const cutoff = new Date(today)
  cutoff.setDate(cutoff.getDate() - rollingWindowDays)
  const cutoffStr = cutoff.toISOString().split('T')[0]

  const stats = new Map<string, RotationStats>()

  for (const log of logs) {
    if (log.log_date < cutoffStr) continue

    const key = `${log.employee_id}__${log.station_id}`
    if (!stats.has(key)) {
      stats.set(key, {
        employee_id: log.employee_id,
        station_id: log.station_id,
        total_hours: 0,
        days_since_last: 999,
        assignment_count: 0,
      })
    }

    const s = stats.get(key)!
    s.total_hours += log.hours
    s.assignment_count += 1

    const logDate = new Date(log.log_date + 'T00:00:00')
    const daysAgo = Math.floor((today.getTime() - logDate.getTime()) / 86400000)
    s.days_since_last = Math.min(s.days_since_last, daysAgo)
  }

  return stats
}

function getCompetency(employee: Employee, stationId: string): number {
  return employee.station_competencies[stationId] ?? 0
}

function isQualified(employee: Employee, station: Station): boolean {
  return (
    employee.certification_level >= station.required_certification &&
    getCompetency(employee, station.id) >= station.required_skill_level
  )
}

function getQualifiedEmployees(
  station: Station,
  availableIds: Set<string>,
  employeesMap: Map<string, Employee>,
  rotationStats: Map<string, RotationStats> | null,
  scenario: ScenarioWeights,
): string[] {
  const qualified: Array<{ id: string; competency: number; cert: number }> = []

  for (const empId of availableIds) {
    const emp = employeesMap.get(empId)
    if (!emp) continue
    if (isQualified(emp, station)) {
      qualified.push({
        id: empId,
        competency: getCompetency(emp, station.id),
        cert: emp.certification_level,
      })
    }
  }

  if (rotationStats) {
    const scored = qualified.map(({ id, competency, cert }) => {
      let skillScore = (competency + cert) / 6.0
      if (scenario.invert_skill) skillScore = 1.0 - skillScore

      const key = `${id}__${station.id}`
      const rs = rotationStats.get(key)
      const recencyScore = rs ? Math.min(rs.days_since_last, 30) / 30.0 : 1.0
      const fatigueScore = rs ? Math.min(rs.total_hours, 240) / 240.0 : 0.0

      const priority =
        scenario.skill_weight * skillScore +
        scenario.recency_weight * recencyScore -
        scenario.fatigue_weight * fatigueScore

      return { id, priority }
    })

    scored.sort((a, b) => b.priority - a.priority)
    return scored.map((s) => s.id)
  }

  qualified.sort((a, b) => b.cert - a.cert || b.competency - a.competency)
  return qualified.map((q) => q.id)
}

export function generateSchedule(
  stations: Station[],
  employees: Employee[],
  absentIds: Set<string>,
  logs: AssignmentLog[],
  scenarioName: string,
): Record<string, Assignment> {
  const scenario = SCENARIOS[scenarioName] ?? SCENARIOS['Balanced']
  const employeesMap = new Map(employees.map((e) => [e.id, e]))
  const availableIds = new Set(
    employees.map((e) => e.id).filter((id) => !absentIds.has(id)),
  )

  const rotationStats = logs.length > 0 ? buildRotationStats(logs) : null

  const sortedStations = [...stations].sort(
    (a, b) => b.required_skill_level - a.required_skill_level,
  )

  const assignments: Record<string, Assignment> = {}

  for (const station of sortedStations) {
    const assignment: Assignment = {
      station_id: station.id,
      assigned_employee_ids: [],
      is_fully_staffed: false,
      unfilled_slots: 0,
    }

    const qualified = getQualifiedEmployees(
      station,
      availableIds,
      employeesMap,
      rotationStats,
      scenario,
    )

    let slotsToFill = station.required_headcount
    for (const empId of qualified) {
      if (slotsToFill <= 0) break
      assignment.assigned_employee_ids.push(empId)
      availableIds.delete(empId)
      slotsToFill--
    }

    assignment.unfilled_slots = station.required_headcount - assignment.assigned_employee_ids.length
    assignment.is_fully_staffed = assignment.unfilled_slots === 0
    assignments[station.id] = assignment
  }

  return assignments
}

export function applyOverrides(
  assignments: Record<string, Assignment>,
  stations: Station[],
  overrides: Record<string, Record<number, string>>,
  employees: Employee[],
  absentIds: Set<string>,
): { assignments: Record<string, Assignment>; conflicts: string[] } {
  const employeesMap = new Map(employees.map((e) => [e.id, e]))
  const empAssignments = new Map<string, string[]>()

  for (const [stationId, slots] of Object.entries(overrides)) {
    for (const [, empId] of Object.entries(slots)) {
      if (empId === '__unassigned__') continue
      if (!empAssignments.has(empId)) empAssignments.set(empId, [])
      empAssignments.get(empId)!.push(stationId)
    }
  }

  const conflicts: string[] = []
  for (const [empId, stationIds] of empAssignments) {
    if (stationIds.length > 1) {
      const emp = employeesMap.get(empId)
      conflicts.push(`${emp?.name ?? empId} assigned to multiple stations`)
    }
  }

  if (conflicts.length > 0) return { assignments, conflicts }

  const newAssignments: Record<string, Assignment> = {}
  const newAssignedIds = new Set<string>()

  for (const station of stations) {
    const slots = overrides[station.id] ?? {}
    const empIds: string[] = []

    for (let i = 0; i < station.required_headcount; i++) {
      const empId = slots[i]
      if (empId && empId !== '__unassigned__') {
        empIds.push(empId)
        newAssignedIds.add(empId)
      }
    }

    newAssignments[station.id] = {
      station_id: station.id,
      assigned_employee_ids: empIds,
      unfilled_slots: station.required_headcount - empIds.length,
      is_fully_staffed: empIds.length >= station.required_headcount,
    }
  }

  return { assignments: newAssignments, conflicts: [] }
}

export function checkEmployeeIsQualified(
  employee: Employee,
  station: Station,
): boolean {
  return isQualified(employee, station)
}
