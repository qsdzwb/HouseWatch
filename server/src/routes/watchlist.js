const express = require('express');
const router = express.Router();
const db = require('../db/pool');
const config = require('../config');

// ============================================
// 关注楼盘管理 API
// ============================================

// POST /api/watchlist/seed — 一键初始化：把样本项目加入关注列表
router.post('/seed', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const samples = config.sampleProjects;

    let added = 0;
    for (const p of samples) {
      await db.upsert('projects', {
        project_id: p.projectID,
        name: p.name,
        status: 'active',
        first_seen: today,
      }, 'project_id');

      await db.insert(
        `INSERT INTO watched_projects (project_id, notes, is_active, added_at)
         VALUES (?, '样本项目', 1, ?)
         ON CONFLICT(project_id) DO UPDATE SET is_active = 1, updated_at = datetime('now','localtime')`,
        [p.projectID, today]
      );
      added++;
    }

    res.json({
      success: true,
      message: `已添加 ${added} 个样本项目到关注列表`,
      data: samples.map(p => ({ project_id: p.projectID, name: p.name })),
    });
  } catch (err) {
    console.error('初始化关注列表失败:', err.message);
    res.status(500).json({ success: false, message: '初始化失败' });
  }
});

// GET /api/watchlist — 获取关注列表
router.get('/', async (req, res) => {
  try {
    const { active_only = '1' } = req.query;
    const activeFilter = active_only === '1' ? 'WHERE w.is_active = 1' : '';

    const items = await db.query(`
      SELECT 
        w.id, w.project_id, w.notes, w.is_active, w.added_at,
        p.name, p.district, p.address, p.developer,
        p.last_crawl, p.status as project_status,
        (SELECT COUNT(*) FROM buildings WHERE project_id = w.project_id) as building_count,
        (SELECT COUNT(*) FROM houses h 
         JOIN buildings b ON h.building_id = b.building_id 
         WHERE b.project_id = w.project_id) as total_units,
        (SELECT COUNT(*) FROM houses h 
         JOIN buildings b ON h.building_id = b.building_id 
         WHERE b.project_id = w.project_id AND h.status IN ('已签约','网上联机备案','已办理预售项目抵押')) as sold_units
      FROM watched_projects w
      JOIN projects p ON w.project_id = p.project_id
      ${activeFilter}
      ORDER BY w.added_at DESC, p.name ASC
    `);

    res.json({
      success: true,
      data: {
        items,
        total: items.length,
      },
    });
  } catch (err) {
    console.error('获取关注列表失败:', err.message);
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

// POST /api/watchlist — 添加关注（需提供 project_id 和 name）
router.post('/', async (req, res) => {
  try {
    const { project_id, name, notes, district, address, developer } = req.body;

    if (!project_id || !name) {
      return res.status(400).json({
        success: false,
        message: '请提供 project_id 和项目名称',
      });
    }

    const today = new Date().toISOString().split('T')[0];

    // 1. 确保 projects 表有记录
    await db.upsert('projects', {
      project_id,
      name,
      district: district || null,
      address: address || null,
      developer: developer || null,
      first_seen: today,
      status: 'active',
    }, 'project_id');

    // 2. 添加到关注列表
    await db.insert(
      `INSERT INTO watched_projects (project_id, notes, is_active, added_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(project_id) DO UPDATE SET is_active = 1, notes = COALESCE(?, watched_projects.notes), updated_at = datetime('now','localtime')`,
      [project_id, notes || null, today, notes || null]
    );

    res.json({
      success: true,
      message: '已添加关注',
      data: { project_id, name, added_at: today },
    });
  } catch (err) {
    console.error('添加关注失败:', err.message);
    res.status(500).json({ success: false, message: '添加失败' });
  }
});

// POST /api/watchlist/batch — 批量添加
router.post('/batch', async (req, res) => {
  try {
    const { projects } = req.body;

    if (!Array.isArray(projects) || projects.length === 0) {
      return res.status(400).json({ success: false, message: '请提供项目列表' });
    }

    const today = new Date().toISOString().split('T')[0];
    let added = 0;

    for (const proj of projects) {
      if (!proj.project_id || !proj.name) continue;

      await db.upsert('projects', {
        project_id: proj.project_id,
        name: proj.name,
        district: proj.district || null,
        status: 'active',
        first_seen: today,
      }, 'project_id');

      await db.insert(
        `INSERT INTO watched_projects (project_id, notes, is_active, added_at)
         VALUES (?, ?, 1, ?)
         ON CONFLICT(project_id) DO UPDATE SET is_active = 1, updated_at = datetime('now','localtime')`,
        [proj.project_id, proj.notes || null, today]
      );

      added++;
    }

    res.json({
      success: true,
      message: `已添加 ${added} 个项目`,
      data: { added, total: projects.length },
    });
  } catch (err) {
    console.error('批量添加失败:', err.message);
    res.status(500).json({ success: false, message: '批量添加失败' });
  }
});

// DELETE /api/watchlist/:projectId — 取消关注
router.delete('/:projectId', async (req, res) => {
  try {
    const result = await db.insert(
      'DELETE FROM watched_projects WHERE project_id = ?',
      [req.params.projectId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: '未找到该关注记录' });
    }

    res.json({ success: true, message: '已取消关注' });
  } catch (err) {
    console.error('取消关注失败:', err.message);
    res.status(500).json({ success: false, message: '操作失败' });
  }
});

// PATCH /api/watchlist/:projectId — 更新备注/启用状态
router.patch('/:projectId', async (req, res) => {
  try {
    const { notes, is_active } = req.body;
    const updates = [];
    const params = [];

    if (notes !== undefined) {
      updates.push('notes = ?');
      params.push(notes);
    }
    if (is_active !== undefined) {
      updates.push('is_active = ?');
      params.push(is_active ? 1 : 0);
    }
    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: '无更新内容' });
    }

    updates.push("updated_at = datetime('now','localtime')");
    params.push(req.params.projectId);

    await db.insert(
      `UPDATE watched_projects SET ${updates.join(', ')} WHERE project_id = ?`,
      params
    );

    res.json({ success: true, message: '已更新' });
  } catch (err) {
    console.error('更新关注失败:', err.message);
    res.status(500).json({ success: false, message: '更新失败' });
  }
});

module.exports = router;
