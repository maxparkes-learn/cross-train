"""Unit tests for the Cross-Training Matrix Scheduler."""

import pytest
from scheduler import MatrixScheduler, Station, Employee, SkillLevel


class TestMatrixScheduler:
    """Tests for MatrixScheduler class."""

    def test_basic_assignment(self):
        """Test basic assignment with sufficient employees."""
        stations = [
            Station("s1", "Station A", required_skill_level=1, required_headcount=1),
            Station("s2", "Station B", required_skill_level=2, required_headcount=1),
        ]
        employees = [
            Employee("e1", "Alice", current_skill_level=3),
            Employee("e2", "Bob", current_skill_level=2),
        ]

        scheduler = MatrixScheduler(stations, employees)
        result = scheduler.generate_schedule()

        # All stations should be fully staffed
        assert result["s1"].is_fully_staffed
        assert result["s2"].is_fully_staffed
        assert len(scheduler.get_unfilled_stations()) == 0

    def test_prioritizes_high_skill_stations(self):
        """Test that high-skill stations are filled first."""
        stations = [
            Station("low", "Low Skill", required_skill_level=1, required_headcount=1),
            Station("high", "High Skill", required_skill_level=3, required_headcount=1),
        ]
        # Only one qualified employee for high-skill station
        employees = [
            Employee("e1", "Alice", current_skill_level=3),
            Employee("e2", "Bob", current_skill_level=1),
        ]

        scheduler = MatrixScheduler(stations, employees)
        result = scheduler.generate_schedule()

        # Alice should be assigned to high-skill station (priority)
        assert "e1" in result["high"].assigned_employee_ids
        # Bob should be assigned to low-skill station
        assert "e2" in result["low"].assigned_employee_ids

    def test_insufficient_qualified_employees(self):
        """Test handling when not enough qualified employees available."""
        stations = [
            Station("s1", "Critical", required_skill_level=3, required_headcount=2),
        ]
        employees = [
            Employee("e1", "Alice", current_skill_level=3),
            Employee("e2", "Bob", current_skill_level=1),  # Not qualified
        ]

        scheduler = MatrixScheduler(stations, employees)
        result = scheduler.generate_schedule()

        # Only Alice can fill the station
        assert len(result["s1"].assigned_employee_ids) == 1
        assert result["s1"].unfilled_slots == 1
        assert not result["s1"].is_fully_staffed
        assert "s1" in scheduler.get_unfilled_stations()

    def test_variable_headcount(self):
        """Test stations requiring multiple employees."""
        stations = [
            Station("s1", "Team Station", required_skill_level=1, required_headcount=3),
        ]
        employees = [
            Employee("e1", "Alice", current_skill_level=2),
            Employee("e2", "Bob", current_skill_level=1),
            Employee("e3", "Carol", current_skill_level=3),
        ]

        scheduler = MatrixScheduler(stations, employees)
        result = scheduler.generate_schedule()

        assert len(result["s1"].assigned_employee_ids) == 3
        assert result["s1"].is_fully_staffed

    def test_handle_absence_triggers_rebalance(self):
        """Test that absence handling removes employee and attempts rebalance."""
        stations = [
            Station("s1", "Station A", required_skill_level=2, required_headcount=1),
        ]
        employees = [
            Employee("e1", "Alice", current_skill_level=3),
            Employee("e2", "Bob", current_skill_level=2),
        ]

        scheduler = MatrixScheduler(stations, employees)
        scheduler.generate_schedule()

        # Get who was originally assigned
        original_assignee = scheduler.assignments["s1"].assigned_employee_ids[0]
        other_employee = "e2" if original_assignee == "e1" else "e1"

        # Mark the assigned employee as absent
        affected = scheduler.handle_absence(original_assignee)

        # Station should have been affected
        assert "s1" in affected

        # Rebalance should have filled with the other employee
        assert other_employee in scheduler.assignments["s1"].assigned_employee_ids
        assert scheduler.assignments["s1"].is_fully_staffed

    def test_absence_no_replacement_available(self):
        """Test absence when no qualified replacement exists."""
        stations = [
            Station("s1", "Critical", required_skill_level=3, required_headcount=1),
        ]
        employees = [
            Employee("e1", "Alice", current_skill_level=3),  # Only qualified person
            Employee("e2", "Bob", current_skill_level=1),
        ]

        scheduler = MatrixScheduler(stations, employees)
        scheduler.generate_schedule()

        # Remove Alice - no one else is qualified
        scheduler.handle_absence("e1")

        # Station should be unfilled
        assert not scheduler.assignments["s1"].is_fully_staffed
        assert scheduler.assignments["s1"].unfilled_slots == 1
        assert "s1" in scheduler.get_unfilled_stations()

    def test_serialization_roundtrip(self):
        """Test that to_json/from_json preserves state."""
        stations = [
            Station("s1", "Station A", required_skill_level=2, required_headcount=1),
        ]
        employees = [
            Employee("e1", "Alice", current_skill_level=3),
        ]

        original = MatrixScheduler(stations, employees)
        original.generate_schedule()
        original.handle_absence("e1")

        # Serialize and restore
        json_str = original.to_json()
        restored = MatrixScheduler.from_json(json_str)

        # Verify state is preserved
        assert restored.stations.keys() == original.stations.keys()
        assert restored.employees.keys() == original.employees.keys()
        assert restored.absent_employees == original.absent_employees
        assert "e1" in restored.absent_employees

    def test_get_schedule_summary(self):
        """Test that schedule summary returns correct format."""
        stations = [
            Station("s1", "Quality Control", required_skill_level=2, required_headcount=1),
        ]
        employees = [
            Employee("e1", "Alice", current_skill_level=2),
        ]

        scheduler = MatrixScheduler(stations, employees)
        scheduler.generate_schedule()

        summary = scheduler.get_schedule_summary()

        assert "s1" in summary
        assert summary["s1"]["station_name"] == "Quality Control"
        assert summary["s1"]["required"] == 1
        assert summary["s1"]["filled"] == 1
        assert summary["s1"]["status"] == "fully_staffed"


class TestModels:
    """Tests for data models."""

    def test_station_serialization(self):
        """Test Station to_dict/from_dict."""
        station = Station("s1", "Test", 2, 3)
        restored = Station.from_dict(station.to_dict())

        assert restored.id == station.id
        assert restored.name == station.name
        assert restored.required_skill_level == station.required_skill_level
        assert restored.required_headcount == station.required_headcount

    def test_employee_serialization(self):
        """Test Employee to_dict/from_dict."""
        employee = Employee("e1", "Alice", 3)
        restored = Employee.from_dict(employee.to_dict())

        assert restored.id == employee.id
        assert restored.name == employee.name
        assert restored.current_skill_level == employee.current_skill_level

    def test_skill_level_enum(self):
        """Test SkillLevel enum values."""
        assert SkillLevel.GENERAL == 1
        assert SkillLevel.INTERMEDIATE == 2
        assert SkillLevel.LICENSED == 3


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
