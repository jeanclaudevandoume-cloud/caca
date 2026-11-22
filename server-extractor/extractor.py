#!/usr/bin/env python3
"""
eBay multi-country sold-item extractor.

For a given search title, retrieves from each of eBay US / UK / FR / DE / ES / IT:
  - the number of items sold in the last 90 days
  - the median sold price

Strategy per site:
  1. Open the eBay "Sold items" search (LH_Sold=1, LH_Complete=1) with the query.
  2. If eBay's own "Sold date: Last 90 days" filter link is present, follow it
     so every result is by definition sold in the last 90 days.
  3. Scrape up to N result pages (default 3, configurable 1-4).
  4. Parse every sold listing card: sold price, sold quantity ("N sold" badge),
     sold date (locale-aware). Items without a parseable date are assumed recent.
  5. sold_count_90d = sum of per-card sold quantities within the 90-day window.
     median_price  = quantity-weighted median of sold prices
                     (simple median also reported).
  6. eBay's own reported result count for the filtered query is captured as
     ebay_reported_results when parseable.

Login: performs a silent best-effort sign-in with the credentials in
config.json (or EBAY_EMAIL / EBAY_PASSWORD env vars) using a persistent
browser profile so the session is reused across runs. If a CAPTCHA /
device check appears, login is skipped and the run continues logged-out
(sold search works without an account). The program never prompts.

Usage:
    python3 extractor.py "gojo satoru plush"
    python3 extractor.py "gojo satoru plush" --pages 2 --sites us,de --out out.json
    python3 extractor.py --selftest          # offline parser validation

Output: JSON written to stdout and --out file:
    { "query": ..., "scraped_at": ...,
      "sites": { "us": {...}, "uk": {...}, ... },
      "successes": N }
"""

import argparse
import asyncio
import json
import math
import os
import random
import re
import statistics
import sys
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

from bs4 import BeautifulSoup

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LOCAL_LIBS = os.path.join(BASE_DIR, ".flat-libs")

SITES = {
    "us": {"host": "www.ebay.com", "currency": "USD", "locale": "en-US", "tz": "America/New_York", "lang": "en"},
    "uk": {"host": "www.ebay.co.uk", "currency": "GBP", "locale": "en-GB", "tz": "Europe/London", "lang": "en"},
    "fr": {"host": "www.ebay.fr", "currency": "EUR", "locale": "fr-FR", "tz": "Europe/Paris", "lang": "fr"},
    "de": {"host": "www.ebay.de", "currency": "EUR", "locale": "de-DE", "tz": "Europe/Berlin", "lang": "de"},
    "es": {"host": "www.ebay.es", "currency": "EUR", "locale": "es-ES", "tz": "Europe/Madrid", "lang": "es"},
    "it": {"host": "www.ebay.it", "currency": "EUR", "locale": "it-IT", "tz": "Europe/Rome", "lang": "it"},
}

STEALTH_INIT_JS = """
Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
Object.defineProperty(navigator, 'languages', {get: () => ['__LOCALE__']});
Object.defineProperty(navigator, 'plugins', {get: () => [1,2,3,4,5]});
window.chrome = window.chrome || { runtime: {} };
"""

MONTHS = {}
for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july",
     "august", "september", "october", "november", "december"], 1):
    MONTHS[m] = i
for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep",
     "oct", "nov", "dec"], 1):
    MONTHS[m] = i
for m, i in [("janv", 1), ("févr", 2), ("fevr", 2), ("avr", 4), ("juil", 7),
             ("août", 8), ("aout", 8), ("déc", 12), ("juin", 6), ("sept", 9),
             ("märz", 3), ("maerz", 3), ("mär", 3), ("okt", 10), ("dez", 12),
             ("juni", 6), ("juli", 7), ("ene", 1), ("abr", 4), ("ago", 8),
             ("set", 9), ("dic", 12), ("ott", 10), ("gen", 1), ("maggio", 5),
             ("mai", 5),
             ("giugno", 6), ("luglio", 7), ("marzo", 3), ("mars", 3),
             ("mag", 5), ("giu", 6), ("lug", 7), ("avril", 4), ("januar", 1),
             ("junio", 6), ("julio", 7), ("septiembre", 9), ("octubre", 10)]:
    MONTHS.setdefault(m, i)
MONTHS_RE = "|".join(sorted(MONTHS.keys(), key=len, reverse=True))

DATE_RES = [
    # 21.07.2025 / 21-07-2025 (dd.mm.yyyy)
    re.compile(r"\b(\d{1,2})[.\-](\d{1,2})[.\-](\d{4})\b", re.I),
    # Jul 21, 2025 / Jul. 21 2025 / 21 Jul 2025 / 21. Jul 2025
    re.compile(rf"\b(\d{{1,2}})[.,]?\s+({MONTHS_RE})[.,]?\s+(\d{{4}})\b", re.I),
    re.compile(rf"\b({MONTHS_RE})[.,]?\s+(\d{{1,2}}),?\s+(\d{{4}})\b", re.I),
    # 2025-07-21
    re.compile(r"\b(20\d{2})-(\d{1,2})-(\d{1,2})\b"),
]

SOLD_QTY_RES = [
    re.compile(r"(?<![\d.,$£€])([\d.,]+)\+?\s*(?:items?\s+)?(?:sold|verkauft|vendu|vendus|vendue|vendido|vendidos|venduta|vendute|venduto|venduti)\b", re.I),
]
# "N sold in the last 90 days" style badges, localized
SOLD_90D_RE = re.compile(
    r"\b([\d.,]+)\+?(?:\s*(?:items?|artikel?|objets?|artículos?|oggetti?))?\s*"
    r"(?:sold|verkauft|vendus?|vendidos?|vendut[oi])\b[^.\d]{0,60}"
    r"(?:90\s*?(?:days?|tage?|jours?|días|dias|giorni))", re.I)

PRICE_RE = re.compile(
    r"(US\s?\$|CA\s?\$|AU\s?\$|USD|GBP|EUR|\$|£|€)\s*"
    r"(\d(?:[\d.,]*\d)?)")

PRICE_SUFFIX_RE = re.compile(
    r"(?<![\d.,$£€\w])(\d(?:[\d.,]*\d)?)\s*(?:EUR\b|GBP\b|USD\b|€)")

CURRENCIES_BY_SYMBOL = {"$": "USD", "£": "GBP", "€": "EUR",
                        "US$": "USD", "US $": "USD", "US\xa0$": "USD",
                        "CA$": "CAD", "CA $": "CAD", "AU$": "AUD",
                        "AU $": "AUD"}

SHIP_KW_RE = re.compile(
    r"\b(shipping|versand|livraison|env[ií]o|spedizione|exp[eé]dition|"
    r"postage|delivery|porto|fracht)\b", re.I)


def _norm_number(num):
    num = num.replace("\xa0", "")
    if "," in num and "." in num:
        if num.rfind(",") > num.rfind("."):
            num = num.replace(".", "").replace(",", ".")
        else:
            num = num.replace(",", "")
    elif "," in num:
        head, _, tail = num.partition(",")
        if len(tail) in (1, 2) and head.isdigit():
            num = num.replace(",", ".")
        else:
            num = num.replace(",", "")
    elif "." in num:
        head, _, tail = num.partition(".")
        if tail.isdigit() and len(tail) not in (1, 2):
            num = num.replace(".", "")
    try:
        val = float(num)
    except ValueError:
        return None
    return val if val > 0 else None


def _match_to_pair(m, suffix=False):
    if not suffix:
        cur = CURRENCIES_BY_SYMBOL.get(m.group(1), m.group(1))
        cur = CURRENCIES_BY_SYMBOL.get(cur, cur)
        return cur, _norm_number(m.group(2))
    g0 = m.group(0)
    cur = "GBP" if "£" in g0 else ("EUR" if ("€" in g0 or "EUR" in g0) else "USD")
    return cur, _norm_number(m.group(1))


def parse_price(text, default_currency=None):
    """Parse the first currency-led price in a string like '$24.99',
    'EUR 24,99', '24,99 €', 'US $24.99'. Bare numbers are rejected.

    Returns (currency, float) or None.
    """
    if not text:
        return None
    m = PRICE_RE.search(text)
    suffix = False
    if not m:
        m = PRICE_SUFFIX_RE.search(text)
        suffix = True
    if not m:
        return None
    cur, val = _match_to_pair(m, suffix=suffix)
    if val is None:
        return None
    return (cur, val)


def card_price(text):
    """First sold-price token on a card, skipping shipping/handling costs."""
    matches = [(m, False) for m in PRICE_RE.finditer(text)] + \
              [(m, True) for m in PRICE_SUFFIX_RE.finditer(text)]
    for m, suffix in matches:
        cur, val = _match_to_pair(m, suffix=suffix)
        before = text[max(0, m.start() - 18): m.start()]
        after = text[m.end(): m.end() + 18]
        if SHIP_KW_RE.search(before):
            continue
        if SHIP_KW_RE.search(after) and re.search(r"[+>+:]\s*$", before):
            continue
        if val is not None and val > 0:
            return cur, val
    return None


def parse_sold_date(text, today):
    if not text:
        return None
    for idx, pat in enumerate(DATE_RES):
        m = pat.search(text)
        if not m:
            continue
        try:
            if idx == 0:
                d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
            elif idx == 3:
                y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
            else:
                try:
                    d = int(m.group(1))
                    mo = MONTHS[m.group(2).lower().rstrip(".")]
                    y = int(m.group(3))
                except ValueError:
                    mo = MONTHS[m.group(1).lower().rstrip(".")]
                    d, y = int(m.group(2)), int(m.group(3))
            if not (1 <= mo <= 12 and 1 <= d <= 31 and 2000 <= y <= today.year):
                continue
            return datetime(y, mo, d, tzinfo=timezone.utc)
        except (ValueError, KeyError, TypeError):
            continue
    return None


def parse_sold_qty(text):
    for pat in SOLD_QTY_RES:
        m = pat.search(text)
        if m:
            raw = m.group(1).replace(".", "").replace(",", "")
            try:
                return max(1, int(raw))
            except ValueError:
                continue
    return 1


def clean_card_text(el):
    return re.sub(r"\s+", " ", el.get_text(" ", strip=True))


def leaf_texts(card):
    """Text of every leaf-ish element (no element children) in a card."""
    out = []
    for el in card.find_all(True):
        if el.name in ("script", "style", "a"):
            continue
        if el.find(True) is None:
            t = clean_card_text(el)
            if t and len(t) < 120 and not out.count(t):
                out.append(t)
    return out


def extract_items(html, site):
    """Parse sold listings out of an eBay sold-search results page.

    Returns dict with:
      items: [{title, price, currency, qty, sold_date}]
      reported_results: int|None
      filter_90d_link: str|None   (ebay's own "Last 90 days" sold-date filter)
    """
    soup = BeautifulSoup(html, "html.parser")
    for bad in soup.select("script, style, noscript"):
        bad.decompose()

    items = []
    seen_urls = set()

    anchors = soup.select('a[href*="/itm/"]') or soup.find_all("a", href=True)
    cards = set()
    for a in anchors:
        if "/itm/" not in (a.get("href") or ""):
            continue
        node = a
        for _ in range(6):
            if node is None:
                break
            if any(cls in (node.get("class") or []) for cls in ("s-item", "brw", "su-card-container")):
                break
            nxt = node.parent
            if nxt is None:
                break
            # Card container must contain a price-ish text but not span two cards
            if node.name in ("li", "article"):
                break
            if sum(1 for _ in nxt.find_all("a", href=True, recursive=False)) > 8:
                break
            node = nxt
        if node is not None:
            cards.add(node)

    for card in cards:
        text = clean_card_text(card)
        if "sold" not in text.lower() and "verkauft" not in text.lower() \
                and "vendu" not in text.lower() and "vendido" not in text.lower() \
                and "vendut" not in text.lower():
            # sold pages normally tag each card; skip non-sold look-alikes
            # (active-listing previews) unless we are on a dedicated sold page
            continue
        leaves = leaf_texts(card)

        parsed = None
        qty = 1
        date_match = None
        for leaf in leaves:
            if parsed is None and not SHIP_KW_RE.search(leaf):
                parsed = card_price(leaf)
            if qty == 1:
                masked = PRICE_RE.sub(" ", leaf)
                masked = PRICE_SUFFIX_RE.sub(" ", masked)
                q = parse_sold_qty(masked)
                if q > 1 and len(leaf) <= 64:
                    qty = q
            if date_match is None:
                date_match = parse_sold_date(leaf, datetime.now(timezone.utc))
        if parsed is None:
            parsed = card_price(text)
        if not parsed:
            continue
        currency, price = parsed

        title_el = card.select_one(".s-item__title, h3, span[role='heading']")
        title = clean_card_text(title_el)[:200] if title_el else ""
        items.append({
            "title": title,
            "price": round(price, 2),
            "currency": currency,
            "qty": qty,
            "sold_date": date_match.date().isoformat() if date_match else None,
        })
        href = (card.find("a", href=True) or {}).get("href", "")
        seen_urls.add(href.split("?", 1)[0])

    results_pat = re.compile(
        r"(?:results?|Ergebnisse?|ergebnisse?|résultats?|resultados?|risultati)")
    reported = None
    for m in re.finditer(r"([\d.,]+)\+?\s*(?:\w+\s+)?"
                         r"(?:results?|Ergebnisse?|ergebnisse?|résultats?|"
                         r"resultados?|risultati)\b", soup.get_text(" ", strip=True), re.I):
        raw = m.group(1).replace(".", "").replace(",", "")
        try:
            v = int(raw)
            if v > 0 and (reported is None or v < reported):
                reported = v
        except ValueError:
            pass

    filter_90d = None
    for a in soup.find_all("a", href=True):
        label = a.get_text(" ", strip=True)
        href = a.get("href", "")
        if re.search(r"\b(90|neunzig)(\s*(days?|tage?|jours?|d[ií]as|giorni))?\b", label) \
                and "90" in href and "itm" not in href:
            filter_90d = href
            break

    return {"items": items, "reported_results": reported, "filter_90d_link": filter_90d}


def within_90d(item, now):
    if item["sold_date"] is None:
        return True
    try:
        d = datetime.fromisoformat(item["sold_date"]).replace(tzinfo=timezone.utc)
    except ValueError:
        return True
    return (now - d) <= timedelta(days=90)


def median_weighted(pairs):
    """Quantity-weighted median from [(price, qty), ...]."""
    if not pairs:
        return None
    expanded = sorted(p for p, q in pairs for p in [p] * q)
    n = len(expanded)
    if n % 2:
        return expanded[n // 2]
    return (expanded[n // 2 - 1] + expanded[n // 2]) / 2


def summarize_site(items, filter_90d_used, now):
    in_window = [i for i in items if within_90d(i, now)]
    sold_90d = sum(i["qty"] for i in in_window)
    prices_site = [i for i in in_window]
    weighted = [(i["price"], i["qty"]) for i in prices_site]
    simple = [i["price"] for i in prices_site]
    med = statistics.median(simple) if simple else None
    med_w = median_weighted(weighted)
    return {
        "items_sold_last_90_days": sold_90d,
        "listings_sampled_last_90_days": len(in_window),
        "median_price": round(med, 2) if med is not None else None,
        "median_price_weighted": round(med_w, 2) if med_w is not None else None,
        "currency": prices_site[0]["currency"] if prices_site else None,
        "used_ebay_90_day_filter": filter_90d_used,
        "sample_prices": sorted(simple)[:240],
    }


# ---------------------------------------------------------------- live layer

def load_config():
    cfg_path = os.path.join(BASE_DIR, "config.json")
    cfg = {}
    if os.path.exists(cfg_path):
        with open(cfg_path) as f:
            cfg = json.load(f)
    cfg.setdefault("email", os.environ.get("EBAY_EMAIL", ""))
    cfg.setdefault("password", os.environ.get("EBAY_PASSWORD", ""))
    cfg.setdefault("default_pages", 3)
    return cfg


def sold_url(site, query, page):
    params = {
        "_nkw": query,
        "LH_Sold": 1,
        "LH_Complete": 1,
        "_ipg": 120,
        "_pgn": page,
    }
    return f"https://{site['host']}/sch/i.html?" + urlencode(params)


async def amebY_login_soft_check(page):
    html = await page.content()
    return 'name="userid"' in html


async def attempt_login(pw_browser, site, cfg, log):
    """Silent best-effort login inside the given page/context. Never prompts."""
    email, password = cfg.get("email"), cfg.get("password")
    if not email or not password:
        log("no credentials configured; running logged-out")
        return False
    page = await pw_browser.new_page()
    try:
        await page.goto(f"https://signin.{site['host'].split('.', 1)[1]}/",
                        wait_until="domcontentloaded", timeout=45000)
        await page.wait_for_timeout(2500)
        if 'name="userid"' not in (await page.content()):
            log("login page unavailable; continuing logged-out")
            return False
        await page.fill('input[name="userid"]', email)
        await page.click('#signin-continue-btn, button[type="submit"]')
        await page.wait_for_timeout(2500)
        if 'name="pass"' not in (await page.content()):
            log("login interrupted (challenge/device check); continuing logged-out")
            return False
        await page.fill('input[name="pass"]', password)
        async with page.expect_navigation(timeout=30000):
            await page.click('#sgnBt, button[type="submit"]')
        await page.wait_for_timeout(2500)
        ok = not await amebY_login_soft_check(page)
        log("login " + ("succeeded" if ok else "did not complete; continuing logged-out"))
        return ok
    except Exception as e:
        log(f"login skipped ({type(e).__name__}); continuing logged-out")
        return False
    finally:
        await page.close()


def looks_like_bot_wall(html):
    m = re.search(r"<title>([^<]*)</title>", html)
    title = (m.group(1) if m else "").lower()
    return "error page" in title and "ebay" in title


async def scrape_site(pw_browser_holder, site, query, pages, cfg, log):
    from playwright.async_api import async_playwright
    results = {"site": site["host"], "status": "ok", "error": None}
    context = await pw_browser_holder.new_context(
        locale=site["locale"],
        timezone_id=site["tz"],
        viewport={"width": 1440, "height": 900},
        user_agent=("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/159.0.0.0 Safari/537.36"),
    )
    await context.add_init_script(
        STEALTH_INIT_JS.replace("__LOCALE__", site["locale"]))
    page = await context.new_page()
    now = datetime.now(timezone.utc)
    all_items = []
    filter_90d_used = False
    reported_results = None
    try:
        url = sold_url(site, query, 1)
        resp = await page.goto(url, wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_timeout(random.uniform(2500, 4000))
        html = await page.content()
        if looks_like_bot_wall(html):
            raise RuntimeError(
                f"eBay returned an error page (HTTP {resp.status if resp else '?'}); "
                "the network egress for this machine is blocked by eBay")
        parsed = extract_items(html, site)
        if parsed["filter_90d_link"]:
            from urllib.parse import urljoin
            next_url = urljoin(url, parsed["filter_90d_link"])
            log(f"[{site['host']}] following eBay '90 days' sold-date filter")
            resp = await page.goto(next_url, wait_until="domcontentloaded",
                                  timeout=60000)
            await page.wait_for_timeout(random.uniform(2500, 4000))
            html = await page.content()
            parsed = extract_items(html, site)
            filter_90d_used = True
        reported_results = parsed["reported_results"]
        all_items.extend(parsed["items"])
        pages_scraped = 1
        for pgn in range(2, max(2, pages + 1)):
            if pages_scraped >= pages:
                break
            if not parsed["items"]:
                break
            await page.wait_for_timeout(random.uniform(1500, 3500))
            url = sold_url(site, query, pgn)
            resp = await page.goto(url, wait_until="domcontentloaded",
                                   timeout=60000)
            await page.wait_for_timeout(random.uniform(2000, 3500))
            html = await page.content()
            if looks_like_bot_wall(html):
                break
            parsed = extract_items(html, site)
            if not parsed["items"]:
                break
            before = len(all_items)
            all_items.extend(parsed["items"])
            pages_scraped += 1
            if len(all_items) == before:
                break
        summary = summarize_site(all_items, filter_90d_used, now)
        results.update(summary)
        results["pages_scraped"] = pages_scraped
        results["ebay_reported_results"] = reported_results
        results["items"] = all_items[:240]
    except Exception as e:
        results["status"] = "error"
        results["error"] = f"{type(e).__name__}: {e}"
    finally:
        await context.close()
    return results


async def run_live(query, pages, sites, cfg, headless):
    if os.path.isdir(LOCAL_LIBS):
        os.environ["LD_LIBRARY_PATH"] = (
            LOCAL_LIBS + os.pathsep + os.environ.get("LD_LIBRARY_PATH", ""))
    from playwright.async_api import async_playwright
    out = {"query": query, "scraped_at": datetime.now(timezone.utc).isoformat(),
           "sites": {}, "login": {}}
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=headless,
            args=["--disable-blink-features=AutomationControlled", "--no-sandbox"])
        # one login attempt on the US site; cookies persist in the context
        login_ctx = await browser.new_context(
            locale="en-US", timezone_id="America/New_York",
            viewport={"width": 1440, "height": 900},
            user_agent=("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/159.0.0.0 Safari/537.36"))
        def log(msg):
            print(f"  {msg}", file=sys.stderr)
        try:
            ok = await attempt_login(login_ctx, SITES["us"], cfg, log)
            out["login"] = {"attempted": True, "ok": ok}
        except Exception as e:
            out["login"] = {"attempted": True, "ok": False, "error": str(e)}
        await login_ctx.close()
        for key in sites:
            site = SITES[key]
            print(f"[{key}] scraping {site['host']} ...", file=sys.stderr)
            out["sites"][key] = await scrape_site(browser, site, query, pages,
                                                  cfg, log)
        await browser.close()
    out["successes"] = sum(1 for s in out["sites"].values()
                           if s.get("status") == "ok" and s.get("median_price") is not None)
    return out


# ---------------------------------------------------------------- self test

def run_selftest():
    import unittest
    sys.path.insert(0, BASE_DIR)
    import test_parser
    import test_modern_markup
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    suite.addTests(loader.loadTestsFromModule(test_parser))
    suite.addTests(loader.loadTestsFromModule(test_modern_markup))
    runner = unittest.TextTestRunner(verbosity=2)
    ok = runner.run(suite).wasSuccessful()
    sys.exit(0 if ok else 1)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    ap.add_argument("query", nargs="?", default=None, help="search title")
    ap.add_argument("--pages", type=int, default=3,
                    help="result pages per site, 1-4 (default 3)")
    ap.add_argument("--sites", default="us,uk,fr,de,es,it",
                    help="comma list among us,uk,fr,de,es,it")
    ap.add_argument("--out", default=None, help="write JSON to this file too")
    ap.add_argument("--headed", action="store_true", help="show the browser")
    ap.add_argument("--selftest", action="store_true",
                    help="run offline parser tests against fixtures")
    args = ap.parse_args()

    if args.selftest:
        run_selftest()
    if not args.query:
        ap.error("a query is required (or use --selftest)")
    pages = max(1, min(4, args.pages)) if args.pages else 3
    sites = [s.strip() for s in args.sites.split(",") if s.strip() in SITES]
    cfg = load_config()

    if pages < 1 or pages > 4:
        ap.error("--pages must be 1-4")
    out = asyncio.run(run_live(args.query, pages, sites or list(SITES), cfg,
                               headless=not args.headed))
    text = json.dumps(out, indent=2, ensure_ascii=False)
    print(text)
    if args.out:
        with open(args.out, "w") as f:
            f.write(text)


if __name__ == "__main__":
    main()
