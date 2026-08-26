#!/usr/bin/env bash
set -euo pipefail

# Wrapper around citation-snapshot-report.ts — see that file's header for
# what it produces (4 CSVs: citations_by_type / citations_unbranded /
# citations_branded / mentions). Handles cd'ing into apps/web (tsx needs
# its tsconfig paths to resolve) and checks DATABASE_URL is set.
#
# Usage:
#   export DATABASE_URL="postgresql://..."
#   ./scripts/citation-snapshot-report.sh brand-4 2026-08-24
#   ./scripts/citation-snapshot-report.sh brand-4 2026-08-24 ../../reports
#   ./scripts/citation-snapshot-report.sh brand-4 2026-08-24 . scripts/product-names.txt

if [ -z "${DATABASE_URL:-}" ]; then
	echo "DATABASE_URL is not set. Run: export DATABASE_URL=\"postgresql://...\"" >&2
	exit 1
fi

BRAND="${1:-}"
DATE="${2:-}"
OUT="${3:-.}"
PRODUCTS="${4:-}"

if [ -z "$BRAND" ] || [ -z "$DATE" ]; then
	echo "Usage: $0 <brandId> <YYYY-MM-DD> [outDir] [productNamesFile]" >&2
	exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

ARGS=(--brand="$BRAND" --date="$DATE" --out="$OUT")
if [ -n "$PRODUCTS" ]; then
	ARGS+=(--products="$PRODUCTS")
fi

pnpm tsx scripts/citation-snapshot-report.ts "${ARGS[@]}"
