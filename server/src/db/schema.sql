-- ============================================
-- 北京住建委网签数据 — 数据库 Schema (SQLite)
-- ============================================

-- 1. 项目表
CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    permit_no TEXT DEFAULT NULL,
    issue_date TEXT DEFAULT NULL,
    district TEXT DEFAULT NULL,
    display_name TEXT DEFAULT NULL,
    address TEXT DEFAULT NULL,
    developer TEXT DEFAULT NULL,
    first_seen TEXT DEFAULT NULL,
    last_crawl TEXT DEFAULT NULL,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_projects_district ON projects(district);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

-- 2. 楼栋表
CREATE TABLE IF NOT EXISTS buildings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    building_id TEXT NOT NULL UNIQUE,
    building_name TEXT NOT NULL,
    sale_permit_id TEXT DEFAULT NULL,
    total_units INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_buildings_project ON buildings(project_id);

-- 3. 房屋表（当前最新状态）
CREATE TABLE IF NOT EXISTS houses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    house_id TEXT NOT NULL UNIQUE,
    building_id TEXT NOT NULL,
    room_no TEXT NOT NULL,
    status TEXT NOT NULL,
    purpose TEXT DEFAULT NULL,
    layout TEXT DEFAULT NULL,
    build_area REAL DEFAULT NULL,
    inner_area REAL DEFAULT NULL,
    list_price_per_sqm REAL DEFAULT NULL,
    list_total_price REAL DEFAULT NULL,
    status_changed_date TEXT DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (building_id) REFERENCES buildings(building_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_houses_building ON houses(building_id);
CREATE INDEX IF NOT EXISTS idx_houses_status ON houses(status);
CREATE INDEX IF NOT EXISTS idx_houses_changed_date ON houses(status_changed_date);

-- 4. 日快照表
CREATE TABLE IF NOT EXISTS daily_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    house_id TEXT NOT NULL,
    snapshot_date TEXT NOT NULL,
    status TEXT NOT NULL,
    list_price_per_sqm REAL DEFAULT NULL,
    build_area REAL DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_snap_house_date ON daily_snapshots(house_id, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_snap_date_status ON daily_snapshots(snapshot_date, status);

-- 5. 日变化表（差值分析结果）
CREATE TABLE IF NOT EXISTS daily_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    change_date TEXT NOT NULL,
    project_id TEXT NOT NULL,
    building_id TEXT NOT NULL,
    house_id TEXT NOT NULL,
    room_no TEXT NOT NULL,
    change_type TEXT NOT NULL,
    old_status TEXT DEFAULT NULL,
    new_status TEXT NOT NULL,
    old_price REAL DEFAULT NULL,
    new_price REAL DEFAULT NULL,
    build_area REAL DEFAULT NULL,
    deal_unit_price REAL DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_changes_date ON daily_changes(change_date);
CREATE INDEX IF NOT EXISTS idx_changes_project_date ON daily_changes(project_id, change_date);
CREATE INDEX IF NOT EXISTS idx_changes_type ON daily_changes(change_type);

-- 6. 爬取队列表
CREATE TABLE IF NOT EXISTS crawl_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    priority INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending',
    retry_count INTEGER DEFAULT 0,
    last_error TEXT DEFAULT NULL,
    next_retry TEXT DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_cq_status_priority ON crawl_queue(status, priority DESC);
CREATE INDEX IF NOT EXISTS idx_cq_project ON crawl_queue(project_id);

-- 7. 关注楼盘表（用户关注/监测的项目）
CREATE TABLE IF NOT EXISTS watched_projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL UNIQUE,
    notes TEXT DEFAULT NULL,
    is_active INTEGER DEFAULT 1,
    added_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_watched_active ON watched_projects(is_active);

-- 8. 爬取日志表
CREATE TABLE IF NOT EXISTS crawl_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    crawl_date TEXT NOT NULL,
    phase TEXT NOT NULL,
    project_id TEXT DEFAULT NULL,
    status TEXT NOT NULL,
    message TEXT DEFAULT NULL,
    duration_ms INTEGER DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_logs_date ON crawl_logs(crawl_date);
CREATE INDEX IF NOT EXISTS idx_logs_date_phase ON crawl_logs(crawl_date, phase);
