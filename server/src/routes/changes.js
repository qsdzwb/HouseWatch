const express = require('express');
const router = express.Router();
const db = require('../db/pool');

// 辅助：将 projectId 参数解析为数组（支持逗号分隔的多ID）
function parseProjectIds(projectId) {
  if (!projectId) return null;
  return projectId.split(',').filter(Boolean);
}

// ============================================================
// GET /api/changes/daily — 日变化列表
// 数据源：project_daily_stats（项目级累计）+ daily_snapshots（房屋明细）
// 已废弃 daily_changes 表依赖
// ============================================================
router.get('/daily', async (req, res) => {
  try {
    const { date, projectId, district, change_type, page = 1, limit = 50 } = req.query;

    // 如果传了 district，先查该区下所有楼盘 ID
    let effectiveProjectId = projectId;
    if (district) {
      const projRows = await db.query('SELECT project_id FROM projects WHERE district = ?', [district]);
      if (projRows.length > 0) {
        effectiveProjectId = projRows.map(r => r.project_id).join(',');
      } else {
        return res.json({
          success: true,
          data: { items: [], queryDate: date, summary: { newSales: 0, total: 0, avgDealPrice: null }, pagination: { total: 0, page: 1, limit: parseInt(limit, 10), totalPages: 0 } }
        });
      }
    }

    // 如果没有指定日期，取最近有快照的日期
    let targetDate = date;
    if (!targetDate) {
      const latestRow = await db.queryOne(
        'SELECT MAX(snapshot_date) as latest FROM daily_snapshots'
      );
      targetDate = latestRow?.latest || new Date().toISOString().split('T')[0];
    }

    // 计算前一天
    const prevDate = new Date(targetDate);
    prevDate.setDate(prevDate.getDate() - 1);
    const prevDateStr = prevDate.toISOString().split('T')[0];

    // === Step 1: 从 project_daily_stats 计算每个项目的日增量 ===
    let perProjectSql = `
      SELECT pds.project_id, pds.stat_date, pds.signed_count, pds.avg_price,
             COALESCE(p.display_name, p.name) as project_name, p.district
      FROM project_daily_stats pds
      JOIN projects p ON pds.project_id = p.project_id
      WHERE pds.stat_date IN (?, ?)
    `;
    const perProjectParams = [prevDateStr, targetDate];
    if (effectiveProjectId) {
      const ids = parseProjectIds(effectiveProjectId);
      perProjectSql += ` AND pds.project_id IN (${ids.map(() => '?').join(',')})`;
      perProjectParams.push(...ids);
    }
    perProjectSql += ` ORDER BY pds.project_id, pds.stat_date`;

    const perProjectRows = await db.query(perProjectSql, perProjectParams);

    // 按 project_id 分组，计算日增量和收集有增量的项目
    const projectGroups = {};
    perProjectRows.forEach(row => {
      if (!projectGroups[row.project_id]) projectGroups[row.project_id] = [];
      projectGroups[row.project_id].push(row);
    });

    const deltaProjects = [];
    let totalNewSales = 0;
    let totalPriceWeight = 0;
    let totalPriceCount = 0;

    for (const [pid, rows] of Object.entries(projectGroups)) {
      rows.sort((a, b) => a.stat_date.localeCompare(b.stat_date));
      if (rows.length >= 2) {
        const curr = rows[1].signed_count || 0;
        const prev = rows[0].signed_count || 0;
        const delta = curr - prev;
        if (delta > 0) {
          deltaProjects.push({ pid, delta, avgPrice: rows[1].avg_price, projectName: rows[1].project_name });
          totalNewSales += delta;
          if (rows[1].avg_price > 0) {
            totalPriceWeight += rows[1].avg_price * delta;
            totalPriceCount += delta;
          }
        }
      }
    }

    const summary = {
      newSales: totalNewSales,
      total: 0,
      avgDealPrice: totalPriceCount > 0 ? Math.round(totalPriceWeight / totalPriceCount) : null,
    };

    // === Step 2: 从 daily_snapshots 获取具体房屋信息 ===
    const items = [];

    if (deltaProjects.length > 0) {
      const allPids = deltaProjects.map(d => d.pid);
      const pidPlaceholders = allPids.map(() => '?').join(',');

      const snapshotSql = `
        WITH prev AS (
          SELECT s.house_id, s.snapshot_date, s.status, s.room_no, s.building_id,
                 COALESCE(b.building_name, b.building_id) as building_name,
                 b.project_id
          FROM daily_snapshots s
          JOIN buildings b ON s.building_id = b.building_id
          WHERE s.snapshot_date = ? AND b.project_id IN (${pidPlaceholders})
        ),
        curr AS (
          SELECT s.house_id, s.snapshot_date, s.status, s.room_no, s.building_id,
                 COALESCE(b.building_name, b.building_id) as building_name,
                 b.project_id
          FROM daily_snapshots s
          JOIN buildings b ON s.building_id = b.building_id
          WHERE s.snapshot_date = ? AND b.project_id IN (${pidPlaceholders})
        )
        SELECT 
          curr.project_id,
          curr.house_id,
          curr.room_no,
          curr.building_id,
          curr.building_name,
          curr.status as curr_status,
          COALESCE(prev.status, '(新增)') as prev_status
        FROM curr
        LEFT JOIN prev ON curr.house_id = prev.house_id
        WHERE curr.status = '网上联机备案'
          AND (
            prev.house_id IS NULL
            OR (prev.status != '网上联机备案' AND prev.status != '已签约')
          )
        ORDER BY curr.project_id, curr.building_name, curr.room_no
      `;
      const snapshotParams = [prevDateStr, ...allPids, targetDate, ...allPids];
      const snapshotRows = await db.query(snapshotSql, snapshotParams);

      // 按 project_id 分组快照结果
      const projectSnapshots = {};
      snapshotRows.forEach(r => {
        if (!projectSnapshots[r.project_id]) projectSnapshots[r.project_id] = [];
        projectSnapshots[r.project_id].push(r);
      });

      // 构建 items
      for (const d of deltaProjects) {
        const pSnaps = projectSnapshots[d.pid] || [];
        const itemChangeType = 'new_sale'; // 快照比对只追踪成交

        // 跳过不匹配 change_type 的项目
        if (change_type && change_type !== 'all' && change_type !== itemChangeType) continue;

        if (pSnaps.length > 0) {
          pSnaps.forEach(s => {
            items.push({
              id: null,
              project_id: d.pid,
              project_name: d.projectName,
              building_name: s.building_name,
              building_id: s.building_id,
              room_no: s.room_no,
              house_id: s.house_id,
              change_type: itemChangeType,
              change_date: targetDate,
              old_status: s.prev_status,
              new_status: s.curr_status,
              deal_unit_price: d.avgPrice || null,
              price_display: d.avgPrice ? Math.round(d.avgPrice) + '元/㎡' : null,
            });
          });

          if (pSnaps.length < d.delta) {
            const extra = d.delta - pSnaps.length;
            items.push({
              id: null,
              project_id: d.pid,
              project_name: d.projectName,
              building_name: '',
              building_id: null,
              room_no: '',
              house_id: null,
              change_type: itemChangeType,
              change_date: targetDate,
              old_status: '累计签约',
              new_status: '+' + extra + '套(明细未抓取)',
              deal_unit_price: d.avgPrice || null,
              price_display: d.avgPrice ? Math.round(d.avgPrice) + '元/㎡' : null,
            });
          }
        } else {
          // 无具体房屋明细，生成汇总条目
          items.push({
            id: null,
            project_id: d.pid,
            project_name: d.projectName,
            building_name: '',
            building_id: null,
            room_no: '',
            house_id: null,
            change_type: itemChangeType,
            change_date: targetDate,
            old_status: '可售',
            new_status: '已签约',
            deal_unit_price: d.avgPrice || null,
            price_display: d.avgPrice ? Math.round(d.avgPrice) + '元/㎡' : null,
            summary_count: d.delta,
          });
        }
      }
    }

    // === Step 3: 分页 ===
    const total = items.length;
    summary.total = total;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;
    const pagedItems = items.slice(offset, offset + limitNum);

    res.json({
      success: true,
      data: {
        items: pagedItems,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
        summary,
        queryDate: targetDate,
      },
    });
  } catch (err) {
    console.error('日变化查询失败:', err.message);
    res.status(500).json({ success: false, message: '查询失败: ' + err.message });
  }
});

// ============================================================
// GET /api/changes/by-date — 按日期汇总
// 数据源：project_daily_stats（日增量）
// ============================================================
router.get('/by-date', async (req, res) => {
  try {
    const { days = 30, projectId } = req.query;
    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - parseInt(days, 10));
    const startDate = daysAgo.toISOString().split('T')[0];

    // 从 project_daily_stats 获取每日累计，计算日增量
    let statsSql = `
      SELECT project_id, stat_date as date, signed_count
      FROM project_daily_stats
      WHERE stat_date >= ?
    `;
    const statsParams = [startDate];
    if (projectId) {
      const ids = parseProjectIds(projectId);
      statsSql += ` AND project_id IN (${ids.map(() => '?').join(',')})`;
      statsParams.push(...ids);
    }
    statsSql += ` ORDER BY project_id, stat_date ASC`;

    const statsRows = await db.query(statsSql, statsParams);

    // 按项目分组，计算日增量
    const projectMap = {};
    statsRows.forEach(r => {
      if (!projectMap[r.project_id]) projectMap[r.project_id] = [];
      projectMap[r.project_id].push({ date: r.date, signed_count: r.signed_count || 0 });
    });

    const dailyNewMap = {};
    Object.values(projectMap).forEach(rows => {
      rows.sort((a, b) => a.date.localeCompare(b.date));
      for (let i = 1; i < rows.length; i++) {
        const prev = rows[i - 1];
        const curr = rows[i];
        const newCount = curr.signed_count - prev.signed_count;
        if (newCount > 0) {
          dailyNewMap[curr.date] = (dailyNewMap[curr.date] || 0) + newCount;
        }
      }
    });

    const dailyStats = Object.entries(dailyNewMap)
      .map(([date, sales_count]) => ({ date, sales_count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // 最近一天
    let latestDate = null;
    let latestChanges = [];
    let latestSummary = {};
    if (dailyStats.length > 0) {
      latestDate = dailyStats[dailyStats.length - 1].date;
    }

    if (latestDate) {
      // 懒加载：返回空，由前端调用 /daily 获取明细
      // 保持兼容：返回最近一天的基本摘要
      const prevDate = new Date(latestDate);
      prevDate.setDate(prevDate.getDate() - 1);
      const prevDateStr = prevDate.toISOString().split('T')[0];

      const latestRows = await db.query(
        `SELECT pds.project_id, pds.stat_date, pds.signed_count, pds.avg_price
         FROM project_daily_stats pds
         WHERE pds.stat_date IN (?, ?)
         ${projectId ? 'AND pds.project_id IN (' + parseProjectIds(projectId).map(() => '?').join(',') + ')' : ''}
         ORDER BY pds.project_id, pds.stat_date`,
        projectId ? [prevDateStr, latestDate, ...parseProjectIds(projectId)] : [prevDateStr, latestDate]
      );

      const pMap = {};
      latestRows.forEach(r => {
        if (!pMap[r.project_id]) pMap[r.project_id] = [];
        pMap[r.project_id].push(r);
      });

      let newSales = 0;
      let totalPriceWeight = 0;
      let totalPriceCount = 0;
      Object.values(pMap).forEach(rows => {
        rows.sort((a, b) => a.stat_date.localeCompare(b.stat_date));
        if (rows.length >= 2) {
          const delta = (rows[1].signed_count || 0) - (rows[0].signed_count || 0);
          if (delta > 0) {
            newSales += delta;
            if (rows[1].avg_price > 0) {
              totalPriceWeight += rows[1].avg_price * delta;
              totalPriceCount += delta;
            }
          }
        }
      });

      latestSummary = {
        newSales,
        avgDealPrice: totalPriceCount > 0 ? Math.round(totalPriceWeight / totalPriceCount) : null,
      };
    }

    res.json({
      success: true,
      data: { dailyStats, latestDate, latestChanges, latestSummary },
    });
  } catch (err) {
    console.error('by-date查询失败:', err.message);
    res.status(500).json({ success: false, message: '查询失败: ' + err.message });
  }
});

// ============================================================
// GET /api/changes/trend — 趋势数据
// 数据源：project_daily_stats（每日已售累计值 → 计算日新增）
// ============================================================
router.get('/trend', async (req, res) => {
  try {
    const { projectId, district, days = 30 } = req.query;

    let effectiveProjectId = projectId;
    if (district) {
      const projRows = await db.query('SELECT project_id FROM projects WHERE district = ?', [district]);
      if (projRows.length > 0) {
        effectiveProjectId = projRows.map(r => r.project_id).join(',');
      } else {
        return res.json({
          success: true,
          data: { dailySales: [], projectId: null, district }
        });
      }
    }

    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - parseInt(days, 10));
    const trendStart = daysAgo.toISOString().split('T')[0];

    let statsSql = `
      SELECT project_id, stat_date as date, signed_count, avg_price as avgPrice
      FROM project_daily_stats
      WHERE stat_date >= ?
    `;
    const statsParams = [trendStart];
    if (effectiveProjectId) {
      const ids = parseProjectIds(effectiveProjectId);
      statsSql += ` AND project_id IN (${ids.map(() => '?').join(',')})`;
      statsParams.push(...ids);
    }
    statsSql += ` ORDER BY stat_date ASC`;

    const statsRows = await db.query(statsSql, statsParams);
    const dailySales = [];

    if (statsRows.length > 0) {
      const projectMap = {};
      statsRows.forEach(r => {
        if (!projectMap[r.project_id]) projectMap[r.project_id] = [];
        projectMap[r.project_id].push({
          date: r.date,
          signed_count: r.signed_count || 0,
          avg_price: r.avgPrice || 0
        });
      });

      const dailyNewMap = {};
      Object.values(projectMap).forEach(rows => {
        rows.sort((a, b) => a.date.localeCompare(b.date));
        for (let i = 1; i < rows.length; i++) {
          const prev = rows[i - 1];
          const curr = rows[i];
          const newCount = curr.signed_count - prev.signed_count;
          if (newCount > 0) {
            if (!dailyNewMap[curr.date]) {
              dailyNewMap[curr.date] = { totalNew: 0, totalPriceWeight: 0, totalCount: 0 };
            }
            dailyNewMap[curr.date].totalNew += newCount;
            if (curr.avg_price > 0) {
              dailyNewMap[curr.date].totalPriceWeight += curr.avg_price * newCount;
              dailyNewMap[curr.date].totalCount += newCount;
            }
          }
        }
      });

      const sortedDates = Object.keys(dailyNewMap).sort();
      for (const date of sortedDates) {
        const d = dailyNewMap[date];
        dailySales.push({
          date,
          count: d.totalNew,
          avgPrice: d.totalCount > 0 ? Math.round(d.totalPriceWeight / d.totalCount) : 0,
        });
      }
    }

    // 去掉开头的零值
    while (dailySales.length > 0 && dailySales[0].count === 0) {
      dailySales.shift();
    }

    res.json({
      success: true,
      data: { dailySales, projectId: projectId || null, district: district || null },
    });
  } catch (err) {
    console.error('趋势查询失败:', err.message);
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

// ============================================================
// GET /api/changes/project-price-extremes — 楼盘历史成交价极值
// 数据源：project_daily_stats（每项目每日均价）
// ============================================================
router.get('/project-price-extremes', async (req, res) => {
  try {
    const { projectId } = req.query;
    if (!projectId) {
      return res.status(400).json({ success: false, message: '缺少 projectId' });
    }

    const ids = parseProjectIds(projectId);
    const dailyAvg = await db.query(
      `SELECT stat_date as date, avg_price as avgPrice
       FROM project_daily_stats
       WHERE project_id IN (${ids.map(() => '?').join(',')}) AND avg_price > 0
       ORDER BY stat_date ASC`,
      ids
    );

    if (!dailyAvg.length) {
      return res.json({ success: true, data: { hasData: false } });
    }

    const prices = dailyAvg.map(r => r.avgPrice);
    const minPrice = Math.round(Math.min(...prices));
    const maxPrice = Math.round(Math.max(...prices));
    const latestPrice = Math.round(prices[prices.length - 1]);

    let position = 'mid';
    if (latestPrice <= minPrice + (maxPrice - minPrice) * 0.2) { position = 'low'; }
    else if (latestPrice >= maxPrice - (maxPrice - minPrice) * 0.2) { position = 'high'; }

    let tip = '';
    if (position === 'low') {
      tip = `当前成交均价处于历史低位（历史最低${minPrice}元/㎡），可能是入手好时机 📉`;
    } else if (position === 'high') {
      tip = `当前成交均价处于历史高位（历史最高${maxPrice}元/㎡），建议观望 📈`;
    } else {
      tip = `当前成交均价处于历史中等水平（历史区间${minPrice}~${maxPrice}元/㎡）`;
    }

    res.json({
      success: true,
      data: { hasData: true, minPrice, maxPrice, latestPrice, position, tip, dataPoints: dailyAvg.length },
    });
  } catch (err) {
    console.error('极值查询失败:', err.message);
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

module.exports = router;
