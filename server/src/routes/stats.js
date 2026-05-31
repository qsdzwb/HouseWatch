const express = require('express');
const router = express.Router();
const db = require('../db/pool');

// GET /api/stats/dashboard — 首页仪表盘数据
router.get('/dashboard', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // 今日新售出
    const todaySales = await db.query(
      `SELECT COUNT(*) as count, AVG(deal_unit_price) as avgPrice
       FROM daily_changes
       WHERE change_date = ? AND change_type = 'new_sale'`,
      [today]
    );

    // 项目总数
    const [{ projectCount }] = await db.query(
      'SELECT COUNT(*) as projectCount FROM projects WHERE status = "active"'
    );

    // 监控房屋总数
    const [{ houseCount }] = await db.query('SELECT COUNT(*) as houseCount FROM houses');

    // 可售房屋数
    const [{ availableCount }] = await db.query(
      "SELECT COUNT(*) as availableCount FROM houses WHERE status = '可售'"
    );

    // 已售房屋数
    const [{ soldCount }] = await db.query(
      "SELECT COUNT(*) as soldCount FROM houses WHERE status IN ('已签约','网上联机备案')"
    );

    // 整体去化率
    const overallRate = houseCount > 0
      ? (soldCount / houseCount * 100).toFixed(1)
      : '0.0';

    // 近7天日销售趋势
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const weekStart = sevenDaysAgo.toISOString().split('T')[0];

    const weeklyTrend = await db.query(
      `SELECT change_date as date, COUNT(*) as count
       FROM daily_changes
       WHERE change_type = 'new_sale'
         AND change_date >= ?
       GROUP BY change_date
       ORDER BY change_date ASC`,
      [weekStart]
    );

    // 近7天均价
    const weeklyPrice = await db.query(
      `SELECT change_date as date, AVG(deal_unit_price) as avgPrice
       FROM daily_changes
       WHERE change_type = 'new_sale'
         AND change_date >= ?
       GROUP BY change_date
       ORDER BY change_date ASC`,
      [weekStart]
    );

    // 最新5条变化
    const latestChanges = await db.query(
      `SELECT dc.*, p.name as project_name, b.building_name
       FROM daily_changes dc
       JOIN projects p ON dc.project_id = p.project_id
       JOIN buildings b ON dc.building_id = b.building_id
       ORDER BY dc.change_date DESC, dc.id DESC
       LIMIT 10`
    );

    // 最后一次爬取时间
    const lastCrawl = await db.queryOne(
      `SELECT crawl_date, created_at, phase, status
       FROM crawl_logs
       ORDER BY created_at DESC
       LIMIT 1`
    );

    res.json({
      success: true,
      data: {
        today: {
          newSales: todaySales[0]?.count || 0,
          avgDealPrice: todaySales[0]?.avgPrice
            ? Math.round(todaySales[0].avgPrice)
            : 0,
        },
        overview: {
          totalProjects: projectCount,
          totalHouses: houseCount,
          availableHouses: availableCount,
          soldHouses: soldCount,
          soldRate: `${overallRate}%`,
        },
        weeklyTrend: {
          dates: weeklyTrend.map(r => r.date),
          counts: weeklyTrend.map(r => r.count),
          prices: weeklyPrice.map(r => Math.round(r.avgPrice || 0)),
        },
        latestChanges,
        lastCrawl,
      },
    });
  } catch (err) {
    console.error('仪表盘查询失败:', err.message);
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

module.exports = router;
