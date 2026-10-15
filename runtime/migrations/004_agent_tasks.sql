-- Phase 2E MVP: user-started, read-only page review jobs.
-- No write/post/message permissions; audit entries must not contain page text.
CREATE TABLE IF NOT EXISTS agent_tasks (
  id uuid PRIMARY KEY,
  objective text NOT NULL CHECK (length(objective) BETWEEN 1 AND 2000),
  tab_id text NOT NULL,
  model text NOT NULL,
  status text NOT NULL CHECK(status IN ('queued','running','done','failed','cancelled')),
  result text,
  error text,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS agent_tasks_created_idx ON agent_tasks(created_at DESC);
