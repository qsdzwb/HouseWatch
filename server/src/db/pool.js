const Database = require('better-sqlite3');
const path = require('path');
const config = require('../config');

let db = null;

// ============================================
// 初始化
// ============================================

function getDb() {
  if (db) return db;

  const dbPath = process.env.DB_SQLITE_PATH
    ? path.resolve(process.env.DB_SQLITE_PATH)
    : path.resolve(__dirname, '../../data/bj_realestate.db');
  const dbDir = path.dirname(dbPath);

  // 确保目录存在
  const fs = require('fs');
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(dbPath);

  // 性能优化
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  // 进程退出时关闭
  process.on('exit', () => { if (db) db.close(); });
  process.on('SIGINT', () => { if (db) db.close(); process.exit(0); });

  return db;
}

// ============================================
// 公开 API（与原 pool.js 保持相同接口）
// ============================================

function query(sql, params = []) {
  const dbInstance = getDb();
  try {
    const stmt = dbInstance.prepare(sql);
    const results = stmt.all(params);
    return results;
  } catch (err) {
    console.error('SQL 查询错误:', sql.substring(0, 100), err.message);
    throw err;
  }
}

function queryOne(sql, params = []) {
  const dbInstance = getDb();
  try {
    const stmt = dbInstance.prepare(sql);
    const result = stmt.get(params);
    return result || null;
  } catch (err) {
    console.error('SQL 查询错误 (queryOne):', sql.substring(0, 100), err.message);
    throw err;
  }
}

function insert(sql, params = []) {
  const dbInstance = getDb();
  try {
    const stmt = dbInstance.prepare(sql);
    const info = stmt.run(params);
    return { insertId: info.lastInsertRowid, affectedRows: info.changes };
  } catch (err) {
    console.error('SQL 插入错误:', sql.substring(0, 100), err.message);
    throw err;
  }
}

function upsert(table, data, uniqueKey) {
  const dbInstance = getDb();
  const keys = Object.keys(data);
  const values = Object.values(data);
  const placeholders = keys.map(() => '?').join(', ');
  const conflictKeys = Array.isArray(uniqueKey) ? uniqueKey : [uniqueKey];

  const updates = keys.map(k => `${k} = excluded.${k}`).join(', ');

  const sql = `
    INSERT INTO ${table} (${keys.join(', ')})
    VALUES (${placeholders})
    ON CONFLICT(${conflictKeys.join(', ')})
    DO UPDATE SET ${updates}
  `;

  try {
    const stmt = dbInstance.prepare(sql);
    const info = stmt.run(values);
    return { affectedRows: info.changes };
  } catch (err) {
    console.error('SQL upsert 错误:', err.message);
    throw err;
  }
}

function batchInsert(table, rows, keys) {
  if (!rows || rows.length === 0) return { affectedRows: 0 };

  const dbInstance = getDb();
  const placeholders = keys.map(() => '?').join(', ');
  const sql = `INSERT OR IGNORE INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`;

  let totalAffected = 0;

  try {
    dbInstance.transaction(() => {
      const stmt = dbInstance.prepare(sql);
      for (const row of rows) {
        const params = keys.map(k => row[k] ?? null);
        const info = stmt.run(params);
        totalAffected += info.changes;
      }
    })();
  } catch (err) {
    console.error('SQL 批量插入错误:', err.message);
    throw err;
  }

  return { affectedRows: totalAffected };
}

function healthCheck() {
  try {
    const dbInstance = getDb();
    dbInstance.prepare('SELECT 1').get();
    return true;
  } catch (err) {
    return false;
  }
}

function close() {
  if (db) {
    db.close();
    db = null;
  }
}

function saveDb() {
  // better-sqlite3 自动持久化，无需手动保存
  // 保留此方法以保持接口兼容
}

module.exports = {
  getDb,
  query,
  queryOne,
  insert,
  upsert,
  batchInsert,
  healthCheck,
  saveDb,
  close,
};
