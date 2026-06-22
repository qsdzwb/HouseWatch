const express = require('express');
const router = express.Router();
const db = require('../db/pool');
const { crawlHouseDetail } = require('../crawler/crawlHouseDetail');

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

    // 从 snapshots 推导变化事件（替代 daily_changes）
    const changes = [];
    for (let i = 0; i < snapshots.length - 1; i++) {
      const curr = snapshots[i];
      const prev = snapshots[i + 1];
      if (curr.status !== prev.status) {
        changes.push({
          change_date: curr.snapshot_date,
          change_type: curr.status.includes('签约') || curr.status.includes('备案') ? 'new_sale' : 'status_change',
          old_status: prev.status,
          new_status: curr.status,
          room_no: house.room_no,
        });
      }
    }

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

// GET /api/houses/:id/detail — 获取房源详情（含按需爬取）
router.get('/:id/detail', async (req, res) => {
  try {
    // 1. 从数据库查
    const house = await db.queryOne(
      'SELECT h.*, b.sale_permit_id FROM houses h JOIN buildings b ON h.building_id = b.building_id WHERE h.house_id = ?',
      [req.params.id]
    );

    if (!house) {
      return res.status(404).json({ success: false, message: '房屋不存在' });
    }

    // 2. 判断是否需要爬取：缺少关键详情字段时触发
    const needsCrawl = !house.build_area || !house.purpose || !house.layout;

    if (needsCrawl && house.sale_permit_id) {
      console.log(`[houses/${req.params.id}/detail] 数据不完整，触发按需爬取...`);
      try {
        const rawDetail = await crawlHouseDetail(req.params.id, house.sale_permit_id);

        if (rawDetail && (rawDetail.purpose || rawDetail.layout || rawDetail.buildArea)) {
          // 解析数值字段
          const buildAreaMatch = String(rawDetail.buildArea || '').match(/([\d.]+)/);
          const innerAreaMatch = String(rawDetail.innerArea || '').match(/([\d.]+)/);
          const pricePerSqmMatch = String(rawDetail.pricePerSqM || '').match(/([\d.]+)/);

          db.run(
            `UPDATE houses SET
              purpose = COALESCE(?, purpose),
              layout = COALESCE(?, layout),
              build_area = COALESCE(?, build_area),
              inner_area = COALESCE(?, inner_area),
              list_price_per_sqm = COALESCE(?, list_price_per_sqm),
              updated_at = datetime('now','localtime')
             WHERE house_id = ?`,
            [
              rawDetail.purpose || null,
              rawDetail.layout || null,
              buildAreaMatch ? parseFloat(buildAreaMatch[1]) : null,
              innerAreaMatch ? parseFloat(innerAreaMatch[1]) : null,
              pricePerSqmMatch ? parseFloat(pricePerSqmMatch[1]) : null,
              req.params.id
            ]
          );

          console.log(`[houses/${req.params.id}/detail] 爬取成功并已保存`);
          // 重新查询获取更新后的数据
          const updatedHouse = await db.queryOne('SELECT * FROM houses WHERE house_id = ?', [req.params.id]);
          return res.json({ success: true, data: updatedHouse });
        }
      } catch (crawlErr) {
        console.error(`[houses/${req.params.id}/detail] 爬取失败:`, crawlErr.message);
        // 爬取失败仍返回已有数据
      }
    }

    // 3. 返回数据库中的数据
    res.json({ success: true, data: house });
  } catch (err) {
    console.error('房屋详情查询失败:', err.message);
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

module.exports = router;
