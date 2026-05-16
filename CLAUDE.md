# CLAUDE.md — Neo Mobile

> Mobile-first PWA where John (and eventually 4 TMs) chat with **Neo** about the CRM. Forked from Field Notes V4.0.3.

## Boot orientation

You're inside the **Neo Mobile** project repo. This is a **separate git repository** from Codex (nested inside `/Users/johnwalsh/Codex/Projects/Neo Mobile/`). Pushes go to `jwalshAO/neo-mobile`, Vercel auto-deploys.

Read `neo-mobile-project-doc.md` for full project state — it's the source of truth for what shipped, what's open, and what's next.

## The two-app pattern

- **Field Notes** (sibling, `../Field Notes/`) = CAPTURE. Reps write field intel into the CRM via **Q** (terse sidekick voice). Lives at https://field-intel-webapp.vercel.app.
- **Neo Mobile** (this repo) = ASK / ACT. John + TMs query and operate the CRM via **Neo** (calm/direct/professional voice). Lives at https://neomobile.vercel.app.

Both apps share: same Supabase project (`oso-tray-tracker`, `pchhtltxdcmvdcwnwaeg`), same auth (email OTP, `reps` table), same Whisper key, same Anthropic key, same `fn_lookup_entity` + `fn_recent_notes_about` RPCs.

They differ in: system prompt, tool set, voice/persona, and audience (all reps vs. leadership-only).

## File map

| File | What it is |
|------|-----------|
| `index.html` | Full app — splash, login, chat shell, Whisper recorder. 927 lines. |
| `manifest.json` / `sw.js` | PWA manifest + service worker (cache `neo-mobile-v0-1`) |
| `vercel.json` | SPA rewrites + cache headers (same as Field Notes) |
| `supabase/functions/neo-mobile-chat/index.ts` | Edge Function — Whisper + Claude Haiku 4.5 + 6 read tools + interaction logging |
| `neo-mobile-project-doc.md` | Living project doc (status, decisions, history, open questions) |
| `icon-*.png` | **Placeholder** — still Field Notes kraft notebook |

## Deploy workflow

- **Frontend changes** (`index.html`, `manifest.json`, `sw.js`, `vercel.json`, icons):
  ```
  git add . && git commit -m "v0.x: ..." && git push origin main && ./bin/update-aliases.sh
  ```
  Vercel auto-deploys on push to main. The auto-generated `neo-mobile-agility-ortho.vercel.app` follows production automatically. **The custom aliases (`neomobile.vercel.app`, `neo-ao.vercel.app`, `neo-mobile-ao.vercel.app`) are pinned per-deployment** and need re-pointing via the helper script — run it after every push.

- **Edge Function changes** (`supabase/functions/neo-mobile-chat/index.ts`):
  Deploy via Supabase MCP `deploy_edge_function` tool (function name `neo-mobile-chat`, project_id `pchhtltxdcmvdcwnwaeg`), OR via Supabase CLI at the office. No Vercel rebuild needed.

## Tone of the assistant inside the app

Neo is the calm/direct/professional voice — distinct from Q. Brief, 1–4 sentences, no exclamation points, no emojis, no "honestly/frankly/real talk." Self-expansion pattern: end with one "Want me to learn how to [action]?" IF (and only if) the user implies a follow-up Neo can't yet perform. Don't add fluff offers — silence is fine.

The system prompt lives in `supabase/functions/neo-mobile-chat/index.ts` (`const SYSTEM_PROMPT`). Tune it there.

## Roadmap data lives here

Every chat turn writes a row to `neo_mobile_interactions` in Supabase (`oso-tray-tracker`). To see what John is asking and which write tools Neo is offering to learn:

```sql
SELECT created_at, user_message, assistant_message, tool_calls_made
FROM neo_mobile_interactions
ORDER BY created_at DESC
LIMIT 50;
```

The v0.1 roadmap = whichever "Want me to learn how to X?" offers John says yes to most. Build those write tools first.

## What v0 cannot do (by design)

No write tools. No email drafts, no Todoist tasks, no CRM mutations. v0 = read-only Q&A. The self-expansion pattern surfaces demand for writes; build them in v0.1 based on actual usage.
