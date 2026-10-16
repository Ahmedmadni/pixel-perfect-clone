-- Domain-level permissions. No write permissions are supported.
-- User authentication status is not inferred from saved policies.
CREATE TABLE IF NOT EXISTS review_permissions (
 id uuid PRIMARY KEY,
 domain text NOT NULL UNIQUE,
 label text NOT NULL,
 can_review boolean NOT NULL DEFAULT false,
 can_external_write boolean NOT NULL DEFAULT false CHECK (can_external_write = false),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS review_permissions_allowed_idx ON review_permissions(domain) WHERE can_review;
