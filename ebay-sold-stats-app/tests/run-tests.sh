#!/usr/bin/env bash
# JVM regression tests for audit cycle ADV-EBAYSS-2025-0007.
# CsvTest replicates the app's splitCsvLine() parser (finding ADV-004).
# TrustTest replicates the app's isTrustedEbayUrl() gate (finding ADV-001).
# Usage: bash run-tests.sh <jdk-home>   (or export JAVA_HOME first)
set -e
JDK="${1:-$JAVA_HOME}"
if [ -z "$JDK" ]; then echo "Pass a JDK 17+ home as argument 1 (or export JAVA_HOME)"; exit 1; fi
HERE="$(cd "$(dirname "$0")" && pwd)"
export PATH="$JDK/bin:$PATH"
cd "$HERE"
javac CsvTest.java && java CsvTest
javac TrustTest.java && java TrustTest
echo "ALL AUDIT REGRESSION TESTS PASSED"
