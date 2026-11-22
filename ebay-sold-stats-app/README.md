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

## v1.4 (latest)

- Layout restructured so everything is scrollable and always reachable:
  fixed compact controls on top (marketplace, title, Extract/Stop, status,
  progress bar, browser toggle) and a dedicated ScrollView (fills the
  remaining screen) containing the result card, selectable full text and
  Settings. The WebView was moved out of the scroll flow entirely and
  appears as a fixed panel only when needed.
- The plain-text result line is now also displayed (in the scroll area,
  selectable) in addition to the result card, so the output can never be lost.
- The scroll area auto-scrolls to the top when a result arrives.
- Lightweight: the on-page parser takes ~15 ms for ~70 cards (measured);
  after each run the WebView loads about:blank to release eBay's page heap;
  bounded evaluations (one driver run per page + max 2 re-checks); no
  services, no polling, no timers left running. APK remains ~25 KB.

## v1.5 (latest)

- The whole screen scrolls now: one ScrollView contains every control, the
  result card, the results text, Settings, and the new sales grid - nothing
  is stuck or cut off. The WebView moved to a bottom overlay outside the
  scroll flow (no gesture conflicts, no blank area: on completion it hides
  first and releases the page a few seconds later).
- eBay FR is the default marketplace on first install.
- New "recent sales" grid: after a run, the 1-20 most recent sales inside the
  90-day window appear as a 4-column grid under the results - product
  thumbnail (eBay CDN, small s-l200 webp) with its sold price under it,
  newest first. Images load asynchronously on background threads with
  view-tag guards; no image-loading library needed.
- Lightness kept: APK ~29 KB, parser ~15 ms/page, bounded evaluations,
  WebView released after each run, no services.

## v1.6 (latest)

- Recent-sales grid cells are now clickable: tapping a product thumbnail
  opens that eBay listing directly in the in-app browser panel.
- The in-app browser can never sit blank after results: it hides on
  completion, and if opened manually after the page was released it loads
  the marketplace home instead of a blank page.
- Fixed pagination past 99 results: the app previously constructed page-2
  URLs itself (adding _ipg=120), which eBay serves as an empty results page
  in some cases (e.g. "panda jujutsu": 99 items then 0). The driver now
  reads eBay's own next-page link from the results page and navigates with
  it verbatim (verified on live fixture: proper _pgn=2 session URL is
  captured and used).
