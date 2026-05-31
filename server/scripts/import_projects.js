/**
 * 批量导入楼盘列表到数据库
 *
 * 用法：
 *   node scripts/import_projects.js <project_list.json>
 *
 * 示例：
 *   # 从本地 JSON 文件导入
 *   node scripts/import_projects.js ../crawler/output/project_list.json
 *
 *   # 从指定路径导入
 *   node scripts/import_projects.js /tmp/project_list.json
 */

const fs = require('fs');
const path = require('path');
const db = require('../src/db/pool');

async function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error('用法: node scripts/import_projects.js <project_list.json>');
    process.exit(1);
  }

  const absPath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);

  if (!fs.existsSync(absPath)) {
    console.error('文件不存在:', absPath);
    process.exit(1);
  }

  console.log('=== 批量导入楼盘到数据库 ===\n');
  console.log('文件:', absPath);

  const raw = fs.readFileSync(absPath, 'utf-8');
  const projects = JSON.parse(raw);

  if (!Array.isArray(projects) || projects.length === 0) {
    console.error('JSON 文件格式错误或为空');
    process.exit(1);
  }

  console.log('待导入: %d 个楼盘\n', projects.length);

  let inserted = 0;
  let updated = 0;
  let failed = 0;
  const errors = [];
  const today = new Date().toISOString().split('T')[0];

  for (let i = 0; i < projects.length; i++) {
    const p = projects[i];

    if (!p.project_id || !p.name) {
      failed++;
      errors.push({ index: i, reason: '缺少 project_id 或 name', data: p });
      continue;
    }

    try {
      // Upsert: 存在则更新，不存在则插入
      const existing = await db.queryOne(
        'SELECT id, project_id FROM projects WHERE project_id = ?',
        [p.project_id]
      );

      if (existing) {
        await db.insert(
          'UPDATE projects SET name = ?, permit_no = ?, issue_date = ?, district = ?, address = ?, developer = ?, updated_at = datetime(\'now\',\'localtime\') WHERE project_id = ?',
          [
            p.name,
            p.permit_no || null,
            p.issue_date || null,
            p.district || null,
            p.address || null,
            p.developer || null,
            p.project_id,
          ]
        );
        updated++;
      } else {
        await db.insert(
          'INSERT INTO projects (project_id, name, permit_no, issue_date, district, address, developer, first_seen, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            p.project_id,
            p.name,
            p.permit_no || null,
            p.issue_date || null,
            p.district || null,
            p.address || null,
            p.developer || null,
            today,
            'active',
          ]
        );
        inserted++;
      }

      if ((i + 1) % 100 === 0) {
        console.log('  进度: %d/%d (新增 %d, 更新 %d, 失败 %d)', i + 1, projects.length, inserted, updated, failed);
      }
    } catch (err) {
      failed++;
      errors.push({ index: i, project_id: p.project_id, reason: err.message });
    }
  }

  console.log('\n=== 导入完成 ===');
  console.log('新增: %d', inserted);
  console.log('更新: %d', updated);
  console.log('跳过: %d', failed);
  console.log('合计: %d', inserted + updated);

  if (errors.length > 0) {
    console.log('\n错误列表 (前10条):');
    errors.slice(0, 10).forEach(e => {
      console.log('  [%d] %s — %s', e.index, e.project_id || '?', e.reason);
    });
  }

  process.exit(0);
}

main().catch(err => {
  console.error('导入失败:', err);
  process.exit(1);
});
