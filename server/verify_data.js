const db = require('./src/db/pool');

(async () => {
  // 1. 项目统计
  const projects = await db.query(`
    SELECT p.project_id, p.name, p.status,
           (SELECT COUNT(*) FROM buildings WHERE project_id = p.project_id) as bldg_count,
           (SELECT COUNT(*) FROM houses h JOIN buildings b2 ON h.building_id = b2.building_id WHERE b2.project_id = p.project_id) as house_count
    FROM projects p
  `);
  console.log('=== 项目 ===');
  projects.forEach(p => console.log(`  ${p.name} (${p.project_id}): ${p.bldg_count}楼栋, ${p.house_count}套房, 状态=${p.status}`));

  // 2. 楼栋统计
  const buildings = await db.query(`
    SELECT b.building_name, b.total_units, p.name as project
    FROM buildings b JOIN projects p ON b.project_id = p.project_id
    ORDER BY p.name, b.building_name
  `);
  console.log('\n=== 楼栋 ===');
  buildings.forEach(b => console.log(`  [${b.project}] ${b.building_name}: ${b.total_units}套`));

  // 3. 金阙华院房屋样例
  const houses = await db.query(`
    SELECT h.room_no, h.status, h.build_area, h.list_price_per_sqm, h.layout, h.purpose,
           b.building_name
    FROM houses h
    JOIN buildings b ON h.building_id = b.building_id
    JOIN projects p ON b.project_id = p.project_id
    WHERE p.name = '金阙华院'
    ORDER BY h.room_no
    LIMIT 8
  `);
  console.log('\n=== 金阙华院房屋样例 ===');
  houses.forEach(h => console.log(`  ${h.room_no} | ${h.status} | ${h.layout||'-'} | ${h.build_area||'-'} | ¥${h.list_price_per_sqm||'-'}/㎡ | ${h.purpose||'-'}`));

  // 4. 满和苑房屋样例
  const houses2 = await db.query(`
    SELECT h.room_no, h.status, h.build_area, h.list_price_per_sqm, h.layout, h.purpose
    FROM houses h
    JOIN buildings b ON h.building_id = b.building_id
    JOIN projects p ON b.project_id = p.project_id
    WHERE p.name = '满和苑'
    ORDER BY h.room_no
  `);
  console.log('\n=== 满和苑房屋 ===');
  console.log(`  共 ${houses2.length} 套:`);
  houses2.forEach(h => console.log(`  ${h.room_no} | ${h.status} | ${h.layout||'-'} | ${h.build_area||'-'} | ¥${h.list_price_per_sqm||'-'}/㎡`));

  // 5. 日快照统计
  const snapshots = await db.query(`
    SELECT ds.snapshot_date, COUNT(*) as cnt
    FROM daily_snapshots ds
    GROUP BY ds.snapshot_date
  `);
  console.log('\n=== 日快照 ===');
  if (snapshots.length === 0) console.log('  (空 — 首次抓取无历史对比)');
  snapshots.forEach(s => console.log(`  ${s.snapshot_date}: ${s.cnt}条`));

  // 6. 日变化统计
  const changes = await db.query('SELECT change_type, COUNT(*) as cnt FROM daily_changes GROUP BY change_type');
  console.log('\n=== 日变化 ===');
  if (changes.length === 0) console.log('  (空 — 首次抓取，明日才有变化)');
  changes.forEach(c => console.log(`  ${c.change_type}: ${c.cnt}条`));

  await db.close();
  console.log('\n✅ 数据库验证完成');
})();
