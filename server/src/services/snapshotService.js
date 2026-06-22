const db = require('../db/pool');
const config = require('../config');

/**
 * 快照与差值分析服务
 * 
 * 核心逻辑：
 * 1. 读取昨日快照 (yesterday)
 * 2. 读取今日快照 (today)
 * 3. 逐套对比：统计变化数量
 * 4. 更新 houses.status_changed_date（首次售出日期）
 * 
 * 2026-06-22: 已废弃 daily_changes 表写入，仅做统计 + 状态日期更新
 */
const snapshotService = {
  /**
   * 执行每日差值分析
   * @param {string} date - 当天日期 (YYYY-MM-DD)
   * @returns {number} 发现的变化数
   */
  async analyzeDailyChanges(date) {
    const yesterday = getYesterday(date);

    console.log(`  对比日期: ${yesterday} → ${date}`);

    // 检查今日是否有快照
    const [{ count: todayCount }] = await db.query(
      'SELECT COUNT(*) as count FROM daily_snapshots WHERE snapshot_date = ?',
      [date]
    );

    if (todayCount === 0) {
      console.log('  今日无快照数据，跳过差值分析');
      return 0;
    }

    // 检查昨日是否有快照
    const [{ count: yesterdayCount }] = await db.query(
      'SELECT COUNT(*) as count FROM daily_snapshots WHERE snapshot_date = ?',
      [yesterday]
    );

    if (yesterdayCount === 0) {
      console.log(`  昨日(${yesterday})无快照数据，跳过差值分析（可能是首次运行）`);
      return 0;
    }

    // 核心查询：对比昨日和今日的状态变化
    const changes = await db.query(
      `SELECT 
        y.house_id,
        y.status as old_status,
        t.status as new_status,
        y.list_price_per_sqm as old_price,
        t.list_price_per_sqm as new_price,
        h.room_no,
        h.building_id,
        b.project_id,
        h.build_area,
        h.list_price_per_sqm as current_price
      FROM daily_snapshots y
      JOIN daily_snapshots t ON y.house_id = t.house_id
      JOIN houses h ON y.house_id = h.house_id
      JOIN buildings b ON h.building_id = b.building_id
      WHERE y.snapshot_date = ?
        AND t.snapshot_date = ?
        AND y.status != t.status`,
      [yesterday, date]
    );

    console.log(`  发现 ${changes.length} 条状态变化`);

    // 统计变化（不写入 daily_changes）
    let newSaleCount = 0;
    let statusChangeCount = 0;

    for (const change of changes) {
      const changeType = classifyChange(change.old_status, change.new_status);
      if (!changeType) continue;

      if (changeType === 'new_sale') {
        newSaleCount++;

        // 更新首次售出日期（保留有用信息）
        try {
          await db.insert(
            `UPDATE houses SET status_changed_date = ? 
             WHERE house_id = ? AND status_changed_date IS NULL`,
            [date, change.house_id]
          );
        } catch (err) {
          // 忽略
        }
      } else {
        statusChangeCount++;
      }
    }

    console.log(`  新售出: ${newSaleCount} | 状态变更: ${statusChangeCount}`);
    return newSaleCount + statusChangeCount;
  },

  /**
   * 获取最新快照日期
   */
  async getLatestSnapshotDate() {
    const row = await db.queryOne(
      'SELECT MAX(snapshot_date) as latest FROM daily_snapshots'
    );
    return row?.latest || null;
  },
};

/**
 * 判断变化类型
 */
function classifyChange(oldStatus, newStatus) {
  const soldStatuses = ['已签约', '网上联机备案', '已办理预售项目抵押'];

  // 从可售/已预订 → 已售出
  if (
    ['可售', '已预订', '资格核验中'].includes(oldStatus) &&
    soldStatuses.includes(newStatus)
  ) {
    return 'new_sale';
  }

  // 从可售 → 已预订（预订不算售出，但是状态变化）
  if (oldStatus === '可售' && newStatus === '已预订') {
    return 'status_change';
  }

  // 已预订 → 资格核验中
  if (oldStatus !== newStatus && !soldStatuses.includes(oldStatus) && !soldStatuses.includes(newStatus)) {
    return 'status_change';
  }

  return null; // 忽略（如已签约→备案这种纯状态流转）
}

/**
 * 获取昨天的日期
 */
function getYesterday(dateStr) {
  const date = new Date(dateStr);
  date.setDate(date.getDate() - 1);
  return date.toISOString().split('T')[0];
}

module.exports = snapshotService;
