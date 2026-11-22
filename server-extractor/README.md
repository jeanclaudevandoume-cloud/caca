# eBay Multi-Country Sold-Item Extractor

Retrieves, for a given search title, from each of eBay **US, UK, FR, DE, ES, IT**:

- `items_sold_last_90_days` — number of items sold in the last 90 days
  (sum of per-listing "N sold" quantities, restricted to the 90-day window)
- `median_price` — median sold price (simple) and `median_price_weighted`
  (sold-quantity weighted) in the site's currency
- `ebay_reported_results` — eBay's own result count for the sold query, when shown
- `pages_scraped`, `used_ebay_90_day_filter`, per-listing details

## Usage

```bash
pip install playwright beautifulsoup4
playwright install chromium            # plus `playwright install-deps chromium` on Linux (needs root)

./run.sh "gojo satoru plush" 3          # query, pages per site (1-4)
# or
python3 extractor.py "gojo satoru plush" --pages 3 --sites us,uk,fr,de,es,it --out results.json
```

Results are printed as JSON (and written to `--out`).

## Configuration

`config.json` holds the eBay account credentials used for a silent best-effort
login (or use `EBAY_EMAIL` / `EBAY_PASSWORD` env vars). Login is **never
prompted**: if a CAPTCHA or device check appears, the run continues logged-out —
sold-search data is public and does not require an account.

```json
{ "email": "...", "password": "...", "default_pages": 3 }
```

## How it works

1. For each site, opens the sold-search URL
   `https://<site>/sch/i.html?_nkw=<query>&LH_Sold=1&LH_Complete=1&_ipg=120`
   in headless Chromium with anti-automation flags.
2. If the page exposes eBay's own **"Sold date: Last 90 days"** filter link,
   it is followed so every result is inside the window by definition.
3. Scrapes up to N pages (2–4 recommended), parsing each listing card:
   price (locale-format aware: `$28.00`, `£22.50`, `EUR 24,99`, `24,99 €`),
   sold quantity badges (`29 sold` / `31 verkauft` / `26 vendidos` /
   `19 venduti` …), and sold dates (`Jul 21, 2025`, `21.07.2025`,
   `21 juil. 2025`, `21 lug 2025`…).
4. Applies the 90-day window client-side (undated cards are treated as recent),
   sums quantities, and computes medians.

Parsing is class-agnostic (works across eBay's legacy `s-item` and modern
`brw` result markups) and locale-aware for en/de/fr/es/it.

## Network requirement — important

eBay aggressively 403-blocks requests from **datacenter/cloud IP ranges**
(AWS, GCP, Azure, and common reader-proxy services). Run this from a
**residential connection** (home/office machine). In a cloud/VPS sandbox,
every site returns:

```
"status": "error",
"error": "RuntimeError: eBay returned an error page (HTTP 403); the network
 egress for this machine is blocked by eBay"
```

This is an IP-reputation block at eBay's edge — an environment issue, not a
code issue; browser-based login cannot bypass it from a blocked IP.

## Tests

```bash
python3 extractor.py --selftest
```

Runs the offline parser suite (6 locale fixtures + modern-markup fixture):
90-day windowing, locale price formats, localized sold-quantity badges,
localized date parsing, shipping-cost exclusion, and reported-results parsing.

## Files

- `extractor.py` — extractor + CLI
- `config.json` — credentials and defaults
- `test_parser.py`, `test_modern_markup.py`, `make_fixtures.py` — offline tests
- `run.sh` — convenience runner
- `results.json` — output of the last run
