const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

async function init() {
  console.log('=== 数据库初始化 (SQLite) ===\n');

  // 加载 sql.js
  const SQL = await initSqlJs();

  const dbPath = path.resolve(require('../config').db.sqlitePath);
  const dbDir = path.dirname(dbPath);

  // 确保目录存在
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  // 创建新数据库
  let db;
  if (fs.existsSync(dbPath)) {
    console.log(`数据库文件已存在: ${dbPath}`);
    console.log('如需重建，请先删除该文件\n');
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
    console.log(`创建新数据库: ${dbPath}`);
  }

  db.run('PRAGMA foreign_keys=ON');

  // 读取并执行 schema
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');

  // 执行所有语句
  try {
    db.run(schema);
    console.log('Schema 执行完成！');
  } catch (err) {
    console.error('Schema 执行失败:', err.message);
    process.exit(1);
  }

  // 保存
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
  db.close();

  console.log(`\n初始化完成！`);
  console.log(`数据库文件: ${dbPath}`);
  console.log('表: projects, buildings, houses, daily_snapshots, daily_changes, crawl_queue, crawl_logs, watched_projects');
}

init().catch(err => {
  console.error('初始化失败:', err.message);
  process.exit(1);
});
