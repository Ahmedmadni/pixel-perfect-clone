-- Phase 2B: persistent local chat history (single local user, conversation 'default').
CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY,
  seq bigserial UNIQUE NOT NULL,
  conversation_id text NOT NULL DEFAULT 'default' CHECK (length(conversation_id) BETWEEN 1 AND 64),
  role text NOT NULL CHECK (role IN ('user','assistant','system')),
  content text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('complete','streaming','aborted','failed')),
  model text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_messages_conv_seq_idx ON chat_messages (conversation_id, seq DESC);
