const express = require('express');
const router = express.Router();
const db = require('../db/pool');

// GET /api/changes/daily — 日变化列表
router.get('/daily', async (req, res) => {
  try {
    const { date, projectId, page = 1, limit = 50 } = req.query;

    let sql = `
      SELECT dc.*, p.name as project_name, b.building_name
      FROM daily_changes dc
      JOIN projects p ON dc.project_id = p.project_id
      JOIN buildings b ON dc.building_id = b.building_id
      WHERE 1=1
    `;
    const params = [];

    if (date) {
      sql += ' AND dc.change_date = ?';
      params.push(date);
    }

    if (projectId) {
      sql += ' AND dc.project_id = ?';
      params.push(projectId);
    }

    // 查询总数
    const countSql = sql.replace(
      'SELECT dc.*, p.name as project_name, b.building_name',
      'SELECT COUNT(*) as total'
    );
    const [{ total }] = await db.query(countSql, params);

    // 数据
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    sql += ' ORDER BY dc.change_date DESC, dc.id DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit, 10), offset);

    let changes = await db.query(sql, params);

    // 汇总统计
    let summary = { newSales: 0, statusChanges: 0, avgDealPrice: null, total: total };

    if (date) {
      const statResult = await db.queryOne(
        `SELECT 
          SUM(CASE WHEN change_type = 'new_sale' THEN 1 ELSE 0 END) as newSales,
          SUM(CASE WHEN change_type != 'new_sale' THEN 1 ELSE 0 END) as statusChanges,
          AVG(CASE WHEN change_type = 'new_sale' AND deal_unit_price > 0 THEN deal_unit_price END) as avgDealPrice
        FROM daily_changes WHERE change_date = ?`,
        [date]
      );
      summary = { ...summary, ...statResult };
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
      where += ' AND dc.project_id = ?';
      params.push(projectId);
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
      latestChanges = await db.query(
        `SELECT dc.*, p.name as project_name, b.building_name
         FROM daily_changes dc
         JOIN projects p ON dc.project_id = p.project_id
         JOIN buildings b ON dc.building_id = b.building_id
         WHERE dc.change_date = ?
         ORDER BY dc.change_type DESC, dc.id ASC
         LIMIT 50`,
        [latestDate]
      );

      latestSummary = await db.queryOne(
        `SELECT 
          SUM(CASE WHEN change_type = 'new_sale' THEN 1 ELSE 0 END) as newSales,
          SUM(CASE WHEN change_type != 'new_sale' THEN 1 ELSE 0 END) as statusChanges,
          AVG(CASE WHEN change_type = 'new_sale' AND deal_unit_price > 0 THEN deal_unit_price END) as avgDealPrice
        FROM daily_changes WHERE change_date = ?`,
        [latestDate]
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

// GET /api/changes/trend — 趋势数据
router.get('/trend', async (req, res) => {
  try {
    const { projectId, days = 30 } = req.query;

    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - parseInt(days, 10));
    const trendStart = daysAgo.toISOString().split('T')[0];

    const dailySales = await db.query(
      `SELECT 
        change_date as date,
        COUNT(*) as count,
        AVG(CASE WHEN deal_unit_price > 0 THEN deal_unit_price END) as avgPrice
      FROM daily_changes
      WHERE change_type = 'new_sale'
        AND change_date >= ?
        ${projectId ? 'AND project_id = ?' : ''}
      GROUP BY change_date
      ORDER BY change_date ASC`,
      projectId ? [trendStart, projectId] : [trendStart]
    );

    res.json({
      success: true,
      data: {
        dailySales,
      },
    });
  } catch (err) {
    console.error('趋势查询失败:', err.message);
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

module.exports = router;
