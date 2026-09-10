#!/usr/bin/env bash
set -euo pipefail

# Wrapper around create-user.ts — see that file's header for what it does
# (creates a user + their own organization, bypassing Better Auth's
# one-user-only local-mode signup gate). Handles cd'ing into apps/web (tsx
# needs its tsconfig paths to resolve) and checks DATABASE_URL is set.
#
# Usage:
#   export DATABASE_URL="postgresql://..."
#   ./scripts/create-user.sh dd-gs-sol1@example.com dd-gs-sol1 dd-gs-sol1 dd-gs-sol1

if [ -z "${DATABASE_URL:-}" ]; then
	echo "DATABASE_URL is not set. Run: export DATABASE_URL=\"postgresql://...\"" >&2
	exit 1
fi

EMAIL="${1:-}"
NAME="${2:-}"
PASSWORD="${3:-}"
ORG_NAME="${4:-}"

if [ -z "$EMAIL" ] || [ -z "$NAME" ] || [ -z "$PASSWORD" ] || [ -z "$ORG_NAME" ]; then
	echo "Usage: $0 <email> <name> <password> <orgName>" >&2
	exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

pnpm tsx scripts/create-user.ts --email="$EMAIL" --name="$NAME" --password="$PASSWORD" --org-name="$ORG_NAME"
