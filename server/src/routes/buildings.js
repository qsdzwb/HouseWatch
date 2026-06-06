const express = require('express');
const router = express.Router();
const db = require('../db/pool');

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

    // 为每套房子查找成交日期和价格
    for (const h of houses) {
      // 1. 优先从 daily_changes 找 new_sale 记录（精确成交日期）
      let saleRecord = await db.queryOne(
        `SELECT change_date, deal_unit_price, deal_total_price, build_area
         FROM daily_changes
         WHERE house_id = ? AND change_type = 'new_sale'
         ORDER BY change_date ASC LIMIT 1`,
        [h.house_id]
      );
      let isExact = false;

      if (saleRecord) {
        isExact = true;
      } else if (h.status !== '可售') {
        // 2. 从 daily_snapshots 找最早的已售状态日期（仅作参考，不显示"成交"）
        saleRecord = await db.queryOne(
          `SELECT snapshot_date as change_date
           FROM daily_snapshots
           WHERE house_id = ? AND status IN ('已签约', '网上联机备案')
           ORDER BY snapshot_date ASC LIMIT 1`,
          [h.house_id]
        );
      }

      if (saleRecord) {
        h.sale_date = saleRecord.change_date;
        h.sale_unit_price = saleRecord.deal_unit_price;
        h.sale_total_price = saleRecord.deal_total_price;
        h.sale_build_area = saleRecord.build_area;
        h.sale_date_exact = isExact ? 1 : 0;  // 1=精确成交日期, 0=近似日期
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
