#!/usr/bin/env python3
"""
关注楼盘优先更新 v6 — 修复楼栋数据解析

修复:
- 详情页楼栋表格列顺序不对，之前把'批准销售面积'当成了'已签约套数'
- 新增从详情页底部汇总表格提取项目级签约数据
- 项目级 signed_count/signed_area/avg_price 存入 projects 表
"""
import sqlite3, datetime, urllib.request, urllib.parse, re, time, sys, os

DB = '/opt/bj-server/data/bj_realestate.db'

# 昌平区 2026 年活跃楼盘
CHANGPING_2026 = [
    ('8203707', '樾序海苑', '昌平区-2026-05-10'),
    ('8161845', '誉淙家园', '昌平区-2026-02-05'),
    ('8158008', '星洵家园', '昌平区-2026-01-28'),
    ('8106368', '星洵家园', '昌平区-2025-09-27'),
]

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'zh-CN,zh;q=0.9',
}

def fetch(url, timeout=45):
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            resp = urllib.request.urlopen(req, timeout=timeout)
            return resp.read().decode('utf-8', errors='replace')
        except Exception as e:
            if attempt < 2:
                time.sleep(5)
    return ""

# ─── 详情页：楼栋列表 + 项目汇总数据 ───
def parse_detail_page(project_id):
    """从详情页获取：
    1. 楼栋列表（building_id, name, sale_permit_id, total_units）
    2. 项目级汇总数据（signed_count, signed_area, avg_price）
    """
    url = f"http://bjjs.zjw.beijing.gov.cn/eportal/ui?pageId=320794&projectID={project_id}&systemID=2&srcId=1"
    
    # 重试：网站不稳定
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

    # ── 1. 解析楼栋列表 ──
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
        
        # 列: [销售楼号, 批准销售套数, 批准销售面积, 销售状态, 住宅拟售价格, 楼盘表链接]
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

    # ── 2. 解析项目级汇总数据 ──
    summary = None
    idx = html.find('已签约套数')
    if idx >= 0:
        table_start = html.rfind('<table', 0, idx)
        table_end = html.find('</table>', idx)
        if table_start >= 0 and table_end >= 0:
            table = html[table_start:table_end+8]
            tds = re.findall(r'<td[^>]*>\s*(.*?)\s*</td>', table, re.DOTALL)
            clean = []
            for td in tds:
                c = re.sub(r'<[^>]+>', '', td).strip()
                c = re.sub(r'&nbsp;', ' ', c).strip()
                if c:
                    clean.append(c)
            
            # 提取数字（已签约套数, 已签约面积, 成交均价）
            numbers = [x for x in clean if re.match(r'^\d+(\.\d+)?$', x)]
            if len(numbers) >= 3:
                summary = {
                    'signed_count': int(numbers[0]),
                    'signed_area': float(numbers[1]),
                    'avg_price': float(numbers[2]),
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
            r'href="#"\s*[^>]*>([^<]+)</a>',
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

    # buildings 字段
    for col in ['signed_count', 'signed_area', 'avg_price']:
        try:
            cur.execute(f"ALTER TABLE buildings ADD COLUMN {col} INTEGER DEFAULT 0")
        except:
            pass
    try:
        cur.execute("ALTER TABLE buildings ADD COLUMN signed_area REAL DEFAULT 0")
    except:
        pass
    try:
        cur.execute("ALTER TABLE buildings ADD COLUMN avg_price REAL DEFAULT 0")
    except:
        pass

    # projects 新增汇总字段
    for col in ['signed_count', 'signed_area', 'avg_price']:
        try:
            cur.execute(f"ALTER TABLE projects ADD COLUMN {col} REAL DEFAULT 0")
        except:
            pass

    # 确保快照和变更表存在
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

    cur.execute("""
        CREATE TABLE IF NOT EXISTS daily_changes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            change_date TEXT NOT NULL,
            project_id TEXT NOT NULL,
            building_id TEXT NOT NULL,
            building_name TEXT DEFAULT '',
            house_id TEXT NOT NULL,
            room_no TEXT NOT NULL,
            old_status TEXT NOT NULL,
            new_status TEXT NOT NULL,
            building_avg_price REAL DEFAULT NULL,
            created_at TEXT DEFAULT (datetime('now', 'localtime'))
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_changes_date ON daily_changes(change_date)")

    conn.commit()

# ─── 关注列表 ───
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
    print(f"  活跃关注项目数: {len(watched)}")
    return watched

# ─── 快照与变更对比 ───
def generate_snapshots(conn, today_str):
    cur = conn.cursor()
    cur.execute("SELECT project_id FROM watched_projects WHERE is_active=1")
    watched = [r[0] for r in cur.fetchall()]
    if not watched:
        return

    placeholders = ','.join('?' * len(watched))
    cur.execute(f"""
        SELECT h.house_id, h.building_id, h.room_no, h.status, b.avg_price
        FROM houses h
        JOIN buildings b ON h.building_id = b.building_id
        WHERE b.project_id IN ({placeholders})
    """, watched)

    rows = cur.fetchall()
    print(f"  生成快照: {len(rows)} 套房")

    cur.execute("DELETE FROM daily_snapshots WHERE snapshot_date = ?", (today_str,))

    for house_id, building_id, room_no, status, avg_price in rows:
        cur.execute("""
            INSERT INTO daily_snapshots (house_id, building_id, room_no, snapshot_date, status, building_avg_price)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (house_id, building_id, room_no, today_str, status, avg_price))

    conn.commit()

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

    # 按项目汇总：用于单套成交时推算价格
    proj_change_map = {}
    for row in changes:
        house_id, building_id, room_no, old_status, new_status, avg_price = row
        proj_id = bld_map.get(building_id, ('', ''))[0]
        if proj_id not in proj_change_map:
            proj_change_map[proj_id] = 0
        is_new_sale = (new_status in ('已签约', '网上联机备案') and
                       old_status not in ('已签约', '网上联机备案'))
        if is_new_sale:
            proj_change_map[proj_id] += 1

    # 获取项目级均价变化，用于推算成交单价
    proj_price_info = {}
    for proj_id in proj_change_map:
        row_t = conn.execute(
            "SELECT signed_count, signed_area, avg_price FROM projects WHERE project_id=?",
            (proj_id,)
        ).fetchone()
        # 尝试从昨天的项目数据获取（如果有历史表，这里暂时用 projects 表当前值）
        # 简化：单套时直接用 (项目新总价 - 项目旧总价) / 1 推算
        proj_price_info[proj_id] = row_t  # (signed_count, signed_area, avg_price)

    cur.execute("DELETE FROM daily_changes WHERE change_date = ?", (today_str,))

    new_sale_count = 0
    for row in changes:
        house_id, building_id, room_no, old_status, new_status, avg_price = row
        proj_id, bld_name = bld_map.get(building_id, ('', building_id))
        is_new_sale = (new_status in ('已签约', '网上联机备案') and
                       old_status not in ('已签约', '网上联机备案'))
        change_type = 'new_sale' if is_new_sale else 'status_change'

        deal_unit_price = None
        deal_total_price = None
        build_area = None

        if is_new_sale:
            new_sale_count += 1
            # 尝试获取房屋面积（从 houses 表）
            h_row = conn.execute(
                "SELECT build_area, list_price_per_sqm FROM houses WHERE house_id=?",
                (house_id,)
            ).fetchone()
            if h_row:
                build_area = h_row[0]
                # 如果有备案单价，可以作为参考（不是成交价，但接近）
                if h_row[1]:
                    deal_unit_price = h_row[1]  # 备案单价，非成交价

        cur.execute("""
            INSERT OR IGNORE INTO daily_changes 
            (change_date, project_id, building_id, building_name,
             house_id, room_no, old_status, new_status,
             building_avg_price, change_type, build_area,
             deal_unit_price, deal_total_price)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (today_str, proj_id, building_id, bld_name,
               house_id, room_no, old_status, new_status,
               avg_price, change_type, build_area,
               deal_unit_price, deal_total_price))

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
    print("关注楼盘优先更新 v6 (修复楼栋数据解析)")
    print(f"时间: {datetime.datetime.now().isoformat()}")
    print("=" * 60)

    conn = sqlite3.connect(DB)
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 30000")

    ensure_schema(conn)

    # Step 1: 关注列表
    print("\n[Step 1] 设置关注列表...")
    watched_ids = setup_watchlist(conn)

    cur = conn.cursor()
    cur.execute("SELECT project_id, name FROM projects WHERE project_id IN ({})".format(
        ','.join("?" * len(watched_ids))
    ), watched_ids)
    projects = {row[0]: row[1] for row in cur.fetchall()}

    # Step 2: 爬取每个楼盘
    total_houses = 0
    total_buildings = 0

    for idx, pid in enumerate(watched_ids):
        name = projects.get(pid, pid)
        print(f"\n{'='*40}")
        print(f"[{idx+1}/{len(watched_ids)}] {pid} - {name}")

        # 从详情页获取楼栋列表 + 项目汇总
        buildings, summary = parse_detail_page(pid)
        print(f"  楼栋: {len(buildings)} 个")
        if summary:
            print(f"  项目汇总: 已签{summary['signed_count']}套, 面积{summary['signed_area']}㎡, 均价¥{summary['avg_price']:,.0f}/㎡")
            # 存入 projects 表
            cur.execute("""
                UPDATE projects 
                SET signed_count=?, signed_area=?, avg_price=?, updated_at=datetime('now','localtime')
                WHERE project_id=?
            """, (summary['signed_count'], summary['signed_area'], summary['avg_price'], pid))
        total_buildings += len(buildings)

        for bs in buildings:
            bid = bs['building_id']
            bname = bs['building_name']
            sid = bs['sale_permit_id']
            total_units = bs['total_units']

            # 写入楼栋信息（total_units 来自表格，signed_* 来自项目汇总或后续计算）
            cur.execute("""
                INSERT OR REPLACE INTO buildings 
                (project_id, building_id, building_name, sale_permit_id, 
                 total_units, updated_at)
                VALUES (?, ?, ?, ?, ?, datetime('now','localtime'))
            """, (pid, bid, bname, sid, total_units))

            if not sid:
                print(f"  [{bname}] 无 salePermitId，跳过房屋详情")
                continue

            # 获取房屋数据
            houses = get_unit_table(sid, bid)
            total_houses += len(houses)
            status_summary = {}
            for h in houses:
                status_summary[h['status']] = status_summary.get(h['status'], 0) + 1

            status_str = ', '.join(f"{s}:{c}" for s, c in status_summary.items())
            print(f"  [{bname}] {len(houses)}套 (批准销售{total_units}套) [{status_str}]")

            for h in houses:
                cur.execute("""
                    INSERT OR REPLACE INTO houses 
                    (building_id, house_id, room_no, status, updated_at)
                    VALUES (?, ?, ?, ?, datetime('now','localtime'))
                """, (bid, h['house_id'], h['room_no'], h['status']))

            conn.commit()
            time.sleep(3)

        # 更新关注项目时间
        cur.execute("""
            UPDATE watched_projects SET updated_at=datetime('now','localtime')
            WHERE project_id=?
        """, (pid,))
        conn.commit()

        time.sleep(5)

    # Step 3: 生成每日快照
    today_str = datetime.datetime.now().strftime('%Y-%m-%d')
    print(f"\n[Step 3] 生成今日快照 ({today_str})...")
    generate_snapshots(conn, today_str)

    # Step 4: 对比变化
    print(f"\n[Step 4] 对比日变更...")
    change_count = compare_and_generate_changes(conn, today_str)

    conn.close()

    # 最终报告
    print(f"\n{'='*60}")
    print(f"完成!")
    print(f"楼盘: {len(watched_ids)} | 楼栋: {total_buildings} | 房屋: {total_houses}")
    print(f"今日变更: {change_count} 套")
    print(f"时间: {datetime.datetime.now().isoformat()}")

    # 验证
    conn2 = sqlite3.connect(DB)
    b = conn2.execute("SELECT COUNT(*) FROM buildings").fetchone()[0]
    h = conn2.execute("SELECT COUNT(*) FROM houses").fetchone()[0]
    s = conn2.execute("SELECT COUNT(*) FROM daily_snapshots WHERE snapshot_date=?", (today_str,)).fetchone()[0]
    c = conn2.execute("SELECT COUNT(*) FROM daily_changes WHERE change_date=?", (today_str,)).fetchone()[0]
    # 显示项目汇总
    for pid, name, _ in CHANGPING_2026:
        row = conn2.execute("SELECT signed_count, signed_area, avg_price FROM projects WHERE project_id=?", (pid,)).fetchone()
        if row and row[0]:
            print(f"  [{name}] 已签{row[0]}套 面积{row[1]:.2f}㎡ 均价¥{row[2]:,.0f}/㎡")
    print(f"[验证] buildings:{b} houses:{h} snapshots:{s} changes:{c}")
    conn2.close()
    print("=" * 60)

if __name__ == '__main__':
    main()
