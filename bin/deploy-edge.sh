#!/usr/bin/env bash
# Deploy the neo-mobile-chat Edge Function via Supabase CLI.
#
# Replaces the heavy "embed entire file in MCP call" workflow with a one-liner.
# Requires `supabase` CLI authed and the project linked (one-time setup).
#
# First-time setup if Supabase CLI isn't authed yet on this machine:
#   supabase login --token sbp_xxx       # token from supabase.com/dashboard/account/tokens
#   cd "/Users/johnwalsh/Codex/Projects/Neo Mobile"
#   supabase link --project-ref pchhtltxdcmvdcwnwaeg
#
# Usage:
#   ./bin/deploy-edge.sh

set -euo pipefail

# Run from repo root regardless of where the script is called from
cd "$(dirname "$0")/.."

if ! command -v supabase >/dev/null 2>&1; then
  echo "supabase CLI not found. Install via: brew install supabase/tap/supabase" >&2
  exit 1
fi

if [[ ! -d supabase/functions/neo-mobile-chat ]]; then
  echo "Expected supabase/functions/neo-mobile-chat/ relative to repo root." >&2
  exit 1
fi

echo "Deploying neo-mobile-chat..."
supabase functions deploy neo-mobile-chat

echo
echo "Done. Inspect at https://supabase.com/dashboard/project/pchhtltxdcmvdcwnwaeg/functions/neo-mobile-chat"
