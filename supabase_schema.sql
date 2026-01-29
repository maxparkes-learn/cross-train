-- Cross-Training Matrix Scheduler - Supabase Schema
-- Run this in your Supabase SQL Editor to set up the database tables

-- Stations table
CREATE TABLE stations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  required_skill_level INTEGER DEFAULT 0,
  required_headcount INTEGER DEFAULT 1,
  required_certification INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Employees table
CREATE TABLE employees (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  certification_level INTEGER DEFAULT 0,
  is_absent BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Competencies (employee skill per station)
CREATE TABLE competencies (
  employee_id TEXT REFERENCES employees(id) ON DELETE CASCADE,
  station_id TEXT REFERENCES stations(id) ON DELETE CASCADE,
  level INTEGER DEFAULT 0,
  PRIMARY KEY (employee_id, station_id)
);

-- Settings (for custom labels)
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

-- Assignment logs (historical rotation tracking)
CREATE TABLE assignment_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  log_date DATE NOT NULL,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  hours NUMERIC(4,1) NOT NULL DEFAULT 8.0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (log_date, employee_id, station_id)
);

CREATE INDEX idx_assignment_logs_date ON assignment_logs (log_date DESC);
CREATE INDEX idx_assignment_logs_employee ON assignment_logs (employee_id, log_date DESC);
CREATE INDEX idx_assignment_logs_station ON assignment_logs (station_id, log_date DESC);

-- Enable Row Level Security (optional but recommended)
ALTER TABLE stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE competencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignment_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- Allow anonymous access (for simple setup - adjust for production)
CREATE POLICY "Allow anonymous read" ON stations FOR SELECT USING (true);
CREATE POLICY "Allow anonymous insert" ON stations FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anonymous update" ON stations FOR UPDATE USING (true);
CREATE POLICY "Allow anonymous delete" ON stations FOR DELETE USING (true);

CREATE POLICY "Allow anonymous read" ON employees FOR SELECT USING (true);
CREATE POLICY "Allow anonymous insert" ON employees FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anonymous update" ON employees FOR UPDATE USING (true);
CREATE POLICY "Allow anonymous delete" ON employees FOR DELETE USING (true);

CREATE POLICY "Allow anonymous read" ON competencies FOR SELECT USING (true);
CREATE POLICY "Allow anonymous insert" ON competencies FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anonymous update" ON competencies FOR UPDATE USING (true);
CREATE POLICY "Allow anonymous delete" ON competencies FOR DELETE USING (true);

CREATE POLICY "Allow anonymous read" ON assignment_logs FOR SELECT USING (true);
CREATE POLICY "Allow anonymous insert" ON assignment_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anonymous update" ON assignment_logs FOR UPDATE USING (true);
CREATE POLICY "Allow anonymous delete" ON assignment_logs FOR DELETE USING (true);

CREATE POLICY "Allow anonymous read" ON settings FOR SELECT USING (true);
CREATE POLICY "Allow anonymous insert" ON settings FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anonymous update" ON settings FOR UPDATE USING (true);
CREATE POLICY "Allow anonymous delete" ON settings FOR DELETE USING (true);
