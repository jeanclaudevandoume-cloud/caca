#!/usr/bin/env python3
"""Generate the six locale fixtures used by test_parser.py.

Each fixture mimics an eBay sold-search results page (legacy s-item markup,
which the parser handles class-agnostically) in the site's language, currency
format and date format. Sold dates are generated RELATIVE TO TODAY so the
90-day window logic is exercised reproducibly: offsets [20,45,70,85] days are
inside the window, [120,200] are outside and must be excluded.
"""

import os
from datetime import datetime, timedelta, timezone

FIX_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tests", "fixtures")
os.makedirs(FIX_DIR, exist_ok=True)

NOW = datetime.now(timezone.utc)

EN_M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
FR_M = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."]
IT_M = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"]


def date_str(site, days_ago):
    d = NOW - timedelta(days=days_ago)
    if site == "us":                      # Jul 21, 2025
        return f"{EN_M[d.month-1]} {d.day}, {d.year}"
    if site == "uk":                      # 21 Jul 2025
        return f"{d.day} {EN_M[d.month-1]} {d.year}"
    if site == "fr":                      # 21 juil. 2025
        return f"{d.day} {FR_M[d.month-1]} {d.year}"
    if site == "de":                      # 21.07.2025
        return f"{d.day:02d}.{d.month:02d}.{d.year}"
    if site == "es":                      # 21 jul 2025
        return f"{d.day} {EN_M[d.month-1].lower()} {d.year}".replace("jul.", "jul")
    if site == "it":                      # 21 lug 2025
        return f"{d.day} {IT_M[d.month-1]} {d.year}"
    raise ValueError(site)


def mk(site, dates, verbdays):
    sold_verb = {"us": "Sold", "uk": "Sold", "fr": "Vendu", "de": "Verkauft",
                 "es": "Vendido", "it": "Venduto"}[site]
    sold_noun = {"us": "sold", "uk": "sold", "fr": "vendus", "de": "verkauft",
                 "es": "vendidos", "it": "venduti"}[site]
    return sold_verb, sold_noun


def card(href, title, price, sold_line, qty_badge="", ship_line=""):
    qty = f'<span class="s-item__quantitySold">{qty_badge}</span>' if qty_badge else ""
    ship = f'<span class="s-item__shipping">{ship_line}</span>' if ship_line else ""
    return f"""
<li class="s-item">
  <div class="s-item__wrapper clearfix">
    <div class="s-item__image-section"><a href="{href}"><img src="x"/></a></div>
    <div class="s-item__info flex-1">
      <a href="{href}" class="s-item__link"><h3 class="s-item__title">{title}</h3></a>
      <div class="s-item__details clearfix">
        <div class="s-item__detail s-item__detail--primary">
          <span class="s-item__price">{price}</span>
          {qty}
        </div>
        <div class="s-item__detail s-item__detail--secondary">
          <span class="s-item__sold-date">{sold_line}</span>
        </div>
        <div class="s-item__detail s-item__detail--secondary">{ship}</div>
      </div>
    </div>
  </div>
</li>"""


PAGE = """<!doctype html><html><head><title>ebay sold</title></head>
<body><h1 class="srp-controls__count-heading">{count}</h1>
<div class="srp-river-results"><ul class="srp-results">{cards}</ul></div>
<div class="srp-Filter">{filter90}</div>
</body></html>"""

FILTER_90 = ('<a href="/sch/i.html?_nkw=gojo+satoru+plush&amp;LH_Sold=1&amp;'
             'LH_Complete=1&amp;LH_SoldDate=90">Last 90 days</a>')

OFFSETS = [20, 45, 70, 85, 120, 200]

SITES = {
    "us": {"host": "www.ebay.com", "prices": ["$28.00", "$24.99", "$35.50", "$19.99", "$44.00", "$12.50"],
           "qtys": [None, "29 sold", "3 sold", None, None, "5 sold"],
           "ship": ["+ $6.00 shipping", "+ $8.00 shipping", "Free shipping", "+ $5.00 shipping", "", ""],
           "count": "1,732 results"},
    "uk": {"host": "www.ebay.co.uk", "prices": ["£22.50", "£18.99", "£30.00", "£26.75", "£41.00", "£9.99"],
           "qtys": [None, "17 sold", "2 sold", None, None, "4 sold"],
           "ship": ["Free postage", "+ £4.50 postage", "", "+ £3.00 postage", "", ""],
           "count": "584 results"},
    "fr": {"host": "www.ebay.fr", "prices": ["EUR 24,99", "EUR 19,90", "EUR 29,00", "EUR 27,50", "EUR 40,00", "EUR 11,25"],
           "qtys": [None, "23 vendus", "3 vendus", None, None, "6 vendus"],
           "ship": ["Livraison + 5,00 EUR", "Livraison + 6,50 EUR", "", "", "", ""],
           "count": "412 résultats"},
    "de": {"host": "www.ebay.de", "prices": ["24,99 €", "19,90 €", "29,00 €", "27,50 €", "40,00 €", "11,25 €"],
           "qtys": [None, "31 verkauft", "3 verkauft", None, None, "6 verkauft"],
           "ship": ["+ 5,00 € Versand", "+ 6,50 € Versand", "", "", "", ""],
           "count": "1.204 Ergebnisse"},
    "es": {"host": "www.ebay.es", "prices": ["24,99 EUR", "19,90 EUR", "29,00 EUR", "27,50 EUR", "40,00 EUR", "11,25 EUR"],
           "qtys": [None, "26 vendidos", "3 vendidos", None, None, "6 vendidos"],
           "ship": ["Envío + 5,00 EUR", "Envío + 6,50 EUR", "", "", "", ""],
           "count": "358 resultados"},
    "it": {"host": "www.ebay.it", "prices": ["EUR 24,99", "EUR 19,90", "EUR 29,00", "EUR 27,50", "EUR 40,00", "EUR 11,25"],
           "qtys": [None, "19 venduti", "3 venduti", None, None, "6 venduti"],
           "ship": ["Spedizione + 5,00 EUR", "Spedizione + 6,50 EUR", "", "", "", ""],
           "count": "291 risultati"},
}


def build(site):
    cfg = SITES[site]
    verb, noun = mk(site, None, None)
    cards = []
    for i, off in enumerate(OFFSETS):
        href = f"https://{cfg['host']}/itm/296{abs(hash(site)) % 100000:05d}{i:03d}"
        sold_line = f"{verb}  {date_str(site, off)}"
        qty = cfg["qtys"][i] or ""
        cards.append(card(f"https://{cfg['host']}/itm/29600000000{i}",
                          f"Gojo Satoru plush item {i}",
                          cfg["prices"][i], sold_line, qty, cfg["ship"][i]))
    return PAGE.format(count=cfg["count"], cards="\n".join(cards), filter90=FILTER_90)


for site in SITES:
    path = os.path.join(FIX_DIR, f"fixture_{site}.html")
    with open(path, "w") as f:
        f.write(build(site))
    print("wrote", path)
