-- Phase 2D: persistent single-user knowledge with full revision history.
-- No personal data or mock seed is inserted by migrations.
CREATE TABLE IF NOT EXISTS knowledge_items (
  id uuid PRIMARY KEY,
  category text NOT NULL CHECK (category IN ('personal','instruction','style','example')),
  title text NOT NULL,
  body text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_versions (
  knowledge_id uuid NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  category text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  tags text[] NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(knowledge_id, version)
);
CREATE INDEX IF NOT EXISTS knowledge_items_updated_idx ON knowledge_items(updated_at DESC);
