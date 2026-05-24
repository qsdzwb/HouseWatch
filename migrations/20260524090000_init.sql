CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city_code TEXT NOT NULL,
  developer TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS units (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  building TEXT,
  unit_no TEXT,
  room_no TEXT,
  floor INTEGER,
  area_sqm REAL,
  status TEXT NOT NULL,
  listed_price_cny INTEGER,
  last_seen_at TEXT NOT NULL,
  source TEXT NOT NULL,
  source_record_id TEXT,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_units_project_id ON units(project_id);
CREATE INDEX IF NOT EXISTS idx_units_project_unit_no ON units(project_id, unit_no);
CREATE INDEX IF NOT EXISTS idx_units_project_status ON units(project_id, status);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  unit_id TEXT,
  deal_date TEXT,
  deal_total_cny INTEGER,
  deal_unit_price_cny_per_sqm INTEGER,
  area_sqm REAL,
  building TEXT,
  unit_no TEXT,
  room_no TEXT,
  source TEXT NOT NULL,
  source_record_id TEXT,
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(unit_id) REFERENCES units(id)
);

CREATE INDEX IF NOT EXISTS idx_tx_project_date ON transactions(project_id, deal_date);
CREATE INDEX IF NOT EXISTS idx_tx_project_unit ON transactions(project_id, unit_no);

CREATE TABLE IF NOT EXISTS sync_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  error_message TEXT,
  stats_json TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_project_id ON sync_runs(project_id);

CREATE TABLE IF NOT EXISTS source_configs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  city_code TEXT NOT NULL,
  base_url TEXT NOT NULL,
  settings_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_source_configs_source_city ON source_configs(source, city_code);

