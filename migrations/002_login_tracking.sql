-- 002_login_tracking.sql
--
-- Records when each user (manager, admin, superadmin) signs in and when they were
-- last active, so the Users tab can show a "Last active" column.
--
-- Two distinct things are tracked, because they answer different questions:
--
--   last_sign_in_at  -- set at /auth/callback, i.e. an actual OAuth authentication.
--                       Supabase refresh tokens persist, so this fires rarely: a
--                       daily user may only re-authenticate every few months.
--   last_seen_at     -- set on every authenticated page load. This is the one that
--                       answers "is this person actually using the tool?".
--
-- login_events keeps the full history of real sign-ins (not page loads), so usage
-- can be counted or charted later. Sign-ins are infrequent, so it stays small.
--
-- RUN THIS BY HAND in the Supabase SQL editor. There is no migration runner.
--
-- To roll back:
--   DROP TABLE IF EXISTS login_events;
--   ALTER TABLE user_profiles DROP COLUMN IF EXISTS last_sign_in_at,
--                             DROP COLUMN IF EXISTS last_seen_at;


-- Unlike 001, this DOES alter an existing table -- but only by adding two nullable
-- columns with no default, which rewrites no rows and cannot fail on existing data.
-- Every current user_profiles row simply gets NULL for both, and the UI renders a
-- dash until that person next signs in or loads a page.
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS last_sign_in_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_seen_at    TIMESTAMPTZ;


CREATE TABLE login_events (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- Deliberately no foreign key to user_profiles(email). Removing a user should not
  -- erase the record that they used to sign in; that is the point of a login log.
  user_email   TEXT NOT NULL,

  signed_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Serves per-user counts and any per-user history drill-down.
CREATE INDEX idx_login_events_email ON login_events (user_email, signed_in_at DESC);
-- Serves a chronological feed across all users.
CREATE INDEX idx_login_events_signed_in_at ON login_events (signed_in_at DESC);


ALTER TABLE login_events ENABLE ROW LEVEL SECURITY;

-- No TO clause, so these apply to PUBLIC, matching the existing policies. The Users
-- tab is admin-gated in the application, but note that RLS itself does not enforce
-- that -- anyone holding the anon key can read this table, exactly as is already
-- true of audit_logs and user_profiles.
CREATE POLICY "Allow read"   ON login_events FOR SELECT USING (true);
CREATE POLICY "Allow insert" ON login_events FOR INSERT WITH CHECK (true);

-- No UPDATE or DELETE policy: append-only for the browser client. If a bad row ever
-- lands, removing it needs the SQL editor.


NOTIFY pgrst, 'reload schema';
