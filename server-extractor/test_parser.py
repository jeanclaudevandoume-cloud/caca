"""Offline validation of the extractor's parsing pipeline against fixtures.

Expected values below mirror make_fixtures.py: items with sold-date offsets
[20, 45, 70, 85] days are inside the 90-day window, [120, 200] are outside.
"""

import os
import statistics
import unittest
from datetime import datetime, timezone

import extractor

FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tests", "fixtures")
NOW = datetime.now(timezone.utc)

# per site: (prices of in-window items, qtys of in-window items, currency,
#            expected median (simple, rounded 2dp))
EXPECT = {
    "us": ([28.00, 24.99, 35.50, 19.99], [1, 29, 3, 1], "USD"),
    "uk": ([22.50, 18.99, 30.00, 26.75], [1, 17, 2, 1], "GBP"),
    "fr": ([24.99, 19.90, 29.00, 27.50], [1, 23, 3, 1], "EUR"),
    "de": ([24.99, 19.90, 29.00, 27.50], [1, 31, 3, 1], "EUR"),
    "es": ([24.99, 19.90, 29.00, 27.50], [1, 26, 3, 1], "EUR"),
    "it": ([24.99, 19.90, 29.00, 27.50], [1, 19, 3, 1], "EUR"),
}

EXPECTED_90D_FILTER_LINKS = {s: True for s in EXPECT}


def load(site):
    with open(os.path.join(FIX, f"fixture_{site}.html")) as f:
        return f.read()


class ParsingTests(unittest.TestCase):
    def test_all_sites(self):
        for site, (prices, qtys, currency) in EXPECT.items():
            with self.subTest(site=site):
                html = load(site)
                parsed = extractor.extract_items(html, extractor.SITES[site])
                self.assertEqual(len(parsed["items"]), 6,
                                 f"expected 6 cards parsed, got {len(parsed['items'])}: "
                                 f"{[i['title'] for i in parsed['items']]}")
                summary = extractor.summarize_site(parsed["items"], False, NOW)
                in_window = within_90d(parsed["items"])
                self.assertEqual(len(in_window), 4, "4 items inside window")
                self.assertEqual(
                    summary["items_sold_last_90_days"], sum(qtys),
                    f"qty-sum mismatch for {site}")
                self.assertEqual(summary["currency"], currency)
                for i in in_window:
                    self.assertIn(i["price"], prices)
                self.assertAlmostEqual(
                    summary["median_price"],
                    round(statistics.median(prices), 2), places=2)

    def test_reported_results_parsed(self):
        for site, expected in {"us": 1732, "uk": 584, "fr": 412, "de": 1204,
                               "es": 358, "it": 291}.items():
            with self.subTest(site=site):
                parsed = extractor.extract_items(load(site), extractor.SITES[site])
                self.assertEqual(parsed["reported_results"], expected)

    def test_90_day_filter_link_detected(self):
        for site in EXPECTED_90D_FILTER_LINKS:
            with self.subTest(site=site):
                parsed = extractor.extract_items(load(site), extractor.SITES[site])
                self.assertTrue(parsed["filter_90d_link"],
                                "90-day filter link not detected")

    def test_out_of_window_excluded(self):
        html = load("us")
        parsed = extractor.extract_items(html, extractor.SITES["us"])
        dates = sorted(i["sold_date"] for i in parsed["items"] if i["sold_date"])
        old = [d for d in dates if (NOW - datetime.fromisoformat(d).replace(
            tzinfo=timezone.utc)).days > 90]
        self.assertEqual(len(old), 2, "two stale listings expected")

    def test_price_parsing_locales(self):
        cases = [
            ("$28.00", "USD", 28.00), ("US $35.50", "USD", 35.50),
            ("£22.50", "GBP", 22.50), ("EUR 24,99", "EUR", 24.99),
            ("24,99 €", "EUR", 24.99), ("40,00 EUR", "EUR", 40.00),
            ("1.234,56 €", "EUR", 1234.56), ("1,234.56", None, None),
        ]
        for text, cur, val in cases:
            with self.subTest(text=text):
                out = extractor.parse_price(text, "EUR")
                if val is None:
                    self.assertIsNone(out)
                else:
                    self.assertEqual(out[0], cur)
                    self.assertAlmostEqual(out[1], val, places=2)

    def test_shipping_price_not_chosen(self):
        html = load("us").replace("$28.00", "$28.00 + $999.00 shipping")
        parsed = extractor.extract_items(html, extractor.SITES["us"])
        prices = sorted(i["price"] for i in parsed["items"])
        self.assertIn(28.00, prices)
        self.assertNotIn(999.00, prices)


# helper used above
def within_90d(items):
    return [i for i in items if extractor.within_90d(i, NOW)]


if __name__ == "__main__":
    unittest.main(verbosity=2)
