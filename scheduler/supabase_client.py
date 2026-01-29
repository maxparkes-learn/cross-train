"""Supabase client for the Cross-Training Matrix Scheduler."""

import os
from typing import List, Dict, Optional
from datetime import date
from supabase import create_client, Client

_client: Optional[Client] = None


def get_client() -> Client:
    """Get or create Supabase client singleton."""
    global _client
    if _client is None:
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_KEY")
        if not url or not key:
            raise ValueError(
                "SUPABASE_URL and SUPABASE_KEY environment variables are required"
            )
        _client = create_client(url, key)
    return _client


# --- Stations ---

def fetch_stations() -> List[dict]:
    """Fetch all stations from database."""
    client = get_client()
    response = client.table("stations").select("*").execute()
    return response.data


def upsert_station(station: dict) -> dict:
    """Insert or update a station."""
    client = get_client()
    response = client.table("stations").upsert(station).execute()
    return response.data[0] if response.data else {}


def delete_station(station_id: str) -> None:
    """Delete a station by ID."""
    client = get_client()
    client.table("stations").delete().eq("id", station_id).execute()


# --- Employees ---

def fetch_employees() -> List[dict]:
    """Fetch all employees from database."""
    client = get_client()
    response = client.table("employees").select("*").execute()
    return response.data


def upsert_employee(employee: dict) -> dict:
    """Insert or update an employee."""
    client = get_client()
    response = client.table("employees").upsert(employee).execute()
    return response.data[0] if response.data else {}


def delete_employee(employee_id: str) -> None:
    """Delete an employee by ID."""
    client = get_client()
    client.table("employees").delete().eq("id", employee_id).execute()


def update_employee_absence(employee_id: str, is_absent: bool) -> None:
    """Update an employee's absence status."""
    client = get_client()
    client.table("employees").update({"is_absent": is_absent}).eq("id", employee_id).execute()


# --- Competencies ---

def fetch_competencies() -> List[dict]:
    """Fetch all competencies from database."""
    client = get_client()
    response = client.table("competencies").select("*").execute()
    return response.data


def fetch_competencies_for_employee(employee_id: str) -> List[dict]:
    """Fetch competencies for a specific employee."""
    client = get_client()
    response = client.table("competencies").select("*").eq("employee_id", employee_id).execute()
    return response.data


def upsert_competencies(employee_id: str, competencies: Dict[str, int]) -> None:
    """Insert or update competencies for an employee."""
    client = get_client()
    # Delete existing competencies for this employee
    client.table("competencies").delete().eq("employee_id", employee_id).execute()
    # Insert new competencies
    if competencies:
        rows = [
            {"employee_id": employee_id, "station_id": station_id, "level": level}
            for station_id, level in competencies.items()
        ]
        client.table("competencies").insert(rows).execute()


def delete_competencies_for_employee(employee_id: str) -> None:
    """Delete all competencies for an employee."""
    client = get_client()
    client.table("competencies").delete().eq("employee_id", employee_id).execute()


# --- Settings ---

def fetch_setting(key: str) -> Optional[dict]:
    """Fetch a setting by key."""
    client = get_client()
    response = client.table("settings").select("*").eq("key", key).execute()
    if response.data:
        return response.data[0].get("value")
    return None


def upsert_setting(key: str, value: dict) -> None:
    """Insert or update a setting."""
    client = get_client()
    client.table("settings").upsert({"key": key, "value": value}).execute()


# --- Assignment Logs ---

def upsert_assignment_logs(logs: List[dict]) -> List[dict]:
    """Bulk upsert assignment logs for a finalized day."""
    if not logs:
        return []
    client = get_client()
    response = client.table("assignment_logs").upsert(
        logs, on_conflict="log_date,employee_id,station_id"
    ).execute()
    return response.data


def fetch_assignment_logs_by_date(log_date: str) -> List[dict]:
    """Get all logs for a specific date."""
    client = get_client()
    response = client.table("assignment_logs").select("*").eq("log_date", log_date).execute()
    return response.data


def fetch_all_assignment_logs(since_date: Optional[str] = None) -> List[dict]:
    """Get all logs, optionally since a date."""
    client = get_client()
    query = client.table("assignment_logs").select("*").order("log_date", desc=True)
    if since_date:
        query = query.gte("log_date", since_date)
    response = query.execute()
    return response.data


def fetch_assignment_logs_for_employee(employee_id: str, since_date: Optional[str] = None) -> List[dict]:
    """Get assignment logs for a specific employee."""
    client = get_client()
    query = client.table("assignment_logs").select("*").eq("employee_id", employee_id).order("log_date", desc=True)
    if since_date:
        query = query.gte("log_date", since_date)
    response = query.execute()
    return response.data


def fetch_assignment_logs_for_station(station_id: str, since_date: Optional[str] = None) -> List[dict]:
    """Get assignment logs for a specific station."""
    client = get_client()
    query = client.table("assignment_logs").select("*").eq("station_id", station_id).order("log_date", desc=True)
    if since_date:
        query = query.gte("log_date", since_date)
    response = query.execute()
    return response.data


def delete_assignment_logs_by_date(log_date: str) -> None:
    """Delete all assignment logs for a specific date."""
    client = get_client()
    client.table("assignment_logs").delete().eq("log_date", log_date).execute()


# --- Bulk Operations ---

def load_all_data() -> dict:
    """Load all data from Supabase in one go."""
    stations = fetch_stations()
    employees = fetch_employees()
    competencies = fetch_competencies()
    try:
        assignment_logs = fetch_all_assignment_logs()
    except Exception:
        # Table may not exist yet if migration hasn't been run
        assignment_logs = []
    skill_labels = fetch_setting("skill_labels")
    cert_labels = fetch_setting("cert_labels")
    competency_colors = fetch_setting("competency_colors")

    # Build competencies dict per employee
    emp_competencies = {}
    for comp in competencies:
        emp_id = comp["employee_id"]
        if emp_id not in emp_competencies:
            emp_competencies[emp_id] = {}
        emp_competencies[emp_id][comp["station_id"]] = comp["level"]

    # Attach competencies to employees
    for emp in employees:
        emp["station_competencies"] = emp_competencies.get(emp["id"], {})

    return {
        "stations": stations,
        "employees": employees,
        "assignment_logs": assignment_logs,
        "skill_labels": skill_labels,
        "cert_labels": cert_labels,
        "competency_colors": competency_colors,
    }
