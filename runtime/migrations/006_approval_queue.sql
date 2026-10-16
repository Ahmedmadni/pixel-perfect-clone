-- Phase 2E: persisted, immutable external-action proposals for HUMAN review only.
-- 'approved' is NOT an execution command, and no external write dispatcher exists.
CREATE TABLE IF NOT EXISTS approval_requests (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('external_message','publish_comment','project_change','other')),
  action_label text NOT NULL CHECK (char_length(action_label) BETWEEN 1 AND 120),
  target text NOT NULL CHECK (char_length(target) BETWEEN 1 AND 240),
  preview text NOT NULL CHECK (char_length(preview) BETWEEN 1 AND 4000),
  payload_digest text NOT NULL CHECK (payload_digest ~ '^[0-9a-f]{64}$'),
  risk text NOT NULL CHECK (risk IN ('low','medium','high')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
  origin text NOT NULL DEFAULT 'user' CHECK (origin IN ('user','agent')),
  source_task_id uuid REFERENCES agent_tasks(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  decided_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK ((status = 'pending' AND decided_at IS NULL) OR
         (status <> 'pending' AND decided_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS approval_requests_status_idx
 ON approval_requests(status,created_at DESC);
CREATE INDEX IF NOT EXISTS approval_requests_expires_idx
 ON approval_requests(expires_at) WHERE status='pending';

-- Enforce original approval payload immutability at the database boundary.
CREATE OR REPLACE FUNCTION prevent_approval_payload_edit() RETURNS trigger AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.action_label IS DISTINCT FROM OLD.action_label
    OR NEW.target IS DISTINCT FROM OLD.target
    OR NEW.preview IS DISTINCT FROM OLD.preview
    OR NEW.payload_digest IS DISTINCT FROM OLD.payload_digest
    OR NEW.risk IS DISTINCT FROM OLD.risk
    OR NEW.origin IS DISTINCT FROM OLD.origin
    OR NEW.source_task_id IS DISTINCT FROM OLD.source_task_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
 THEN
    RAISE EXCEPTION 'Approval contents are immutable';
 END IF;
 IF OLD.status <> 'pending' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Approval decision is final';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS approval_payload_immutable ON approval_requests;
CREATE TRIGGER approval_payload_immutable BEFORE UPDATE ON approval_requests
 FOR EACH ROW EXECUTE FUNCTION prevent_approval_payload_edit();
