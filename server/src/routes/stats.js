const express = require('express');
const router = express.Router();
const db = require('../db/pool');

// GET /api/stats/dashboard — 首页仪表盘数据
// 优先从 project_daily_stats 表获取趋势数据（daily_changes 为空时的 fallback）
router.get('/dashboard', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // ─── 项目总数 / 房源概况（不依赖 daily_changes） ───
    const [{ projectCount }] = await db.query(
      "SELECT COUNT(*) as projectCount FROM projects WHERE status = 'active'"
    );
    const [{ houseCount }] = await db.query('SELECT COUNT(*) as houseCount FROM houses');
    const [{ availableCount }] = await db.query(
      "SELECT COUNT(*) as availableCount FROM houses WHERE status = '可售'"
    );
    const [{ soldCount }] = await db.query(
      "SELECT COUNT(*) as soldCount FROM houses WHERE status IN ('已签约','网上联机备案')"
    );
    const overallRate = houseCount > 0
      ? (soldCount / houseCount * 100).toFixed(1)
      : '0.0';

    // ─── 今日成交 / 均价：优先从 project_daily_stats 计算日增量 ───
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const todayStats = await db.query(
      `SELECT stat_date, SUM(signed_count) as signed_count,
              CASE WHEN SUM(signed_count)>0 THEN SUM(signed_count*avg_price)/SUM(signed_count) ELSE 0 END as avg_price
       FROM project_daily_stats WHERE stat_date=? GROUP BY stat_date`,
      [today]
    );
    const prevStats = await db.query(
      `SELECT stat_date, SUM(signed_count) as signed_count FROM project_daily_stats WHERE stat_date=? GROUP BY stat_date`,
      [yesterdayStr]
    );

    let todayNewSales = 0;
    let todayAvgPrice = 0;
    if (todayStats.length > 0) {
      todayAvgPrice = Math.round(todayStats[0].avg_price || 0);
      if (prevStats.length > 0) {
        todayNewSales = Math.max(0, (todayStats[0].signed_count || 0) - (prevStats[0].signed_count || 0));
      }
    }

    // fallback：尝试 daily_changes（房屋级变化记录）
    if (todayNewSales === 0) {
      const todaySales = await db.query(
        `SELECT COUNT(*) as count, AVG(deal_unit_price) as avgPrice
         FROM daily_changes WHERE change_date = ? AND change_type = 'new_sale'`,
        [today]
      );
      if (todaySales[0]?.count > 0) {
        todayNewSales = todaySales[0].count;
        todayAvgPrice = todaySales[0].avgPrice ? Math.round(todaySales[0].avgPrice) : 0;
      }
    }

    // ─── 近7天趋势：优先 project_daily_stats ───
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const weekStart = sevenDaysAgo.toISOString().split('T')[0];

    // 从 project_daily_stats 获取近7天每日累计已售
    const pds7d = await db.query(
      `SELECT stat_date as date, SUM(signed_count) as signed_count,
              CASE WHEN SUM(signed_count)>0 THEN SUM(signed_count*avg_price)/SUM(signed_count) ELSE 0 END as avg_price
       FROM project_daily_stats WHERE stat_date >= ? GROUP BY stat_date ORDER BY stat_date ASC`,
      [weekStart]
    );

    let weeklyTrend = [];
    let weeklyPrice = [];

    if (pds7d.length > 0) {
      let prevCount = null;
      for (const row of pds7d) {
        let dailyNew = 0;
        if (prevCount !== null) {
          dailyNew = Math.max(0, (row.signed_count || 0) - prevCount);
        }
        weeklyTrend.push({ date: row.date, count: dailyNew });
        weeklyPrice.push({ date: row.date, avgPrice: row.avg_price || 0 });
        prevCount = row.signed_count || 0;
      }
      // 去掉开头 count=0 的日期
      while (weeklyTrend.length > 0 && weeklyTrend[0].count === 0) {
        weeklyTrend.shift();
        weeklyPrice.shift();
      }
    }

    // fallback：daily_changes
    if (weeklyTrend.length === 0) {
      weeklyTrend = await db.query(
        `SELECT change_date as date, COUNT(*) as count FROM daily_changes
         WHERE change_type='new_sale' AND change_date >= ? GROUP BY change_date ORDER BY change_date ASC`,
        [weekStart]
      );
      weeklyPrice = await db.query(
        `SELECT change_date as date, AVG(deal_unit_price) as avgPrice FROM daily_changes
         WHERE change_type='new_sale' AND change_date >= ? GROUP BY change_date ORDER BY change_date ASC`,
        [weekStart]
      );
    }

    // ─── 价格趋势简报 ───
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const monthStart = thirtyDaysAgo.toISOString().split('T')[0];

    // 从 project_daily_stats 获取均价
    const price7dRowPds = await db.queryOne(
      `SELECT CASE WHEN SUM(signed_count)>0 THEN SUM(signed_count*avg_price)/SUM(signed_count) ELSE 0 END as avgPrice
       FROM project_daily_stats WHERE stat_date >= ?`,
      [weekStart]
    );
    const price30dRowPds = await db.queryOne(
      `SELECT CASE WHEN SUM(signed_count)>0 THEN SUM(signed_count*avg_price)/SUM(signed_count) ELSE 0 END as avgPrice
       FROM project_daily_stats WHERE stat_date >= ?`,
      [monthStart]
    );
    const price7dBeforeRowPds = await db.queryOne(
      `SELECT CASE WHEN SUM(signed_count)>0 THEN SUM(signed_count*avg_price)/SUM(signed_count) ELSE 0 END as avgPrice
       FROM project_daily_stats WHERE stat_date >= ? AND stat_date < ?`,
      [(function(){const d=new Date();d.setDate(d.getDate()-14);return d.toISOString().split('T')[0];})(),
       (function(){const d=new Date();d.setDate(d.getDate()-7);return d.toISOString().split('T')[0];})()]
    );

    let price7d = price7dRowPds?.avgPrice ? Math.round(price7dRowPds.avgPrice) : null;
    let price30d = price30dRowPds?.avgPrice ? Math.round(price30dRowPds.avgPrice) : null;
    let price7dBefore = price7dBeforeRowPds?.avgPrice ? Math.round(price7dBeforeRowPds.avgPrice) : null;

    // fallback：daily_changes
    if (!price7d) {
      const r = await db.queryOne(`SELECT AVG(deal_unit_price) as avgPrice FROM daily_changes WHERE change_type='new_sale' AND change_date >= ?`, [weekStart]);
      price7d = r?.avgPrice ? Math.round(r.avgPrice) : null;
    }
    if (!price30d) {
      const r = await db.queryOne(`SELECT AVG(deal_unit_price) as avgPrice FROM daily_changes WHERE change_type='new_sale' AND change_date >= ?`, [monthStart]);
      price30d = r?.avgPrice ? Math.round(r.avgPrice) : null;
    }
    if (!price7dBefore) {
      const d = new Date(); d.setDate(d.getDate()-14);
      const ps = d.toISOString().split('T')[0]; d.setDate(d.getDate()+7);
      const pe = d.toISOString().split('T')[0];
      const r = await db.queryOne(`SELECT AVG(deal_unit_price) as avgPrice FROM daily_changes WHERE change_type='new_sale' AND change_date >= ? AND change_date < ?`, [ps, pe]);
      price7dBefore = r?.avgPrice ? Math.round(r.avgPrice) : null;
    }

    let trend = 'flat';
    let trendText = '近7天均价平稳';
    let trendValue = 0;
    if (price7d && price7dBefore && price7dBefore > 0) {
      trendValue = Math.round((price7d - price7dBefore) / price7dBefore * 10000) / 100;
      if (trendValue > 1) { trend = 'up'; trendText = `近7天均价上涨${trendValue}%`; }
      else if (trendValue < -1) { trend = 'down'; trendText = `近7天均价下降${Math.abs(trendValue)}%`; }
      else { trendText = '近7天均价平稳'; }
    } else if (price7d && price30d && price30d > 0) {
      trendValue = Math.round((price7d - price30d) / price30d * 10000) / 100;
      if (trendValue > 1) { trend = 'up'; trendText = `近7天均价较近30天上涨${trendValue}%`; }
      else if (trendValue < -1) { trend = 'down'; trendText = `近7天均价较近30天下降${Math.abs(trendValue)}%`; }
      else { trendText = '近7天均价平稳'; }
    }

    // 热盘：从 project_daily_stats 近7天日增量计算
    const hotProjectsPds = await db.query(
      `SELECT p.project_id, p.name as project_name,
              SUM(CASE WHEN s1.signed_count IS NOT NULL AND s2.signed_count IS NOT NULL
                       THEN s1.signed_count - s2.signed_count ELSE 0 END) as salesCount,
              ROUND(AVG(s1.avg_price)) as avgPrice
       FROM project_daily_stats s1
       JOIN projects p ON s1.project_id = p.project_id
       LEFT JOIN project_daily_stats s2 ON s1.project_id = s2.project_id
         AND s2.stat_date = date(s1.stat_date, '-1 day')
       WHERE s1.stat_date >= ?
       GROUP BY s1.project_id
       HAVING salesCount > 0
       ORDER BY salesCount DESC
       LIMIT 3`,
      [weekStart]
    );

    let hotProjects = hotProjectsPds;
    if (hotProjects.length === 0) {
      hotProjects = await db.query(
        `SELECT p.project_id, p.name as project_name, COUNT(*) as salesCount,
                ROUND(AVG(dc.deal_unit_price)) as avgPrice
         FROM daily_changes dc
         JOIN projects p ON dc.project_id = p.project_id
         WHERE dc.change_type = 'new_sale' AND dc.change_date >= ?
         GROUP BY dc.project_id
         ORDER BY salesCount DESC
         LIMIT 3`,
        [weekStart]
      );
    }

    let summary = '暂无足够成交数据生成趋势简报';
    if (price7d && hotProjects.length) {
      const topProject = hotProjects[0];
      if (trend === 'up') {
        summary = `近期均价呈上涨趋势，建议关注${topProject.project_name}等热盘，成交活跃`;
      } else if (trend === 'down') {
        summary = `近期均价有所回落，当前是关注的窗口期，${topProject.project_name}近期有成交`;
      } else {
        summary = `均价走势平稳，${topProject.project_name}近期成交较活跃，可重点关注`;
      }
    } else if (price7d) {
      summary = `近7天成交均价约${(price7d / 10000).toFixed(1)}万/㎡，走势平稳`;
    }

    const priceBrief = {
      trend: trend,
      trendText: trendText,
      trendValue: trendValue,
      avgPrice7d: price7d,
      avgPrice30d: price30d,
      hotProjects: hotProjects,
      summary: summary
    };

    // ─── 最新变化（房屋级）───
    const latestChanges = await db.query(
      `SELECT dc.*, p.name as project_name, b.building_name
       FROM daily_changes dc
       JOIN projects p ON dc.project_id = p.project_id
       JOIN buildings b ON dc.building_id = b.building_id
       ORDER BY dc.change_date DESC, dc.id DESC
       LIMIT 10`
    );

    // ─── 最后更新时间：优先 project_daily_stats 最大日期 ───
    const latestPdsDate = await db.queryOne(
      `SELECT MAX(stat_date) as latest_date FROM project_daily_stats`
    );
    const latestChangeDate = await db.queryOne(
      `SELECT MAX(change_date) as latest_date FROM daily_changes`
    );
    const lastCrawlLog = await db.queryOne(
      `SELECT crawl_date, created_at FROM crawl_logs ORDER BY created_at DESC LIMIT 1`
    );

    let lastCrawlDate = '';
    const dates = [
      latestPdsDate?.latest_date,
      latestChangeDate?.latest_date,
      lastCrawlLog?.crawl_date,
      lastCrawlLog?.created_at?.split(' ')[0]
    ].filter(Boolean);
    if (dates.length > 0) {
      lastCrawlDate = dates.sort().reverse()[0];
    }

    const lastCrawl = {
      crawl_date: lastCrawlDate,
      created_at: lastCrawlDate,
      phase: 'crawl',
      status: 'success'
    };

    res.json({
      success: true,
      data: {
        today: {
          newSales: todayNewSales,
          avgDealPrice: todayAvgPrice,
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
        priceBrief,
      },
    });
  } catch (err) {
    console.error('仪表盘查询失败:', err.message);
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

module.exports = router;
