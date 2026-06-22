#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
爬虫公共函数模块

被 crawlAllActive_v1.py 和 crawlWatchlist_v7.py 共用。
包含：HTTP 请求、详情页解析、房屋表解析、建表逻辑、快照生成、变化对比。
"""

import sqlite3, datetime, urllib.request, urllib.parse, re, time, random

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'zh-CN,zh;q=0.9',
}

DB = '/user/local/service/house/data/bj_realestate.db'

PROJECT_DELAY = (3, 8)
BUILDING_DELAY = (1, 3)
REQUEST_DELAY = (0.5, 1.5)


# ─── HTTP 请求 ───

def fetch(url, timeout=45, max_retry=5):
    """带指数退避的 HTTP 请求，最多重试 max_retry 次"""
    for attempt in range(max_retry):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            resp = urllib.request.urlopen(req, timeout=timeout)
            return resp.read().decode('utf-8', errors='replace')
        except Exception as e:
            if attempt < max_retry - 1:
                wait = min(2 ** (attempt + 1), 60)
                print("  HTTP 失败({0}/{1})，{2}s 后重试... ({3})".format(
                    attempt+1, max_retry, wait, str(e)[:50]))
                time.sleep(wait)
            else:
                print("  HTTP 失败，已重试{0}次，放弃: {1}".format(max_retry, str(e)[:80]))
    return ''


def random_sleep(low, high):
    time.sleep(low + (high - low) * random.random())


# ─── 详情页解析 ───

def parse_detail_page(project_id):
    """
    从详情页获取：
    1. 楼栋列表（building_id, name, sale_permit_id, total_units）
    2. 项目级汇总数据（signed_count, signed_area, avg_price）
    返回: (buildings, summary)
    """
    base_url = "http://bjjs.zjw.beijing.gov.cn/eportal/ui?pageId=320794&projectID={0}&systemID=2&srcId=1".format(project_id)
    all_html = ""

    # 第一页
    html = ""
    for attempt in range(8):
        html = fetch(base_url)
        if html and len(html) >= 10000 and '查看信息' in html:
            break
        print("  详情页重试 {0}/8 ({1} chars)...".format(attempt+1, len(html)))
        time.sleep(5)

    if not html or len(html) < 10000:
        print("  详情页获取失败 ({0} chars)".format(len(html)))
        return [], None

    all_html += html

    # 处理"下一页"分页
    visited_urls = set()
    for pg in range(2, 21):
        next_match = re.search(r'<a[^>]*href="([^"]*)"[^>]*>\s*下一页\s*</a>', all_html)
        if not next_match:
            next_match = re.search(r'<a[^>]*href="([^"]*pageNo=\d+[^"]*)"', all_html)
        if not next_match:
            break
        next_href = next_match.group(1)
        if not next_href or next_href == '#':
            break
        if next_href.startswith('http'):
            next_url = next_href
        elif next_href.startswith('/'):
            next_url = 'http://bjjs.zjw.beijing.gov.cn' + next_href
        else:
            sep = '&' if '?' in base_url else '?'
            next_url = base_url + sep + next_href
        next_url = re.sub(r'&amp;', '&', next_url)
        if next_url in visited_urls:
            break
        visited_urls.add(next_url)
        print("  抓取楼栋分页 pg{0}: {1}".format(pg, next_url[-60:]))
        more_html = fetch(next_url)
        if not more_html or len(more_html) < 1000:
            break
        all_html += "\n" + more_html

    html = all_html

    # 1a. 检查"查看更多"链接
    more_match = re.search(r'href="([^"]*pageId=411612[^"]*)"[^>]*>\s*查看更多', html)
    more_buildings = []
    if more_match:
        more_href = more_match.group(1)
        if more_href.startswith('/'):
            more_url = 'http://bjjs.zjw.beijing.gov.cn' + more_href
        else:
            more_url = more_href
        more_url = re.sub(r'&amp;', '&', more_url)
        print("  发现查看更多页面: {0}".format(more_url[-80:]))
        more_html = fetch(more_url)
        if more_html and len(more_html) > 5000:
            for row_match in re.finditer(r'<tr[^>]*>(.*?)</tr>', more_html, re.DOTALL):
                row = row_match.group(1)
                b_match = re.search(r'buildingId=(\d+)', row)
                if not b_match:
                    continue
                bid = b_match.group(1)
                tds = re.findall(r'<td[^>]*>(.*?)</td>', row, re.DOTALL)
                clean = []
                for td in tds:
                    c = re.sub(r'<[^>]+>', '', td).strip()
                    c = re.sub(r'&nbsp;', ' ', c).strip()
                    if c:
                        clean.append(c)
                if len(clean) >= 2 and '住宅' in clean[0]:
                    try:
                        total_units = int(clean[1]) if clean[1].isdigit() else 0
                    except:
                        total_units = 0
                    more_buildings.append({
                        'building_id': bid,
                        'building_name': clean[0],
                        'total_units': total_units,
                    })
            print("  查看更多页面获取 {0} 个楼栋".format(len(more_buildings)))

    # 1b. 解析详情页楼栋列表（获取 sale_permit_id）
    detail_buildings = []
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
        detail_buildings.append({
            'building_id': bid,
            'building_name': building_name,
            'sale_permit_id': sid,
            'total_units': total_units,
        })

    # 1c. 合并楼栋列表
    buildings = []
    sid_map = {b['building_id']: b['sale_permit_id'] for b in detail_buildings}
    default_sid = ''
    for b in detail_buildings:
        if b['sale_permit_id']:
            default_sid = b['sale_permit_id']
            break

    if more_buildings:
        for mb in more_buildings:
            bid = mb['building_id']
            sid = sid_map.get(bid, default_sid)
            buildings.append({
                'building_id': bid,
                'building_name': mb['building_name'],
                'sale_permit_id': sid,
                'total_units': mb['total_units'],
            })
        print("  合并后共 {0} 个楼栋（查看更多页面）".format(len(buildings)))
    else:
        buildings = detail_buildings
        print("  共 {0} 个楼栋（详情页面）".format(len(buildings)))

    # 2. 解析项目级汇总数据
    summary = None
    idx = html.find('已签约套数')
    if idx >= 0:
        table_start = html.rfind('<table', 0, idx)
        table_end = html.find('</table>', idx)
        if table_start >= 0 and table_end >= 0:
            table = html[table_start:table_end+8]
            rows = re.findall(r'<tr[^>]*>(.*?)</tr>', table, re.DOTALL)
            residential = None
            for row in rows[1:]:
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

    return buildings, summary


# ─── 房屋表解析 ───

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
    """
    获取单元表，支持分页。
    sale_permit_id: 预售证ID（用于构造URL）
    building_id: 楼栋ID（用于生成伪ID）
    返回: [{'house_id': ..., 'room_no': ..., 'status': ...}, ...]
    """
    base_url = ("http://bjjs.zjw.beijing.gov.cn/eportal/ui?pageId=320833&systemId=2"
                "&categoryId=1&salePermitId={0}&buildingId={1}").format(sale_permit_id, building_id)

    all_houses = []
    div_pattern = re.compile(
        r'<div[^>]*style="[^"]*background:\s*(#[0-9a-fA-F]{3,6})[^"]*"[^>]*>(.*?)</div>',
        re.DOTALL
    )

    for page in range(1, 21):
        if page == 1:
            url = base_url
        else:
            sep = '&' if '?' in base_url else '?'
            url = "{0}{1}pageNo={2}".format(base_url, sep, page)

        html = ""
        for attempt in range(8):
            html = fetch(url)
            if html and len(html) >= 8000 and ('houseId=' in html or '单元-' in html):
                break
            print("    单元表重试 {0}/8 ({1} chars)...".format(attempt+1, len(html)))
            time.sleep(5)

        if not html:
            if page == 1:
                return []
            else:
                break

        page_houses = []
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
                page_houses.append({
                    'house_id': house_id,
                    'room_no': room_no,
                    'status': status
                })

            for link_match in re.finditer(r'href="#"[^>]*>([^<]+)</a>', div_content):
                if link_match.group(0) in matched_href_links:
                    continue
                room_no = link_match.group(1).strip()
                if room_no and not room_no.startswith('#'):
                    pseudo_id = "{0}_{1}".format(building_id, room_no)
                    page_houses.append({
                        'house_id': pseudo_id,
                        'room_no': room_no,
                        'status': status
                    })

        if not page_houses:
            break

        all_houses.extend(page_houses)
        print("    第{0}页：获取 {1} 套".format(page, len(page_houses)))

        if '下一页' not in html:
            if '>{0}<'.format(page+1) not in html and 'pageNo={0}'.format(page+1) not in html:
                break

    if not all_houses:
        return []

    # 过滤非住宅楼栋：房间号第一位为1-9（楼层号）视为住宅
    filtered = []
    for h in all_houses:
        digits = re.sub(r'\D', '', h['room_no'])
        if len(digits) >= 3 and digits[0] != '0':
            filtered.append(h)

    if not filtered:
        return []

    print("  共获取 {0} 套，过滤后 {1} 套住宅".format(len(all_houses), len(filtered)))
    return filtered


# ─── 建表 + 补字段 ───

def ensure_schema(conn):
    """
    建表 + 补字段（两爬虫共用）。
    已废弃 daily_changes 表依赖（2026-06-22）。
    """
    cur = conn.cursor()

    # buildings 字段
    for col, ctype in [('signed_count', 'INTEGER'), ('signed_area', 'REAL'), ('avg_price', 'REAL')]:
        try:
            cur.execute("ALTER TABLE buildings ADD COLUMN {0} {1} DEFAULT 0".format(col, ctype))
        except:
            pass

    # projects 字段
    for col, ctype in [('signed_count', 'REAL'), ('signed_area', 'REAL'), ('avg_price', 'REAL')]:
        try:
            cur.execute("ALTER TABLE projects ADD COLUMN {0} {1} DEFAULT 0".format(col, ctype))
        except:
            pass

    # project_daily_stats 表
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

    # daily_snapshots 表
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
    for col, ctype in [('room_no', 'TEXT'), ('building_id', 'TEXT'), ('building_avg_price', 'REAL')]:
        try:
            cur.execute("ALTER TABLE daily_snapshots ADD COLUMN {0} {1}".format(col, ctype))
        except:
            pass

    conn.commit()


# ─── 快照生成 ───

def generate_snapshots(conn, today_str, project_filter_sql=None, project_filter_params=None):
    """
    生成每日快照。
    project_filter_sql: 可选的 WHERE 子句，如 "WHERE b.project_id IN ({0})"
    project_filter_params: 对应的参数列表
    """
    cur = conn.cursor()

    base_sql = """
        SELECT h.house_id, h.building_id, h.room_no, h.status, b.avg_price
        FROM houses h
        JOIN buildings b ON h.building_id = b.building_id
        JOIN projects p ON b.project_id = p.project_id
    """
    params = []
    if project_filter_sql:
        base_sql += " AND " + project_filter_sql
        params = project_filter_params or []

    cur.execute(base_sql, params)
    rows = cur.fetchall()
    print("  生成快照: {0} 套房".format(len(rows)))

    cur.execute("DELETE FROM daily_snapshots WHERE snapshot_date = ?", (today_str,))

    for row in rows:
        house_id, building_id, room_no, status, avg_price = row
        cur.execute("""
            INSERT INTO daily_snapshots (house_id, building_id, room_no, snapshot_date, status, building_avg_price)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (house_id, building_id, room_no, today_str, status, avg_price))

    conn.commit()


# ─── 变化对比（含可选成交价反推）───

def compare_and_generate_changes(conn, today_str, calc_price=False):
    """
    [已废弃] 对比相邻两天快照，统计变化数量（不再写入 daily_changes）。
    2026-06-22: daily_changes 表已废弃，此函数仅统计不写入。
    返回: 变化条数
    """
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
    print("  对比: {0} -> {1} (仅统计，不写入 daily_changes)".format(yesterday_str, today_str))

    cur.execute("""
        SELECT COUNT(*)
        FROM daily_snapshots t
        JOIN daily_snapshots y ON t.house_id = y.house_id AND y.snapshot_date = ?
        WHERE t.snapshot_date = ?
        AND t.status != y.status
    """, (yesterday_str, today_str))

    row = cur.fetchone()
    change_count = row[0] if row else 0
    print("  变化记录: {0} 条".format(change_count))
    return change_count
    print("  发现变化: {0} 套房 (新增成交: {1})".format(len(changes), new_sale_count))

    for row in changes[:10]:
        house_id, building_id, room_no, old_status, new_status, avg_price = row
        proj_id, bld_name = bld_map.get(building_id, ('', building_id))
        price_str = "?.{0:,.0f}/m?".format(avg_price) if avg_price else "æ åä»·"
        print("    [{0}] {1}: {2} -> {3} ({4})".format(bld_name, room_no, old_status, new_status, price_str))

    return len(changes)
