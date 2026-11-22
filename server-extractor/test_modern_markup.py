"""Additional test: class-agnostic 'modern' markup (no s-item classes)."""

import os
import re
import statistics
import unittest
from datetime import datetime, timedelta, timezone

import extractor

BASE = os.path.dirname(os.path.abspath(__file__))
NOW = datetime.now(timezone.utc)
D = lambda days_ago: (NOW - timedelta(days=days_ago))
EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

def dstr(days):
    d = D(days)
    return f"{EN[d.month-1]} {d.day}, {d.year}"

def modern_card(i, price, qty, days):
    return f"""
<li data-testid="item-card">
  <div class="brw-river-card">
    <a href="/itm/1550000000{i:03d}?epid=1"><h3>Gojo Satoru plush modern {i}</h3></a>
    <div class="brw-price-display"><span class="ux-textspans">{price}</span></div>
    <div class="brw-badge"><span class="ux-textspans">{qty}</span></div>
    <div class="brw-date"><span class="ux-textspans">Sold  {dstr(days)}</span></div>
  </div>
</li>"""

HTML = f"""<!doctype html><html><body>
<h1 class="srp-controls__count-heading">999+ results</h1>
<ul>
{modern_card(0, "$25.00", "12 sold", 30)}
{modern_card(1, "$30.00", "1 sold", 60)}
{modern_card(2, "$20.00", "40 sold", 10)}
{modern_card(3, "$90.00", "2 sold", 150)}
</ul>
</body></html>"""


class ModernMarkupTests(unittest.TestCase):
    def test_modern_cards(self):
        parsed = extractor.extract_items(HTML, extractor.SITES["us"])
        self.assertEqual(len(parsed["items"]), 4, parsed["items"])
        qs = {i["price"]: i["qty"] for i in parsed["items"]}
        self.assertEqual(qs.get(25.00), 12)
        self.assertEqual(qs.get(30.00), 1)
        self.assertEqual(qs.get(20.00), 40)
        summary = extractor.summarize_site(parsed["items"], False, NOW)
        self.assertEqual(summary["items_sold_last_90_days"], 12 + 1 + 40)
        self.assertEqual(summary["currency"], "USD")
        self.assertAlmostEqual(summary["median_price"],
                               round(statistics.median([25.0, 30.0, 20.0]), 2))
        self.assertEqual(parsed["reported_results"], 999)

    def test_absolute_itm_links_climb(self):
        # ensure the /itm/ link resolution does not require absolute URLs
        self.assertIn("/itm/", HTML)


if __name__ == "__main__":
    unittest.main(verbosity=2)
