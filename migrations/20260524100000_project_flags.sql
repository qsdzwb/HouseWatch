CREATE TABLE IF NOT EXISTS project_flags (
  project_id TEXT PRIMARY KEY,
  is_followed INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_project_flags_followed ON project_flags(is_followed);

