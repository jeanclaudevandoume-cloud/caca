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

## v1.7 (latest)

- Fixed the "89 of 99" undercount (live-tested with "panda jujutsu" on FR):
  the old per-item duplicate filter wrongly merged distinct sold listings
  that share price+quantity+date - identical plushies sold the same day are
  DIFFERENT sales. It is replaced with a per-batch signature guard: the
  whole page batch has a signature (count + price sum + first items), so a
  re-evaluation of the same page after a redirect is ignored, while distinct
  identical-looking listings are all counted.
- Live end-to-end verification of the app's exact flow (login, page 1 with
  the next-page link, page 2): page 1 = 120 listings, page 2 = +28, total
  148, of which 138 inside the 90-day window; median EUR 9.21 (previously
  the app reported 89 of 99, median 10.84).

## v2.0 (latest) - phone-only batch mode

Run the whole 800-query character-goods catalog directly on an Android phone:

- New "Batch: run 800-query catalog" button: loads the bundled catalog
  (100 characters x 8 goods types across 30 franchises), and runs each query
  through the same WebView flow one after another at polite pacing
  (12-21s randomized gap between queries, 2.5-5s between pages).
- Resumable: progress and the results CSV survive app restarts; pressing
  Batch again resumes where it stopped.
- Progress in the status line ("[Batch 37/800] done - last: Gojo Satoru
  figurine -> 182 sold"); stop any time with the Stop button.
- "Share CSV" exports the accumulated results (query, franchise, character,
  goods, sold-90d, median, weighted median, currency, listings,
  pages, status) via the Android share sheet - send it to Google Sheets
  or Drive for sorting/filtering.
- Keep the phone charging and the app in the foreground during a batch;
  a full sweep at polite pacing takes several hours. Chunks are fine -
  resume does the rest.

## v2.1 - survives screen lock; 1500-query catalog; custom lists

- Foreground service with a partial wake lock keeps the batch running when
  the screen locks (persistent notification, dataSync foreground-service
  type). Progress and results are persisted after every query, so even if
  Android kills the app or the phone dies, pressing Batch resumes exactly
  where the run stopped - the run is never lost.
- Catalog expanded to 15 goods types x 100 characters = 1500 queries
  (peluche, peluche geante, figurine, figurine chibi, figurine pop,
  gashapon, porte-cles, badge, pin's, stand acrylique, poupee, magnet,
  strap, carte a collectionner, tapis de souris).
- Settings now has a "Custom catalog" box: one search query per line
  (or franchise,character,goods,query CSV lines). When filled, the batch
  runs YOUR list instead of the built-in one - so the list has no limit.
## v2.2 - reliable stop, skip-finished resume, results viewer

- "Stop batch" now really stops: the pause between queries is cancelled as
  well, so the batch never restarts on its own after pressing Stop
  (previously the next scheduled query still fired).
- Resuming skips every query already recorded in the results: the batch
  index is persisted after each query and the app resumes at the exact
  next query. If the custom catalog in Settings changed since the last
  run, the batch restarts from the beginning automatically. If the whole
  catalog is already checked, the app asks before redoing anything
  ("Start over" dialog) instead of silently re-running 1500 queries.
- New "See results" button: shows all results acquired so far (newest
  first, 300 shown) as a readable list - usable any time, even while a
  batch is still running mid-way. Share CSV still exports the raw data.
  It also works right after a fresh app start (loads the saved results).
- Batch button label no longer hardcodes the query count.

## v2.3 - results infographic

- "Results infographic" replaces the plain text list: a full-screen scrollable
  dashboard generated from the batch CSV - KPI cards (found sales, hit rate,
  items sold, typical price), a Top-12 sellers chart with rank badges, tiny
  thumbnails (64px, downloaded only at s-l64 low-res), relative sales bars and
  the #1 seller highlighted, plus Sold-by-franchise and Sold-by-goods-type
  bar rankings.
- Thumbnails are captured automatically per query while the batch runs
  (first recent in-window listing image, persisted with results); queries
  without an image get a clean initial-letter placeholder.
- Works mid-batch, after a stop, and right after a fresh app relaunch
  (loads saved results from storage).
- Visual design was iterated 5 times against headless-Chromium screenshots
  reviewed by a separate visual-QA pass; final grade 9/10 (remaining nit:
  rank badge sits close to the thumbnail edge).

## v2.4 - whole-flow visual & usability pass (blind-reviewed to 9-10/10)

Blind visual-QA loop over rendered replicas of the real layout XML, iterated
until every screen passed a fresh unbiased review at 9+/10:

- Stop affordance fixed and made obvious: the run button now turns RED with a
  "Stop"/"Stop batch" label while a run is active (it was inverted before -
  red when idle). Status text during batch explicitly says the red button
  stops the run.
- Batch progress: new determinate progress bar plus "[Batch 373/1500 - 24%]"
  in the status line, so completion is understandable at a glance. Hidden
  again on stop/finish.
- Status text upgraded: larger, higher-contrast (13sp gray -> 14sp dark).
- Settings: section headers in bold app blue, clearer "Cookie fallback"
  wording, pages field hint ("1 to 4 - default 3"), custom catalog hint
  documents the CSV line format, big blue "Save settings" button (was a bare
  gray button). Password stays masked in the real app (inputType=textPassword).

## v2.5 - performance / battery / memory pass

Audit of the whole codebase with a strict efficiency review; every finding
verified functional-risk-free before applying:

- WebView no longer downloads listing images: a sold-search page fetches
  ~120 full-size images that the parser never renders (it reads URL
  attributes only). Network images are blocked during extraction - a
  1500-query batch skips tens of MB of image data and the decode CPU.
  Images are shown normally when the in-app browser is opened manually
  (sign-in, browsing a listing).
- WebView timers are paused after each query and resumed for the next one,
  so eBay's page scripts cannot spin CPU during the 12-21s polite pause
  or when the batch is stopped.
- WebView history is cleared after every query instead of growing across
  thousands of pages (slow RAM creep over a full batch).
- The results-infographic dialog WebView is destroyed on dismiss (was
  leaking one WebView per view).
- Grid thumbnail connections are now disconnected in finally (was
  leaving sockets to the CDN open).
- Activity onDestroy stops the batch service and destroys the WebView
  (clean teardown instead of orphaned renderers).
- Per-run parsing state (items, recent, currencies, seen-batches) was
  verified to be reset per query, so no unbounded growth there;
  resultsCsv/thumbnails stay small (KBs-scale at 1500 queries).

## v2.6 (latest) - fixes batch resume corruption (stop + restart)

Reported on device: after stopping a batch and restarting it, the first query
reported an inflated sold count (101 instead of 9) and then the batch wedged
with the page loaded but nothing happening.

Root cause: timers scheduled before the Stop survived it. The next-page load
in ingestItems had NO guard at all, and the driver evaluation/403-retry/settle
re-checks weren't generation-checked. After a stop+resume, a leftover 2s timer
could load the OLD query's page-2 into the NEW run, merging two result sets
(inflated counts) and desynchronizing the page counter (hang).

Fix: a run-generation token (runGen) and batch-generation token (batchGen).
Every scheduled postDelayed callback now captures the generation and aborts if
it changed. Generations are bumped on: query start, batch start/stop, single-run
stop, and both Stop buttons. Additionally:
- pendingNextUrl is now reset at the start of every run
- a 40s watchdog reloads the current page if a run produced no items and no
  "no items" signal (the silent stall case)
- the about:blank clear after a single run is also generation-guarded

Every scheduled callback path is generation-guarded (verified by audit):
driver eval, 403 retry, settle re-check, next-page load, next-query timer,
watchdog, blank clear.
