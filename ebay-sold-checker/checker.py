#!/usr/bin/env python3
"""Batch sold-items checker for Japanese character goods on eBay.

Takes the query catalog (queries.csv) and, for each query, runs the proven
flow (curl_cffi Chrome-TLS session + verified cookies + silent login fallback
+ eBay's own next-page links + batch-signature counting) against the
configured marketplace, then writes:
  - state/results into results.db  (SQLite; resumable)
  - results.csv                   (flat rows, one per query)
  - report.html                   (sortable + filterable table)

Usage:
  python3 checker.py --list queries.csv --limit 10
  python3 checker.py --list queries.csv --start 100 --limit 50 --pages 2
  python3 checker.py --list queries.csv --redo-failed
  python3 checker.py --report-only     # rebuild csv + html from DB

Credentials: reads cookies_ebay_*.json next to this script (seeded session),
falls back to a silent login when eBay serves its sign-in wall.
"""

import argparse
import csv
import json
import os
import random
import re
import sqlite3
import sys
import time
from datetime import datetime, timezone
from html.parser import HTMLParser
from urllib.parse import quote, urlencode

from curl_cffi import requests as creq

BASE = os.path.dirname(os.path.abspath(__file__))
PROXY = os.environ.get("EBAY_PROXY", "")
EMAIL = os.environ.get("EBAY_EMAIL", "")
PASSWORD = os.environ.get("EBAY_PASSWORD", "")
PAGES_DEFAULT = 2


class FormP(HTMLParser):
    def __init__(self):
        super().__init__()
        self.fields = []
        self.action = None

    def handle_starttag(self, tag, attrs):
        d = dict(attrs)
        if tag == "form" and self.action is None and d.get("action"):
            self.action = d["action"]
        if tag == "input" and d.get("name") and d.get("type") != "submit":
            self.fields.append((d["name"], d.get("value", "")))


class Session:
    """Verified-session HTTP client for one marketplace."""

    def __init__(self, host):
        self.host = host
        prox = {"http": PROXY, "https": PROXY} if PROXY else None
        self.s = creq.Session(impersonate="chrome", proxies=prox)
        self.cookie_files_applied = 0
        self.login_attempted = False
        self.seed_cookies()

    def seed_cookies(self):
        import glob
        for f in glob.glob(os.path.join(BASE, "cookies_ebay_*.json")):
            try:
                for c in json.load(open(f)):
                    self.s.cookies.set(c["name"], c["value"],
                                       domain=c["domain"].lstrip("."),
                                       path=c.get("path", "/"))
                    self.cookie_files_applied += 1
            except Exception as e:
                print(f"  ! bad cookie file {f}: {e}", file=sys.stderr)

    def login(self, ru):
        if not EMAIL or not PASSWORD:
            return None
        signin_host = f"signin.{'.'.join(self.host.split('.')[1:])}"
        r1 = self.s.get(f"https://{signin_host}/signin/?ru={ru}", timeout=60)
        if r1.status_code != 200:
            return None
        p = FormP()
        p.feed(r1.text)
        if not p.action:
            return None
        data = {}
        for n, v in p.fields:
            data.setdefault(n, v)
        data["userid"] = EMAIL
        data["pass"] = PASSWORD
        return self.s.post(p.action, data=data, timeout=60, allow_redirects=True,
                           headers={"Origin": f"https://{signin_host}",
                                    "Referer": f"https://{signin_host}/signin/?ru={ru}"})

    def get(self, url, referer=None):
        h = {"Referer": referer} if referer else None
        return self.s.get(url, timeout=60, headers=h)

    def login_if_wall(self, url, text):
        if "/itm/" in text:
            return text
        if self.login_attempted:
            return text   # account protection: never hammer repeated logins
        self.login_attempted = True
        try:
            lr = self.login(quote(url, safe=""))
        except Exception:
            return text
        if lr is not None and "/itm/" in lr.text:
            return lr.text
        r = self.get(url)
        return r.text

    def sold_search(self, query, pages):
        base = urlencode({"_nkw": query, "LH_Sold": "1",
                          "LH_Complete": "1", "_ipg": "120"})
        url = f"https://{self.host}/sch/i.html?" + base
        htmls = []
        for page in range(1, max(2, pages + 1)):
            r = self.get(url)
            text = r.text
            if "/itm/" not in text:
                text = self.login_if_wall(url, text)
            if "/itm/" not in text:
                break
            htmls.append(text)
            # find eBay's own next-page link
            links = re.findall(r'href=([^\s>]+_pgn=[^\s>]+)', text)
            cm = re.search(r"_pgn=(\d+)", url)
            cp = int(cm.group(1)) if cm else 1
            nxt = None
            for l in links:
                m = re.search(r"_pgn=(\d+)", l)
                if m and int(m.group(1)) == cp + 1:
                    nxt = l
                    break
            if not nxt or page >= pages:
                break
            time.sleep(random.uniform(1.5, 3.0))
            url = nxt
        return htmls


_MARKET = "fr"


def summarize(htmls, now, ref):
    """Parse pages with the reference extractor, count (batch-signature safe)."""
    items = []
    for ph in htmls:
        items.extend(ref.extract_items(ph, ref.SITES[_MARKET])["items"])
    summary = ref.summarize_site(items, False, now)
    return summary, items


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    ap.add_argument("--list", default=os.path.join(BASE, "queries.csv"))
    ap.add_argument("--limit", type=int, default=0, help="max queries this run (0 = all)")
    ap.add_argument("--start", type=int, default=0, help="start at catalog index (0-based)")
    ap.add_argument("--pages", type=int, default=PAGES_DEFAULT, help="result pages per query (1-4)")
    ap.add_argument("--delay", type=float, default=10.0, help="base delay between queries (s)")
    ap.add_argument("--redo-failed", action="store_true")
    ap.add_argument("--report-only", action="store_true")
    ap.add_argument("--marketplace", default="fr")
    args = ap.parse_args()

    sys.path.insert(0, os.path.join(BASE, "..", "ebay-extractor"))
    if not os.path.isdir(os.path.join(BASE, "..", "ebay-extractor")):
        sys.path.insert(0, "/workspace/ebay-extractor")
    import extractor as ref

    db = sqlite3.connect(os.path.join(BASE, "results.db"))
    db.execute("""CREATE TABLE IF NOT EXISTS results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query_id INTEGER, query TEXT, franchise TEXT, character TEXT,
        goods TEXT, marketplace TEXT,
        sold_90d INTEGER, median REAL, median_weighted REAL,
        currency TEXT, listings INTEGER, listings_in_window INTEGER,
        pages INTEGER, status TEXT, error TEXT,
        checked_at TEXT, UNIQUE(query_id, marketplace))""")

    rows = list(csv.DictReader(open(args.list)))
    total = len(rows)

    def write_outputs():
        cur = db.execute("SELECT query_id, query, franchise, character, goods, "
                         "marketplace, sold_90d, median, median_weighted, currency, "
                         "listings, listings_in_window, pages, status, error, checked_at "
                         "FROM results ORDER BY query_id")
        with open(os.path.join(BASE, "results.csv"), "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["query_id", "query", "franchise", "character", "goods",
                        "marketplace", "sold_90d", "median", "median_weighted",
                        "currency", "listings", "listings_in_window", "pages",
                        "status", "error", "checked_at"])
            for r in cur:
                w.writerow(r)
        html_report(db)
        csv_n = db.execute("SELECT COUNT(*) FROM results WHERE status='ok'").fetchone()[0]
        print(f"outputs written: results.csv ({csv_n} ok rows) + report.html")

    if args.report_only:
        write_outputs()
        return

    host = ref.SITES[args.marketplace]["host"]
    global _MARKET
    _MARKET = args.marketplace
    sess = Session(host)
    print(f"session ready (cookies applied: {sess.cookie_files_applied})",
          file=sys.stderr)

    done_ids = {r[0] for r in db.execute(
        "SELECT query_id FROM results WHERE status='ok' AND marketplace=?",
        (args.marketplace,))}
    run = 0
    now0 = datetime.now(timezone.utc)
    for idx, row in enumerate(rows):
        if idx < args.start:
            continue
        if args.limit and run >= args.limit:
            break
        qid = int(row["id"])
        if qid in done_ids:
            continue
        row_status = db.execute("SELECT status FROM results WHERE query_id=? AND marketplace=?",
                                (qid, args.marketplace)).fetchone()
        if row_status and row_status[0] == "error" and not args.redo_failed:
            continue
        run += 1
        query = row["query"]
        print(f"[{idx+1}/{total}] {query} ...", file=sys.stderr)
        try:
            t0 = time.time()
            htmls = sess.sold_search(query, max(1, min(4, args.pages)))
            if not htmls:
                raise RuntimeError("no results page reachable (blocked or empty)")
            summary, items = summarize(htmls, datetime.now(timezone.utc), ref)
            db.execute("INSERT OR REPLACE INTO results "
                       "(query_id, query, franchise, character, goods, marketplace, "
                       "sold_90d, median, median_weighted, currency, listings, "
                       "listings_in_window, pages, status, error, checked_at) "
                       "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                       (qid, query, row["franchise"], row["character"], row["goods"],
                        args.marketplace, summary["items_sold_last_90_days"],
                        summary["median_price"], summary["median_price_weighted"],
                        summary["currency"], len(items),
                        summary["listings_sampled_last_90_days"], len(htmls),
                        "ok", "", datetime.now(timezone.utc).isoformat()))
            print(f"    -> sold90d={summary['items_sold_last_90_days']} "
                  f"median={summary['median_price']} {summary['currency']} "
                  f"({len(items)} listings, {len(htmls)} pages, "
                  f"{time.time()-t0:.0f}s)", file=sys.stderr)
        except Exception as e:
            db.execute("INSERT OR REPLACE INTO results "
                       "(query_id, query, franchise, character, goods, marketplace, "
                       "sold_90d, median, median_weighted, currency, listings, "
                       "listings_in_window, pages, status, error, checked_at) "
                       "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                       (qid, query, row["franchise"], row["character"], row["goods"],
                        args.marketplace, None, None, None, None, 0, 0, 0,
                        "error", f"{type(e).__name__}: {e}"[:200],
                        datetime.now(timezone.utc).isoformat()))
            print(f"    -> ERROR {type(e).__name__}: {str(e)[:90]}", file=sys.stderr)
        db.commit()
        delay = args.delay * random.uniform(0.8, 1.3)
        if run < args.limit if args.limit else idx + 1 < total:
            time.sleep(delay)

    write_outputs()
    print("batch complete.")


def html_report(db):
    rows = list(db.execute(
        "SELECT query, franchise, character, goods, marketplace, sold_90d, median, "
        "median_weighted, currency, listings, listings_in_window, pages, status, "
        "error, checked_at FROM results ORDER BY query").fetchall())
    tbody = ""
    for r in rows:
        (q, fr_, ch, goods, mkt, sold, med, medw, cur, n, nw, pages, status, err, when) = r
        style = "" if status == "ok" else "opacity:.4"
        med_s = f"{med:.2f} {cur}" if med is not None else "-"
        medw_s = f"{medw:.2f} {cur}" if medw is not None else "-"
        err_s = err.replace("<", "&lt;")[:60] if err else ""
        tbody += (f"<tr style='{style}' data-status='{status}'>"
                  f"<td>{q}</td><td>{fr_}</td><td>{ch}</td><td>{goods}</td>"
                  f"<td class='num'>{sold if sold is not None else '-'}</td>"
                  f"<td class='num'>{med_s}</td>"
                  f"<td class='num'>{medw_s}</td>"
                  f"<td class='num'>{nw}</td>"
                  f"<td class='num'>{n}</td>"
                  f"<td>{status}{(' ' + err_s) if err_s and status != 'ok' else ''}</td>"
                  f"<td>{(when or '')[:16]}</td></tr>")
    html = """<!doctype html><html><head><meta charset='utf-8'>
<title>eBay sold checker - results</title>
<style>
 body{font:14px/1.45 -apple-system,'Segoe UI',Roboto,sans-serif;margin:20px;background:#f7f9fb}
 h1{font-size:20px;margin:0 0 4px}
 .toolbar{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0}
 input,select{padding:7px 10px;border:1px solid #cfd6de;border-radius:8px;font-size:14px}
 table{border-collapse:collapse;background:#fff;width:100%;font-size:13px}
 th{position:sticky;top:0;background:#0a4fa0;color:#fff;text-align:left;padding:8px 10px;cursor:pointer;user-select:none}
 th.num,td.num{text-align:right}
 td{border-bottom:1px solid #e6ebf1;padding:7px 10px;vertical-align:top}
 tr:hover{background:#f0f6ff}
 .ok{color:#1a7f37}.error{color:#c62828}
</style></head><body>
<h1>eBay sold-in-90-days report</h1>
<div id='count'></div>
<div class='toolbar'>
 <input id='fq' type='search' placeholder='Filter: character, franchise, goods...' style='flex:1;min-width:260px'>
 <select id='franchise'><option value=''>All franchises</option></select>
 <select id='goods'><option value=''>All goods types</option></select>
 <input id='minsold' type='number' min='0' placeholder='min sold' style='width:110px'>
 <label><input type='checkbox' id='onlyok' checked> only successful rows</label>
</div>
<table id='tbl'><thead><tr>
 <th>Query</th><th>Franchise</th><th>Character</th><th>Goods</th>
 <th class='num'>Sold 90d</th><th class='num'>Median</th><th class='num'>Med. weighted</th>
 <th class='num'>In window</th><th class='num'>Listings</th><th>Status</th><th>Checked</th>
</tr></thead><tbody id='tb'>TBODY_ROWS</tbody></table>
<script>
let rows=[...document.querySelectorAll('#tb tr')];
let vals=rows.map(r=>[...r.children].map(c=>c.textContent.trim()));
function opts(sel,i){let s=new Set(vals.map(v=>v[i]).filter(x=>x&&x!=='-'));[...s].sort().forEach(x=>{let o=document.createElement('option');o.value=x;o.textContent=x;sel.appendChild(o);});}
opts(document.getElementById('franchise'),1);opts(document.getElementById('goods'),3);
function num(x){return parseFloat(String(x).replace(',','.'))||0;}
function apply(){
 const q=document.getElementById('fq').value.toLowerCase();
 const fr=document.getElementById('franchise').value;
 const gd=document.getElementById('goods').value;
 const mn=parseFloat(document.getElementById('minsold').value)||0;
 const only=document.getElementById('onlyok').checked;
 let n=0;
 rows.forEach((r,i)=>{const v=vals[i];let show=!q||v.some(x=>x.toLowerCase().includes(q));
  if(fr&&v[1]!==fr)show=false; if(gd&&v[3]!==gd)show=false;
  if(mn&&num(v[4])<mn)show=false; if(only&&r.dataset.status!=='ok')show=false;
  r.style.display=show?'':'none'; if(show)n++;});
 document.getElementById('count').textContent=n+' / '+rows.length+' rows shown';}
['fq','franchise','goods','minsold','onlyok'].forEach(id=>document.getElementById(id).addEventListener('input',apply));
document.querySelectorAll('th').forEach((th,i)=>{th.title='click to sort';
 th.addEventListener('click',()=>{let arr=rows.map((r)=>[r,vals[rows.indexOf(r)][i]]);
  let asc=th.dataset.asc!=='1';th.dataset.asc=asc?'1':'0';
  arr.sort((a,b)=>{let x=a[1],y=b[1];let nx=num(x),ny=num(y);
   if(nx&&ny)return asc?nx-ny:ny-nx; return asc?x.localeCompare(y):y.localeCompare(x);});
  arr.forEach(([r])=>document.getElementById('tb').appendChild(r));});});
apply();
</script></body></html>"""
    with open(os.path.join(BASE, "report.html"), "w") as f:
        f.write(html.replace("TBODY_ROWS", tbody))


if __name__ == "__main__":
    main()
