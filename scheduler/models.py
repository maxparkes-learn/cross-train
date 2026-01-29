"""Data models for the Cross-Training Matrix Scheduler."""

from dataclasses import dataclass, field
from typing import List, Dict, Optional
from enum import IntEnum


class SkillLevel(IntEnum):
    """Skill levels for stations and employees (0-4 scale)."""
    NOT_APPLICABLE = 0
    GENERAL = 1
    INTERMEDIATE = 2
    LICENSED = 3
    TRAINER = 4


@dataclass
class Station:
    """A manufacturing station requiring staffing."""
    id: str
    name: str
    required_skill_level: int
    required_headcount: int = 1
    required_certification: int = 0  # 0=None, 1=Apprentice, 2=Licensed

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "required_skill_level": self.required_skill_level,
            "required_headcount": self.required_headcount,
            "required_certification": self.required_certification,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Station":
        return cls(
            id=data["id"],
            name=data["name"],
            required_skill_level=data["required_skill_level"],
            required_headcount=data.get("required_headcount", 1),
            required_certification=data.get("required_certification", 0),
        )


@dataclass
class Employee:
    """An employee with per-station competency ratings and certification."""
    id: str
    name: str
    station_competencies: Dict[str, int] = field(default_factory=dict)
    certification_level: int = 0  # 0=None, 1=Apprentice, 2=Licensed

    def get_competency(self, station_id: str) -> int:
        """Get competency level for a specific station (default 0)."""
        return self.station_competencies.get(station_id, 0)

    def set_competency(self, station_id: str, level: int) -> None:
        """Set competency level for a specific station."""
        self.station_competencies[station_id] = level

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "station_competencies": self.station_competencies.copy(),
            "certification_level": self.certification_level,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Employee":
        # Handle legacy format with current_skill_level
        if "current_skill_level" in data and "station_competencies" not in data:
            return cls(
                id=data["id"],
                name=data["name"],
                station_competencies={},
                certification_level=data.get("certification_level", 0),
            )
        return cls(
            id=data["id"],
            name=data["name"],
            station_competencies=data.get("station_competencies", {}).copy(),
            certification_level=data.get("certification_level", 0),
        )


@dataclass
class Assignment:
    """An assignment of employees to a station."""
    station_id: str
    assigned_employee_ids: List[str] = field(default_factory=list)
    is_fully_staffed: bool = False
    unfilled_slots: int = 0

    def to_dict(self) -> dict:
        return {
            "station_id": self.station_id,
            "assigned_employee_ids": self.assigned_employee_ids.copy(),
            "is_fully_staffed": self.is_fully_staffed,
            "unfilled_slots": self.unfilled_slots,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Assignment":
        return cls(
            station_id=data["station_id"],
            assigned_employee_ids=data.get("assigned_employee_ids", []).copy(),
            is_fully_staffed=data.get("is_fully_staffed", False),
            unfilled_slots=data.get("unfilled_slots", 0),
        )


@dataclass
class AssignmentLog:
    """A historical record of an employee-station assignment for a given day."""
    log_date: str  # "YYYY-MM-DD"
    employee_id: str
    station_id: str
    hours: float = 8.0

    def to_dict(self) -> dict:
        return {
            "log_date": self.log_date,
            "employee_id": self.employee_id,
            "station_id": self.station_id,
            "hours": self.hours,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "AssignmentLog":
        return cls(
            log_date=data["log_date"],
            employee_id=data["employee_id"],
            station_id=data["station_id"],
            hours=float(data.get("hours", 8.0)),
        )


@dataclass
class RotationStats:
    """Computed rotation statistics for an employee-station pair (not persisted)."""
    employee_id: str
    station_id: str
    total_hours: float = 0.0
    days_since_last: int = 999  # Large default = never assigned
    assignment_count: int = 0


@dataclass
class ScenarioWeights:
    """Weight profile for a scheduling scenario."""
    name: str
    skill_weight: float = 0.40
    recency_weight: float = 0.35
    fatigue_weight: float = 0.25
    invert_skill: bool = False  # True = prefer lower-skilled (for cross-training)
