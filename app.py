"""Cross-Training Matrix Scheduler - Streamlit Application."""

import json
import io
import os
import requests as http_requests
from datetime import date, datetime, timedelta
import streamlit as st
import pandas as pd
from pathlib import Path
import uuid
from urllib.parse import urlencode
from dotenv import load_dotenv
from fpdf import FPDF

# Load environment variables from .env file
load_dotenv()

from scheduler import (
    MatrixScheduler,
    Station,
    Employee,
    SkillLevel,
    AssignmentLog,
    RotationStats,
    ScenarioWeights,
    load_all,
)
from scheduler import supabase_client as db

# Page config
st.set_page_config(
    page_title="Rotation & Safety Management System",
    page_icon="🏭",
    layout="wide",
)

# Data file path for JSON fallback/export
DATA_FILE = Path("data/current_data.json")

# Check if Supabase is configured
SUPABASE_ENABLED = bool(os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_KEY"))

# Default skill level labels (0-4 scale)
DEFAULT_SKILL_LABELS = {
    0: "N/A",
    1: "General",
    2: "Intermediate",
    3: "Licensed",
    4: "Trainer",
}

# Default certification level labels (0-2 scale)
DEFAULT_CERT_LABELS = {
    0: "None",
    1: "Apprentice",
    2: "Licensed Mechanic",
}

# Default competency colors (0-4 scale) - red to green gradient for quick visual scanning
DEFAULT_COMPETENCY_COLORS = {
    0: "#E8E8E8",  # Gray - N/A
    1: "#F8D7DA",  # Light red - needs attention
    2: "#FFE5B4",  # Peach/orange - developing
    3: "#D4EDDA",  # Light green - competent
    4: "#28A745",  # Green - trainer level
}


def get_skill_labels():
    """Get current skill labels from session state."""
    return st.session_state.get("skill_labels", DEFAULT_SKILL_LABELS.copy())


def get_skill_options():
    """Get skill options as list of tuples for selectbox."""
    labels = get_skill_labels()
    return [(i, labels[i]) for i in range(5)]


def get_cert_labels():
    """Get current certification labels from session state."""
    return st.session_state.get("cert_labels", DEFAULT_CERT_LABELS.copy())


def get_cert_options():
    """Get certification options as list of tuples for selectbox."""
    labels = get_cert_labels()
    return [(i, labels[i]) for i in range(3)]


def get_competency_colors():
    """Get current competency colors from session state."""
    return st.session_state.get("competency_colors", DEFAULT_COMPETENCY_COLORS.copy())


def generate_id(prefix: str) -> str:
    """Generate a unique ID with prefix."""
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


ADMIN_EMAIL = "max.parkes@clutch.ca"
ALLOWED_DOMAIN = "clutch.ca"


def get_current_user_email():
    """Get email of the signed-in user from auth session."""
    session = st.session_state.get("auth_session")
    if session and isinstance(session, dict):
        user = session.get("user", {})
        return user.get("email", "unknown")
    return "local"


def _get_secret(key, default=""):
    """Get a secret from st.secrets or environment variables."""
    try:
        return st.secrets[key]
    except Exception:
        return os.environ.get(key, default)


def login_page():
    """Render the login page with Google OAuth. Blocks access to the rest of the app."""
    # Handle OAuth callback — Google returns ?code=... as a query param
    auth_code = st.query_params.get("code")
    if auth_code:
        redirect_url = _get_secret("REDIRECT_URL", "http://localhost:8501")
        # Exchange authorization code for tokens via Google's token endpoint
        token_response = http_requests.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": auth_code,
                "client_id": _get_secret("GOOGLE_CLIENT_ID"),
                "client_secret": _get_secret("GOOGLE_CLIENT_SECRET"),
                "redirect_uri": redirect_url,
                "grant_type": "authorization_code",
            },
        )
        if token_response.status_code != 200:
            st.query_params.clear()
            st.error(f"Token exchange failed (HTTP {token_response.status_code}): {token_response.text}")
            st.stop()

        token_data = token_response.json()

        if "error" in token_data:
            st.query_params.clear()
            st.error(f"Token exchange failed: {token_data.get('error_description', token_data['error'])}")
            st.stop()

        # Get user info from Google
        userinfo_response = http_requests.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {token_data['access_token']}"},
        )

        if userinfo_response.status_code != 200:
            st.query_params.clear()
            st.error(f"Failed to get user info (HTTP {userinfo_response.status_code}): {userinfo_response.text}")
            st.stop()

        user_info = userinfo_response.json()
        user_email = user_info.get("email", "")

        if not user_email.lower().endswith(f"@{ALLOWED_DOMAIN}"):
            st.query_params.clear()
            st.error(f"Access denied. Only @{ALLOWED_DOMAIN} accounts are allowed.")
            st.stop()

        st.session_state.auth_session = {
            "user": {
                "id": user_info.get("id", ""),
                "email": user_email,
            },
            "access_token": token_data["access_token"],
        }
        st.query_params.clear()
        st.rerun()

    st.title("Rotation & Safety Management System")
    st.markdown("Sign in with your company Google account to access the scheduler")

    redirect_url = _get_secret("REDIRECT_URL", "http://localhost:8501")
    params = urlencode({
        "client_id": _get_secret("GOOGLE_CLIENT_ID"),
        "redirect_uri": redirect_url,
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "offline",
        "prompt": "select_account",
    })
    oauth_url = f"https://accounts.google.com/o/oauth2/v2/auth?{params}"
    st.link_button("Continue with Google", oauth_url, type="primary")


def log_action(action, details=""):
    """Write an audit log entry for the current user."""
    email = get_current_user_email()
    if SUPABASE_ENABLED:
        try:
            db.insert_audit_log(email, action, details)
        except Exception:
            pass  # Don't break the app if audit table doesn't exist yet
    # Also append to session state for immediate display
    if "audit_logs" not in st.session_state:
        st.session_state.audit_logs = []
    st.session_state.audit_logs.insert(0, {
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "user": email,
        "action": action,
        "details": details,
    })


def auto_save():
    """Auto-save current data (no-op when using Supabase - saves happen immediately)."""
    if SUPABASE_ENABLED:
        # With Supabase, saves happen immediately on each change
        return

    # Fallback to JSON file save
    scheduler = st.session_state.scheduler
    if scheduler is None:
        return

    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)

    data = {
        "stations": [s.to_dict() for s in scheduler.stations.values()],
        "employees": [e.to_dict() for e in scheduler.employees.values()],
        "assignment_logs": [log.to_dict() for log in scheduler.assignment_logs],
        "skill_labels": get_skill_labels(),
        "cert_labels": get_cert_labels(),
        "competency_colors": get_competency_colors(),
    }

    with open(DATA_FILE, "w") as f:
        json.dump(data, f, indent=2)


def save_skill_labels():
    """Save skill labels to Supabase."""
    if SUPABASE_ENABLED:
        db.upsert_setting("skill_labels", get_skill_labels())


def save_cert_labels():
    """Save certification labels to Supabase."""
    if SUPABASE_ENABLED:
        db.upsert_setting("cert_labels", get_cert_labels())


def save_competency_colors():
    """Save competency colors to Supabase."""
    if SUPABASE_ENABLED:
        db.upsert_setting("competency_colors", get_competency_colors())


def init_session_state():
    """Initialize session state variables."""
    if "skill_labels" not in st.session_state:
        st.session_state.skill_labels = DEFAULT_SKILL_LABELS.copy()

    if "cert_labels" not in st.session_state:
        st.session_state.cert_labels = DEFAULT_CERT_LABELS.copy()

    if "competency_colors" not in st.session_state:
        st.session_state.competency_colors = DEFAULT_COMPETENCY_COLORS.copy()

    if "scheduler" not in st.session_state:
        if SUPABASE_ENABLED:
            # Load from Supabase
            try:
                data = db.load_all_data()

                stations = [Station.from_dict(s) for s in data.get("stations", [])]
                employees = []
                for e in data.get("employees", []):
                    emp = Employee.from_dict(e)
                    employees.append(emp)

                st.session_state.scheduler = MatrixScheduler(stations, employees)

                # Load assignment logs
                for log_data in data.get("assignment_logs", []):
                    st.session_state.scheduler.assignment_logs.append(
                        AssignmentLog.from_dict(log_data)
                    )

                # Set absent employees from is_absent flag
                for e in data.get("employees", []):
                    if e.get("is_absent", False):
                        st.session_state.scheduler.absent_employees.add(e["id"])
                        st.session_state.scheduler.available_employees.discard(e["id"])

                # Load custom labels if present
                if data.get("skill_labels"):
                    loaded_labels = {int(k): v for k, v in data["skill_labels"].items()}
                    st.session_state.skill_labels = loaded_labels

                if data.get("cert_labels"):
                    loaded_labels = {int(k): v for k, v in data["cert_labels"].items()}
                    st.session_state.cert_labels = loaded_labels

                if data.get("competency_colors"):
                    loaded_colors = {int(k): v for k, v in data["competency_colors"].items()}
                    st.session_state.competency_colors = loaded_colors

            except Exception as e:
                st.error(f"Failed to load from Supabase: {e}")
                st.session_state.scheduler = MatrixScheduler([], [])
        elif DATA_FILE.exists():
            # Fallback to JSON file
            try:
                with open(DATA_FILE, "r") as f:
                    data = json.load(f)

                stations = [Station.from_dict(s) for s in data.get("stations", [])]
                employees = [Employee.from_dict(e) for e in data.get("employees", [])]
                st.session_state.scheduler = MatrixScheduler(stations, employees)

                # Load assignment logs from JSON
                for log_data in data.get("assignment_logs", []):
                    st.session_state.scheduler.assignment_logs.append(
                        AssignmentLog.from_dict(log_data)
                    )

                # Load custom skill labels if present
                if "skill_labels" in data:
                    loaded_labels = {int(k): v for k, v in data["skill_labels"].items()}
                    st.session_state.skill_labels = loaded_labels

                # Load custom cert labels if present
                if "cert_labels" in data:
                    loaded_labels = {int(k): v for k, v in data["cert_labels"].items()}
                    st.session_state.cert_labels = loaded_labels

                # Load custom competency colors if present
                if "competency_colors" in data:
                    loaded_colors = {int(k): v for k, v in data["competency_colors"].items()}
                    st.session_state.competency_colors = loaded_colors
            except Exception:
                st.session_state.scheduler = MatrixScheduler([], [])
        else:
            st.session_state.scheduler = MatrixScheduler([], [])

    if "schedule_generated" not in st.session_state:
        st.session_state.schedule_generated = False

    if "adding_employee" not in st.session_state:
        st.session_state.adding_employee = False

    if "editing_employee" not in st.session_state:
        st.session_state.editing_employee = None

    if "override_mode" not in st.session_state:
        st.session_state.override_mode = False

    if "audit_logs" not in st.session_state:
        st.session_state.audit_logs = []
        if SUPABASE_ENABLED:
            try:
                st.session_state.audit_logs = db.fetch_audit_logs(limit=50)
            except Exception:
                pass  # Table may not exist yet


def render_sidebar():
    """Render sidebar with management controls."""
    scheduler = st.session_state.scheduler
    skill_labels = get_skill_labels()
    skill_options = get_skill_options()
    cert_labels = get_cert_labels()
    cert_options = get_cert_options()

    with st.sidebar:
        # === SIGNED-IN USER & LOGOUT ===
        user_email = get_current_user_email()
        col_user, col_logout = st.columns([3, 1])
        with col_user:
            st.caption(f"Signed in as **{user_email}**")
        with col_logout:
            if st.button("Logout", key="logout_btn"):
                st.session_state.auth_session = None
                st.rerun()
        st.divider()

        st.header("Manage Data")

        # === SETTINGS SECTION ===
        with st.expander("⚙️ Settings", expanded=False):
            st.subheader("Competency Level Labels")
            st.caption("Customize the names for each competency level (0-4)")

            updated_skill_labels = {}
            for level in range(5):
                updated_skill_labels[level] = st.text_input(
                    f"Level {level}",
                    value=skill_labels[level],
                    key=f"skill_label_{level}",
                )

            if st.button("Save Competency Labels", key="save_skill_labels_btn"):
                st.session_state.skill_labels = updated_skill_labels
                save_skill_labels()
                auto_save()
                log_action("Updated competency labels")
                st.success("Competency labels saved!")
                st.rerun()

            st.divider()

            st.subheader("Certification Level Labels")
            st.caption("Customize the names for each certification level (0-2)")

            updated_cert_labels = {}
            for level in range(3):
                updated_cert_labels[level] = st.text_input(
                    f"Cert Level {level}",
                    value=cert_labels[level],
                    key=f"cert_label_{level}",
                )

            if st.button("Save Certification Labels", key="save_cert_labels_btn"):
                st.session_state.cert_labels = updated_cert_labels
                save_cert_labels()
                auto_save()
                log_action("Updated certification labels")
                st.success("Certification labels saved!")
                st.rerun()

            st.divider()

            st.subheader("Competency Colors")
            st.caption("Customize background colors for each competency level")

            competency_colors = get_competency_colors()
            updated_colors = {}
            for level in range(5):
                col1, col2 = st.columns([1, 2])
                with col1:
                    updated_colors[level] = st.color_picker(
                        f"Level {level}",
                        value=competency_colors.get(level, DEFAULT_COMPETENCY_COLORS[level]),
                        key=f"color_picker_{level}",
                    )
                with col2:
                    st.markdown(
                        f"<div style='background-color: {competency_colors.get(level, DEFAULT_COMPETENCY_COLORS[level])}; "
                        f"padding: 0.5rem; border-radius: 4px; margin-top: 0.5rem;'>"
                        f"{skill_labels.get(level, f'Level {level}')}</div>",
                        unsafe_allow_html=True,
                    )

            if st.button("Save Colors", key="save_colors_btn"):
                st.session_state.competency_colors = updated_colors
                save_competency_colors()
                auto_save()
                log_action("Updated competency colors")
                st.success("Competency colors saved!")
                st.rerun()

            st.divider()
            if st.button("Reset All to Defaults", type="secondary", key="reset_labels_btn"):
                st.session_state.skill_labels = DEFAULT_SKILL_LABELS.copy()
                st.session_state.cert_labels = DEFAULT_CERT_LABELS.copy()
                st.session_state.competency_colors = DEFAULT_COMPETENCY_COLORS.copy()
                save_skill_labels()
                save_cert_labels()
                save_competency_colors()
                auto_save()
                log_action("Reset all settings to defaults")
                st.rerun()

        # === EMPLOYEES SECTION ===
        with st.expander("👥 Employees", expanded=True):
            if st.button("+ Add New Employee", type="primary", key="start_add_emp"):
                st.session_state.adding_employee = True
                st.session_state.editing_employee = None

            if scheduler.employees:
                st.divider()
                st.subheader("Edit / Remove")

                emp_list = [(e.id, e.name) for e in scheduler.employees.values()]
                selected_emp = st.selectbox(
                    "Select Employee",
                    options=emp_list,
                    format_func=lambda x: x[1],
                    key="edit_emp_select",
                )

                col1, col2 = st.columns(2)
                with col1:
                    if st.button("Edit", key="edit_emp_btn"):
                        st.session_state.editing_employee = selected_emp[0]
                        st.session_state.adding_employee = False

                with col2:
                    if st.button("Remove", type="secondary", key="remove_emp_btn"):
                        removed_name = scheduler.employees[selected_emp[0]].name
                        if SUPABASE_ENABLED:
                            db.delete_employee(selected_emp[0])
                        del scheduler.employees[selected_emp[0]]
                        scheduler.available_employees.discard(selected_emp[0])
                        scheduler.absent_employees.discard(selected_emp[0])
                        for assignment in scheduler.assignments.values():
                            if selected_emp[0] in assignment.assigned_employee_ids:
                                assignment.assigned_employee_ids.remove(selected_emp[0])
                        st.session_state.schedule_generated = False
                        auto_save()
                        log_action("Removed employee", removed_name)
                        st.rerun()

        # === STATIONS SECTION ===
        with st.expander("🏭 Stations", expanded=True):
            st.subheader("Add Station")

            new_station_name = st.text_input("Station Name", key="new_station_name")
            new_station_skill = st.selectbox(
                "Required Competency",
                options=skill_options,
                format_func=lambda x: f"{x[0]} - {x[1]}",
                key="new_station_skill",
            )
            new_station_cert = st.selectbox(
                "Required Certification",
                options=cert_options,
                format_func=lambda x: f"{x[0]} - {x[1]}",
                key="new_station_cert",
            )
            new_station_headcount = st.number_input(
                "Headcount",
                min_value=1,
                max_value=50,
                value=1,
                key="new_station_headcount",
            )

            if st.button("Add Station", type="primary", key="add_station_btn"):
                if new_station_name.strip():
                    new_id = generate_id("station")
                    new_station = Station(
                        new_id,
                        new_station_name.strip(),
                        new_station_skill[0],
                        int(new_station_headcount),
                        new_station_cert[0],
                    )
                    scheduler.stations[new_id] = new_station
                    if SUPABASE_ENABLED:
                        db.upsert_station(new_station.to_dict())
                    st.session_state.schedule_generated = False
                    auto_save()
                    log_action("Added station", new_station_name.strip())
                    st.rerun()
                else:
                    st.error("Please enter a station name")

            if scheduler.stations:
                st.divider()
                st.subheader("Edit / Remove")

                station_list = [(s.id, s.name) for s in scheduler.stations.values()]
                selected_station = st.selectbox(
                    "Select Station",
                    options=station_list,
                    format_func=lambda x: x[1],
                    key="edit_station_select",
                )

                if selected_station:
                    station = scheduler.stations[selected_station[0]]
                    station_key = selected_station[0]  # Use station ID for unique keys

                    edited_station_name = st.text_input(
                        "Edit Name",
                        value=station.name,
                        key=f"edit_station_name_{station_key}",
                    )

                    current_station_skill_idx = [
                        i for i, opt in enumerate(skill_options)
                        if opt[0] == station.required_skill_level
                    ]
                    edited_station_skill = st.selectbox(
                        "Edit Required Competency",
                        options=skill_options,
                        format_func=lambda x: f"{x[0]} - {x[1]}",
                        index=current_station_skill_idx[0] if current_station_skill_idx else 0,
                        key=f"edit_station_skill_{station_key}",
                    )

                    current_station_cert_idx = [
                        i for i, opt in enumerate(cert_options)
                        if opt[0] == station.required_certification
                    ]
                    edited_station_cert = st.selectbox(
                        "Edit Required Certification",
                        options=cert_options,
                        format_func=lambda x: f"{x[0]} - {x[1]}",
                        index=current_station_cert_idx[0] if current_station_cert_idx else 0,
                        key=f"edit_station_cert_{station_key}",
                    )

                    edited_headcount = st.number_input(
                        "Edit Headcount",
                        min_value=1,
                        max_value=50,
                        value=station.required_headcount,
                        key=f"edit_station_headcount_{station_key}",
                    )

                    col1, col2 = st.columns(2)
                    with col1:
                        if st.button("Update", key="update_station_btn"):
                            station.name = edited_station_name.strip()
                            station.required_skill_level = edited_station_skill[0]
                            station.required_certification = edited_station_cert[0]
                            station.required_headcount = int(edited_headcount)
                            if SUPABASE_ENABLED:
                                db.upsert_station(station.to_dict())
                            st.session_state.schedule_generated = False
                            auto_save()
                            log_action("Updated station", edited_station_name.strip())
                            st.rerun()

                    with col2:
                        if st.button("Remove", type="secondary", key="remove_station_btn"):
                            removed_station_name = scheduler.stations[selected_station[0]].name
                            if SUPABASE_ENABLED:
                                db.delete_station(selected_station[0])
                            for emp in scheduler.employees.values():
                                if selected_station[0] in emp.station_competencies:
                                    del emp.station_competencies[selected_station[0]]
                            del scheduler.stations[selected_station[0]]
                            if selected_station[0] in scheduler.assignments:
                                del scheduler.assignments[selected_station[0]]
                            st.session_state.schedule_generated = False
                            auto_save()
                            log_action("Removed station", removed_station_name)
                            st.rerun()

        # === IMPORT/EXPORT ===
        with st.expander("📁 Import / Export"):
            st.subheader("Load Sample Data")
            if st.button("Load Sample", key="load_sample_btn"):
                sample_path = Path("data/sample_data.json")
                if sample_path.exists():
                    with open(sample_path, "r") as f:
                        data = json.load(f)
                    stations = [Station.from_dict(s) for s in data.get("stations", [])]
                    employees = [Employee.from_dict(e) for e in data.get("employees", [])]
                    st.session_state.scheduler = MatrixScheduler(stations, employees)
                    if "skill_labels" in data:
                        loaded_labels = {int(k): v for k, v in data["skill_labels"].items()}
                        st.session_state.skill_labels = loaded_labels
                    if "cert_labels" in data:
                        loaded_labels = {int(k): v for k, v in data["cert_labels"].items()}
                        st.session_state.cert_labels = loaded_labels
                    if "competency_colors" in data:
                        loaded_colors = {int(k): v for k, v in data["competency_colors"].items()}
                        st.session_state.competency_colors = loaded_colors
                    st.session_state.schedule_generated = False
                    auto_save()
                    log_action("Loaded sample data")
                    st.rerun()

            st.divider()
            st.subheader("Upload JSON")
            uploaded_file = st.file_uploader(
                "Upload data file",
                type=["json"],
                key="upload_json",
            )
            if uploaded_file is not None:
                try:
                    data = json.load(uploaded_file)
                    stations = [Station.from_dict(s) for s in data.get("stations", [])]
                    employees = [Employee.from_dict(e) for e in data.get("employees", [])]
                    st.session_state.scheduler = MatrixScheduler(stations, employees)
                    if "skill_labels" in data:
                        loaded_labels = {int(k): v for k, v in data["skill_labels"].items()}
                        st.session_state.skill_labels = loaded_labels
                    if "cert_labels" in data:
                        loaded_labels = {int(k): v for k, v in data["cert_labels"].items()}
                        st.session_state.cert_labels = loaded_labels
                    if "competency_colors" in data:
                        loaded_colors = {int(k): v for k, v in data["competency_colors"].items()}
                        st.session_state.competency_colors = loaded_colors
                    st.session_state.schedule_generated = False
                    auto_save()
                    log_action("Uploaded JSON data file")
                    st.success("Data loaded!")
                    st.rerun()
                except Exception as e:
                    st.error(f"Error: {e}")

            st.divider()
            st.subheader("Download Data")
            if scheduler.stations or scheduler.employees:
                data = {
                    "stations": [s.to_dict() for s in scheduler.stations.values()],
                    "employees": [e.to_dict() for e in scheduler.employees.values()],
                    "assignment_logs": [log.to_dict() for log in scheduler.assignment_logs],
                    "skill_labels": get_skill_labels(),
                    "cert_labels": get_cert_labels(),
                    "competency_colors": get_competency_colors(),
                }
                st.download_button(
                    "Download JSON",
                    data=json.dumps(data, indent=2),
                    file_name="scheduler_data.json",
                    mime="application/json",
                )

        # === ACTIVITY LOG (admin only) ===
        if get_current_user_email() == ADMIN_EMAIL:
            with st.expander("Activity Log", expanded=False):
                audit_logs = st.session_state.get("audit_logs", [])
                if audit_logs:
                    for entry in audit_logs[:50]:
                        ts = entry.get("timestamp", "")
                        user = entry.get("user_email", entry.get("user", ""))
                        action = entry.get("action", "")
                        details = entry.get("details", "")
                        # Show compact user (just the part before @)
                        short_user = user.split("@")[0] if "@" in user else user
                        detail_str = f" — {details}" if details else ""
                        st.caption(f"**{ts}** · {short_user} · {action}{detail_str}")
                else:
                    st.caption("No activity recorded yet.")


def render_add_employee_form():
    """Render form to add a new employee with station competencies."""
    scheduler = st.session_state.scheduler
    skill_labels = get_skill_labels()
    skill_options = get_skill_options()
    cert_labels = get_cert_labels()
    cert_options = get_cert_options()

    st.subheader("Add New Employee")

    if not scheduler.stations:
        st.warning("Please add stations first before adding employees.")
        if st.button("Cancel"):
            st.session_state.adding_employee = False
            st.rerun()
        return

    new_name = st.text_input("Employee Name", key="new_emp_name_form")

    new_cert = st.selectbox(
        "Certification Level",
        options=cert_options,
        format_func=lambda x: f"{x[0]} - {x[1]}",
        key="new_emp_cert",
    )

    st.write("**Rate competency for each station (0-4):**")

    competencies = {}
    cols = st.columns(min(3, len(scheduler.stations)))

    for idx, station in enumerate(scheduler.stations.values()):
        col_idx = idx % len(cols)
        with cols[col_idx]:
            level = st.selectbox(
                f"{station.name}",
                options=skill_options,
                format_func=lambda x: f"{x[0]} - {x[1]}",
                key=f"new_emp_comp_{station.id}",
            )
            competencies[station.id] = level[0]

    col1, col2 = st.columns(2)
    with col1:
        if st.button("Save Employee", type="primary"):
            if new_name.strip():
                new_id = generate_id("emp")
                new_employee = Employee(
                    id=new_id,
                    name=new_name.strip(),
                    station_competencies=competencies,
                    certification_level=new_cert[0],
                )
                scheduler.employees[new_id] = new_employee
                scheduler.available_employees.add(new_id)
                if SUPABASE_ENABLED:
                    db.upsert_employee({
                        "id": new_id,
                        "name": new_name.strip(),
                        "certification_level": new_cert[0],
                        "is_absent": False,
                    })
                    db.upsert_competencies(new_id, competencies)
                st.session_state.adding_employee = False
                st.session_state.schedule_generated = False
                auto_save()
                log_action("Added employee", new_name.strip())
                st.rerun()
            else:
                st.error("Please enter a name")

    with col2:
        if st.button("Cancel"):
            st.session_state.adding_employee = False
            st.rerun()


def render_edit_employee_form():
    """Render form to edit an existing employee's competencies."""
    scheduler = st.session_state.scheduler
    skill_labels = get_skill_labels()
    skill_options = get_skill_options()
    cert_labels = get_cert_labels()
    cert_options = get_cert_options()
    emp_id = st.session_state.editing_employee

    if emp_id not in scheduler.employees:
        st.session_state.editing_employee = None
        st.rerun()
        return

    employee = scheduler.employees[emp_id]

    st.subheader(f"Edit Employee: {employee.name}")

    edited_name = st.text_input("Employee Name", value=employee.name, key=f"edit_emp_name_form_{emp_id}")

    current_cert_idx = [i for i, opt in enumerate(cert_options) if opt[0] == employee.certification_level]
    edited_cert = st.selectbox(
        "Certification Level",
        options=cert_options,
        format_func=lambda x: f"{x[0]} - {x[1]}",
        index=current_cert_idx[0] if current_cert_idx else 0,
        key=f"edit_emp_cert_{emp_id}",
    )

    st.write("**Update competency for each station (0-4):**")

    competencies = {}
    cols = st.columns(min(3, max(1, len(scheduler.stations))))

    for idx, station in enumerate(scheduler.stations.values()):
        col_idx = idx % len(cols)
        current_level = employee.get_competency(station.id)
        current_idx = [i for i, opt in enumerate(skill_options) if opt[0] == current_level]

        with cols[col_idx]:
            level = st.selectbox(
                f"{station.name}",
                options=skill_options,
                format_func=lambda x: f"{x[0]} - {x[1]}",
                index=current_idx[0] if current_idx else 0,
                key=f"edit_emp_comp_{emp_id}_{station.id}",
            )
            competencies[station.id] = level[0]

    col1, col2 = st.columns(2)
    with col1:
        if st.button("Save Changes", type="primary"):
            employee.name = edited_name.strip()
            employee.certification_level = edited_cert[0]
            employee.station_competencies = competencies
            if SUPABASE_ENABLED:
                is_absent = emp_id in scheduler.absent_employees
                db.upsert_employee({
                    "id": emp_id,
                    "name": edited_name.strip(),
                    "certification_level": edited_cert[0],
                    "is_absent": is_absent,
                })
                db.upsert_competencies(emp_id, competencies)
            st.session_state.editing_employee = None
            st.session_state.schedule_generated = False
            auto_save()
            log_action("Updated employee", edited_name.strip())
            st.rerun()

    with col2:
        if st.button("Cancel"):
            st.session_state.editing_employee = None
            st.rerun()


def display_cross_training_matrix():
    """Display the cross-training matrix showing all employees and their station competencies."""
    scheduler = st.session_state.scheduler
    skill_labels = get_skill_labels()
    cert_labels = get_cert_labels()

    # Count absent employees for summary
    total_employees = len(scheduler.employees)
    absent_count = len(scheduler.absent_employees)
    present_count = total_employees - absent_count

    # Header row with summary on the right
    col_left, col_right = st.columns([2, 1])
    with col_left:
        st.header("Cross-Training Matrix")
    with col_right:
        if total_employees > 0:
            st.markdown(
                f"<div style='text-align: right; padding-top: 1.5rem;'>"
                f"<b>{present_count}</b> present · <b>{absent_count}</b> absent · <b>{total_employees}</b> total"
                f"</div>",
                unsafe_allow_html=True,
            )

    if not scheduler.stations:
        st.info("No stations. Add some in the sidebar →")
        return

    if not scheduler.employees:
        st.info("No employees. Add some in the sidebar →")
        return

    # Competency level indicators (colored squares)
    level_indicators = {
        0: "⬜",  # White - N/A
        1: "🟥",  # Red - needs attention
        2: "🟧",  # Orange - developing
        3: "🟨",  # Yellow - competent
        4: "🟩",  # Green - trainer
    }

    # Build matrix data with employee IDs for tracking
    matrix_data = []
    emp_ids = []
    for idx, emp in enumerate(scheduler.employees.values(), start=1):
        emp_ids.append(emp.id)
        is_present = emp.id not in scheduler.absent_employees
        row = {
            "#": idx,
            "Present": is_present,
            "Employee": emp.name,
            "Cert": cert_labels.get(emp.certification_level, "?"),
        }
        for station in scheduler.stations.values():
            competency = emp.get_competency(station.id)
            indicator = level_indicators.get(competency, "")
            row[station.name] = f"{indicator} {competency} - {skill_labels.get(competency, '?')}"
        matrix_data.append(row)

    df = pd.DataFrame(matrix_data)

    # Configure column settings
    column_config = {
        "#": st.column_config.NumberColumn("#", disabled=True, width="small"),
        "Present": st.column_config.CheckboxColumn(
            "Present",
            help="Uncheck to mark employee as absent",
            default=True,
        ),
        "Employee": st.column_config.TextColumn("Employee", disabled=True),
        "Cert": st.column_config.TextColumn("Cert", disabled=True),
    }

    # Make station columns read-only
    for station in scheduler.stations.values():
        column_config[station.name] = st.column_config.TextColumn(station.name, disabled=True)

    # Display editable table
    edited_df = st.data_editor(
        df,
        column_config=column_config,
        use_container_width=True,
        hide_index=True,
        key="matrix_editor",
    )

    # Check for presence changes
    for idx, emp_id in enumerate(emp_ids):
        was_present = emp_id not in scheduler.absent_employees
        is_now_present = edited_df.iloc[idx]["Present"]

        if was_present and not is_now_present:
            # Mark as absent
            scheduler.absent_employees.add(emp_id)
            scheduler.available_employees.discard(emp_id)
            if SUPABASE_ENABLED:
                db.update_employee_absence(emp_id, True)
            # Remove from any assignments
            for assignment in scheduler.assignments.values():
                if emp_id in assignment.assigned_employee_ids:
                    assignment.assigned_employee_ids.remove(emp_id)
                    assignment.unfilled_slots += 1
                    assignment.is_fully_staffed = False
            st.session_state.schedule_generated = False
            log_action("Marked absent", scheduler.employees[emp_id].name)
            st.rerun()
        elif not was_present and is_now_present:
            # Mark as present
            scheduler.absent_employees.discard(emp_id)
            scheduler.available_employees.add(emp_id)
            if SUPABASE_ENABLED:
                db.update_employee_absence(emp_id, False)
            st.session_state.schedule_generated = False
            log_action("Marked present", scheduler.employees[emp_id].name)
            st.rerun()

    # Show station requirements
    st.subheader("Station Requirements")
    station_data = []
    for s in scheduler.stations.values():
        station_data.append({
            "Station": s.name,
            "Required Competency": f"{s.required_skill_level} - {skill_labels.get(s.required_skill_level, '?')}",
            "Required Certification": f"{s.required_certification} - {cert_labels.get(s.required_certification, '?')}",
            "Headcount": s.required_headcount,
        })
    st.dataframe(pd.DataFrame(station_data), use_container_width=True, hide_index=True)


def generate_schedule_pdf(scheduler, report_date, skill_labels, cert_labels, scenario_name=None):
    """Generate a printable PDF report of the current schedule."""
    pdf = FPDF(orientation="L", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.add_page()

    page_w = pdf.w - 20  # usable width (10mm margins each side)

    # --- Header ---
    pdf.set_font("Helvetica", "B", 18)
    pdf.cell(page_w, 10, "Daily Schedule Report", ln=True, align="C")
    pdf.set_font("Helvetica", "", 11)
    pdf.cell(page_w, 7, report_date.strftime("%A, %B %d, %Y"), ln=True, align="C")

    if scenario_name:
        pdf.set_font("Helvetica", "I", 10)
        pdf.cell(page_w, 6, f"Strategy: {scenario_name}", ln=True, align="C")

    pdf.ln(4)

    # --- Summary metrics ---
    summary = scheduler.get_schedule_summary()
    unfilled = scheduler.get_unfilled_stations()
    total = len(summary)
    staffed = total - len(unfilled)

    assigned_ids = set()
    for assignment in scheduler.assignments.values():
        assigned_ids.update(assignment.assigned_employee_ids)
    present = set(scheduler.employees.keys()) - scheduler.absent_employees
    unassigned_count = len(present - assigned_ids)
    absent_count = len(scheduler.absent_employees)

    pdf.set_font("Helvetica", "", 10)
    metrics_text = (
        f"Stations: {total}    |    "
        f"Fully Staffed: {staffed}    |    "
        f"Understaffed: {len(unfilled)}    |    "
        f"Unassigned Employees: {unassigned_count}    |    "
        f"Absent: {absent_count}"
    )
    pdf.cell(page_w, 7, metrics_text, ln=True, align="C")
    pdf.ln(4)

    # --- Assignments table ---
    # Column widths (landscape A4 ~ 277mm usable)
    col_station = 50
    col_competency = 35
    col_cert = 35
    col_assigned = page_w - col_station - col_competency - col_cert - 35
    col_filled = 20
    col_status = 15

    # Header row
    pdf.set_fill_color(50, 50, 70)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 9)
    row_h = 8
    pdf.cell(col_station, row_h, "Station", border=1, fill=True, align="C")
    pdf.cell(col_competency, row_h, "Req. Competency", border=1, fill=True, align="C")
    pdf.cell(col_cert, row_h, "Req. Certification", border=1, fill=True, align="C")
    pdf.cell(col_assigned, row_h, "Assigned Employees", border=1, fill=True, align="C")
    pdf.cell(col_filled, row_h, "Filled", border=1, fill=True, align="C")
    pdf.cell(col_status, row_h, "", border=1, fill=True, align="C")
    pdf.ln()

    # Data rows
    pdf.set_text_color(0, 0, 0)
    pdf.set_font("Helvetica", "", 8)
    row_idx = 0
    for station_id, info in summary.items():
        station = scheduler.stations[station_id]
        # Alternating row colors
        if row_idx % 2 == 0:
            pdf.set_fill_color(245, 245, 250)
        else:
            pdf.set_fill_color(255, 255, 255)

        # Build assigned names
        assigned_names = []
        for eid in info["assigned"]:
            if eid in scheduler.employees:
                emp = scheduler.employees[eid]
                comp = emp.get_competency(station_id)
                assigned_names.append(f"{emp.name} (C:{comp})")
        assigned_str = ", ".join(assigned_names) if assigned_names else "-"

        comp_label = f"{station.required_skill_level} - {skill_labels.get(station.required_skill_level, '?')}"
        cert_label = cert_labels.get(station.required_certification, "?")
        filled_str = f"{info['filled']}/{info['required']}"
        status_str = "OK" if info["status"] == "fully_staffed" else "!!"

        pdf.cell(col_station, row_h, station.name[:25], border=1, fill=True)
        pdf.cell(col_competency, row_h, comp_label, border=1, fill=True, align="C")
        pdf.cell(col_cert, row_h, cert_label, border=1, fill=True, align="C")

        # Handle long assigned strings with multi-cell
        pdf.cell(col_assigned, row_h, assigned_str[:80], border=1, fill=True)
        pdf.cell(col_filled, row_h, filled_str, border=1, fill=True, align="C")

        # Status cell with color
        if info["status"] == "fully_staffed":
            pdf.set_fill_color(212, 237, 218)
        else:
            pdf.set_fill_color(248, 215, 218)
        pdf.cell(col_status, row_h, status_str, border=1, fill=True, align="C")
        pdf.ln()

        # Reset fill for next row
        row_idx += 1

    pdf.ln(6)

    # --- Unassigned employees ---
    unassigned_ids = present - assigned_ids
    if unassigned_ids:
        pdf.set_font("Helvetica", "B", 10)
        pdf.cell(page_w, 7, "Unassigned Employees", ln=True)
        pdf.set_font("Helvetica", "", 9)
        unassigned_names = [
            scheduler.employees[eid].name
            for eid in unassigned_ids
            if eid in scheduler.employees
        ]
        pdf.cell(page_w, 6, ", ".join(sorted(unassigned_names)), ln=True)
        pdf.ln(3)

    # --- Absent employees ---
    if scheduler.absent_employees:
        pdf.set_font("Helvetica", "B", 10)
        pdf.cell(page_w, 7, "Absent Employees", ln=True)
        pdf.set_font("Helvetica", "", 9)
        absent_names = [
            scheduler.employees[eid].name
            for eid in scheduler.absent_employees
            if eid in scheduler.employees
        ]
        pdf.cell(page_w, 6, ", ".join(sorted(absent_names)), ln=True)
        pdf.ln(3)

    # --- Footer ---
    pdf.ln(6)
    pdf.set_font("Helvetica", "I", 8)
    pdf.set_text_color(120, 120, 120)
    pdf.cell(page_w, 5, f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}    |    Rotation & Safety Management System", align="C")

    return bytes(pdf.output())


def schedule_section():
    """Section for generating and viewing the schedule."""
    scheduler = st.session_state.scheduler
    skill_labels = get_skill_labels()
    cert_labels = get_cert_labels()

    st.header("Schedule")

    if not scheduler.stations or not scheduler.employees:
        st.info("Add stations and employees first, then generate a schedule")
        return

    col1, col2, col3 = st.columns([2, 1, 2])

    with col1:
        scenario_name = st.selectbox(
            "Scheduling Strategy",
            options=list(MatrixScheduler.SCENARIOS.keys()),
            index=0,
            key="scenario_select",
        )
    with col2:
        st.markdown("<div style='padding-top: 1.7rem;'></div>", unsafe_allow_html=True)
        if st.button("Generate Schedule", type="primary"):
            scenario = MatrixScheduler.SCENARIOS[scenario_name]
            scheduler.generate_schedule(scenario=scenario)
            st.session_state.schedule_generated = True
            st.session_state.active_scenario = scenario_name
            log_action("Generated schedule", scenario_name)
            st.rerun()

    st.caption(f"**{scenario_name}:** {MatrixScheduler.SCENARIO_DESCRIPTIONS[scenario_name]}")

    if not st.session_state.schedule_generated:
        st.info("Click 'Generate Schedule' to assign employees to stations")
        return

    if "active_scenario" in st.session_state:
        st.info(f"Active strategy: **{st.session_state.active_scenario}**")

    # Display schedule
    summary = scheduler.get_schedule_summary()
    unfilled = scheduler.get_unfilled_stations()

    # Calculate unassigned employees for metrics
    assigned_ids = set()
    for assignment in scheduler.assignments.values():
        assigned_ids.update(assignment.assigned_employee_ids)
    present_employees = set(scheduler.employees.keys()) - scheduler.absent_employees
    unassigned_count = len(present_employees - assigned_ids)

    # Status metrics
    total_stations = len(summary)
    filled_stations = total_stations - len(unfilled)

    col1, col2, col3, col4 = st.columns(4)
    col1.metric("Total Stations", total_stations)
    col2.metric("Fully Staffed", filled_stations)
    col3.metric("Understaffed", len(unfilled))
    col4.metric("Unassigned", unassigned_count)

    # Schedule table
    schedule_data = []
    for station_id, info in summary.items():
        station = scheduler.stations[station_id]
        assigned_names = []
        for eid in info["assigned"]:
            if eid in scheduler.employees:
                emp = scheduler.employees[eid]
                comp = emp.get_competency(station_id)
                cert = cert_labels.get(emp.certification_level, "?")
                assigned_names.append(f"{emp.name} (C:{comp}, {cert})")

        schedule_data.append({
            "Station": info["station_name"],
            "Req. Competency": f"{station.required_skill_level} - {skill_labels.get(station.required_skill_level, '?')}",
            "Req. Certification": cert_labels.get(station.required_certification, "?"),
            "Assigned": ", ".join(assigned_names) if assigned_names else "-",
            "Filled": f"{info['filled']}/{info['required']}",
            "Status": "✅ Staffed" if info["status"] == "fully_staffed" else "⚠️ Understaffed",
        })

    st.dataframe(pd.DataFrame(schedule_data), use_container_width=True, hide_index=True)

    # --- Manual Override Section ---
    if st.session_state.override_mode:
        if st.button("Done Editing", key="done_override_btn"):
            st.session_state.override_mode = False
            st.rerun()

        st.subheader("Adjust Assignments")
        st.caption("Select employees for each station slot. Only qualified employees are shown.")

        # Collect all current assignments to track who's taken
        all_assigned = {}  # emp_id -> station_id
        for sid, asn in scheduler.assignments.items():
            for eid in asn.assigned_employee_ids:
                all_assigned[eid] = sid

        # Build override selections per station
        override_selections = {}  # (station_id, slot_idx) -> selected emp_id or None

        for station_id, assignment in scheduler.assignments.items():
            station = scheduler.stations[station_id]
            filled = len(assignment.assigned_employee_ids)
            status_icon = "✅" if assignment.is_fully_staffed else "⚠️"

            with st.expander(
                f"{status_icon} {station.name} ({filled}/{station.required_headcount})",
                expanded=not assignment.is_fully_staffed,
            ):
                for slot_idx in range(station.required_headcount):
                    current_emp_id = (
                        assignment.assigned_employee_ids[slot_idx]
                        if slot_idx < len(assignment.assigned_employee_ids)
                        else None
                    )

                    # Build options: qualified employees not assigned elsewhere (+ current holder)
                    options = [("__unassigned__", "(Unassigned)")]
                    present_ids = set(scheduler.employees.keys()) - scheduler.absent_employees

                    for emp_id in present_ids:
                        if not scheduler.is_qualified(emp_id, station_id):
                            continue
                        emp = scheduler.employees[emp_id]
                        comp = emp.get_competency(station_id)
                        comp_label = skill_labels.get(comp, "?")

                        # Show if: this is the current assignee, or not assigned elsewhere
                        if emp_id == current_emp_id or emp_id not in all_assigned:
                            options.append((emp_id, f"{emp.name} (Comp: {comp} - {comp_label})"))

                    # Find current selection index
                    current_idx = 0
                    if current_emp_id:
                        for i, (eid, _) in enumerate(options):
                            if eid == current_emp_id:
                                current_idx = i
                                break

                    selected = st.selectbox(
                        f"Slot {slot_idx + 1}",
                        options=options,
                        index=current_idx,
                        format_func=lambda x: x[1],
                        key=f"override_{station_id}_{slot_idx}",
                    )
                    override_selections[(station_id, slot_idx)] = selected[0]

        # Apply Changes button
        if st.button("Apply Changes", type="primary", key="apply_overrides_btn"):
            # Check for conflicts (same employee in two slots)
            emp_assignments = {}  # emp_id -> list of (station_id, slot_idx)
            for (sid, slot), emp_id in override_selections.items():
                if emp_id != "__unassigned__":
                    if emp_id not in emp_assignments:
                        emp_assignments[emp_id] = []
                    emp_assignments[emp_id].append((sid, slot))

            conflicts = {eid: locs for eid, locs in emp_assignments.items() if len(locs) > 1}

            if conflicts:
                for emp_id, locs in conflicts.items():
                    emp_name = scheduler.employees[emp_id].name
                    station_names = [scheduler.stations[sid].name for sid, _ in locs]
                    st.error(f"Conflict: {emp_name} assigned to multiple stations: {', '.join(station_names)}")
            else:
                # Apply overrides
                new_assigned_ids = set()
                for station_id in scheduler.assignments:
                    station = scheduler.stations[station_id]
                    new_emp_ids = []
                    for slot_idx in range(station.required_headcount):
                        emp_id = override_selections.get((station_id, slot_idx), "__unassigned__")
                        if emp_id != "__unassigned__":
                            new_emp_ids.append(emp_id)
                            new_assigned_ids.add(emp_id)

                    assignment = scheduler.assignments[station_id]
                    assignment.assigned_employee_ids = new_emp_ids
                    filled = len(new_emp_ids)
                    assignment.unfilled_slots = station.required_headcount - filled
                    assignment.is_fully_staffed = (assignment.unfilled_slots == 0)

                # Update available employees
                scheduler.available_employees = (
                    set(scheduler.employees.keys()) - scheduler.absent_employees - new_assigned_ids
                )

                st.session_state.override_mode = False
                log_action("Manually adjusted assignments")
                st.success("Assignments updated.")
                st.rerun()
    else:
        if st.button("Edit Assignments", key="start_override_btn"):
            st.session_state.override_mode = True
            st.rerun()

    # Show unassigned employees (reuse assigned_ids from metrics calculation)
    # Recalculate in case overrides changed things
    assigned_ids = set()
    for assignment in scheduler.assignments.values():
        assigned_ids.update(assignment.assigned_employee_ids)
    present_employees = set(scheduler.employees.keys()) - scheduler.absent_employees
    unassigned_ids = present_employees - assigned_ids

    if unassigned_ids:
        st.subheader("Unassigned Employees - Training Recommendations")
        st.caption("These employees are present but not assigned to any station")

        # Build recommendations for all unassigned employees
        employees_with_recs = []
        employees_without_recs = []

        for emp_id in unassigned_ids:
            emp = scheduler.employees[emp_id]
            cert_label = cert_labels.get(emp.certification_level, "?")

            # Find training opportunities
            training_recommendations = []
            for station_id, assignment in scheduler.assignments.items():
                station = scheduler.stations[station_id]
                trainer_competency = emp.get_competency(station_id)

                # Only consider if the unassigned employee has some competency at this station
                if trainer_competency > 0:
                    # Find assigned employees with lower competency
                    for assigned_id in assignment.assigned_employee_ids:
                        if assigned_id in scheduler.employees:
                            assigned_emp = scheduler.employees[assigned_id]
                            assigned_competency = assigned_emp.get_competency(station_id)

                            if trainer_competency > assigned_competency:
                                training_recommendations.append({
                                    "station": station.name,
                                    "trainee": assigned_emp.name,
                                    "trainee_level": assigned_competency,
                                    "trainer_level": trainer_competency,
                                })

            if training_recommendations:
                employees_with_recs.append((emp, cert_label, training_recommendations))
            else:
                employees_without_recs.append((emp, cert_label))

        # Display employees with recommendations first (in expanders)
        for emp, cert_label, recs in employees_with_recs:
            with st.expander(f"**{emp.name}** ({cert_label})", expanded=True):
                rec_data = []
                for rec in recs:
                    rec_data.append({
                        "Station": rec["station"],
                        "Can Train": rec["trainee"],
                        "Trainee Level": f"{rec['trainee_level']} - {skill_labels.get(rec['trainee_level'], '?')}",
                        "Trainer Level": f"{rec['trainer_level']} - {skill_labels.get(rec['trainer_level'], '?')}",
                    })
                st.dataframe(pd.DataFrame(rec_data), use_container_width=True, hide_index=True)

        # Display employees without recommendations as simple lines
        if employees_without_recs:
            st.markdown("**No possible pairings:**")
            for emp, cert_label in employees_without_recs:
                st.text(f"  {emp.name} ({cert_label})")

    # --- Finalize Day Section ---
    st.divider()
    st.subheader("Finalize Day")
    st.caption("Commit today's assignments to the rotation history log")

    col_date, col_hours = st.columns(2)
    with col_date:
        finalize_date = st.date_input(
            "Date",
            value=date.today(),
            key="finalize_date",
        )
    with col_hours:
        default_hours = st.number_input(
            "Default shift hours",
            min_value=0.5,
            max_value=24.0,
            value=8.0,
            step=0.5,
            key="default_shift_hours",
        )

    # Build editable table from current assignments
    finalize_rows = []
    for station_id, assignment in scheduler.assignments.items():
        station = scheduler.stations.get(station_id)
        if not station:
            continue
        for emp_id in assignment.assigned_employee_ids:
            emp = scheduler.employees.get(emp_id)
            if not emp:
                continue
            finalize_rows.append({
                "Employee": emp.name,
                "Station": station.name,
                "Hours": default_hours,
                "_employee_id": emp_id,
                "_station_id": station_id,
            })

    if finalize_rows:
        finalize_df = pd.DataFrame(finalize_rows)
        edited_finalize = st.data_editor(
            finalize_df[["Employee", "Station", "Hours"]],
            column_config={
                "Employee": st.column_config.TextColumn("Employee", disabled=True),
                "Station": st.column_config.TextColumn("Station", disabled=True),
                "Hours": st.column_config.NumberColumn(
                    "Hours", min_value=0.5, max_value=24.0, step=0.5
                ),
            },
            use_container_width=True,
            hide_index=True,
            key="finalize_editor",
        )

        btn_col1, btn_col2 = st.columns([1, 1])
        with btn_col1:
            finalize_clicked = st.button("Finalize Day", type="primary", key="finalize_day_btn")
        with btn_col2:
            scenario_name = st.session_state.get("active_scenario", None)
            pdf_bytes = generate_schedule_pdf(
                scheduler, finalize_date, skill_labels, cert_labels, scenario_name
            )
            st.download_button(
                "Download PDF Report",
                data=pdf_bytes,
                file_name=f"schedule_{finalize_date.strftime('%Y-%m-%d')}.pdf",
                mime="application/pdf",
                key="download_pdf_btn",
            )

        if finalize_clicked:
            log_date_str = finalize_date.strftime("%Y-%m-%d")
            new_logs = []
            for idx, row in enumerate(finalize_rows):
                hours = float(edited_finalize.iloc[idx]["Hours"])
                new_logs.append(AssignmentLog(
                    log_date=log_date_str,
                    employee_id=row["_employee_id"],
                    station_id=row["_station_id"],
                    hours=hours,
                ))

            # Persist to Supabase
            if SUPABASE_ENABLED:
                try:
                    db.upsert_assignment_logs([log.to_dict() for log in new_logs])
                except Exception as e:
                    st.warning(f"Could not save to Supabase (table may not exist yet): {e}")

            # Merge into scheduler's in-memory logs (dedup by date/emp/station)
            existing_keys = set()
            for log in scheduler.assignment_logs:
                existing_keys.add((log.log_date, log.employee_id, log.station_id))

            for log in new_logs:
                key = (log.log_date, log.employee_id, log.station_id)
                if key in existing_keys:
                    # Update existing entry
                    for i, existing in enumerate(scheduler.assignment_logs):
                        if (existing.log_date, existing.employee_id, existing.station_id) == key:
                            scheduler.assignment_logs[i] = log
                            break
                else:
                    scheduler.assignment_logs.append(log)
                    existing_keys.add(key)

            auto_save()
            log_action("Finalized day", f"{len(new_logs)} assignments for {log_date_str}")
            st.success(f"Finalized {len(new_logs)} assignments for {log_date_str}")
    else:
        st.info("No assignments to finalize. Generate a schedule first.")


def generate_rotation_pdf(scheduler, rotation_stats, start_date, end_date):
    """Generate a printable PDF of the rotation dashboard matrix."""
    pdf = FPDF(orientation="L", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.add_page()

    page_w = pdf.w - 20  # 10mm margins each side

    # --- Header ---
    pdf.set_font("Helvetica", "B", 18)
    pdf.cell(page_w, 10, "Rotation Dashboard Report", ln=True, align="C")
    pdf.set_font("Helvetica", "", 11)
    pdf.cell(
        page_w, 7,
        f"{start_date.strftime('%b %d, %Y')}  to  {end_date.strftime('%b %d, %Y')}",
        ln=True, align="C",
    )
    pdf.ln(2)
    pdf.set_font("Helvetica", "I", 9)
    pdf.cell(page_w, 5, "Each cell shows: total hours / days since last assignment", ln=True, align="C")
    pdf.ln(4)

    stations = list(scheduler.stations.values())
    employees = list(scheduler.employees.values())

    if not stations or not employees:
        pdf.set_font("Helvetica", "", 11)
        pdf.cell(page_w, 10, "No data available.", ln=True, align="C")
        return bytes(pdf.output())

    # --- Column sizing ---
    emp_col_w = 45
    remaining = page_w - emp_col_w
    station_col_w = min(remaining / len(stations), 40)
    row_h = 8

    # --- Header row ---
    pdf.set_fill_color(50, 50, 70)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 7 if len(stations) > 6 else 8)
    pdf.cell(emp_col_w, row_h, "Employee", border=1, fill=True, align="C")
    for station in stations:
        label = station.name[:15] if len(station.name) > 15 else station.name
        pdf.cell(station_col_w, row_h, label, border=1, fill=True, align="C")
    pdf.ln()

    # --- Data rows ---
    pdf.set_text_color(0, 0, 0)
    pdf.set_font("Helvetica", "", 7 if len(stations) > 6 else 8)

    for idx, emp in enumerate(employees):
        # Alternating row color
        if idx % 2 == 0:
            pdf.set_fill_color(245, 245, 250)
        else:
            pdf.set_fill_color(255, 255, 255)

        pdf.cell(emp_col_w, row_h, emp.name[:22], border=1, fill=True)

        for station in stations:
            key = (emp.id, station.id)
            if key in rotation_stats:
                s = rotation_stats[key]
                cell_text = f"{s.total_hours}h / {s.days_since_last}d"
                # Color cells by intensity: more hours = darker fill
                intensity = min(s.total_hours / 80.0, 1.0)
                r = int(245 - intensity * 60)
                g = int(245 - intensity * 30)
                b = int(250 - intensity * 10)
                pdf.set_fill_color(r, g, b)
            else:
                cell_text = "-- / --"
                if idx % 2 == 0:
                    pdf.set_fill_color(245, 245, 250)
                else:
                    pdf.set_fill_color(255, 255, 255)

            pdf.cell(station_col_w, row_h, cell_text, border=1, fill=True, align="C")

        pdf.ln()
        # Reset fill for alternating
        if idx % 2 == 0:
            pdf.set_fill_color(245, 245, 250)
        else:
            pdf.set_fill_color(255, 255, 255)

    # --- Footer ---
    pdf.ln(8)
    pdf.set_font("Helvetica", "I", 8)
    pdf.set_text_color(120, 120, 120)
    pdf.cell(
        page_w, 5,
        f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}    |    Rotation & Safety Management System",
        align="C",
    )

    return bytes(pdf.output())


def rotation_dashboard():
    """Display the rotation dashboard showing hours and recency per employee-station pair."""
    scheduler = st.session_state.scheduler

    st.header("Rotation Dashboard")

    if not scheduler.stations or not scheduler.employees:
        st.info("Add stations and employees to view rotation data.")
        return

    if not scheduler.assignment_logs:
        st.info("No assignment history yet. Finalize some days in the Schedule tab to see rotation data here.")
        return

    # Date range presets
    today = date.today()
    presets = {
        "Past 7 days": 7,
        "Past 2 weeks": 14,
        "Past month": 30,
        "Year to date": (today - date(today.year, 1, 1)).days or 1,
        "Custom": None,
    }

    col_preset, col_start, col_end = st.columns([1, 1, 1])

    with col_preset:
        preset = st.selectbox("Date range", options=list(presets.keys()), index=2, key="dashboard_preset")

    preset_days = presets[preset]

    if preset == "Custom":
        with col_start:
            custom_start = st.date_input("Start date", value=today - timedelta(days=30), key="dashboard_start")
        with col_end:
            custom_end = st.date_input("End date", value=today, key="dashboard_end")
        window_days = (today - custom_start).days
        start_date = custom_start
    else:
        window_days = preset_days
        start_date = today - timedelta(days=window_days)
        with col_start:
            st.date_input("Start date", value=start_date, disabled=True, key="dashboard_start")
        with col_end:
            st.date_input("End date", value=today, disabled=True, key="dashboard_end")

    st.caption(f"Showing data from {start_date.strftime('%b %d, %Y')} to {today.strftime('%b %d, %Y')} — total hours / days since last assignment")

    rotation_stats = scheduler._build_rotation_stats(rolling_window_days=window_days)

    # Build matrix: rows = employees, columns = stations
    matrix_data = []
    for emp in scheduler.employees.values():
        row = {"Employee": emp.name}
        for station in scheduler.stations.values():
            key = (emp.id, station.id)
            if key in rotation_stats:
                s = rotation_stats[key]
                row[station.name] = f"{s.total_hours}h / {s.days_since_last}d ago"
            else:
                row[station.name] = "-- / --"
        matrix_data.append(row)

    df = pd.DataFrame(matrix_data)

    column_config = {
        "Employee": st.column_config.TextColumn("Employee", disabled=True),
    }
    for station in scheduler.stations.values():
        column_config[station.name] = st.column_config.TextColumn(station.name, disabled=True)

    st.dataframe(df, column_config=column_config, use_container_width=True, hide_index=True)

    # PDF download
    pdf_bytes = generate_rotation_pdf(scheduler, rotation_stats, start_date, today)
    st.download_button(
        "Download PDF Report",
        data=pdf_bytes,
        file_name=f"rotation_{start_date.strftime('%Y%m%d')}_{today.strftime('%Y%m%d')}.pdf",
        mime="application/pdf",
        key="download_rotation_pdf_btn",
    )


def main():
    """Main application entry point."""
    if "auth_session" not in st.session_state:
        st.session_state.auth_session = None

    if st.session_state.auth_session is None:
        login_page()
        st.stop()

    st.title("Rotation & Safety Management System")
    st.markdown("Assign employees to manufacturing stations based on competencies, certifications, and rotation history")

    init_session_state()
    render_sidebar()

    # Show add/edit employee form if active
    if st.session_state.adding_employee:
        render_add_employee_form()
        st.divider()
    elif st.session_state.editing_employee:
        render_edit_employee_form()
        st.divider()

    tab1, tab2, tab3 = st.tabs(["Cross-Training Matrix", "Schedule", "Rotation Dashboard"])

    with tab1:
        display_cross_training_matrix()

    with tab2:
        schedule_section()

    with tab3:
        rotation_dashboard()


if __name__ == "__main__":
    main()
