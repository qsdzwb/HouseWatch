const express = require('express');
const router = express.Router();
const db = require('../db/pool');

// 辅助：将 projectId 参数解析为数组（支持逗号分隔的多ID）
function parseProjectIds(projectId) {
  if (!projectId) return null;
  return projectId.split(',').filter(Boolean);
}

// 辅助：构建 IN 子句和参数
function buildInClause(ids) {
  if (!ids || ids.length === 0) return { clause: '', params: [] };
  const clause = ' IN (' + ids.map(() => '?').join(',') + ')';
  return { clause, params: ids };
}

// GET /api/changes/daily — 日变化列表
router.get('/daily', async (req, res) => {
  try {
    console.log('[changes/daily] query:', JSON.stringify(req.query));
    const { date, projectId, change_type, page = 1, limit = 50 } = req.query;
    console.log('[changes/daily] change_type param:', change_type);

    // 如果没有指定日期，默认查询最近有变化记录的日期
    let targetDate = date;
    if (!targetDate) {
      const latestRow = await db.queryOne(
        'SELECT MAX(change_date) as latest FROM daily_changes'
      );
      targetDate = latestRow?.latest || new Date().toISOString().split('T')[0];
    }

    let sql = `
      SELECT dc.*, p.name as project_name, b.building_name
      FROM daily_changes dc
      JOIN projects p ON dc.project_id = p.project_id
      JOIN buildings b ON dc.building_id = b.building_id
      WHERE dc.change_date = ?
    `;
    const params = [targetDate];

    if (projectId) {
      const ids = parseProjectIds(projectId);
      if (ids.length === 1) {
        sql += ' AND dc.project_id = ?';
        params.push(ids[0]);
      } else {
        const placeholders = ids.map(() => '?').join(',');
        sql += ` AND dc.project_id IN (${placeholders})`;
        params.push(...ids);
      }
    }
    if (change_type) {
      sql += ' AND dc.change_type = ?';
      params.push(change_type);
    }

    // 查询总数
    const countSql = sql.replace(
      'SELECT dc.*, p.name as project_name, b.building_name',
      'SELECT COUNT(*) as total'
    );
    const [{ total }] = await db.query(countSql, params);

    // 数据
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    sql += ' ORDER BY dc.change_type DESC, dc.id ASC LIMIT ? OFFSET ?';
    params.push(parseInt(limit, 10), offset);

    console.log('[changes/daily] Final SQL:', sql);
    console.log('[changes/daily] Params:', params);
    let changes = await db.query(sql, params);

    // 汇总统计（使用 targetDate）
    let statSql = `
      SELECT
        SUM(CASE WHEN change_type = 'new_sale' THEN 1 ELSE 0 END) as newSales,
        SUM(CASE WHEN change_type != 'new_sale' THEN 1 ELSE 0 END) as statusChanges,
        AVG(CASE WHEN change_type = 'new_sale' AND deal_unit_price > 0 THEN deal_unit_price END) as avgDealPrice
      FROM daily_changes WHERE change_date = ?
    `;
    const statParams = [targetDate];
    if (change_type) {
      statSql = statSql.replace('WHERE change_date = ?', 'WHERE change_date = ? AND change_type = ?');
      statParams.push(change_type);
    }
    const statResult = await db.queryOne(statSql, statParams);
    let summary = { newSales: 0, statusChanges: 0, avgDealPrice: null, total: total, ...statResult };

    // fallback：daily_changes 为空时，从 project_daily_stats 计算日增量
    if (total === 0) {
      const prevDate = new Date(targetDate);
      prevDate.setDate(prevDate.getDate() - 1);
      const prevDateStr = prevDate.toISOString().split('T')[0];

      let fallbackSql = `
        SELECT stat_date, SUM(signed_count) as signed_count,
               CASE WHEN SUM(signed_count) > 0 THEN SUM(signed_count * avg_price) / SUM(signed_count) ELSE 0 END as avg_price
        FROM project_daily_stats
        WHERE stat_date IN (?, ?)
      `;
      const fallbackParams = [prevDateStr, targetDate];
      if (projectId) {
        const ids = parseProjectIds(projectId);
        fallbackSql += ` AND project_id IN (${ids.map(() => '?').join(',')})`;
        fallbackParams.push(...ids);
      }
      fallbackSql += ` GROUP BY stat_date ORDER BY stat_date ASC`;

      const fbRows = await db.query(fallbackSql, fallbackParams);
      if (fbRows.length >= 2) {
        const prev = fbRows[0].signed_count || 0;
        const curr = fbRows[1].signed_count || 0;
        summary.newSales = Math.max(0, curr - prev);
        summary.avgDealPrice = fbRows[1].avg_price;
      } else if (fbRows.length === 1 && fbRows[0].stat_date === targetDate) {
        summary.newSales = 0; // 第一天无增量
        summary.avgDealPrice = fbRows[0].avg_price;
      }
    }

    // 为每条变化添加 price_display
    changes = changes.map(item => {
      if (item.deal_unit_price && item.deal_unit_price > 0) {
        item.price_display = Math.round(item.deal_unit_price) + '元/㎡';
      } else if (item.building_avg_price && item.building_avg_price > 0) {
        item.price_display = Math.round(item.building_avg_price) + '元/㎡(楼栋均价)';
      }
      return item;
    });

    res.json({
      success: true,
      data: {
        items: changes,
        pagination: {
          page: parseInt(page, 10),
          limit: parseInt(limit, 10),
          total,
          totalPages: Math.ceil(total / parseInt(limit, 10)),
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

// GET /api/changes/by-date — 按日期汇总（用于变化页顶部统计）
router.get('/by-date', async (req, res) => {
  try {
    const { days = 30, projectId } = req.query;
    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - parseInt(days, 10));
    const startDate = daysAgo.toISOString().split('T')[0];

    let where = "WHERE dc.change_date >= ? AND dc.change_type = 'new_sale'";
    const params = [startDate];

    if (projectId) {
      const ids = parseProjectIds(projectId);
      if (ids.length === 1) {
        where += ' AND dc.project_id = ?';
        params.push(ids[0]);
      } else {
        const placeholders = ids.map(() => '?').join(',');
        where += ` AND dc.project_id IN (${placeholders})`;
        params.push(...ids);
      }
    }

    const dailyStats = await db.query(
      `SELECT 
        dc.change_date as date,
        COUNT(*) as sales_count,
        SUM(CASE WHEN dc.deal_unit_price > 0 THEN dc.deal_unit_price END) / 
        NULLIF(SUM(CASE WHEN dc.deal_unit_price > 0 THEN 1 END), 0) as avg_price
      FROM daily_changes dc
      ${where}
      GROUP BY dc.change_date
      ORDER BY dc.change_date ASC`,
      params
    );

    // 最近一天的变化明细
    let latestDate = null;
    if (dailyStats.length > 0) {
      latestDate = dailyStats[dailyStats.length - 1].date;
    } else {
      const row = await db.queryOne(
        'SELECT MAX(change_date) as latest FROM daily_changes'
      );
      latestDate = row ? row.latest : null;
    }

    let latestChanges = [];
    let latestSummary = {};
    if (latestDate) {
      let detailWhere = 'WHERE dc.change_date = ?';
      const detailParams = [latestDate];
      if (projectId) {
        const ids = parseProjectIds(projectId);
        if (ids.length === 1) {
          detailWhere += ' AND dc.project_id = ?';
          detailParams.push(ids[0]);
        } else {
          const placeholders = ids.map(() => '?').join(',');
          detailWhere += ` AND dc.project_id IN (${placeholders})`;
          detailParams.push(...ids);
        }
      }

      latestChanges = await db.query(
        `SELECT dc.*, p.name as project_name, b.building_name
         FROM daily_changes dc
         JOIN projects p ON dc.project_id = p.project_id
         JOIN buildings b ON dc.building_id = b.building_id
         ${detailWhere}
         ORDER BY dc.change_type DESC, dc.id ASC
         LIMIT 50`,
        detailParams
      );

      latestSummary = await db.queryOne(
        `SELECT 
          SUM(CASE WHEN change_type = 'new_sale' THEN 1 ELSE 0 END) as newSales,
          SUM(CASE WHEN change_type != 'new_sale' THEN 1 ELSE 0 END) as statusChanges,
          AVG(CASE WHEN change_type = 'new_sale' AND deal_unit_price > 0 THEN deal_unit_price END) as avgDealPrice
        FROM daily_changes ${detailWhere.replace('dc.', '')}`,
        detailParams
      ) || {};

      latestChanges = latestChanges.map(item => {
        if (item.deal_unit_price && item.deal_unit_price > 0) {
          item.price_display = Math.round(item.deal_unit_price) + '元/㎡';
        }
        return item;
      });
    }

    res.json({
      success: true,
      data: {
        dailyStats,
        latestDate,
        latestChanges,
        latestSummary,
      },
    });
  } catch (err) {
    console.error('by-date查询失败:', err.message);
    res.status(500).json({ success: false, message: '查询失败: ' + err.message });
  }
});

// GET /api/changes/trend — 趋势数据（数量 + 均价，支持按楼盘筛选）
// 优先从 project_daily_stats 表获取（每日已售累计值 → 计算日新增）
router.get('/trend', async (req, res) => {
  try {
    const { projectId, days = 30 } = req.query;

    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - parseInt(days, 10));
    const trendStart = daysAgo.toISOString().split('T')[0];

    // 生成日期列表（用于补零）
    const dateList = [];
    for (let i = 0; i < parseInt(days, 10); i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dateList.unshift(d.toISOString().split('T')[0]);
    }

    // 先从 project_daily_stats 获取每日累计已售数据
    let statsSql = `
      SELECT stat_date as date, signed_count, avg_price as avgPrice
      FROM project_daily_stats
      WHERE stat_date >= ?
    `;
    const statsParams = [trendStart];
    if (projectId) {
      const ids = parseProjectIds(projectId);
      statsSql += ` AND project_id IN (${ids.map(() => '?').join(',')})`;
      statsParams.push(...ids);
    }
    statsSql += ` ORDER BY stat_date ASC`;

    const statsRows = await db.query(statsSql, statsParams);

    let dailySales = [];

    if (statsRows.length > 0) {
      // 按日期汇总（多项目时累加 signed_count，加权平均 avg_price）
      const dateMap = {};
      statsRows.forEach(r => {
        if (!dateMap[r.date]) {
          dateMap[r.date] = { signed_count: 0, avgPriceSum: 0, avgPriceWeight: 0 };
        }
        dateMap[r.date].signed_count += r.signed_count || 0;
        if (r.avgPrice && r.avgPrice > 0) {
          // 按已售面积加权（signed_area * avg_price / signed_area = avg_price）
          // 简单处理：按已售套数加权
          const weight = r.signed_count || 1;
          dateMap[r.date].avgPriceSum += r.avgPrice * weight;
          dateMap[r.date].avgPriceWeight += weight;
        }
      });

      // 按日期排序，计算相邻两天的差值（日新增成交）
      const sortedDates = Object.keys(dateMap).sort();
      let prevCount = null; // null 表示还没有前一天数据

      for (const date of sortedDates) {
        const count = dateMap[date].signed_count;
        let dailyNew = 0;
        // 只有有前一天数据时才计算差值（第一天设为0，避免累计值冲击趋势图）
        if (prevCount !== null) {
          dailyNew = count - prevCount;
        }
        const avgPrice = dateMap[date].avgPriceWeight > 0
          ? dateMap[date].avgPriceSum / dateMap[date].avgPriceWeight
          : 0;

        dailySales.push({
          date,
          count: Math.max(0, dailyNew),
          avgPrice: Math.round(avgPrice),
        });
        prevCount = count;
      }
    }

    // fallback：如果 project_daily_stats 没有数据，尝试从 daily_changes 获取
    if (dailySales.length === 0) {
      const salesSql = `
        SELECT 
          change_date as date,
          COUNT(*) as count,
          AVG(CASE WHEN deal_unit_price > 0 THEN deal_unit_price END) as avgPrice
        FROM daily_changes
        WHERE change_type = 'new_sale'
          AND change_date >= ?
          ${projectId ? 'AND project_id IN (' + parseProjectIds(projectId).map(() => '?').join(',') + ')' : ''}
        GROUP BY change_date
        ORDER BY change_date ASC
      `;
      const salesParams = projectId ? [trendStart, ...parseProjectIds(projectId)] : [trendStart];
      const salesData = await db.query(salesSql, salesParams);

      const salesMap = {};
      salesData.forEach(r => {
        salesMap[r.date] = { count: r.count || 0, avgPrice: r.avgPrice || 0 };
      });

      dailySales = dateList.map(d => ({
        date: d,
        count: salesMap[d]?.count || 0,
        avgPrice: Math.round(salesMap[d]?.avgPrice || 0),
      }));
    }

    // 去掉开头 count=0 的日期（如第一天无对比基数的数据）
    while (dailySales.length > 0 && dailySales[0].count === 0) {
      dailySales.shift();
    }

    res.json({
      success: true,
      data: {
        dailySales,
        projectId: projectId || null,
      },
    });
  } catch (err) {
    console.error('趋势查询失败:', err.message);
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

// GET /api/changes/project-price-extremes — 楼盘历史成交价极值
router.get('/project-price-extremes', async (req, res) => {
  try {
    const { projectId } = req.query;
    if (!projectId) {
      return res.status(400).json({ success: false, message: '缺少 projectId' });
    }

    // 历史所有成交记录（按日期汇总日均价）
    const ids = parseProjectIds(projectId);
    const dailyAvg = await db.query(
      `SELECT change_date as date, AVG(deal_unit_price) as avgPrice
       FROM daily_changes
       WHERE project_id IN (${ids.map(() => '?').join(',')}) AND change_type = 'new_sale' AND deal_unit_price > 0
       GROUP BY change_date
       ORDER BY change_date ASC`,
      ids
    );

    if (!dailyAvg.length) {
      return res.json({ success: true, data: { hasData: false } });
    }

    const prices = dailyAvg.map(r => r.avgPrice);
    const minPrice = Math.round(Math.min(...prices));
    const maxPrice = Math.round(Math.max(...prices));
    const latestPrice = Math.round(prices[prices.length - 1]);

    // 最新价在历史中的位置
    let position = 'mid';
    if (latestPrice <= minPrice + (maxPrice - minPrice) * 0.2) { position = 'low'; }
    else if (latestPrice >= maxPrice - (maxPrice - minPrice) * 0.2) { position = 'high'; }

    // 生成提示文案
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
      data: {
        hasData: true,
        minPrice,
        maxPrice,
        latestPrice,
        position,
        tip,
        dataPoints: dailyAvg.length,
      },
    });
  } catch (err) {
    console.error('极值查询失败:', err.message);
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

module.exports = router;
