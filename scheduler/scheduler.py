"""Core scheduling logic for the Cross-Training Matrix Scheduler."""

import json
from datetime import date, datetime, timedelta
from typing import Dict, List, Set, Tuple, Optional

from .models import Station, Employee, Assignment, AssignmentLog, RotationStats, ScenarioWeights


class MatrixScheduler:
    """
    Scheduler that assigns employees to manufacturing stations based on skill levels.

    Prioritizes high-skill (critical) stations first to ensure they are staffed
    before lower-skill stations.
    """

    SCENARIOS = {
        "Balanced": ScenarioWeights("Balanced", 0.40, 0.35, 0.25, False),
        "Max Competency": ScenarioWeights("Max Competency", 0.75, 0.10, 0.15, False),
        "Cross-Training": ScenarioWeights("Cross-Training", 0.10, 0.55, 0.35, True),
        "Fatigue Aware": ScenarioWeights("Fatigue Aware", 0.30, 0.25, 0.45, False),
        "Fresh Rotation": ScenarioWeights("Fresh Rotation", 0.20, 0.60, 0.20, False),
    }

    SCENARIO_DESCRIPTIONS = {
        "Balanced": "Default — balances skill, rotation, and fatigue evenly",
        "Max Competency": "Assigns the most skilled employee to each station",
        "Cross-Training": "Prioritizes less-experienced (but qualified) employees to build new skills",
        "Fatigue Aware": "Spreads hours evenly to minimize burnout",
        "Fresh Rotation": "Maximizes rotation — assigns employees to stations they haven't worked recently",
    }

    def __init__(self, stations: List[Station], employees: List[Employee]):
        """
        Initialize the scheduler with stations and employees.

        Args:
            stations: List of Station objects to be staffed
            employees: List of Employee objects available for assignment
        """
        self.stations: Dict[str, Station] = {s.id: s for s in stations}
        self.employees: Dict[str, Employee] = {e.id: e for e in employees}
        self.assignments: Dict[str, Assignment] = {}
        self.available_employees: Set[str] = set(self.employees.keys())
        self.absent_employees: Set[str] = set()
        self.assignment_logs: List[AssignmentLog] = []
        self.scenario: ScenarioWeights = self.SCENARIOS["Balanced"]

    def generate_schedule(self, scenario: Optional[ScenarioWeights] = None) -> Dict[str, Assignment]:
        """
        Generate station assignments prioritizing high-skill stations first.
        Uses rotation stats (when available) to encourage rotation and prevent fatigue.

        Args:
            scenario: Optional weight profile for prioritization. Defaults to Balanced.

        Returns:
            Dictionary mapping station IDs to Assignment objects
        """
        if scenario is not None:
            self.scenario = scenario

        # Reset assignments
        self.assignments = {}
        self.available_employees = set(self.employees.keys()) - self.absent_employees

        # Build rotation stats if we have historical data
        rotation_stats = self._build_rotation_stats() if self.assignment_logs else None

        # Sort stations by required_skill_level descending (critical first)
        sorted_stations = sorted(
            self.stations.values(),
            key=lambda s: s.required_skill_level,
            reverse=True
        )

        for station in sorted_stations:
            assignment = Assignment(station_id=station.id)

            # Get qualified available employees
            qualified = self._get_qualified_employees(station, rotation_stats)

            # Assign up to required_headcount employees
            slots_to_fill = station.required_headcount
            for emp_id in qualified:
                if slots_to_fill <= 0:
                    break
                assignment.assigned_employee_ids.append(emp_id)
                self.available_employees.discard(emp_id)
                slots_to_fill -= 1

            # Update assignment status
            filled = len(assignment.assigned_employee_ids)
            assignment.unfilled_slots = station.required_headcount - filled
            assignment.is_fully_staffed = (assignment.unfilled_slots == 0)

            self.assignments[station.id] = assignment

        return self.assignments

    def handle_absence(self, employee_id: str) -> List[str]:
        """
        Remove an employee from the schedule and trigger rebalancing.

        Args:
            employee_id: ID of the absent employee

        Returns:
            List of station IDs affected by the absence
        """
        if employee_id not in self.employees:
            raise ValueError(f"Unknown employee: {employee_id}")

        # Mark employee as absent
        self.absent_employees.add(employee_id)
        self.available_employees.discard(employee_id)

        # Find all stations where this employee is assigned
        affected_stations = []
        for station_id, assignment in self.assignments.items():
            if employee_id in assignment.assigned_employee_ids:
                # Remove employee from assignment
                assignment.assigned_employee_ids.remove(employee_id)
                assignment.unfilled_slots += 1
                assignment.is_fully_staffed = False
                affected_stations.append(station_id)

        # Attempt to rebalance each affected station
        for station_id in affected_stations:
            self.rebalance_schedule(station_id)

        return affected_stations

    def rebalance_schedule(self, station_id: str) -> bool:
        """
        Attempt to fill gaps at a specific station with qualified employees.

        Args:
            station_id: ID of the station to rebalance

        Returns:
            True if station is now fully staffed, False otherwise
        """
        if station_id not in self.stations:
            raise ValueError(f"Unknown station: {station_id}")

        station = self.stations[station_id]
        assignment = self.assignments.get(station_id)

        if assignment is None:
            assignment = Assignment(station_id=station_id)
            self.assignments[station_id] = assignment

        # Fill unfilled slots with qualified available employees
        while assignment.unfilled_slots > 0:
            qualified = self._get_qualified_employees(station)

            if not qualified:
                # No qualified replacement available - station remains understaffed
                break

            # Assign the first qualified employee
            emp_id = qualified[0]
            assignment.assigned_employee_ids.append(emp_id)
            self.available_employees.discard(emp_id)
            assignment.unfilled_slots -= 1

        # Update staffing status
        assignment.is_fully_staffed = (assignment.unfilled_slots == 0)
        return assignment.is_fully_staffed

    def _get_qualified_employees(
        self,
        station: Station,
        rotation_stats: Optional[Dict[Tuple[str, str], RotationStats]] = None,
    ) -> List[str]:
        """
        Get available employees qualified for a station.

        Args:
            station: Station to find qualified employees for
            rotation_stats: Optional rotation stats for priority scoring

        Returns:
            List of employee IDs who meet both certification and competency requirements,
            sorted by priority score (or legacy sort when no stats available)
        """
        qualified = []
        for emp_id in self.available_employees:
            employee = self.employees[emp_id]
            competency = employee.get_competency(station.id)

            # Check both certification AND competency requirements
            meets_certification = employee.certification_level >= station.required_certification
            meets_competency = competency >= station.required_skill_level

            if meets_certification and meets_competency:
                qualified.append((emp_id, competency, employee.certification_level))

        if rotation_stats is not None:
            # Priority scoring using scenario weights
            w = self.scenario
            scored = []
            for emp_id, competency, certification in qualified:
                skill_score = (competency + certification) / 6.0
                if w.invert_skill:
                    skill_score = 1.0 - skill_score

                key = (emp_id, station.id)
                if key in rotation_stats:
                    rs = rotation_stats[key]
                    recency_score = min(rs.days_since_last, 30) / 30.0
                    fatigue_score = min(rs.total_hours, 240) / 240.0
                else:
                    # Never assigned here — max recency, zero fatigue
                    recency_score = 1.0
                    fatigue_score = 0.0

                priority = (w.skill_weight * skill_score) + (w.recency_weight * recency_score) - (w.fatigue_weight * fatigue_score)
                scored.append((emp_id, priority))

            scored.sort(key=lambda x: x[1], reverse=True)
            return [emp_id for emp_id, _ in scored]
        else:
            # Fallback: sort by certification descending, then competency descending
            qualified.sort(key=lambda x: (x[2], x[1]), reverse=True)
            return [emp_id for emp_id, _, _ in qualified]

    def is_qualified(self, employee_id: str, station_id: str) -> bool:
        """Check if an employee meets both certification and competency requirements for a station."""
        if employee_id not in self.employees or station_id not in self.stations:
            return False
        employee = self.employees[employee_id]
        station = self.stations[station_id]
        return (
            employee.certification_level >= station.required_certification
            and employee.get_competency(station_id) >= station.required_skill_level
        )

    def _build_rotation_stats(self, rolling_window_days: int = 30) -> Dict[Tuple[str, str], RotationStats]:
        """
        Build rotation statistics from assignment logs within a rolling window.

        Returns:
            Dict mapping (employee_id, station_id) to RotationStats
        """
        today = date.today()
        cutoff = today - timedelta(days=rolling_window_days)
        cutoff_str = cutoff.strftime("%Y-%m-%d")
        today_str = today.strftime("%Y-%m-%d")

        stats: Dict[Tuple[str, str], RotationStats] = {}

        for log in self.assignment_logs:
            if log.log_date < cutoff_str:
                continue

            key = (log.employee_id, log.station_id)
            if key not in stats:
                stats[key] = RotationStats(
                    employee_id=log.employee_id,
                    station_id=log.station_id,
                )

            s = stats[key]
            s.total_hours += log.hours
            s.assignment_count += 1

            # Calculate days since last assignment
            try:
                log_date = datetime.strptime(log.log_date, "%Y-%m-%d").date()
                days_ago = (today - log_date).days
                s.days_since_last = min(s.days_since_last, days_ago)
            except ValueError:
                pass

        return stats

    def get_unfilled_stations(self) -> List[str]:
        """
        Get list of stations that are not fully staffed.

        Returns:
            List of station IDs that have unfilled slots
        """
        unfilled = []
        for station_id, assignment in self.assignments.items():
            if not assignment.is_fully_staffed:
                unfilled.append(station_id)
        return unfilled

    def get_schedule_summary(self) -> Dict[str, dict]:
        """
        Get a human-readable summary of the current schedule.

        Returns:
            Dictionary with station details and assignment status
        """
        summary = {}
        for station_id, assignment in self.assignments.items():
            station = self.stations[station_id]
            filled = len(assignment.assigned_employee_ids)

            summary[station_id] = {
                "station_name": station.name,
                "assigned": assignment.assigned_employee_ids.copy(),
                "required": station.required_headcount,
                "filled": filled,
                "status": "fully_staffed" if assignment.is_fully_staffed else "unfilled"
            }
        return summary

    def to_json(self) -> str:
        """
        Serialize scheduler state to JSON for persistence.

        Returns:
            JSON string representing the complete scheduler state
        """
        state = {
            "stations": [s.to_dict() for s in self.stations.values()],
            "employees": [e.to_dict() for e in self.employees.values()],
            "assignments": [a.to_dict() for a in self.assignments.values()],
            "available_employees": list(self.available_employees),
            "absent_employees": list(self.absent_employees),
            "assignment_logs": [log.to_dict() for log in self.assignment_logs],
        }
        return json.dumps(state, indent=2)

    @classmethod
    def from_json(cls, json_str: str) -> "MatrixScheduler":
        """
        Restore scheduler from serialized JSON state.

        Args:
            json_str: JSON string from to_json()

        Returns:
            Fully hydrated MatrixScheduler instance
        """
        state = json.loads(json_str)

        stations = [Station.from_dict(s) for s in state["stations"]]
        employees = [Employee.from_dict(e) for e in state["employees"]]

        scheduler = cls(stations, employees)

        # Restore assignments
        for a_data in state.get("assignments", []):
            assignment = Assignment.from_dict(a_data)
            scheduler.assignments[assignment.station_id] = assignment

        # Restore employee sets
        scheduler.available_employees = set(state.get("available_employees", []))
        scheduler.absent_employees = set(state.get("absent_employees", []))

        # Restore assignment logs
        for log_data in state.get("assignment_logs", []):
            scheduler.assignment_logs.append(AssignmentLog.from_dict(log_data))

        return scheduler
