#!/usr/bin/env python3
"""
全量活跃楼盘数据更新 v1

功能:
- 从 projects 表获取所有 status='active' 的项目（约 231 个）
- 爬取每个项目的详情页：楼栋列表 + 项目汇总数据
- 爬取每个楼栋的楼盘表：房屋状态
- 更新 projects / buildings / houses 表
- 生成所有活跃项目的快照（daily_snapshots）
- 对比快照，生成变化记录（daily_changes）

使用方式:
- 由 crawl_all_wrapper.sh 统一调度，不单独运行
- 速率已在脚本内控制，无需外部限速
"""

import sqlite3, datetime, urllib.request, urllib.parse, re, time, sys, os, random, random

DB = '/opt/bj-server/data/bj_realestate.db'
LOCK_FILE = '/tmp/house_crawler.lock'

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'zh-CN,zh;q=0.9',
}

# ─── 速率控制 ───
PROJECT_DELAY = (3, 8)   # 每个项目之间随机延迟 3~8 秒
BUILDING_DELAY = (1, 3)  # 每栋楼之间随机延迟 1~3 秒
REQUEST_DELAY = (0.5, 1.5)  # 每次 HTTP 请求之间随机延迟

def random_sleep(low, high):
    time.sleep(low + (high - low) * random.random())


def fetch(url, timeout=45, max_retry=5):
    """"带指数退避的 HTTP 请求，最多重试 max_retry 次"""
    for attempt in range(max_retry):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            resp = urllib.request.urlopen(req, timeout=timeout)
            return resp.read().decode('utf-8', errors='replace')
        except Exception as e:
            if attempt < max_retry - 1:
                wait = min(2 ** (attempt + 1), 60)
                print(f"  HTTP 失败({attempt+1}/{max_retry})，{wait}s 后重试... ({str(e)[:50]})")
                time.sleep(wait)
            else:
                print(f"  HTTP 失败，已重试{max_retry}次，放弃: {str(e)[:80]}")
    return ''


# ─── 详情页：楼栋列表 + 项目汇总数据 ───
def parse_detail_page(project_id):
    url = f"http://bjjs.zjw.beijing.gov.cn/eportal/ui?pageId=320794&projectID={project_id}&systemID=2&srcId=1"
    html = ""
    for attempt in range(8):
        html = fetch(url)
        if html and len(html) >= 10000 and '查看信息' in html:
            break
        print(f"  详情页重试 {attempt+1}/8 ({len(html)} chars)...")
        time.sleep(5)

    if not html or len(html) < 10000:
        print(f"  详情页获取失败 ({len(html)} chars)")
        return [], None

    buildings = []
    for m in re.finditer(r'href="([^"]*buildingId=(\d+)[^"]*)"[^>]*>\s*查看信息\s*</a>', html):
        href = m.group(1)
        bid = m.group(2)
        pos = m.start()
        tr_start = html.rfind('<tr', 0, pos)
        tr_end = html.find('</tr>', pos)
        if tr_start < 0 or tr_end < 0:
            continue
        row = html[tr_start:tr_end+5]
        tds = re.findall(r'<td[^>]*>\s*(.*?)\s*</td>', row, re.DOTALL)
        clean = []
        for td in tds:
            c = re.sub(r'<[^>]+>', '', td).strip()
            c = re.sub(r'&nbsp;', ' ', c).strip()
            if c:
                clean.append(c)
        if len(clean) < 2:
            continue
        building_name = clean[0]
        try:
            total_units = int(clean[1]) if clean[1].isdigit() else 0
        except:
            total_units = 0
        sid_match = re.search(r'salePermitId=(\d+)', href)
        sid = sid_match.group(1) if sid_match else ''
        buildings.append({
            'building_id': bid,
            'building_name': building_name,
            'sale_permit_id': sid,
            'total_units': total_units,
        })

    summary = None
    idx = html.find('已签约套数')
    if idx >= 0:
        table_start = html.rfind('<table', 0, idx)
        table_end = html.find('</table>', idx)
        if table_start >= 0 and table_end >= 0:
            table = html[table_start:table_end+8]
            rows = re.findall(r'<tr[^>]*>(.*?)</tr>', table, re.DOTALL)

            total_count = 0
            total_area = 0.0
            total_amount = 0.0
            residential = None

            for row in rows[1:]:  # 跳过表头
                tds = re.findall(r'<td[^>]*>\s*(.*?)\s*</td>', row, re.DOTALL)
                clean = []
                for td in tds:
                    c = re.sub(r'<[^>]+>', '', td).strip()
                    c = re.sub(r'&nbsp;', ' ', c).strip()
                    if c:
                        clean.append(c)
                if len(clean) < 4:
                    continue
                try:
                    purpose = clean[0]
                    signed_count = int(float(clean[1]))
                    signed_area = float(clean[2])
                    avg_price = float(clean[3])

                    total_count += signed_count
                    total_area += signed_area
                    total_amount += signed_area * avg_price

                    if '住宅' in purpose:
                        residential = {
                            'signed_count': signed_count,
                            'signed_area': signed_area,
                            'avg_price': avg_price,
                        }
                except:
                    pass

            if residential:
                summary = residential
            elif total_area > 0:
                summary = {
                    'signed_count': total_count,
                    'signed_area': round(total_area, 2),
                    'avg_price': round(total_amount / total_area, 2),
                }

    return buildings, summary


# ─── 楼盘表：房屋状态 ───
COLOR_MAP = {
    '#ff0000': '已签约',
    '#33cc00': '可售',
    '#d2691e': '网上联机备案',
    '#ffff00': '已办理预售项目抵押',
    '#ffcc99': '已预订',
    '#00ffff': '资格核验中',
    '#0000ff': '资格核验中',
    '#cccccc': '不可售',
}

def expand_hex(h):
    h = h.lower()
    if len(h) == 4:
        return '#' + h[1]*2 + h[2]*2 + h[3]*2
    return h


def get_unit_table(sale_permit_id, building_id):
    url = f"http://bjjs.zjw.beijing.gov.cn/eportal/ui?pageId=320833&systemId=2&categoryId=1&salePermitId={sale_permit_id}&buildingId={building_id}"
    html = ""
    for attempt in range(8):
        html = fetch(url)
        if html and len(html) >= 8000 and ('houseId=' in html or '单元-' in html):
            break
        print(f"    楼盘表重试 {attempt+1}/8 ({len(html)} chars)...")
        time.sleep(5)
    if not html:
        return []

    houses = []
    div_pattern = re.compile(
        r'<div[^>]*style="[^"]*background:\s*(#[0-9a-fA-F]{3,6})[^"]*"[^>]*>(.*?)</div>',
        re.DOTALL
    )
    for div_match in div_pattern.finditer(html):
        hex_color = expand_hex(div_match.group(1))
        status = COLOR_MAP.get(hex_color, '未知')
        div_content = div_match.group(2)
        matched_href_links = set()
        for link_match in re.finditer(
            r'href="[^"]*houseId=(\d+)[^"]*houseNo=([^"&]+)[^"]*"[^>]*>([^<]+)</a>',
            div_content
        ):
            house_id = link_match.group(1)
            room_no = urllib.parse.unquote(link_match.group(2))
            matched_href_links.add(link_match.group(0))
            houses.append({
                'house_id': house_id,
                'room_no': room_no,
                'status': status
            })
        for link_match in re.finditer(
            r'href="#"[^>]*>([^<]+)</a>',
            div_content
        ):
            if link_match.group(0) in matched_href_links:
                continue
            room_no = link_match.group(1).strip()
            if room_no and not room_no.startswith('#'):
                pseudo_id = f"{building_id}_{room_no}"
                houses.append({
                    'house_id': pseudo_id,
                    'room_no': room_no,
                    'status': status
                })
    return houses


# ─── DB 初始化 ───
def ensure_schema(conn):
    cur = conn.cursor()
    for col, ctype in [('signed_count', 'INTEGER'), ('signed_area', 'REAL'), ('avg_price', 'REAL')]:
        try:
            cur.execute(f"ALTER TABLE buildings ADD COLUMN {col} {ctype} DEFAULT 0")
        except:
            pass
    for col, ctype in [('signed_count', 'REAL'), ('signed_area', 'REAL'), ('avg_price', 'REAL')]:
        try:
            cur.execute(f"ALTER TABLE projects ADD COLUMN {col} {ctype} DEFAULT 0")
        except:
            pass
    cur.execute("""
        CREATE TABLE IF NOT EXISTS project_daily_stats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id TEXT NOT NULL,
            stat_date TEXT NOT NULL,
            signed_count REAL DEFAULT 0,
            signed_area REAL DEFAULT 0,
            avg_price REAL DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now', 'localtime')),
            UNIQUE(project_id, stat_date)
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_pds_date ON project_daily_stats(stat_date)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_pds_project ON project_daily_stats(project_id, stat_date)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS daily_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            house_id TEXT NOT NULL,
            building_id TEXT NOT NULL,
            room_no TEXT NOT NULL,
            snapshot_date TEXT NOT NULL,
            status TEXT NOT NULL,
            building_avg_price REAL DEFAULT NULL,
            created_at TEXT DEFAULT (datetime('now', 'localtime'))
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_snapshots_date ON daily_snapshots(snapshot_date)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_snapshots_house ON daily_snapshots(house_id, snapshot_date)")
    conn.commit()


# ─── 获取所有活跃项目 ───
def get_all_active_projects(conn):
    cur = conn.cursor()
    cur.execute("SELECT project_id, name FROM projects WHERE status='active' ORDER BY district, name")
    rows = cur.fetchall()
    print(f"  活跃项目数: {len(rows)}")
    return [{'project_id': r[0], 'name': r[1]} for r in rows]


# ─── 快照 ───
def generate_snapshots(conn, today_str):
    cur = conn.cursor()
    cur.execute("""
        SELECT h.house_id, h.building_id, h.room_no, h.status, b.avg_price
        FROM houses h
        JOIN buildings b ON h.building_id = b.building_id
        JOIN projects p ON b.project_id = p.project_id
        WHERE p.status = 'active'
    """)
    rows = cur.fetchall()
    print(f"  生成快照: {len(rows)} 套房")

    cur.execute("DELETE FROM daily_snapshots WHERE snapshot_date = ?", (today_str,))

    for house_id, building_id, room_no, status, avg_price in rows:
        cur.execute("""
            INSERT INTO daily_snapshots (house_id, building_id, room_no, snapshot_date, status, building_avg_price)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (house_id, building_id, room_no, today_str, status, avg_price))

    conn.commit()


# ─── 变更对比 ───
def compare_and_generate_changes(conn, today_str):
    cur = conn.cursor()
    cur.execute("""
        SELECT DISTINCT snapshot_date FROM daily_snapshots
        WHERE snapshot_date < ?
        ORDER BY snapshot_date DESC LIMIT 1
    """, (today_str,))
    prev = cur.fetchone()
    if not prev:
        print("  无历史快照，跳过对比")
        return 0

    yesterday_str = prev[0]
    print(f"  对比: {yesterday_str} → {today_str}")

    cur.execute("""
        SELECT
            t.house_id, t.building_id, t.room_no,
            y.status as old_status, t.status as new_status,
            t.building_avg_price
        FROM daily_snapshots t
        JOIN daily_snapshots y ON t.house_id = y.house_id AND y.snapshot_date = ?
        WHERE t.snapshot_date = ?
        AND t.status != y.status
    """, (yesterday_str, today_str))

    changes = cur.fetchall()
    if not changes:
        print(f"  无变化")
        return 0

    cur.execute("SELECT building_id, project_id, building_name FROM buildings")
    bld_map = {r[0]: (r[1], r[2]) for r in cur.fetchall()}

    cur.execute("DELETE FROM daily_changes WHERE change_date = ?", (today_str,))

    new_sale_count = 0
    for row in changes:
        house_id, building_id, room_no, old_status, new_status, avg_price = row
        proj_id, bld_name = bld_map.get(building_id, ('', building_id))
        is_new_sale = (new_status in ('已签约', '网上联机备案') and
                       old_status not in ('已签约', '网上联机备案'))
        change_type = 'new_sale' if is_new_sale else 'status_change'

        if is_new_sale:
            new_sale_count += 1

        cur.execute("""
            INSERT OR IGNORE INTO daily_changes
            (change_date, project_id, building_id, building_name,
             house_id, room_no, old_status, new_status,
             building_avg_price, change_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (today_str, proj_id, building_id, bld_name,
               house_id, room_no, old_status, new_status,
               avg_price, change_type))

    conn.commit()
    print(f"  发现变化: {len(changes)} 套房 (新增成交: {new_sale_count})")

    for row in changes[:10]:
        house_id, building_id, room_no, old_status, new_status, avg_price = row
        proj_id, bld_name = bld_map.get(building_id, ('', building_id))
        price_str = f"¥{avg_price:,.0f}/m²" if avg_price else "无均价"
        print(f"    [{bld_name}] {room_no}: {old_status} → {new_status} ({price_str})")

    return len(changes)


# ─── 主流程 ───
def main():
    print("=" * 60)
    print("全量活跃楼盘数据更新 v1")
    print(f"时间: {datetime.datetime.now().isoformat()}")
    print("=" * 60)

    conn = sqlite3.connect(DB)
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 60000")  # 60秒超时
    ensure_schema(conn)

    # Step 1: 获取所有活跃项目
    print("\n[Step 1] 获取所有活跃项目...")
    projects = get_all_active_projects(conn)

    today_str = datetime.datetime.now().strftime('%Y-%m-%d')
    cur = conn.cursor()

    # Step 2: 爬取每个楼盘
    total_houses = 0
    total_buildings = 0
    print(f"\n[Step 2] 爬取 {len(projects)} 个活跃项目...")

    for idx, proj in enumerate(projects):
        pid = proj['project_id']
        name = proj['name']
        print(f"\n{'='*40}")
        print(f"[{idx+1}/{len(projects)}] {pid} - {name}")

        buildings, summary = parse_detail_page(pid)
        print(f"  楼栋: {len(buildings)} 个")

        if summary:
            print(f"  项目汇总: 已签{summary['signed_count']}套, 面积{summary['signed_area']}㎡, 均价¥{summary['avg_price']:,.0f}/㎡")
            cur.execute("""
                UPDATE projects
                SET signed_count=?, signed_area=?, avg_price=?, updated_at=datetime('now','localtime')
                WHERE project_id=?
            """, (summary['signed_count'], summary['signed_area'], summary['avg_price'], pid))

            cur.execute("""
                INSERT OR REPLACE INTO project_daily_stats (project_id, stat_date, signed_count, signed_area, avg_price)
                VALUES (?, ?, ?, ?, ?)
            """, (pid, today_str, summary['signed_count'], summary['signed_area'], summary['avg_price']))

        # 处理楼栋和房屋
        for bidx, bld in enumerate(buildings):
            bid = bld['building_id']
            bname = bld['building_name']
            sid = bld['sale_permit_id']

            cur.execute("""
                INSERT INTO buildings (building_id, project_id, building_name, sale_permit_id, total_units, updated_at)
                VALUES (?, ?, ?, ?, ?, datetime('now','localtime'))
                ON CONFLICT(building_id) DO UPDATE SET
                    building_name=excluded.building_name,
                    sale_permit_id=excluded.sale_permit_id,
                    total_units=excluded.total_units,
                    updated_at=excluded.updated_at
            """, (bid, pid, bname, sid, bld['total_units']))

            if summary:
                cur.execute("""
                    UPDATE buildings SET signed_count=?, signed_area=?, avg_price=? WHERE building_id=?
                """, (summary['signed_count'], summary['signed_area'], summary['avg_price'], bid))

            # 爬取房屋
            if sid:
                random_sleep(*BUILDING_DELAY)
                houses = get_unit_table(sid, bid)
                if houses:
                    print(f"    [{bidx+1}/{len(buildings)}] {bname}: {len(houses)} 套房")
                    total_houses += len(houses)
                    total_buildings += 1

                    for h in houses:
                        hid = h['house_id']
                        room_no = h['room_no']
                        status = h['status']
                        cur.execute("""
                            INSERT INTO houses (house_id, building_id, room_no, status, updated_at)
                            VALUES (?, ?, ?, ?, datetime('now','localtime'))
                            ON CONFLICT(house_id) DO UPDATE SET
                                status=excluded.status,
                                updated_at=excluded.updated_at
                        """, (hid, bid, room_no, status))

        conn.commit()

        # 项目之间随机延迟，避免请求过快
        if idx < len(projects) - 1:
            delay = PROJECT_DELAY[0] + (PROJECT_DELAY[1] - PROJECT_DELAY[0]) * __import__('random').random()
            delay = round(delay, 1)
            print(f"  等待 {delay}s 后继续...")
            time.sleep(delay)

    print(f"\n[完成] 共处理 {total_buildings} 栋楼, {total_houses} 套房")

    # Step 3: 生成快照（所有活跃项目）
    print(f"\n[Step 3] 生成快照 ({today_str})...")
    generate_snapshots(conn, today_str)

    # Step 4: 对比快照，生成变化
    print(f"\n[Step 4] 对比快照，生成变化记录...")
    changes = compare_and_generate_changes(conn, today_str)

    conn.close()

    # 释放锁
    fcntl.flock(lock_fd, fcntl.LOCK_UN)
    lock_fd.close()

    print(f"\n{'='*60}")
    print(f"完成! 变化: {changes} 条")
    print(f"结束时间: {datetime.datetime.now().isoformat()}")
    print("=" * 60)


if __name__ == '__main__':
    main()
