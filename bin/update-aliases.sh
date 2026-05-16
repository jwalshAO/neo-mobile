#!/usr/bin/env bash
# Re-point Neo Mobile's custom *.vercel.app aliases at the latest production deployment.
#
# Why: aliases assigned via /v2/deployments/{id}/aliases are PINNED to that
# specific deployment. They don't follow production. Run this after every
# `git push` that you want reflected on the custom alias URLs.
#
# The auto-generated `neo-mobile-agility-ortho.vercel.app` alias DOES follow
# production — if you don't care which URL John uses, you can ignore this script.
#
# Requires: vercel CLI installed and authed (`vercel whoami`).

set -euo pipefail

TEAM=team_JdA1PzYEzjypAUH798UGodJJ
PROJECT=prj_pJFS54uDFLpqbmUgVYKxiUdv1coe
ALIASES=(neomobile.vercel.app neo-ao.vercel.app neo-mobile-ao.vercel.app)
AUTH_FILE="$HOME/Library/Application Support/com.vercel.cli/auth.json"

if [[ ! -f "$AUTH_FILE" ]]; then
  echo "Vercel CLI auth not found at $AUTH_FILE — run 'vercel login' first." >&2
  exit 1
fi

TOKEN=$(jq -r .token "$AUTH_FILE")

# Find the latest READY production deployment
LATEST=$(curl -sS "https://api.vercel.com/v6/deployments?teamId=$TEAM&projectId=$PROJECT&target=production&state=READY&limit=1" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.deployments[0].uid')

if [[ -z "$LATEST" || "$LATEST" == "null" ]]; then
  echo "No production deployment found." >&2
  exit 1
fi

echo "Latest production deployment: $LATEST"

for ALIAS in "${ALIASES[@]}"; do
  RESULT=$(curl -sS -X POST "https://api.vercel.com/v2/deployments/$LATEST/aliases?teamId=$TEAM" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"alias\": \"$ALIAS\"}")
  CODE=$(echo "$RESULT" | jq -r '.error.code // "ok"')
  echo "  $ALIAS → $CODE"
done

echo "Done."
