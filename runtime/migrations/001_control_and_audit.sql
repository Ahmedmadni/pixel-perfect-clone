-- Single-row authoritative control state.
CREATE TABLE IF NOT EXISTS control_state (
  id smallint PRIMARY KEY CHECK (id = 1),
  state text NOT NULL CHECK (state IN ('MANUAL','AGENT_ACTIVE','APPROVAL_REQUIRED','PAUSED','STOPPED','ERROR')),
  reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO control_state (id, state) VALUES (1, 'MANUAL') ON CONFLICT (id) DO NOTHING;

-- Append-only audit log.
CREATE TABLE IF NOT EXISTS audit_logs (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  level text NOT NULL CHECK (level IN ('info','warn','error','audit')),
  actor text NOT NULL CHECK (actor IN ('user','agent','system')),
  message text NOT NULL,
  event text,
  from_state text,
  to_state text
);
CREATE INDEX IF NOT EXISTS audit_logs_transitions_idx ON audit_logs (id DESC) WHERE to_state IS NOT NULL;

CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_no_update ON audit_logs;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
DROP TRIGGER IF EXISTS audit_logs_no_truncate ON audit_logs;
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_append_only();
