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

// GET /api/projects — 项目列表（分页+搜索+排序+统计）
router.get('/', async (req, res) => {
  try {
    const { district, page = 1, limit = 20, status = 'active', search, sort_by, order } = req.query;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;

    const statsSQL = 'SELECT p.*,' +
      '(SELECT COUNT(*) FROM buildings b WHERE b.project_id = p.project_id) as building_count,' +
      '(SELECT COUNT(*) FROM houses h WHERE h.building_id IN (SELECT building_id FROM buildings WHERE project_id = p.project_id)) as total_houses,' +
      '(SELECT COUNT(*) FROM houses h WHERE h.building_id IN (SELECT building_id FROM buildings WHERE project_id = p.project_id) AND h.status = \'可售\') as available_houses,' +
      '(SELECT COUNT(*) FROM houses h WHERE h.building_id IN (SELECT building_id FROM buildings WHERE project_id = p.project_id) AND h.status IN (\'已签约\',\'网上联机备案\')) as sold_houses' +
    ' FROM projects p WHERE p.status = ?';
    const params = [status];

    if (district) {
      statsSQL += ' AND p.district = ?';
      params.push(district);
    }

    if (search) {
      statsSQL += ' AND p.name LIKE ?';
      params.push('%' + search + '%');
    }

    const countSQL = statsSQL.replace(
      /SELECT p\.\*,[\s\S]*?FROM projects p/,
      'SELECT COUNT(*) as total FROM projects p'
    );
    const [{ total }] = await db.query(countSQL, params);

    let orderClause = ' ORDER BY last_crawl DESC, name ASC';
    const allowedSorts = {
      total_houses: 'total_houses',
      sold_rate: 'sold_rate',
      building_count: 'building_count',
      name: 'name',
      last_crawl: 'last_crawl',
    };
    if (sort_by && allowedSorts[sort_by]) {
      const dir = order === 'asc' ? 'ASC' : 'DESC';
      if (sort_by === 'sold_rate') {
        orderClause = ' ORDER BY CASE WHEN total_houses > 0 THEN CAST(sold_houses AS REAL) / total_houses ELSE 0 END ' + dir;
      } else {
        orderClause = ' ORDER BY ' + allowedSorts[sort_by] + ' ' + dir;
      }
    }

    const dataSQL = 'SELECT * FROM (' + statsSQL + ') AS sub' + orderClause + ' LIMIT ? OFFSET ?';
    params.push(limitNum, offset);

    const projects = await db.query(dataSQL, params);

    const items = projects.map(function(p) {
      var rate = p.total_houses > 0 ? (p.sold_houses / p.total_houses * 100).toFixed(1) : '0.0';
      var obj = {};
      for (var k in p) { obj[k] = p[k]; }
      obj.sold_rate = rate + '%';
      return obj;
    });

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

// GET /api/projects/:id — 项目详情 + 楼栋汇总（含每栋统计 + 关注状态）
router.get('/:id', async (req, res) => {
  try {
    var pid = req.params.id;
    const project = await db.queryOne(
      'SELECT * FROM projects WHERE project_id = ? AND status = ?',
      [pid, 'active']
    );

    if (!project) {
      return res.status(404).json({ success: false, message: '项目不存在或已下架' });
    }

    // 楼栋列表：
    //   sold_count: 从 houses 表实时统计（爬虫逐户抓取，部分楼栋不完整）
    //   avg_price: 来自 buildings 表（详情页爬取，住建委官方成交均价）
    //   详情页 signed_count 字段不可靠（爬虫疑似把总套数当已签数），仅作参考
    const buildings = await db.query(
      'SELECT b.*, ' +
      '(SELECT COUNT(*) FROM houses h WHERE h.building_id = b.building_id) as total_houses, ' +
      '(SELECT COUNT(*) FROM houses h WHERE h.building_id = b.building_id AND h.status = \'可售\') as available_count, ' +
      '(SELECT COUNT(*) FROM houses h WHERE h.building_id = b.building_id AND h.status IN (\'已签约\',\'网上联机备案\')) as sold_count, ' +
      '(SELECT COUNT(*) FROM houses h WHERE h.building_id = b.building_id AND h.status = \'已签约\') as signed_count_realtime, ' +
      '(SELECT COUNT(*) FROM houses h WHERE h.building_id = b.building_id AND h.status = \'已预订\') as reserved_count ' +
      'FROM buildings b WHERE b.project_id = ? ORDER BY b.building_name',
      [pid]
    );

    // 项目整体统计：全部从 houses 表实时计算
    const stats = await db.queryOne(
      'SELECT ' +
      'COUNT(*) as total_units, ' +
      'SUM(CASE WHEN status = \'可售\' THEN 1 ELSE 0 END) as available, ' +
      'SUM(CASE WHEN status = \'已签约\' THEN 1 ELSE 0 END) as signed, ' +
      'SUM(CASE WHEN status = \'网上联机备案\' THEN 1 ELSE 0 END) as filed, ' +
      'SUM(CASE WHEN status = \'已预订\' THEN 1 ELSE 0 END) as reserved ' +
      'FROM houses ' +
      'WHERE building_id IN (SELECT building_id FROM buildings WHERE project_id = ?)',
      [pid]
    );

    // 项目成交均价：优先使用 projects 表的官方汇总数据（v6爬虫从详情页底部汇总表格抓取）
    //  fallback: 从 buildings 表计算加权平均（旧数据兼容）
    var avgPrice = null;
    if (project.avg_price && project.avg_price > 0) {
      avgPrice = Math.round(project.avg_price);
    } else {
      const priceStats = await db.queryOne(
        'SELECT SUM(signed_area) as total_signed_area, ' +
        'SUM(signed_area * avg_price) as weighted_price_sum ' +
        'FROM buildings WHERE project_id = ? AND signed_area > 0 AND avg_price > 0',
        [pid]
      );
      if (priceStats && priceStats.total_signed_area > 0) {
        avgPrice = Math.round(priceStats.weighted_price_sum / priceStats.total_signed_area);
      }
    }

    // 关注状态
    var watched = null;
    try {
      watched = await db.queryOne(
        'SELECT id, is_active, notes FROM watched_projects WHERE project_id = ?',
        [pid]
      );
    } catch (e) {
      // watched_projects 表可能不存在
    }

    res.json({
      success: true,
      data: {
        project: project,
        buildings: buildings,
        stats: {
          totalUnits: stats ? stats.total_units : 0,
          available: stats ? stats.available : 0,
          sold: (stats ? stats.signed : 0) + (stats ? stats.filed : 0),
          signed: stats ? stats.signed : 0,
          filed: stats ? stats.filed : 0,
          reserved: stats ? stats.reserved : 0,
          soldRate: (stats && stats.total_units)
            ? (((stats.signed || 0) + (stats.filed || 0)) / stats.total_units * 100).toFixed(1)
            : '0.0',
          avgPrice: avgPrice,
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

module.exports = router;
