const express = require('express');
const router = express.Router();
const db = require('../db/pool');
const fs = require('fs');
const path = require('path');

// 缓存元数据文件路径
const DATA_DIR = path.resolve(__dirname, '../../data');
const CACHE_META_FILE = path.join(DATA_DIR, 'project_list_meta.json');

// 读取缓存元数据
function readCacheMeta() {
  try {
    if (fs.existsSync(CACHE_META_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_META_FILE, 'utf-8'));
    }
  } catch (e) { /* ignore */ }
  return null;
}

// 写入缓存元数据
function writeCacheMeta(meta) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CACHE_META_FILE, JSON.stringify(meta, null, 2), 'utf-8');
}

// 判断缓存是否新鲜（默认 24 小时内认为新鲜）
function isCacheFresh(meta, maxAgeHours) {
  if (!meta || !meta.updated_at) return false;
  var age = Date.now() - new Date(meta.updated_at).getTime();
  var maxAge = (maxAgeHours || 24) * 3600 * 1000;
  return age < maxAge;
}

// 根据 project_id 查找其同名的其他 project_id（合并展示）
async function getMergedProjectIds(pid) {
  const nameRow = await db.queryOne('SELECT name FROM projects WHERE project_id = ?', [pid]);
  if (!nameRow) return [pid];
  const rows = await db.query('SELECT project_id FROM projects WHERE name = ? AND status = \'active\'', [nameRow.name]);
  return rows.map(r => r.project_id);
}

// 构建合并统计 SQL 片段（多个 project_id 合并）
function buildMergedStatsCluse(projectIds) {
  const placeholders = projectIds.map(() => '?').join(',');
  const buildingIdsSQL = `SELECT building_id FROM buildings WHERE project_id IN (${placeholders})`;
  return {
    buildingIdsSQL,
    projectIds,
    countHouseSQL: `SELECT COUNT(*) as cnt, 
      SUM(CASE WHEN status = '可售' THEN 1 ELSE 0 END) as available,
      SUM(CASE WHEN status IN ('已签约','网上联机备案') THEN 1 ELSE 0 END) as sold
      FROM houses WHERE building_id IN (${buildingIdsSQL})`,
  };
}
router.get('/', async (req, res) => {
  try {
    const { district, page = 1, limit = 20, status = 'active', search, sort_by, order } = req.query;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;

    // 先按名称分组，获取合并后的名称列表
    let nameSQL = 'SELECT name FROM projects p WHERE p.status = ?';
    const nameParams = [status];

    if (district) {
      nameSQL += ' AND p.district = ?';
      nameParams.push(district);
    }
    if (search) {
      nameSQL += ' AND p.name LIKE ?';
      nameParams.push('%' + search + '%');
    }
    nameSQL += ' GROUP BY p.name';

    // 获取所有匹配的名称（用于分页）
    const allNamesResult = await db.query(nameSQL, nameParams);
    const allNames = allNamesResult.map(r => r.name);
    const total = allNames.length;

    // 分页截取
    const pageNames = allNames.slice(offset, offset + limitNum);

    if (pageNames.length === 0) {
      return res.json({
        success: true,
        data: {
          items: [],
          pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
          cache_status: { data_ready: false, project_count: 0, last_import: null, is_fresh: false, needs_refresh: false, needs_init: total === 0 },
        },
      });
    }

    // 对每个名称，查询合并统计数据
    const items = [];
    for (const name of pageNames) {
      // 获取该名称对应的所有 project_id
      const projectRows = await db.query(
        'SELECT project_id, display_name, permit_no, issue_date, signed_count, signed_area, avg_price FROM projects WHERE name = ? AND status = ? ORDER BY issue_date ASC',
        [name, status]
      );
      const projectIds = projectRows.map(r => r.project_id);
      const placeholders = projectIds.map(() => '?').join(',');

      // 楼栋数量
      const buildingCountRow = await db.queryOne(
        `SELECT COUNT(*) as cnt FROM buildings WHERE project_id IN (${placeholders})`,
        projectIds
      );

      // 房源统计
      const houseStats = await db.queryOne(
        `SELECT COUNT(*) as total,
          SUM(CASE WHEN status = '可售' THEN 1 ELSE 0 END) as available,
          SUM(CASE WHEN status IN ('已签约','网上联机备案') THEN 1 ELSE 0 END) as sold
         FROM houses
         WHERE building_id IN (SELECT building_id FROM buildings WHERE project_id IN (${placeholders}))`,
        projectIds
      );

      const totalHouses = houseStats ? houseStats.total : 0;
      const officialSold = projectRows.reduce((sum, r) => sum + (r.signed_count || 0), 0);
      const soldHouses = officialSold > 0 ? officialSold : (houseStats ? (houseStats.sold || 0) : 0);
      const availableHouses = houseStats ? (houseStats.available || 0) : 0;
      const soldRate = totalHouses > 0 ? (soldHouses / totalHouses * 100).toFixed(1) : '0.0';

      // 使用最新的预售证信息作为代表
      const rep = projectRows[projectRows.length - 1];
      // 获取推广名（同名的所有项目中任意一个有 display_name 即可）
      const displayNameRow = await db.queryOne(
        'SELECT display_name FROM projects WHERE name = ? AND display_name IS NOT NULL AND display_name != \'\' LIMIT 1',
        [name]
      );
      // 各预售证独立均价（不合并加权，避免误导）
      const permitPrices = projectRows
        .filter(r => r.avg_price > 0)
        .map(r => ({
          project_id: r.project_id,
          display_name: r.display_name,
          permit_no: r.permit_no,
          avg_price: Math.round(r.avg_price),
          signed_count: r.signed_count || 0,
          signed_area: r.signed_area || 0,
        }));

      // 关注状态
      const watched = await db.queryOne(
        'SELECT id FROM watched_projects WHERE project_id IN (' + placeholders + ') AND is_active = 1 LIMIT 1',
        projectIds
      );

      items.push({
        name: name,
        display_name: displayNameRow ? displayNameRow.display_name : null,
        project_id: projectIds.join(','),  // 逗号分隔多个ID
        permit_no: projectRows.map(r => r.permit_no).filter(Boolean).join('、') || null,
        issue_date: projectRows.map(r => r.issue_date).filter(Boolean).sort().reverse()[0] || null,
        district: (await db.queryOne('SELECT district FROM projects WHERE name = ? LIMIT 1', [name]))?.district || null,
        building_count: buildingCountRow ? buildingCountRow.cnt : 0,
        total_houses: totalHouses,
        available_houses: availableHouses,
        sold_houses: soldHouses,
        sold_rate: soldRate + '%',
        permit_prices: permitPrices,
        is_watched: watched ? 1 : 0,
        project_count: projectIds.length,  // 几个预售证
      });
    }

    // 排序
    if (sort_by) {
      const dir = order === 'asc' ? 1 : -1;
      const sortMap = {
        total_houses: 'total_houses',
        sold_rate: 'sold_rate_num',
        building_count: 'building_count',
        name: 'name',
      };
      if (sort_by === 'sold_rate') {
        items.forEach(it => { it.sold_rate_num = parseFloat(it.sold_rate) || 0; });
        items.sort((a, b) => (a.sold_rate_num - b.sold_rate_num) * dir);
      } else if (sortMap[sort_by]) {
        items.sort((a, b) => {
          const va = a[sortMap[sort_by]] || 0;
          const vb = b[sortMap[sort_by]] || 0;
          return (va - vb) * dir;
        });
      }
    }

    res.json({
      success: true,
      data: {
        items: items,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: total,
          totalPages: Math.ceil(total / limitNum),
        },
        cache_status: (function() {
          var meta = readCacheMeta();
          return {
            data_ready: total > 0,
            project_count: total,
            last_import: meta ? meta.updated_at : null,
            is_fresh: isCacheFresh(meta),
            needs_refresh: !isCacheFresh(meta) && total > 0,
            needs_init: total === 0,
          };
        })(),
      },
    });
  } catch (err) {
    console.error('项目列表查询失败:', err.message);
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

// POST /api/projects/batch — 批量导入楼盘基本信息（用于初始化全量楼盘列表）
router.post('/batch', async (req, res) => {
  try {
    const { projects } = req.body;

    if (!projects || !Array.isArray(projects) || projects.length === 0) {
      return res.status(400).json({
        success: false,
        message: '请提供 projects 数组',
        example: { projects: [{ project_id: '8205387', name: '金阙华院', permit_no: '京房售证字(2026)41号', issue_date: '2026-05-16' }] },
      });
    }

    const today = new Date().toISOString().split('T')[0];
    let inserted = 0;
    let updated = 0;
    let failed = 0;

    for (const p of projects) {
      if (!p.project_id || !p.name) { failed++; continue; }
      try {
        const existing = await db.queryOne(
          'SELECT id FROM projects WHERE project_id = ?', [p.project_id]
        );
        if (existing) {
          await db.insert(
            'UPDATE projects SET name=?, permit_no=?, issue_date=?, district=?, address=?, developer=?, updated_at=datetime(\'now\',\'localtime\') WHERE project_id=?',
            [p.name, p.permit_no || null, p.issue_date || null, p.district || null, p.address || null, p.developer || null, p.project_id]
          );
          updated++;
        } else {
          await db.insert(
            'INSERT INTO projects (project_id,name,permit_no,issue_date,district,address,developer,first_seen,status) VALUES (?,?,?,?,?,?,?,?,?)',
            [p.project_id, p.name, p.permit_no || null, p.issue_date || null, p.district || null, p.address || null, p.developer || null, today, 'active']
          );
          inserted++;
        }
      } catch (e) { failed++; }
    }

    console.log(`[批量导入] 新增${inserted} 更新${updated} 失败${failed} (共${projects.length})`);

    // 写入缓存元数据
    writeCacheMeta({
      updated_at: new Date().toISOString(),
      project_count: inserted + updated,
      total_received: projects.length,
      failed: failed,
      latest_issue_date: projects.reduce(function(latest, p) {
        return p.issue_date && (!latest || p.issue_date > latest) ? p.issue_date : latest;
      }, null),
    });

    res.json({
      success: true,
      data: { inserted, updated, failed, total: projects.length },
    });
  } catch (err) {
    console.error('批量导入失败:', err.message);
    res.status(500).json({ success: false, message: '导入失败: ' + err.message });
  }
});

// GET /api/projects/cache-status — 缓存状态（小程序轮询此接口判断数据是否就绪）
router.get('/cache-status', async (req, res) => {
  try {
    var meta = readCacheMeta();
    var count = await db.queryOne('SELECT COUNT(*) as cnt FROM projects WHERE status = ?', ['active']);
    var total = count ? count.cnt : 0;
    var fresh = isCacheFresh(meta, 24);

    res.json({
      success: true,
      data: {
        data_ready: total > 0,
        project_count: total,
        last_import: meta ? meta.updated_at : null,
        is_fresh: fresh,
        needs_refresh: !fresh && total > 0,
        needs_init: total === 0,
        latest_issue_date: meta ? meta.latest_issue_date : null,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/projects/:id — 项目详情（支持合并：多个ID逗号分隔）
router.get('/:id', async (req, res) => {
  try {
    // 支持逗号分隔的多个 project_id
    const rawIds = req.params.id.split(',').filter(Boolean);
    if (rawIds.length === 0) {
      return res.status(400).json({ success: false, message: '请提供项目ID' });
    }

    // 查询所有匹配的项目
    const placeholders = rawIds.map(() => '?').join(',');
    const projects = await db.query(
      `SELECT * FROM projects WHERE project_id IN (${placeholders}) AND status = ?`,
      [...rawIds, 'active']
    );

    if (projects.length === 0) {
      return res.status(404).json({ success: false, message: '项目不存在或已下架' });
    }

    const name = projects[0].name;
    // 获取推广名
    const displayNameRow = await db.queryOne(
      'SELECT display_name FROM projects WHERE name = ? AND display_name IS NOT NULL AND display_name != \'\' LIMIT 1',
      [name]
    );
    // 获取所有同名 project_id（完整合并）
    const allProjectRows = await db.query(
      'SELECT project_id, display_name, permit_no, avg_price, signed_count, signed_area FROM projects WHERE name = ? AND status = ?',
      [name, 'active']
    );
    const allPids = allProjectRows.map(r => r.project_id);
    const allPlaceholders = allPids.map(() => '?').join(',');

    // 楼栋列表：合并所有预售证
    const buildings = await db.query(
      'SELECT b.*, ' +
      '(SELECT COUNT(*) FROM houses h WHERE h.building_id = b.building_id) as total_houses, ' +
      '(SELECT COUNT(*) FROM houses h WHERE h.building_id = b.building_id AND h.status = \'可售\') as available_count, ' +
      '(SELECT COUNT(*) FROM houses h WHERE h.building_id = b.building_id AND h.status IN (\'已签约\',\'网上联机备案\')) as sold_count, ' +
      '(SELECT COUNT(*) FROM houses h WHERE h.building_id = b.building_id AND h.status = \'已签约\') as signed_count_realtime, ' +
      '(SELECT COUNT(*) FROM houses h WHERE h.building_id = b.building_id AND h.status = \'已预订\') as reserved_count ' +
      `FROM buildings b WHERE b.project_id IN (${allPlaceholders}) ORDER BY b.building_name`,
      allPids
    );

    // 项目整体统计：合并所有房源
    const stats = await db.queryOne(
      'SELECT ' +
      'COUNT(*) as total_units, ' +
      'SUM(CASE WHEN status = \'可售\' THEN 1 ELSE 0 END) as available, ' +
      'SUM(CASE WHEN status = \'已签约\' THEN 1 ELSE 0 END) as signed, ' +
      'SUM(CASE WHEN status = \'网上联机备案\' THEN 1 ELSE 0 END) as filed, ' +
      'SUM(CASE WHEN status = \'已预订\' THEN 1 ELSE 0 END) as reserved ' +
      'FROM houses ' +
      `WHERE building_id IN (SELECT building_id FROM buildings WHERE project_id IN (${allPlaceholders}))`,
      allPids
    );

    // 各预售证独立均价（不合并加权，避免误导）
    const permitPrices = allProjectRows
      .filter(r => r.avg_price > 0)
      .map(r => ({
        project_id: r.project_id,
        display_name: r.display_name,
        permit_no: r.permit_no,
        avg_price: Math.round(r.avg_price),
        signed_count: r.signed_count || 0,
        signed_area: r.signed_area || 0,
      }));

    // 关注状态（任意一个预售证被关注即视为已关注）
    let watched = null;
    try {
      watched = await db.queryOne(
        `SELECT id, is_active, notes FROM watched_projects WHERE project_id IN (${placeholders}) AND is_active = 1 LIMIT 1`,
        rawIds
      );
    } catch (e) { /* ignore */ }

    // 住建委官方已售套数（优先使用，比爬虫逐户统计更可靠）
    const officialSold = allProjectRows.reduce((sum, r) => sum + (r.signed_count || 0), 0);
    const soldTotal = (stats ? stats.signed : 0) + (stats ? stats.filed : 0);
    const displaySold = officialSold > 0 ? officialSold : soldTotal;
    const displaySoldRate = (stats && stats.total_units)
      ? (displaySold / stats.total_units * 100).toFixed(1)
      : '0.0';

    // 返回合并后的项目信息
    const repProject = projects[projects.length - 1];  // 用最新的预售证信息作为代表
    repProject.name = name;
    repProject.display_name = displayNameRow ? displayNameRow.display_name : null;
    repProject.project_id = allPids.join(',');  // 逗号分隔所有ID
    repProject.permit_no = projects.map(p => p.permit_no).filter(Boolean).join('、') || null;
    repProject.issue_date = projects.map(p => p.issue_date).filter(Boolean).sort().reverse()[0] || null;
    repProject.project_count = allPids.length;

    res.json({
      success: true,
      data: {
        project: repProject,
        buildings: buildings,
        stats: {
          totalUnits: stats ? stats.total_units : 0,
          available: stats ? stats.available : 0,
          sold: displaySold,
          signed: stats ? stats.signed : 0,
          filed: stats ? stats.filed : 0,
          reserved: stats ? stats.reserved : 0,
          soldRate: displaySoldRate,
          permit_prices: permitPrices,
        },
        watch: watched ? {
          id: watched.id,
          is_active: watched.is_active,
          notes: watched.notes,
        } : null,
      },
    });
  } catch (err) {
    console.error('项目详情查询失败:', err.message);
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

// POST /api/projects/batch-insert — 批量插入/更新项目（用于爬虫数据同步）
router.post('/batch-insert', async (req, res) => {
  try {
    var { projects } = req.body || {};
    if (!Array.isArray(projects) || projects.length === 0) {
      return res.status(400).json({ success: false, message: '请提供 projects 数组' });
    }

    var today = new Date().toISOString().split('T')[0];
    var inserted = 0, updated = 0, failed = 0;

    for (var i = 0; i < projects.length; i++) {
      var p = projects[i];
      if (!p.project_id || !p.name) { failed++; continue; }
      try {
        var exists = await db.queryOne('SELECT id FROM projects WHERE project_id = ?', [p.project_id]);
        if (exists) {
          await db.insert(
            "UPDATE projects SET name=?, permit_no=?, issue_date=?, district=?, updated_at=datetime('now','localtime') WHERE project_id=?",
            [p.name, p.permit_no || null, p.issue_date || null, p.district || null, p.project_id]
          );
          updated++;
        } else {
          await db.insert(
            'INSERT INTO projects (project_id,name,permit_no,issue_date,first_seen,status) VALUES (?,?,?,?,?,?)',
            [p.project_id, p.name, p.permit_no || null, p.issue_date || null, today, 'active']
          );
          inserted++;
        }
      } catch (e) {
        console.error('[batch-insert] 项目 ' + p.project_id + ' 失败:', e.message);
        failed++;
      }
    }

    res.json({ success: true, data: { inserted, updated, failed, total: projects.length } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 从环境变量读取管理员 open_id 白名单（逗号分隔）
function getAdminOpenIds() {
  const raw = process.env.ADMIN_OPEN_IDS || '';
  return raw.split(',').map(id => id.trim()).filter(Boolean);
}

// 检查是否为管理员（从 query 或 body 中取 open_id）
function requireAdmin(req, res) {
  const adminIds = getAdminOpenIds();
  // 白名单为空时自动放行（首次配置阶段）
  if (adminIds.length === 0) {
    return true;
  }
  const openId = (req.query && req.query.open_id) || (req.body && req.body.open_id);
  if (!openId) {
    res.status(401).json({ success: false, message: '需要管理员身份（缺少 open_id）' });
    return false;
  }
  if (!adminIds.includes(openId)) {
    res.status(403).json({ success: false, message: '无权限（非管理员）' });
    return false;
  }
  return true;
}

// PUT /api/projects/:id — 更新项目信息（如推广名 display_name）需管理员权限
router.put('/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const rawIds = req.params.id.split(',').filter(Boolean);
    if (rawIds.length === 0) {
      return res.status(400).json({ success: false, message: '请提供项目ID' });
    }

    const { display_name } = req.body;
    if (display_name === undefined) {
      return res.status(400).json({ success: false, message: '请提供 display_name 参数' });
    }

    // 查询这些 ID 对应的项目名称
    const placeholders = rawIds.map(() => '?').join(',');
    const rows = await db.query(
      `SELECT name FROM projects WHERE project_id IN (${placeholders})`,
      rawIds
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '项目不存在' });
    }

    // 同名项目全部更新 display_name（确保合并展示时一致）
    const name = rows[0].name;
    await db.insert(
      "UPDATE projects SET display_name = ?, updated_at = datetime('now','localtime') WHERE name = ?",
      [display_name || null, name]
    );

    res.json({
      success: true,
      message: '已更新推广名',
      data: { name, display_name: display_name || null },
    });
  } catch (err) {
    console.error('更新项目信息失败:', err.message);
    res.status(500).json({ success: false, message: '更新失败: ' + err.message });
  }
});

module.exports = router;
