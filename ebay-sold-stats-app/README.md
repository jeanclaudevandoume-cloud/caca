# eBay Sold Stats (Android)

A tiny, dependency-free Android app that, for a search title on a chosen eBay
marketplace (US / UK / FR / DE / ES / IT), extracts:

- **items sold in the last 90 days** (sum of per-listing "N sold" quantities
  inside the 90-day window)
- **median sold price** (simple and sold-quantity weighted), in the site currency

## Install

Sideload `ebay-sold-stats.apk` (Android 5.0+, ~25 KB, debug-signed).
Enable "install unknown apps" for whatever opened the APK, then install.

## Use

1. Pick the marketplace, type the title (e.g. `gojo satoru plush`), press
   **Extract sold stats**.
2. Sold searches require an eBay sign-in: put your eBay email/password in
   **Settings** and the app auto-fills the login form. If eBay shows a human
   check, complete it once in the app window — the session is remembered.
3. Results: sold count in last 90 days + median price, after scanning up to
   4 result pages (configurable in Settings).

## Settings

- eBay account (auto-fills login)
- Pages to scan per marketplace (1–4)
- **Cookie fallback**: paste an EditThisCookie JSON export. If a marketplace
  returns eBay's 403 wall, the app injects the cookies whose `domain` matches
  that marketplace and retries automatically.

## How it works

The app drives a real WebView (Chromium): requests to eBay carry a genuine
browser fingerprint and TLS, so the extraction behaves like normal browsing.
The results page is parsed in-page (JS) with locale-aware rules:
prices (`$28.00`, `£22.50`, `EUR 24,99`, `22,97 €`), sold badges
(`sold / verkauft / vendus / vendidos / venduti`), sold dates in EN/DE/FR/ES/IT,
shipping costs excluded. Listings without a parseable date are treated as
recent.

Validation: the embedded parser run against a captured live eBay FR sold-search
page returned identical results to the offline Python reference extractor
(69 listings, 66 within the 90-day window, median €21.87).

## Build from source

`build-apk.sh` builds and signs the APK with only the Android SDK
build-tools (aapt2/d8/zipalign/apksigner), a JDK, and the android-34 platform —
no Gradle, no dependencies:

```bash
SDK=/path/to/sdk; JDK=/path/to/jdk  # adjust inside the script
bash build-apk.sh
```

No analytics, no tracking, INTERNET permission only.

## v1.1 (latest)

- Fix: page-load double-triggering eliminated (exactly one driver run per page,
  with bounded re-check before ever reporting "no sold listings found"),
  so an interstitial page no longer prints a false negative before results.
- The embedded eBay browser is now hidden while extracting: the results area
  takes the full screen and is scrollable. The browser auto-expands only when
  eBay requires you to sign in or pass a check, and collapses back afterwards.
  A "Show browser / Hide browser" button toggles it on demand.
- Regression check: on a captured live eBay FR sold-search page, the app's
  parser returns results identical to the Python reference extractor
  (69 listings, 66 within 90 days, median EUR 21.87).

## v1.2 (latest)

UI overhaul and bug fixes:

- New interface: titles and sections, card-style sections with rounded
  backgrounds, big result display ("sold in the last 90 days" as a large
  number, median prices with proper currency symbols, meta line with the
  scan details), indeterminate progress bar while running.
- Marketplace labels now include the currency (eBay US (USD $), ...).
- Bug: rotating the screen mid-extraction no longer kills the run
  (orientation locked + config changes handled in-place).
- Bug: the Extract button now clearly switches to a red "Stop" state while
  running and resets on completion/stop.
- Bug: build script previously masked Java compile errors (deadly for
  artifacts) - now fails hard on javac errors.
- Prices formatted per currency (EUR/USD/GBP/CAD/AUD) with thousands
  separators; results remain copy-selectable in the raw text view.
- Regression re-verified against the reference extractor on the captured
  live eBay FR page (69 listings, 66 within 90 days, median EUR 21.87).

## v1.3 (latest)

Critical fix reported from device testing ("show/hide browser does nothing,
no result visible"): the JavaScript-bridge callbacks ran on the WebView's
bridge thread and directly touched views. With v1.2's richer result card
(progress bar, multiple text views, buttons) this reliably raised
CalledFromWrongThreadException, killing the run right before the result was
shown and freezing the browser toggle. All bridge callbacks
(postItems/noItems/wall403/needLogin) are now marshalled to the UI thread via
runOnUiThread. The browser toggle also correctly resets the WebView layout
weight and requests layout.
