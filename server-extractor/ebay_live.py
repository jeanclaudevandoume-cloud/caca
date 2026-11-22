#!/usr/bin/env python3
"""Live extraction via the verified-session pipeline.

Flow per site:
  1. curl_cffi session (exact Chrome TLS) through the proxy, seeded with the
     user's verified eBay cookies.
  2. GET the sold search. If eBay serves its sign-in wall, perform the real
     login POST with the credentials (no captcha solving - the verified
     cookies avoid the challenge), then retry.
  3. Paginate (_pgn) up to N pages, parse with extractor.extract_items, and
     summarize (90-day window, quantity-weighted sold count, medians).
"""

import json
import re
import sys
import time
from datetime import datetime, timezone
from html.parser import HTMLParser
from urllib.parse import urlencode

from curl_cffi import requests as creq

import extractor

BASE = extractor.BASE_DIR

PROXY = "http://zdpxkgug:4bwyf9bodr9u@46.203.82.11:6011"
EMAIL = "oflisakal@gmail.com"
PASSWORD = "eb4ytestextracti0n"
COOKIES_FILE = extractor  # replaced below


class FormP(HTMLParser):
    def __init__(self):
        super().__init__()
        self.fields = []
        self.action = None

    def handle_starttag(self, tag, attrs):
        d = dict(attrs)
        if tag == "form" and self.action is None and d.get("action"):
            self.action = d["action"]
        if tag == "input" and d.get("name"):
            if d.get("type") == "submit":
                return
            self.fields.append((d["name"], d.get("value", "")))


def new_session(cookie_files):
    s = creq.Session(impersonate="chrome",
                     proxies={"http": PROXY, "https": PROXY})
    import glob, os
    for f in glob.glob(os.path.join(BASE, "cookies_ebay_*.json")):
        for c in json.load(open(f)):
            s.cookies.set(c["name"], c["value"],
                          domain=c["domain"].lstrip("."), path=c.get("path", "/"))
    return s


def is_signin_wall(text):
    return "signin.ebay" in (re.findall(r'<link rel=canonical href="([^"]+)"', text) or [""])[0] \
        or ("Se connecter" in text and "/itm/" not in text) \
        or ('name="userid"' in text and 'id=signin-form' in text.lower()) \
        or re.search(r"<title>[^<]*(?:Sign in|Se connecter|Anmelden|Acceder|Aceptar)", text, re.I)


def login_on(s, signin_host, ru):
    r = s.get(f"https://{signin_host}/signin/?ru={ru}", timeout=60)
    p = FormP()
    p.feed(r.text)
    data = {}
    for n, v in p.fields:
        data.setdefault(n, v)
    if "userid" not in data or not p.action:
        return None, r
    data["userid"] = EMAIL
    data["pass"] = PASSWORD
    r2 = s.post(p.action if p.action.startswith("http") else f"https://{signin_host}{p.action}",
                data=data, timeout=60, allow_redirects=True,
                headers={"Origin": f"https://{signin_host}",
                         "Referer": f"https://{signin_host}/signin/?ru={ru}"})
    return r2, r


def fetch_sold_pages(s, site, query, pages):
    base_q = urlencode({"_nkw": query, "LH_Sold": "1", "LH_Complete": "1",
                        "_ipg": "120"})
    url = f"https://{site['host']}/sch/i.html?" + base_q
    r = s.get(url, timeout=60)
    for attempt in range(4):
        if r.status_code == 200 and "/itm/" in r.text:
            break
        if r.status_code == 403 or is_signin_wall(r.text):
            host = f"signin.{'.'.join(site['host'].split('.')[1:])}"
            ru = urlencode({"ru": url})[3:]
            time.sleep(2)
            lr, _ = login_on(s, host, requote(url))
            if lr is not None:
                print(f"    login POST -> {lr.status_code}", file=sys.stderr)
                r = lr if "/itm/" in lr.text else s.get(url, timeout=60)
        else:
            time.sleep(3 + attempt)
            r = s.get(url, timeout=60)
    if "/itm/" not in r.text:
        return None, r
    pages_html = [r.text]
    for pgn in range(2, max(2, pages + 1)):
        time.sleep(2.5)
        u2 = url + f"&_pgn={pgn}"
        r2 = s.get(u2, timeout=60)
        if r2.status_code == 200 and "/itm/" in r2.text:
            pages_html.append(r2.text)
        else:
            break
    return pages_html, r


def requote(u):
    from urllib.parse import quote
    return quote(u, safe="")


def summarize(pages_html, site, now):
    items = []
    used_filter = False
    reported = None
    for ph in pages_html:
        parsed = extractor.extract_items(ph, site)
        items.extend(parsed["items"])
        if parsed["filter_90d_link"]:
            used_filter = True
        if parsed["reported_results"] and (reported is None):
            reported = parsed["reported_results"]
    # de-duplicate by (title rounded, price) - pagination overlaps
    seen = set()
    unique = []
    for i in items:
        key = (i["title"][:60], i["price"], i["sold_date"])
        if key in seen:
            continue
        seen.add(key)
        unique.append(i)
    summary = extractor.summarize_site(unique, used_filter, now)
    return summary, unique, reported


def main():
    query = sys.argv[1] if len(sys.argv) > 1 else "gojo satoru plush"
    pages = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    sites = extractor.SITES
    order = ["fr", "it", "es", "de", "uk", "us"]
    s = new_session(COOKIES_FILE)
    now = datetime.now(timezone.utc)
    out = {"query": query, "scraped_at": now.isoformat(), "sites": {}}
    for key in order:
        site = sites[key]
        print(f"[{key}] {site['host']} ...", file=sys.stderr)
        try:
            pages_html, last = fetch_sold_pages(s, site, query, pages)
            if pages_html is None:
                out["sites"][key] = {
                    "site": site["host"], "status": "error",
                    "error": f"couldn't reach sold search (HTTP {last.status_code})"}
                continue
            summary, items, reported = summarize(pages_html, site, now)
            out["sites"][key] = {
                "site": site["host"], "status": "ok", **summary,
                "pages_scraped": len(pages_html),
                "ebay_reported_results": reported,
                "items": items[:240],
            }
            print(f"[{key}] sold_90d={summary['items_sold_last_90_days']} "
                  f"median={summary['median_price']} {summary['currency']} "
                  f"(from {len(items)} listings)", file=sys.stderr)
        except Exception as e:
            out["sites"][key] = {"site": site["host"], "status": "error",
                                 "error": f"{type(e).__name__}: {e}"}
    with open("results_live.json", "w") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    for k, v in out["sites"].items():
        if v.get("status") == "ok":
            print(f"{k}: sold_90d={v['items_sold_last_90_days']} "
                  f"median={v['median_price']} {v['currency']} "
                  f"(weighted {v['median_price_weighted']}, "
                  f"listings={v['listings_sampled_last_90_days']})")
        else:
            print(f"{k}: ERROR {v.get('error')}")


if __name__ == "__main__":
    main()
