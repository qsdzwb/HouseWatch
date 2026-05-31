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
