CREATE TABLE IF NOT EXISTS processed_events (
  message_id TEXT PRIMARY KEY,
  seen_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_processed_events_seen_at
  ON processed_events (seen_at);

CREATE TABLE IF NOT EXISTS sessions (
  session_key TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session_options (
  session_key TEXT PRIMARY KEY,
  model TEXT,
  thinking_level TEXT CHECK (thinking_level IN ('low', 'medium', 'high')),
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (session_key) REFERENCES sessions(session_key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_key TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_key) REFERENCES sessions(session_key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_session_created
  ON messages (session_key, created_at);

CREATE TABLE IF NOT EXISTS workspace_state (
  session_key TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('chat', 'dev')),
  cwd TEXT NOT NULL,
  branch TEXT,
  last_task_id TEXT,
  last_error_summary TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  session_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('chat', 'dev', 'control')),
  title TEXT NOT NULL,
  input_text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'waiting_for_input', 'interrupted', 'failed', 'completed', 'resumable')),
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  summary TEXT,
  error_summary TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_session_created
  ON tasks (session_key, created_at DESC);

CREATE TABLE IF NOT EXISTS task_events (
  task_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('queued', 'progress', 'result', 'error')),
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (task_id, seq)
);

CREATE TABLE IF NOT EXISTS task_artifacts (
  task_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('diff', 'log', 'file', 'command_output')),
  label TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
