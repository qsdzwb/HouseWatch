#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
全量活跃楼盘数据更新 v2

使用 crawler_common 公共模块。
功能:
- [Step 0] 动态更新 projects.status（有可售房源=active，无=inactive）
- [Step 1] 从 projects 表获取所有 status='active' 的项目
- [Step 2] 爬取每个项目的详情页：楼栋列表 + 项目汇总数据
- [Step 3] 爬取每个楼栋的楼盘表：房屋状态
- [Step 4] 生成所有活跃项目的快照（daily_snapshots）
- [Step 5] 对比快照，生成变化记录（daily_changes），含成交价反推

活跃定义：有可售房源的项目（动态更新，无需手动维护）
"""

import sys, os, re, time, random, datetime, sqlite3

# 添加当前目录到 sys.path，以便 import crawler_common
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import crawler_common as common

DB = '/user/local/service/house/data/bj_realestate.db'
PROJECT_DELAY = common.PROJECT_DELAY
BUILDING_DELAY = common.BUILDING_DELAY


# ─── 动态更新项目活跃状态 ───

def update_project_status(conn):
    """
    根据是否有可售房源，动态更新 projects.status 字段。
    有可售房源 -> active，没有 -> inactive。
    同时保留首次爬取的新项目（houses 表无记录时，保留原 status）。
    """
    cur = conn.cursor()

    # 1. 将所有有可售房源的项目设为 active
    #    houses 表需要通过 buildings 表关联 project_id
    cur.execute("""
        UPDATE projects
        SET status='active', updated_at=datetime('now','localtime')
        WHERE project_id IN (
            SELECT DISTINCT b.project_id
            FROM houses h
            JOIN buildings b ON h.building_id = b.building_id
            WHERE h.status='可售'
        )
    """)
    activated = cur.rowcount

    # 2. 将没有可售房源的项目设为 inactive
    cur.execute("""
        UPDATE projects
        SET status='inactive', updated_at=datetime('now','localtime')
        WHERE project_id NOT IN (
            SELECT DISTINCT b.project_id
            FROM houses h
            JOIN buildings b ON h.building_id = b.building_id
            WHERE h.status='可售'
        )
        AND project_id IN (
            SELECT DISTINCT b.project_id
            FROM houses h
            JOIN buildings b ON h.building_id = b.building_id
        )
    """)
    deactivated = cur.rowcount

    conn.commit()
    print("  激活 {0} 个项目，停用 {1} 个项目".format(activated, deactivated))


# ─── 获取所有活跃项目 ───

def get_all_active_projects(conn):
    cur = conn.cursor()
    cur.execute("SELECT project_id, name FROM projects WHERE status='active' ORDER BY district, name")
    rows = cur.fetchall()
    print("  活跃项目数: {0}".format(len(rows)))
    return [{'project_id': r[0], 'name': r[1]} for r in rows]


# ─── 主流程 ───

def main():
    print("=" * 60)
    print("全量活跃楼盘数据更新 v2 (使用 crawler_common)")
    print("time: {0}".format(datetime.datetime.now().isoformat()))
    print("=" * 60)

    conn = sqlite3.connect(DB)
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 60000")

    # 建表 + 补字段
    common.ensure_schema(conn, include_daily_changes=True)

    # Step 0: 动态更新项目活跃状态（基于上次爬取的数据）
    print("\n[Step 0] 动态更新项目活跃状态...")
    update_project_status(conn)

    # Step 1: 获取所有活跃项目
    print("\n[Step 1] 获取所有活跃项目...")
    projects = get_all_active_projects(conn)

    today_str = datetime.datetime.now().strftime('%Y-%m-%d')
    cur = conn.cursor()

    # Step 2: 爬取每个楼盘
    total_houses = 0
    total_buildings = 0
    print("\n[Step 2] 爬取 {0} 个活跃项目...".format(len(projects)))

    for idx, proj in enumerate(projects):
        pid = proj['project_id']
        name = proj['name']
        print("\n{0}".format('=' * 40))
        print("[{0}/{1}] {2} - {3}".format(idx+1, len(projects), pid, name))

        buildings, summary = common.parse_detail_page(pid)
        print("  楼栋: {0} 个".format(len(buildings)))

        if summary:
            print("  项目汇总: 已签{0}套, 面积{1}\u33a1, 均价\u00a5{2:,.0f}/\u33a1".format(
                summary['signed_count'], summary['signed_area'], summary['avg_price']))
            cur.execute("""
                UPDATE projects
                SET signed_count=?, signed_area=?, avg_price=?, updated_at=datetime('now','localtime')
                WHERE project_id=?
            """, (summary['signed_count'], summary['signed_area'], summary['avg_price'], pid))

            cur.execute("""
                INSERT OR REPLACE INTO project_daily_stats (project_id, stat_date, signed_count, signed_area, avg_price)
                VALUES (?, ?, ?, ?, ?)
            """, (pid, today_str, summary['signed_count'], summary['signed_area'], summary['avg_price']))

        else:
            cur.execute("UPDATE projects SET avg_price=0, updated_at=datetime('now','localtime') WHERE project_id=?", (pid,))
            print("  \u26a0 无住宅数据，均价设为 0")

        # 处理楼栋和房屋
        for bidx, bld in enumerate(buildings):
            bid = bld['building_id']
            bname = bld['building_name']
            sid = bld['sale_permit_id']

            if re.search(r"(地下车库|车库|车位|库房|戊类|储藏)", bname):
                print("  [{0}] 非住宅楼栋，跳过".format(bname))
                continue

            if not sid:
                print("  [{0}] 无 salePermitId，跳过".format(bname))
                continue

            houses = common.get_unit_table(sid, bid)

            if not houses:
                print("  [{0}] 非住宅楼栋，跳过".format(bname))
                continue

            cur.execute("""INSERT OR REPLACE INTO buildings
                (project_id, building_id, building_name, sale_permit_id,
                 total_units, updated_at)
                VALUES (?, ?, ?, ?, ?, datetime('now','localtime'))
            """, (pid, bid, bname, sid, bld.get('total_units', 0)))

            total_buildings += 1
            total_houses += len(houses)
            status_summary = {}
            for h in houses:
                status_summary[h['status']] = status_summary.get(h['status'], 0) + 1

            status_str = ', '.join(["{0}:{1}".format(s, c) for s, c in status_summary.items()])
            print("  [{0}] {1}套 (批准销售{2}套) [{3}]".format(
                bname, len(houses), bld.get('total_units', len(houses)), status_str))

            for h in houses:
                cur.execute("""INSERT OR REPLACE INTO houses
                    (building_id, house_id, room_no, status, updated_at)
                    VALUES (?, ?, ?, ?, datetime('now','localtime'))
                """, (bid, h['house_id'], h['room_no'], h['status']))

            conn.commit()

            # 楼栋之间随机延迟
            if bidx < len(buildings) - 1:
                delay = BUILDING_DELAY[0] + (BUILDING_DELAY[1] - BUILDING_DELAY[0]) * random.random()
                delay = round(delay, 1)
                print("  等待 {0}s 后继续...".format(delay))
                time.sleep(delay)

        # 项目之间随机延迟
        if idx < len(projects) - 1:
            delay = PROJECT_DELAY[0] + (PROJECT_DELAY[1] - PROJECT_DELAY[0]) * random.random()
            delay = round(delay, 1)
            print("  等待 {0}s 后继续...".format(delay))
            time.sleep(delay)

    print("\n[完成] 共处理 {0} 栋楼, {1} 套房".format(total_buildings, total_houses))

    # Step 3: 生成快照（所有活跃项目）
    print("\n[Step 3] 生成快照 ({0})...".format(today_str))
    common.generate_snapshots(conn, today_str)

    # Step 4: 对比快照，生成变化（含成交价反推）
    print("\n[Step 4] 对比快照，生成变化记录（含成交价反推）...")
    changes = common.compare_and_generate_changes(conn, today_str, calc_price=True)

    conn.close()

    print("\n{0}".format('=' * 60))
    print("完成! 变化: {0} 条".format(changes))
    print("结束时间: {0}".format(datetime.datetime.now().isoformat()))
    print("=" * 60)


if __name__ == '__main__':
    main()
