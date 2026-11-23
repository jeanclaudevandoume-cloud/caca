# Adversarial Verification Report — Cycle 1

**AUDIT ID:** ADV-EBAYSS-2025-0007
**VERIFIED REMEDIATION COMMIT:** 17fce63641652c798dfa156d62d0035052e61956 (v2.7, versionCode 16)
**SPEC UNDER TEST:** audit/ADVERSARIAL_REMEDIATION.md (SHA-256 e1c2a060ec84a32e31563a0d29e6e478725319dfee5141d8a875eaa664bdbb97)
**VERIFIER INDEPENDENCE:** NOT INDEPENDENT. No subagent capability exists in this environment
(declared in the remediation spec and re-verified). This verification was executed as a separate
phase against the immutable spec, reproducing original failure scenarios where testable, with
all NOT TESTED items disclosed.

## Tests executed (evidence)

| # | Objective | Method | Result |
|---|---|---|---|
| V1 | Build integrity | Full manual SDK build pipeline from remediation commit | PASS (zero javac errors, APK built) |
| V2 | Signature | apksigner verify | PASS (same debug key as prior cycles) |
| V3 | ADV-004 original failure reproduces on OLD logic then passes on NEW | JVM CsvTest: plain row, quoted-goods row (original failure case), escaped-quote query, empty-sold row | PASS 11/11 (old naive parse of the quoted-goods row produced character='"porte', franchise='mikasa' — reproduced in cycle 1; new parser yields correct fields) |
| V4 | ADV-001 trust gate | JVM TrustTest replicated from shipped logic: 6 eBay domains + signin subdomain allowed; evil-ebay.com, ebay.fr.evil.com, localhost, file://, null blocked; about:blank allowed | PASS 9/9 |
| V5 | ADV-001 static acceptance trace | grep of remediation commit: shouldOverrideUrlLoading gate at L212, onPageStarted host capture L222, bridgeTrusted() required in hasCreds/email/password (L720/726/729); onPageFinished logic preserved byte-for-byte | PASS |
| V6 | ADV-002 | BatchService L52 returns START_NOT_STICKY; onDestroy release retained | PASS (code-level) |
| V7 | ADV-003 | stallRetries reset per run (L336), bounded at 3 (L344), chained re-schedule, terminal endRun(false); generation-guarded | PASS (code-level) |
| V8 | Regression scan of replaced WebViewClient | diff inspection: driver eval/guards unchanged; loadUrl callers all construct trusted URLs or about:blank; grid listing clicks load ebay /itm URLs | PASS |
| V9 | Device-level: batch resume, service restart, live eBay network, battery | NOT TESTED — no device/emulator; eBay edge blocks search from this sandbox | NOT TESTED |

## Finding statuses

- ADV-001 (P1): **FIXED** — verified V4+V5. Live exfiltration attempt NOT TESTED.
- ADV-002 (P2): **FIXED** — verified V6. Actual service restart after process kill NOT TESTED.
- ADV-003 (P2): **FIXED** — verified V7. Live stall/recovery NOT TESTED.
- ADV-004 (P3): **FIXED** — CONFIRMED by V3 regression test (original failure reproduced then passing).
- ADV-005 (P3, advisory): **OPEN — documented accepted risk** (plaintext credentials in
  private SharedPreferences; personal-use debug-signed tool; EncryptedSharedPreferences excluded
  by build constraints). No silent downgrade: kept at advisory per spec.
- ADV-006 (P3, advisory): **FIXED** (duplicate import removed in remediation commit).

No REGRESSED findings. No new defects discovered during verification within testable scope.

## Re-grade after remediation

| Category | Weight | Score |
|---|---|---|
| Functional correctness | 25 | 22 |
| Reliability and edge cases | 20 | 17 |
| Security | 15 | 13 |
| Concurrency and state integrity | 15 | 12 |
| Performance and resource safety | 10 | 8 |
| Architecture and maintainability | 10 | 8 |
| Testing and observability | 5 | 4 |
| **Computed** | **100** | **84** |

Caps: no confirmed P0/P1/P2 remain. However "critical paths without adequate verification:
maximum 79" applies — the current build's on-device critical paths (extraction, batch resume,
service lifecycle) have code-level and JVM evidence only; live network verification is impossible
from this sandbox (eBay edge block) and no device/emulator exists.

**CAP APPLIED: 79/100 → band C (Significant risks).**

## Release gate (cycle 1 verification)

**CONDITIONAL.**
All four mandatory findings verified FIXED within the testable scope. The release gate cannot
issue an unconditional PASS because the current build's on-device critical paths meet the
"critical paths without adequate verification" cap (79). Release to the single intended user is
acceptable under an explicit human risk acceptance, conditioned on the user's on-device smoke
test: (1) single query returns stats, (2) batch start/stop/resume advances correctly,
(3) blocked-navigation message appears if a non-eBay link is attempted from the in-app browser.

Cycle count for escalation: 1 of 3.
