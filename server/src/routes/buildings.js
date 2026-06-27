const express = require('express');
const router = express.Router();
const db = require('../db/pool');

// 获取前一天日期 (YYYY-MM-DD)
function getPreviousDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00+08:00');
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

// GET /api/buildings/:id/houses — 某楼栋所有房屋状态
router.get('/:id/houses', async (req, res) => {
  try {
    const building = await db.queryOne(
      'SELECT * FROM buildings WHERE building_id = ?',
      [req.params.id]
    );

    if (!building) {
      return res.status(404).json({ success: false, message: '楼栋不存在' });
    }

    const houses = await db.query(
      `SELECT h.*, 
        CASE 
          WHEN h.status = '可售' THEN '#33CC00'
          WHEN h.status = '已签约' THEN '#FF0000'
          WHEN h.status = '已预订' THEN '#FFCC99'
          WHEN h.status = '网上联机备案' THEN '#D2691E'
          WHEN h.status = '已办理预售项目抵押' THEN '#FFFF00'
          WHEN h.status = '资格核验中' THEN '#00FFFF'
          WHEN h.status = '不可售' THEN '#CCCCCC'
          ELSE '#CCCCCC'
        END as color
      FROM houses h
      WHERE h.building_id = ?
      ORDER BY h.room_no`,
      [req.params.id]
    );

    // === 第一步：为每套已售房子查找成交日期 ===
    const saleDates = new Set();
    for (const h of houses) {
      if (h.status !== '可售') {
        const saleRecord = await db.queryOne(
          `SELECT snapshot_date as change_date
           FROM daily_snapshots
           WHERE house_id = ? AND status IN ('已签约', '网上联机备案')
           ORDER BY snapshot_date ASC LIMIT 1`,
          [h.house_id]
        );
        if (saleRecord) {
          h.sale_date = saleRecord.change_date;
          h.sale_date_exact = 1;
          saleDates.add(h.sale_date);
        }
      }
    }

    // === 第二步：用 project_daily_stats 推导每个成交日的房屋均价 ===
    // 公式：当天新房均价 = (当天累计总价 - 前一天累计总价) / (当天签约数 - 前一天签约数)
    // 其中累计总价 = signed_count × avg_price
    const datePrices = {};  // date → derived_avg_price
    if (saleDates.size > 0) {
      const sortedDates = [...saleDates].sort();
      // 需要查每一天 + 前一天的数据
      const allDatesNeeded = new Set(saleDates);
      for (const d of saleDates) {
        const prev = getPreviousDate(d);
        if (prev) allDatesNeeded.add(prev);
      }

      // 批量查询 project_daily_stats
      const placeholders = [...allDatesNeeded].map(() => '?').join(',');
      const statsRows = await db.query(
        `SELECT stat_date, signed_count, avg_price
         FROM project_daily_stats
         WHERE project_id = ? AND stat_date IN (${placeholders})
         ORDER BY stat_date`,
        [building.project_id, ...allDatesNeeded]
      );
      const statsMap = {};
      statsRows.forEach(r => { statsMap[r.stat_date] = r; });

      // 推导每个成交日的均价
      for (const d of sortedDates) {
        const today = statsMap[d];
        const prev = getPreviousDate(d);
        const yesterday = prev ? statsMap[prev] : null;

        if (today && yesterday && today.signed_count > yesterday.signed_count) {
          const todayTotal = today.signed_count * today.avg_price;
          const yesterdayTotal = yesterday.signed_count * yesterday.avg_price;
          const newCount = today.signed_count - yesterday.signed_count;
          const newTotal = todayTotal - yesterdayTotal;
          if (newCount > 0 && newTotal > 0) {
            datePrices[d] = Math.round(newTotal / newCount);
          }
        }
      }
    }

    // === 第三步：分配成交价格 ===
    for (const h of houses) {
      if (h.sale_date && datePrices[h.sale_date]) {
        h.sale_unit_price = datePrices[h.sale_date];
      }
    }

    const statusStats = {};
    houses.forEach(h => {
      statusStats[h.status] = (statusStats[h.status] || 0) + 1;
    });

    res.json({
      success: true,
      data: {
        building,
        houses,
        stats: {
          total: houses.length,
          statusBreakdown: statusStats,
          availableCount: statusStats['可售'] || 0,
          soldCount: (statusStats['已签约'] || 0) + (statusStats['网上联机备案'] || 0),
        },
      },
    });
  } catch (err) {
    console.error('楼栋房屋查询失败:', err.message);
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

module.exports = router;
