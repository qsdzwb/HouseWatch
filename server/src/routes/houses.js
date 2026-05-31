const express = require('express');
const router = express.Router();
const db = require('../db/pool');

// GET /api/houses/:id/history — 某套房历史状态变化
router.get('/:id/history', async (req, res) => {
  try {
    const house = await db.queryOne(
      'SELECT * FROM houses WHERE house_id = ?',
      [req.params.id]
    );

    if (!house) {
      return res.status(404).json({ success: false, message: '房屋不存在' });
    }

    const snapshots = await db.query(
      `SELECT snapshot_date, status, list_price_per_sqm
       FROM daily_snapshots
       WHERE house_id = ?
       ORDER BY snapshot_date DESC
       LIMIT 90`,
      [req.params.id]
    );

    const changes = await db.query(
      `SELECT * FROM daily_changes
       WHERE house_id = ?
       ORDER BY change_date DESC
       LIMIT 30`,
      [req.params.id]
    );

    res.json({
      success: true,
      data: {
        house,
        snapshots,
        changes,
      },
    });
  } catch (err) {
    console.error('房屋历史查询失败:', err.message);
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

module.exports = router;
