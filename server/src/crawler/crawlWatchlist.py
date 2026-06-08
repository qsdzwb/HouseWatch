#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
关注楼盘优先更新 v8 — 使用 crawler_common 公共模块

新增:
- 成交价反推逻辑：利用项目级日均价差值，反推每套房成交单价
- deal_unit_price / is_estimated 字段写入 daily_changes
"""

import sys, os, sqlite3, datetime, urllib.parse, re, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import crawler_common as common

DB = '/user/local/service/house/data/bj_realestate.db'

# 昌平区 2026 年活跃楼盘
CHANGPING_2026 = [
    ('8203707', '樾序海苑', '昌平区-2026-05-10'),
    ('8161845', '誉淙家园', '昌平区-2026-02-05'),
    ('8158008', '星洵家园', '昌平区-2026-01-28'),
    ('8106368', '星洵家园', '昌平区-2025-09-27'),
]


# ─── 关注列表初始化 ───

def setup_watchlist(conn):
    cur = conn.cursor()
    now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    for pid, name, notes in CHANGPING_2026:
        cur.execute(
            "INSERT OR IGNORE INTO projects (project_id, name, status) VALUES (?, ?, 'active')",
            (pid, name)
        )
        cur.execute(
            "INSERT OR IGNORE INTO watched_projects (project_id, notes, is_active, added_at) VALUES (?, ?, 1, ?)",
            (pid, notes, now)
        )
    conn.commit()

    cur.execute("SELECT project_id FROM watched_projects WHERE is_active=1")
    watched = [row[0] for row in cur.fetchall()]
    print("  活跃关注项目数: {0}".format(len(watched)))
    return watched


# ─── 主流程 ───

def main():
    print("=" * 60)
    print("关注楼盘优先更新 v8 (使用 crawler_common，含成交价反推)")
    print("time: {0}".format(datetime.datetime.now().isoformat()))
    print("=" * 60)

    conn = sqlite3.connect(DB)
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 60000")

    # 建表 + 补字段
    common.ensure_schema(conn, include_daily_changes=True)

    # Step 1: 关注列表
    print("\n[Step 1] 设置关注列表...")
    watched_ids = setup_watchlist(conn)

    cur = conn.cursor()
    placeholders = ','.join('?' * len(watched_ids))
    cur.execute(
        "SELECT project_id, name FROM projects WHERE project_id IN ({0})".format(placeholders),
        watched_ids
    )
    projects = {row[0]: row[1] for row in cur.fetchall()}

    today_str = datetime.datetime.now().strftime('%Y-%m-%d')

    # Step 2: 爬取每个楼盘
    total_houses = 0
    total_buildings = 0

    for idx, pid in enumerate(watched_ids):
        name = projects.get(pid, pid)
        print("\n{0}".format('=' * 40))
        print("[{0}/{1}] {2} - {3}".format(idx+1, len(watched_ids), pid, name))

        # 从详情页获取楼栋列表 + 项目汇总
        buildings, summary = common.parse_detail_page(pid)
        print("  楼栋: {0} 个".format(len(buildings)))

        # 保存项目成交数据到 project_daily_stats
        if summary:
            print("  项目汇总: 已签{0}套, 面积{1}㎡, 均价¥{2:,.0f}/㎡".format(
                summary['signed_count'], summary['signed_area'], summary['avg_price']))
            cur.execute("""
                UPDATE projects
                SET signed_count=?, signed_area=?, avg_price=?, updated_at=datetime('now','localtime')
                WHERE project_id=?
            """, (summary['signed_count'], summary['signed_area'], summary['avg_price'], pid))

            cur.execute("""
                INSERT INTO project_daily_stats (project_id, stat_date, signed_count, signed_area, avg_price)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(project_id, stat_date) DO UPDATE SET
                    signed_count=excluded.signed_count,
                    signed_area=excluded.signed_area,
                    avg_price=excluded.avg_price
            """, (pid, today_str, summary['signed_count'], summary['signed_area'], summary['avg_price']))
            print("  ✅ 已保存项目日统计到 project_daily_stats")

        else:
            cur.execute("UPDATE projects SET avg_price=0, updated_at=datetime('now','localtime') WHERE project_id=?", (pid,))
            print("  ⚠️ 无住宅数据，均价设为 0")

        for bs in buildings:
            bid = bs['building_id']
            bname = bs['building_name']
            sid = bs['sale_permit_id']
            total_units = bs['total_units']

            if re.search(r'(地下车库|车库|车位|库房|戊类|储藏)', bname):
                print("  [{0}] 非住宅楼栋，跳过".format(bname))
                continue

            if not sid:
                print("  [{0}] 无 salePermitId，跳过".format(bname))
                continue

            houses = common.get_unit_table(sid, bid)

            if not houses:
                print("  [{0}] 非住宅楼栋，跳过".format(bname))
                continue

            # 是住宅楼栋，保存楼栋信息
            cur.execute("""INSERT OR REPLACE INTO buildings
                (project_id, building_id, building_name, sale_permit_id,
                 total_units, updated_at)
                VALUES (?, ?, ?, ?, ?, datetime('now','localtime'))
            """, (pid, bid, bname, sid, total_units))

            total_buildings += 1
            total_houses += len(houses)
            status_summary = {}
            for h in houses:
                status_summary[h['status']] = status_summary.get(h['status'], 0) + 1

            status_str = ', '.join(["{0}:{1}".format(s, c) for s, c in status_summary.items()])
            print("  [{0}] {1}套 (批准销售{2}套) [{3}]".format(
                bname, len(houses), total_units, status_str))

            for h in houses:
                cur.execute("""INSERT OR REPLACE INTO houses
                    (building_id, house_id, room_no, status, updated_at)
                    VALUES (?, ?, ?, ?, datetime('now','localtime'))
                """, (bid, h['house_id'], h['room_no'], h['status']))

            conn.commit()
            time.sleep(3)

        cur.execute("UPDATE watched_projects SET updated_at=datetime('now','localtime') WHERE project_id=?", (pid,))
        conn.commit()
        time.sleep(5)

    # Step 3: 生成每日快照（仅关注项目）
    print("\n[Step 3] 生成今日快照 ({0})...".format(today_str))
    placeholders = ','.join('?' * len(watched_ids))
    common.generate_snapshots(
        conn, today_str,
        project_filter_sql="b.project_id IN ({0})".format(placeholders),
        project_filter_params=watched_ids
    )

    # Step 4: 对比变化（含成交价反推）
    print("\n[Step 4] 对比日变更（含成交价反推）...")
    change_count = common.compare_and_generate_changes(conn, today_str, calc_price=True)

    conn.close()

    # 最终报告
    print("\n{0}".format('=' * 60))
    print("完成!")
    print("楼盘: {0} | 楼栋: {1} | 房屋: {2}".format(len(watched_ids), total_buildings, total_houses))
    print("今日变更: {0} 套".format(change_count))
    print("time: {0}".format(datetime.datetime.now().isoformat()))

    # 验证
    conn2 = sqlite3.connect(DB)
    b = conn2.execute("SELECT COUNT(*) FROM buildings").fetchone()[0]
    h = conn2.execute("SELECT COUNT(*) FROM houses").fetchone()[0]
    s = conn2.execute("SELECT COUNT(*) FROM daily_snapshots WHERE snapshot_date=?", (today_str,)).fetchone()[0]
    c = conn2.execute("SELECT COUNT(*) FROM daily_changes WHERE change_date=?", (today_str,)).fetchone()[0]
    dc = conn2.execute("SELECT COUNT(*) FROM daily_changes WHERE change_date=? AND deal_unit_price IS NOT NULL", (today_str,)).fetchone()[0]
    print("[验证] buildings:{0} houses:{1} snapshots:{2} changes:{3} (有成交价:{4})".format(b, h, s, c, dc))
    for pid, name, _ in CHANGPING_2026:
        row = conn2.execute("SELECT signed_count, signed_area, avg_price FROM projects WHERE project_id=?", (pid,)).fetchone()
        if row and row[0]:
            print("  [{0}] 已签{1}套 面积{2:.2f}㎡ 均价¥{3:,.0f}/㎡".format(name, int(row[0]), row[1], row[2]))
    conn2.close()

    print("=" * 60)


if __name__ == '__main__':
    main()
