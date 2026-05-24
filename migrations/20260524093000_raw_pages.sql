CREATE TABLE IF NOT EXISTS raw_pages (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  city_code TEXT NOT NULL,
  url TEXT NOT NULL,
  status INTEGER,
  fetched_at TEXT NOT NULL,
  body_text TEXT
);

CREATE INDEX IF NOT EXISTS idx_raw_pages_source_city_time ON raw_pages(source, city_code, fetched_at);

