"""Utilities for loading scheduler data from JSON files."""

import json
from pathlib import Path
from typing import List, Tuple, Union

from .models import Station, Employee


def load_stations(file_path: Union[str, Path]) -> List[Station]:
    """
    Load stations from a JSON file.

    Args:
        file_path: Path to JSON file containing stations array

    Returns:
        List of Station objects
    """
    with open(file_path, "r") as f:
        data = json.load(f)

    stations_data = data if isinstance(data, list) else data.get("stations", [])
    return [Station.from_dict(s) for s in stations_data]


def load_employees(file_path: Union[str, Path]) -> List[Employee]:
    """
    Load employees from a JSON file.

    Args:
        file_path: Path to JSON file containing employees array

    Returns:
        List of Employee objects
    """
    with open(file_path, "r") as f:
        data = json.load(f)

    employees_data = data if isinstance(data, list) else data.get("employees", [])
    return [Employee.from_dict(e) for e in employees_data]


def load_all(file_path: Union[str, Path]) -> Tuple[List[Station], List[Employee]]:
    """
    Load both stations and employees from a combined JSON file.

    Expected format:
    {
        "stations": [...],
        "employees": [...]
    }

    Args:
        file_path: Path to combined JSON file

    Returns:
        Tuple of (stations list, employees list)
    """
    with open(file_path, "r") as f:
        data = json.load(f)

    stations = [Station.from_dict(s) for s in data.get("stations", [])]
    employees = [Employee.from_dict(e) for e in data.get("employees", [])]

    return stations, employees


def save_schedule_state(scheduler, file_path: Union[str, Path]) -> None:
    """
    Save scheduler state to a JSON file.

    Args:
        scheduler: MatrixScheduler instance
        file_path: Path to save state to
    """
    with open(file_path, "w") as f:
        f.write(scheduler.to_json())


def load_schedule_state(file_path: Union[str, Path]):
    """
    Load scheduler state from a JSON file.

    Args:
        file_path: Path to saved state file

    Returns:
        MatrixScheduler instance with restored state
    """
    from .scheduler import MatrixScheduler

    with open(file_path, "r") as f:
        json_str = f.read()

    return MatrixScheduler.from_json(json_str)
