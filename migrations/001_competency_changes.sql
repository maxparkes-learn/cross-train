-- 001_competency_changes.sql
--
-- Adds an append-only history of competency (station skill level) changes, so the
-- matrix and Needs Attention tables can show a "Last Update" column with who
-- changed what and when.
--
-- RUN THIS BY HAND in the Supabase SQL editor. There is no migration runner in
-- this project, and supabase_schema.sql is stale (it predates multi-department
-- support), so do not expect that file to be runnable end to end.
--
-- Non-destructive: creates one table, one view, two indexes, two policies.
-- No ALTER, no DROP, no existing table is touched.
--
-- To roll back:
--   DROP VIEW IF EXISTS latest_competency_changes;
--   DROP TABLE IF EXISTS competency_changes;


-- Sanity check before running. Expect a PRIMARY KEY on (employee_id, station_id):
-- the application's upsert uses that as its ON CONFLICT target.
--
--   SELECT conname, contype, pg_get_constraintdef(oid)
--   FROM pg_constraint WHERE conrelid = 'competencies'::regclass;


CREATE TABLE competency_changes (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id   TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,

  -- Deliberately NO foreign key on station_id. With ON DELETE CASCADE (as on
  -- assignment_logs), deleting a station would silently move an employee's
  -- Last Update backwards, or back to a dash. The station_name snapshot below
  -- keeps the row readable without the key.
  station_id    TEXT NOT NULL,

  -- Snapshots taken at write time, not joins resolved at read time. The matrix
  -- only loads the active department's stations, so a shared employee's change
  -- in another department would otherwise render as a raw stn_xxxx id. These
  -- also survive a station rename, which is what an audit trail should do.
  station_name  TEXT NOT NULL,
  department_id TEXT,

  old_level     INTEGER,          -- NULL = no prior competency row (first time set)
  new_level     INTEGER NOT NULL,

  changed_by    TEXT NOT NULL,    -- acting user's email
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Serves the view below and any future per-employee history drill-down.
CREATE INDEX idx_competency_changes_employee   ON competency_changes (employee_id, changed_at DESC);
-- Serves date-bounded scans / a future activity feed.
CREATE INDEX idx_competency_changes_changed_at ON competency_changes (changed_at DESC);


ALTER TABLE competency_changes ENABLE ROW LEVEL SECURITY;

-- No TO clause, so these apply to PUBLIC (both anon and authenticated), matching
-- the existing wide-open policies in supabase_schema.sql. This table MUST be
-- readable by every role, not just admins -- the Last Update column silently
-- shows nothing but dashes for managers if the read policy is too narrow.
CREATE POLICY "Allow read"   ON competency_changes FOR SELECT USING (true);
CREATE POLICY "Allow insert" ON competency_changes FOR INSERT WITH CHECK (true);

-- Deliberately no UPDATE or DELETE policy: RLS makes the table append-only for
-- the browser client. Note this is not tamper-proof -- the service-role key and
-- the SQL editor bypass RLS entirely.


-- One row per employee: their most recent competency change. Collapsing this in
-- Postgres keeps the read at <= (number of employees) rows no matter how large
-- the log grows. Doing it in JS instead would mean either downloading the whole
-- log forever, or date-bounding the query -- and date-bounding breaks the
-- feature, because a change from 200 days ago would fall out of the window and
-- render as "no history" (no warning) instead of "stale" (warning).
--
-- security_invoker keeps RLS evaluated as the calling user; Supabase's linter
-- flags SECURITY DEFINER views. Harmless here, since SELECT is USING (true).
CREATE VIEW latest_competency_changes WITH (security_invoker = on) AS
SELECT DISTINCT ON (employee_id)
  employee_id, station_id, station_name, department_id,
  old_level, new_level, changed_by, changed_at
FROM competency_changes
-- The id DESC tiebreak is load-bearing: NOW() is transaction time, so a
-- multi-station batch insert gives every row an identical changed_at. Without
-- it, "which station changed" would be non-deterministic.
ORDER BY employee_id, changed_at DESC, id DESC;

GRANT SELECT ON latest_competency_changes TO anon, authenticated;


-- Without this, PostgREST 404s the new table and view until its next automatic
-- schema reload (PGRST205: could not find the table in the schema cache).
NOTIFY pgrst, 'reload schema';
