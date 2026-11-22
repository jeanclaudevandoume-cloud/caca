#!/usr/bin/env bash
# Convenience runner for the batch checker.
# Credentials come from the environment (EBAY_EMAIL, EBAY_PASSWORD, EBAY_PROXY)
# and the cookie export (cookies_ebay_fr.json) sits next to this script.
set -e
cd "$(dirname "$0")"
exec python3 checker.py --list queries.csv "$@"
