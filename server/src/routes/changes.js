const express = require('express');
const router = express.Router();
const db = require('../db/pool');

// GET /api/changes/daily — 日变化列表
router.get('/daily', async (req, res) => {
  try {
    const { date, projectId, type, page = 1, limit = 50 } = req.query;

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

    if (type) {
      sql += ' AND dc.change_type = ?';
      params.push(type);
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

    const changes = await db.query(sql, params);

    // 汇总统计
    let summary = { newSales: 0, statusChanges: 0, total: total };

    if (date) {
      const statResult = await db.queryOne(
        `SELECT 
          SUM(CASE WHEN change_type = 'new_sale' THEN 1 ELSE 0 END) as newSales,
          SUM(CASE WHEN change_type = 'status_change' THEN 1 ELSE 0 END) as statusChanges
        FROM daily_changes WHERE change_date = ?`,
        [date]
      );
      summary = { ...summary, ...statResult };
    }

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
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

// GET /api/changes/trend — 趋势数据
router.get('/trend', async (req, res) => {
  try {
    const { projectId, days = 30, district } = req.query;

    let projectFilter = '';
    const params = [parseInt(days, 10)];

    if (projectId) {
      projectFilter = 'WHERE project_id = ?';
      params.push(projectId);
    }

    // 每日销售数量趋势
    const daysAgoDate = new Date();
    daysAgoDate.setDate(daysAgoDate.getDate() - parseInt(days, 10));
    const trendStart = daysAgoDate.toISOString().split('T')[0];

    const dailySales = await db.query(
      `SELECT 
        change_date as date,
        COUNT(*) as count,
        AVG(deal_unit_price) as avgPrice,
        AVG(build_area) as avgArea
      FROM daily_changes
      ${projectFilter ? `WHERE project_id = ?` : ''}
        AND change_type = 'new_sale'
        AND change_date >= ?
      GROUP BY change_date
      ORDER BY change_date ASC`,
      projectFilter ? [projectId, trendStart] : [trendStart]
    );

    // 各区域统计
    let districtStats = [];
    if (!projectId) {
      districtStats = await db.query(
        `SELECT 
          p.district,
          COUNT(*) as totalSales,
          AVG(dc.deal_unit_price) as avgPrice
        FROM daily_changes dc
        JOIN projects p ON dc.project_id = p.project_id
        WHERE dc.change_type = 'new_sale'
          AND dc.change_date >= ?
        GROUP BY p.district
        ORDER BY totalSales DESC`,
        [trendStart]
      );
    }

    res.json({
      success: true,
      data: {
        dailySales,
        districtStats,
      },
    });
  } catch (err) {
    console.error('趋势查询失败:', err.message);
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

module.exports = router;
