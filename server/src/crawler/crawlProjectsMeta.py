#!/usr/bin/env python3
"""
爬取楼盘元数据（区域、地址等）
更新 projects 表的 district / address 字段

用法:
    python3 crawlProjectsMeta.py          # 只更新 district 为空的
    python3 crawlProjectsMeta.py --all    # 强制更新所有
"""
import sqlite3, urllib.request, urllib.parse, re, time, sys, os, argparse

DB = '/opt/bj-server/data/bj_realestate.db'
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'zh-CN,zh;q=0.9',
}

BEIJING_DISTRICTS = [
    '昌平区', '朝阳区', '海淀区', '丰台区', '大兴区', '通州区', '顺义区',
    '房山区', '东城区', '西城区', '石景山区', '门头沟区', '平谷区',
    '怀柔区', '密云区', '延庆区',
]

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

def parse_meta(html):
    """从详情页 HTML 中提取区域和地址，返回 (district, address)"""
    district = None
    address = None

    # 提取区域 —— 多种 pattern 兜底
    dist_patterns = [
        r'区域\s*</td>\s*<td[^>]*>\s*([^<]+)\s*</td>',
        r'所属区域[：:]\s*([^<]+)',
        r'区域[：:]\s*([^<]+)',
    ]
    for pat in dist_patterns:
        m = re.search(pat, html)
        if m:
            d = m.group(1).strip()
            for bd in BEIJING_DISTRICTS:
                if bd in d or bd.replace('区','') in d:
                    district = d
                    break
            if district:
                break

    # 提取地址
    addr_patterns = [
        r'项目地址\s*</td>\s*<td[^>]*>\s*([^<]+)\s*</td>',
        r'地址[：:]\s*([^<]+)',
        r'项目详细地址[：:]\s*([^<]+)',
    ]
    for pat in addr_patterns:
        m = re.search(pat, html)
        if m:
            address = m.group(1).strip()
            break

    return district, address

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--all', action='store_true', help='强制更新所有楼盘')
    args = parser.parse_args()

    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row

    if args.all:
        rows = conn.execute('SELECT project_id, name FROM projects').fetchall()
    else:
        rows = conn.execute(
            "SELECT project_id, name FROM projects WHERE district IS NULL OR district = ''"
        ).fetchall()

    print(f"需处理 {len(rows)} 个楼盘")
    updated = 0
    failed = 0

    for i, row in enumerate(rows):
        pid = row['project_id']
        name = row['name']
        print(f"[{i+1}/{len(rows)}] {pid} {name}...", flush=True)

        url = (f"http://bjjs.zjw.beijing.gov.cn/eportal/ui"
               f"?pageId=320794&projectID={pid}&systemID=2&srcId=1")
        html = fetch(url)

        if not html or len(html) < 5000:
            print(f"  ✗ 获取失败 ({len(html) if html else 0} chars)")
            failed += 1
            time.sleep(2)
            continue

        district, address = parse_meta(html)

        updates = []
        params = []

        found = False
        if district:
            updates.append('district = ?')
            params.append(district)
            print(f"  ✓ 区域: {district}", end='')
            found = True

        if address:
            updates.append('address = ?')
            params.append(address)
            if district:
                print(f" | 地址: {address[:20]}...", end='')
            else:
                print(f"  ✓ 地址: {address[:20]}...", end='')
            found = True

        if found:
            params.append(pid)
            sql = f"UPDATE projects SET {', '.join(updates)} WHERE project_id = ?"
            conn.execute(sql, params)
            conn.commit()
            print()
            updated += 1
        else:
            print(f"  ✗ 未找到区域/地址")
            failed += 1

        time.sleep(2)  # 礼貌爬取

    conn.close()
    print(f"\n完成！更新 {updated} 个，失败 {failed} 个")

if __name__ == '__main__':
    main()
