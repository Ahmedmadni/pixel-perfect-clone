-- Phase 2F: local, privacy-minimal task notifications. No page text or account data.
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY,
  task_id uuid REFERENCES agent_tasks(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('task_done','task_failed','task_cancelled')),
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE INDEX IF NOT EXISTS notifications_unread_created_idx
  ON notifications(created_at DESC) WHERE read_at IS NULL;
