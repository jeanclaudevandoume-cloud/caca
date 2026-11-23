# Adversarial Build Audit — Remediation Specification (v1)

**AUDIT ID:** ADV-EBAYSS-2025-0007
**AUDIT CYCLE:** 1
**REVIEWED COMMIT:** 58f296c81bce85d5d5695ad8c8c7a75e918b0176 (branch vibe/ebay-sold-stats-app-599ce9)
**WORKING TREE AT AUDIT TIME:** clean (no uncommitted changes)
**BUILD UNDER REVIEW:** eBay Sold Stats v2.6 (versionCode 15), APK `ebay-sold-stats-app/ebay-sold-stats.apk`
**AUDITOR INDEPENDENCE:** Full independence could NOT be established. This environment provides
no subagent-spawning capability (verified via tool-catalog inspection; Mistral Studio agent tools
are external lookups, not spawnable isolated reviewers). This audit was therefore performed as a
**phase-separated adversarial review** by the same underlying agent. It is NOT independent
verification. Findings below were derived from fresh source inspection and adversarial JVM tests,
not from prior claims.

---

## System reconstruction (auditor's own reading)

Intended behavior (from README + user requirements in-thread):
1. Single query: load eBay sold SERP in a WebView (marketplace picker, default FR), parse sold
   items with the embedded DRIVER_JS, follow eBay's own next-page links, report sold-in-90-days
   and median prices, show a recent-sales image grid.
2. Batch: run a 1500-query catalog (or a custom pasted catalog) with polite pacing (12–21 s),
   resumable across restarts, survivable screen lock (foreground service + wake lock), CSV export,
   results infographic.
3. Fallbacks: saved eBay credentials for silent sign-in; pasted cookie JSON applied on 403 walls;
   generation tokens guard all scheduled callbacks (v2.6).

Verified by execution during this audit: source compiles (manual SDK pipeline), APK signature
valid, JVM-level adversarial test of infographic CSV row parsing (see ADV-004). NOT TESTED (no
device/emulator in this environment): on-device batch resume, service lifecycle under Android,
actual eBay network behavior from this network (edge-blocked from this sandbox — the /sch 403
wall is confirmed live).

---

## Findings register

| ID | Severity | Confidence | Location (approx) | Status at audit |
|----|----------|-------------|--------------------|------------------|
| ADV-001 | P1 | HIGH CONFIDENCE | MainActivity WebViewClient + Bridge (App/java/com/vibe/ebaysoldstats/MainActivity.java ~line 199–230, ~640–700) | OPEN (mandatory) |
| ADV-002 | P2 | CONFIRMED | BatchService.java line 52 | OPEN (mandatory) |
| ADV-003 | P2 | HIGH CONFIDENCE | MainActivity.startRun watchdog (~line 295–305) | OPEN (mandatory) |
| ADV-004 | P3 | CONFIRMED | MainActivity.showResultsSoFar row parse (~line 315–335) | OPEN (mandatory) |
| ADV-005 | P3 | HIGH CONFIDENCE | SettingsActivity prefs storage | OPEN (advisory) |
| ADV-006 | P3 | CONFIRMED | MainActivity duplicate `import android.widget.Button;` | OPEN (advisory) |

Finding counts: P0: 0 · P1: 1 · P2: 2 · P3: 3.

---

## FINDING ID: ADV-001

**SEVERITY:** P1
**CONFIDENCE:** HIGH CONFIDENCE
**LOCATION:** `App/java/com/vibe/ebaysoldstats/MainActivity.java` — WebView setup (~line 195–230),
`Bridge.hasCreds()/email()/password()` (~line 640–700)

**DEFECT:** The JavaScript bridge object `Android` is injected into the WebView, and its methods
`hasCreds()`, `email()`, `password()` return the user's stored eBay credentials to *any* page
loaded in that WebView. There is no `shouldOverrideUrlLoading` navigation gate; any link or
redirect can navigate the extraction WebView to an arbitrary origin, which can then call
`Android.email()` / `Android.password()` and exfiltrate the credentials (WebView also permits
cross-origin loads; skimming via a malicious page embedded in or linked from even a compromised
listing is sufficient).

**ROOT CAUSE:** The bridge predates adversarial review; it was written for a WebView assumed to
contain only eBay pages, but nothing enforces that assumption.

**FAILURE SCENARIO:** User taps a listing/image/link in the in-app browser (grid cells load
listing URLs captured from eBay content, but nothing restricts what reachable pages may contain)
-> navigation leaves ebay trusted zone -> hostile page executes
`Android.hasCreds() && Android.email()+" "+Android.password()` -> credentials exfiltrated to
network or storage.

**IMPACT:** Account credential theft (P1 — serious security exposure; not code execution).

**EVIDENCE:** Source contains no `shouldOverrideUrlLoading` and no host restriction in bridge
methods (fresh inspection of lines ~199–230 and Bridge class). Not exploitable-verified on a
device (NOT TESTED live), but the code path is unconditional; graded HIGH CONFIDENCE, not
CONFIRMED, because exfiltration requires the user to land on a hostile page.

**REPRODUCTION:** Static inspection: `wv.addJavascriptInterface(new Bridge(), "Android");`
before `setWebViewClient` that only overrides `onPageFinished`; `email()` returns
`prefs.getString("email","")` with no host validation.

**MANDATORY REMEDIATION:**
1. Add a navigation gate: `shouldOverrideUrlLoading` permits only hosts whose registrable domain
   is one of `ebay.com|ebay.co.uk|ebay.fr|ebay.de|ebay.es|ebay.it` (including subdomains such as
   `signin.ebay.*`); every other navigation is blocked with a visible status message.
2. Restrict credential bridge methods to trusted hosts: a UI-thread-updated field (set from
   `onPageStarted`) records the page host; `hasCreds()/email()/password()` return safe defaults
   (`false`/`""`) whenever the current page host is not in the trusted set. The trusted check
   must live in Java, not in page-supplied data.
3. No weakening: the cookie-application path, silent login flow, sold search and grid behavior
   on eBay domains must remain byte-compatible in function (regression: extraction flow works on
   eBay pages).

**PROHIBITED SHORTCUTS:** Removing `addJavascriptInterface` (breaks login fallback); gating by
URL-string contains("ebay") (bypassable via subdomain tricks such as
`https://evil.com/?x=ebay.fr`); suppressing the notification of blocked navigation.

**ACCEPTANCE CRITERIA:** (a) A static trace shows every path to `email()/password()` requires a
trusted host. (b) Non-eBay navigation attempts result in no page change and a user-visible
notice. (c) Extraction flow compile + harness checks unchanged on eBay URLs.

**REGRESSION TEST:** JVM/static: grep verifies bridge gating present and
`shouldOverrideUrlLoading` returns true for a non-eBay URL constant and false for all six eBay
domains plus `signin.ebay.fr`. Build passes.

**DEPENDENCIES:** none.

---

## FINDING ID: ADV-002

**SEVERITY:** P2
**CONFIDENCE:** CONFIRMED
**LOCATION:** `App/java/com/vibe/ebaysoldstats/BatchService.java` line 52 (`return START_STICKY;`)
and `onStartCommand` wake-lock acquisition.

**DEFECT:** The foreground service uses `START_STICKY`. If Android kills and later restarts the
process, Android re-creates the service (`onStartCommand` with a null intent), which calls
`startForeground` and re-acquires a `PARTIAL_WAKE_LOCK` for 12 hours — while all batch state
(MainActivity fields) is gone and nothing will run. Result: a CPU-availability wake lock held for
up to 12 h with no work — pure battery drain after any process restart.

**ROOT CAUSE:** The service was declared STICKY to "survive" restarts, but the actual batch
state is process-local, so a sticky restart is useless by construction.

**FAILURE SCENARIO:** Batch running -> Android low-memory kills the process (state persists via
results_csv/batch_idx prefs) -> later the sticky service restarts -> wake lock re-acquired with
no batch -> overnight battery drain; user sees a "Batch running" notification with nothing
running (unclear UI state).

**IMPACT:** Meaningful battery drain; misleading persistent notification; recoverable by the user
(reported P2).

**EVIDENCE:** Source line 52; wake lock re-acquired in `onStartCommand` regardless of intent.

**REPRODUCTION:** Static code inspection (service code, 66 lines, read in full).

**MANDATORY REMEDIATION:** Change to `START_NOT_STICKY`. On restart-after-kill, the service must
not re-acquire the lock; resumption of an interrupted batch is the documented manual path
("press Batch to resume", batch_idx persisted per query).

**PROHIBITED SHORTCUTS:** Keeping STICKY but silently releasing the lock (restart would still
show a bogus foreground notification); moving state into the service scope in this cycle
(out-of-scope refactor).

**ACCEPTANCE CRITERIA:** `BatchService` returns `START_NOT_STICKY`; stop paths unchanged
(release on onDestroy retained).

**REGRESSION TEST:** Code inspection + build; device-level service kill/restart NOT TESTED here
(must be noted as such in verification).

**DEPENDENCIES:** none.

---

## FINDING ID: ADV-003

**SEVERITY:** P2
**CONFIDENCE:** HIGH CONFIDENCE
**LOCATION:** `MainActivity.startRun(...)` 40 s watchdog (~line 295–305).

**DEFECT:** The stall watchdog is one-shot per run (generation-guarded, fires once). If the
single reload also stalls (slow proxy, silent eBay interstitial, page that never fires the
driver), the run hangs forever — precisely the class of "page loaded, batch doing nothing"
failure reported by the user in the previous cycle. Conversely, if the stall is a sign-in page
needing user action, an un-guided reload policy could fight the user; the fix must both bound
retries and terminate the run instead of looping.

**ROOT CAUSE:** Watchdog added as a single reload without a retry budget or terminal action.

**FAILURE SCENARIO:** Query page fails to produce items and no `noItems` callback fires; first
watchdog reload also stalls; no further recovery exists -> batch wedges indefinitely (state:
running=true, batchRunning=true forever, notification stays).

**IMPACT:** Batch can still deadlock (P2 — the exact symptom the previous fix attempted to close;
not confirmed on device, hence HIGH CONFIDENCE via code trace).

**EVIDENCE:** Watchdog body schedules no subsequent check and has no terminal path (fresh
inspection).

**REPRODUCTION:** Reasonable under network stalls; NOT TESTED live on device.

**MANDATORY REMEDIATION:** Bound the watchdog: at most **3** reload attempts per run; if the
third reload still yields no items and no signal, terminate the query via `endRun(false)` (batch:
advance to next query with `status=empty` row; single-run: show "no sold listings" result as
today). Watchdog must remain generation-guarded and must not accumulate across runs.

**PROHIBITED SHORTCUTS:** Unlimited reload loop; suppressing the run instead of ending it
cleanly (leaves stuck "running" state); changing pacing or the parse logic.

**ACCEPTANCE CRITERIA:** Code shows a per-run retry counter reset in `startRun`, chained
watchdog that stops after 3 attempts and unconditionally calls `endRun(...)`; counter reset
between queries; watchdog dead after `finishBatch` / stops.

**REGRESSION TEST:** Static: both the reload chain and terminal `endRun` path verified by
inspection; normal-flow behavior unchanged in harness build. Device stall test — NOT TESTED
(declared).

**DEPENDENCIES:** none.

---

## FINDING ID: ADV-004

**SEVERITY:** P3
**CONFIDENCE:** CONFIRMED
**LOCATION:** `MainActivity.showResultsSoFar()` row parse (`String[] p = ln.split(",", -1);`
with tail-indexed columns, ~line 315–335).

**DEFECT:** The results CSV uses RFC-4180-style quoting for fields containing commas, but the
infographic parses with a naive split. Tail-side numeric columns stay correct, but the three
identity columns (franchise/character/goods) are shifted into fragments of quoted fields when
any identity column itself contains a comma. JVM adversarial test (this audit, AdvTest.java):
row `...,mikasa,"porte, clé",23,18.75,...` renders **character as `"porte`, franchise as
`mikasa`, goods as ` clé"`** — visibly corrupted infographic rows.

**ROOT CAUSE:** Naive `split(",", -1)` used instead of a quote-aware parser on the read side
(the write side does quote correctly).

**FAILURE SCENARIO:** User's custom catalog contains a goods/franchise/character value with a
comma (e.g. custom line `Manga, Gojo case, badge, gojo badge`) or a quoted query; after results
accumulate, the infographic shows mangled names and wrong franchise/goods groupings (aggregation
keys corrupted; totals misplaced).

**IMPACT:** Display + breakdown aggregation corruption only; sold/median/CSV are unaffected
(recoverable, limited to custom catalogs — P3).

**EVIDENCE:** JVM test executed during this audit (output recorded above); CONFIRMED.

**REPRODUCTION:** Run AdvTest (simplified fixture) — reproduced.

**MANDATORY REMEDIATION:** Replace naive parsing in the infographic read path with a
quote-aware CSV line parser (handles `""` escapes) or an equivalent robust strategy; identity
columns must come from properly parsed fields. Numeric tail-columns behavior must not change
(rows with simple fields must parse identically).

**PROHIBITED SHORTCUTS:** Halting on malformed rows; dropping quoted rows from display; changing
the CSV writer format (would invalidate saved results).

**ACCEPTANCE CRITERIA:** JVM/regression test with rows containing quoted commas parses correct
franchise/character/goods; all 13 plain columns unchanged; empty-sold rows still parse as 0.

**REGRESSION TEST:** Quote-aware parser unit test covering: plain row, quoted-query row,
quoted-goods row, `""` escaped quotes, empty-sold row.

**DEPENDENCIES:** none.

---

## FINDING ID: ADV-005 (ADVISORY — no mandatory remediation this cycle)

**SEVERITY:** P3
**CONFIDENCE:** HIGH CONFIDENCE
**LOCATION:** `SettingsActivity` prefs storage (email, password, cookies_json in plaintext
SharedPreferences).

**DEFECT/IMPACT:** eBay credentials and session cookies are stored unencrypted in the app's
private SharedPreferences (world-readable only pre-API-19 via misconfiguration; on modern
Android restricted to the app + ADB backup paths). Standard mitigation is EncryptedSharedPreferences
or similar; for a personal-use debug-signed tool, remediation requires new dependencies excluded
by the manual build config.

**AUDITOR NOTE:** Accepted-risk candidate for this product class. The release gate below treats
it as an advisory: the implementation agent must either document acceptance or implement
encryption as a future cycle item. Silently ignoring it would be a PROHIBITED shortcut.

---

## FINDING ID: ADV-006 (ADVISORY)

**SEVERITY:** P3
**CONFIDENCE:** CONFIRMED
**LOCATION:** `MainActivity.java` imports — duplicate `import android.widget.Button;`.

**DEFECT:** Trivial duplicate import (compiles fine; hygiene only). Cosmetic cleanup permitted
as a side-effect of other edits; not itself release-blocking.

---

## Grade (audit-cycle-1)

| Category | Weight | Score | Notes |
|---|---|---|---|
| Functional correctness | 25 | 22 | Extraction pipeline regression-verified on captured fixtures; device-resume path verified in-cycle-1 fix but NOT TESTED on device live |
| Reliability / edge cases | 20 | 14 | ADV-002, ADV-003 open |
| Security | 15 | 7 | ADV-001 (credential exposure) + ADV-005 |
| Concurrency & state integrity | 15 | 12 | v2.6 generation tokens audited and found coherent; residual risk noted but no concrete defect demonstrated |
| Performance & resource safety | 10 | 8 | v2.5 leaks fixed; sticky-service wake lock counted under reliability |
| Architecture & maintainability | 10 | 8 | Monolithic MainActivity (1115 lines) acceptable for the project scale; duplicate import |
| Testing & observability | 5 | 3 | Ad-hoc JVM harness only; no committed automated test suite |
| **Computed** | 100 | **74** | |

**Caps applied:** confirmed P1 (ADV-001) → maximum 69/100. **Final graded score: 69/100 → band D
(Unreliable).**

**Release recommendation (cycle 1): FAIL** — release gate blocked until ADV-001..ADV-004 are
remediated and re-verified.

## Verification plan (for the verifier phase)

1. Build from source with the manual SDK pipeline (must compile with zero javac errors).
2. `apksigner verify` (unchanged debug key).
3. Static acceptance checks for ADV-001 (bridge gating + navigation gate), ADV-002 (START_NOT_STICKY),
   ADV-003 (bounded watchdog with terminal `endRun`).
4. JVM regression test for ADV-004 (quote-aware parser, plain rows unchanged).
5. Declare device-run checks (battery, service restart, live eBay) as NOT TESTED where they
   were not executed. Do not accept build success as behavioral proof.

## Immutability

This specification is immutable for audit cycle 1. Its SHA-256 is recorded in
`audit/ADVERSARIAL_REMEDIATION_v1.sha256` at commit time. Any change to findings requires a new
audit version (cycle 2) documented as an addendum. The hash detects edits; authorized
corrections to an erroneous finding must go through a documented amendment, not silent edits.

**SHA-256(spec):** (recorded in audit/ADVERSARIAL_REMEDIATION_v1.sha256 immediately after write)

**Audit limitations:** single sandbox environment; Android device/emulator unavailable; eBay
network edge unreachable from this environment (all live-path checks NOT TESTED); no subagent
independence.
