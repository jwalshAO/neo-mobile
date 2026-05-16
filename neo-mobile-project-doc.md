---
title: "Neo Mobile"
cockpit: true
domain: "Field"
description: "Mobile-first PWA where John (and eventually 4 TMs) chat with Neo about anything in the CRM — pull surgeon history, build target lists, look up tray locations, surface recent intel. Forked from Field Notes V4.0.3 (~80% shared shell). Capture stays in Field Notes; Neo Mobile is the read/ask/act side."
next_action: "John installs Neo Mobile as a PWA on his phone from https://neomobile.vercel.app, asks Neo a few real questions, and reports back on tone, transcription, latency, and which self-expansion offers Neo makes. Edge Function logs every turn to `neo_mobile_interactions` for roadmap data."
rollout_target: "v0 LIVE in production. Read-only CRM Q&A for John. TMs added once tone/UX are dialed."
build_machine: "Either — repo on GitHub, Vercel auto-deploys on push. Built session 1 on the laptop."
---

# Neo Mobile — Living Project Document
Last updated: 2026-05-16 | Session #1 (v0 BUILT AND SHIPPED — Edge Function + chat shell + Vercel deploy + interaction logging)

---

## 1. Project Identity
- **What it is:** A mobile-first PWA where John (and eventually the TMs) chat with **Neo** about anything in the CRM — pull data, build lists, look up trays, draft outreach, surface intel.
- **Goal:** John taps an icon on his home screen, signs in once with an email code, and asks Neo anything that's currently a 3-app dance. Voice or text. Conversational.
- **Owner:** John Walsh
- **Key people:** John (owner, primary user). Nick, Nate, Noah, Pat (TMs, Phase 2 users). S3 reps NOT in scope.
- **Key systems:** Supabase `oso-tray-tracker` (shared with Field Notes), Vercel team `agility-ortho`, GitHub `jwalshAO/neo-mobile`, Anthropic API (shared "Field Notes" workspace), OpenAI Whisper (shared key in Supabase secrets).
- **Quick start:** To continue this project, say: `"continue Neo Mobile"`

---

## 2. Current Status
**v0 is LIVE in production at https://neomobile.vercel.app.** John installs as a PWA on his phone, signs in via email OTP, and chats with Neo (voice or text). The Edge Function calls Claude Haiku 4.5 with 6 read tools, fuzzy-matches CRM entities via `pg_trgm` + `dmetaphone`, and writes every turn to `neo_mobile_interactions` so we have data on what John asks + which write tools Neo offers to learn.

Neo's voice is calm, direct, brief. Distinct from Q's terse field-sidekick tone — Neo is the "senior colleague who knows the business." After each answer, IF the user's question implies a follow-up action Neo can't do yet (draft email, create task, build target list), Neo ends with one offer: "Want me to learn how to [action]?" Each yes becomes the next write tool to build.

Not yet on phone: tone calibration from real use, icon design, splash blurb final wording. No write tools yet — by design.

---

## 3. What Exists (Artifacts & Files)

### Production stack (all live)
- **Public URL:** https://neomobile.vercel.app (also https://neo-ao.vercel.app and https://neo-mobile-ao.vercel.app, all aliased to the same deployment)
- **GitHub:** [`jwalshAO/neo-mobile`](https://github.com/jwalshAO/neo-mobile) — public, default branch `main`
- **Vercel project:** `neo-mobile` (id `prj_pJFS54uDFLpqbmUgVYKxiUdv1coe`) under team `agility-ortho` (id `team_JdA1PzYEzjypAUH798UGodJJ`). Auto-deploys on push to main. SSO/password protection disabled (it's a PWA — must be publicly fetchable).
- **Supabase Edge Function:** `neo-mobile-chat` v3 ACTIVE in `oso-tray-tracker` project (id `pchhtltxdcmvdcwnwaeg`). JWT-verified.

### Code (in the repo)
- `index.html` — 927 lines. Splash, login (email OTP), chat shell, Whisper voice recording with silence detection, mic↔send toggle. No capture flow, no notes feed, no confirm-and-edit. Endpoint: `neo-mobile-chat`.
- `manifest.json` — PWA manifest (short_name: "Neo Mobile")
- `sw.js` — Service worker (cache name `neo-mobile-v0-1`)
- `vercel.json` — same SPA-style rewrites + cache headers as Field Notes
- `supabase/functions/neo-mobile-chat/index.ts` — Edge Function source (~600 lines). Whisper + Claude Haiku 4.5 + tool-use loop + 6 read tools + interaction logging.
- `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` — **still Field Notes icons** (placeholder)
- `neo-mobile-project-doc.md` — this file

### Database (added this session)
- **`neo_mobile_interactions`** table (in `oso-tray-tracker`). Every chat turn writes one row: `rep_id`, `rep_email`, `user_message`, `via_audio`, `assistant_message`, `tool_calls_made` (jsonb), `usage` (jsonb token counts), `error`, `created_at`. RLS: only the rep with `role = 'Owner'` can read; Edge Function writes via service_role. Indexed on `rep_id` and `created_at`. **This is the roadmap engine** — what John asks and what Neo offers builds the v0.1 tool list.

### Reused from Field Notes (no changes)
- Supabase project `oso-tray-tracker` (`pchhtltxdcmvdcwnwaeg`) — same DB, same auth, same reps table
- `pg_trgm` + `fuzzystrmatch` extensions
- `fn_lookup_entity` RPC (fuzzy match across surgeons / locations / manufacturers / competitors)
- `fn_recent_notes_about` RPC
- `ANTHROPIC_API_KEY` + `OPENAI_API_KEY` (Supabase secrets, shared workspace "Field Notes")
- Whisper proper-noun priming prompt (manufacturers + competitors + top hospitals + procedures)

---

## 4. v0 Tools (6 deployed)

All wired to the same Supabase service-role connection. Smoke-tested against real data in session 1.

| Tool | What it returns | Backend |
|------|-----------------|---------|
| `lookup_entity(query, kinds[])` | Fuzzy match → up to 12 ranked candidates from surgeons/locations/manufacturers/competitors | `fn_lookup_entity` RPC |
| `get_surgeon_profile(surgeon_id)` | Surgeon row + locations they operate at + 5 most recent field notes | Direct SELECT + `surgeon_locations` two-step join |
| `get_location_profile(location_id)` | Location + territory + assigned TM rep + surgeons there + 5 most recent field notes | Direct SELECT + `surgeon_locations` two-step join |
| `get_recent_notes(entity_kind, entity_id, days)` | Recent field notes (default 60 days) | `fn_recent_notes_about` RPC |
| `get_team_member(rep_id or name)` | Rep row + territory | Direct SELECT + ilike on name |
| `get_tray_status(serial)` | Tray rows matching serial + tray_type description | `trays` + `tray_types` join by prefix |

---

## 5. Settled Decisions
- **Separate project, not a Field Notes mode** — Capture is high-frequency / low-cognition (S3 reps too). Q&A is low-frequency / high-cognition (John + TMs only). Different users, different UX, different system prompts.
- **80% code share from Field Notes V4.0.3** — Same PWA shell, same auth, same chat UI, same Whisper + Claude tool-loop Edge Function pattern. Diverges in: system prompt, tool set, no confirm-and-edit modal, no form, no tags, no photo, no soft-delete UI.
- **Assistant name = Neo** — Mobile sibling of the desktop Codex assistant. Q remains Field Notes-specific.
- **Voice = Neo, calm/direct/professional** — distinct from Q's terse Bond Q-Branch sidekick tone. "Senior colleague who knows the business." No exclamation points, no emojis, no "honestly/frankly/real talk."
- **v0 scope = read-only CRM Q&A** — 6 read tools. No writes, no email drafts, no task creation. Build trust on read first.
- **Self-expansion roadmap pattern** — After answering, IF the user implies a follow-up action Neo can't do yet, Neo ends with one offer: "Want me to learn how to [action]?" Saying yes goes on the v0.1 roadmap. Logged in `neo_mobile_interactions` for analysis.
- **User base for v0** — John only, until the loop feels right. TMs join when v0 is steady.
- **Vercel: same team, separate project** — Unified billing + secrets, isolated deploys/domain. Vercel SSO/password protection DISABLED for PWA accessibility.
- **Supabase: one DB** — `oso-tray-tracker` continues as the single operational DB.
- **Whisper + Haiku 4.5** — Inherited from Field Notes. Re-evaluate model if multi-tool queries need more reasoning.
- **No confirm-and-edit modal** — Neo Mobile produces answers in chat, not `field_notes` rows.
- **Interaction logging from day one** — Every turn → `neo_mobile_interactions`. This is the v0.1 roadmap data.
- **Use `neomobile.vercel.app` as the primary URL** — `neo-mobile.vercel.app` is taken globally; chose the no-hyphen variant. `neo-ao.vercel.app` and `neo-mobile-ao.vercel.app` also alias the same deployment (in case we change preference later).

---

## 6. Active Work Items

**Done session 1 (2026-05-16):**
- [x] Fork code from Field Notes V4.0.3 → `/Users/johnwalsh/Codex/Projects/Neo Mobile/`
- [x] Refactor `index.html` from 2126 → 927 lines (strip capture, tags, photo, feed, modals)
- [x] Rebrand manifest + service worker
- [x] Write Neo system prompt (voice + self-expansion pattern)
- [x] Build Edge Function `neo-mobile-chat` with 6 read tools + Anthropic prompt caching
- [x] Smoke-test all 6 tools against real data (Petrucelli, Lankenau, Nick Diiorio, GMN trays)
- [x] Create `neo_mobile_interactions` log table with RLS
- [x] Wire Edge Function to log every turn (rep_id from JWT, message, tools, usage)
- [x] Create GitHub repo `jwalshAO/neo-mobile`, push
- [x] Create Vercel project, link to GitHub, disable SSO, deploy
- [x] Claim short URLs: `neomobile.vercel.app`, `neo-ao.vercel.app`, `neo-mobile-ao.vercel.app`
- [x] Permissions allowlist for Codex worktree (Supabase MCP writes, Vercel MCP, git/gh, file ops; denied destructive commands)

**Next (in priority order):**
- [ ] **John installs on phone + tests real queries** — tone calibration, transcription accuracy, latency, see whether Neo's self-expansion offers feel natural
- [ ] Review `neo_mobile_interactions` log after a day of use → build the v0.1 write tool John says yes to most
- [ ] Replace placeholder Field Notes icons (kraft notebook) with a Neo-specific icon
- [ ] Settle splash blurb (currently "Ask Neo anything — surgeons, trays, sales, intel.")
- [ ] Settle Anthropic workspace decision (reuse "Field Notes" workspace, or split off "Neo Mobile")
- [ ] v0.1 — first write tool (depends on log data; likely Todoist task or Gmail draft)

**Deploy command (for index.html / vercel.json / manifest / sw.js changes):**
```
cd "/Users/johnwalsh/Codex/Projects/Neo Mobile" && git add . && git commit -m "v0.x: ..." && git push origin main
```

**Redeploy Edge Function (for `supabase/functions/neo-mobile-chat/index.ts` changes):**
Via Supabase MCP `deploy_edge_function` from this session, OR via Supabase CLI if you're at the office.

---

## 7. Open Questions & Blockers
- **Tone calibration** — John's real-phone test will tell us. The system prompt rules ("brief, direct, no fluff, no exclamations") will likely need 1-2 rounds of tuning.
- **Transcription quality** — Whisper proper-noun priming is the same as Field Notes (which works). But Neo Mobile queries may include more sales/finance vocabulary not in the priming list. Watch logs.
- **Self-expansion offer trigger threshold** — Will Neo offer too often (annoying), too rarely (no roadmap data), or about right? Live use answers it.
- **Icon design** — placeholder is Field Notes kraft notebook with "Field Notes" text. Needs Neo-specific design. Defer until v0.1.
- **Splash screen** — currently has motivational-free framing. Decide: keep, replace, or drop entirely for a single-power-user app.
- **Naming on phone home screen** — currently "Neo Mobile". Consider just "Neo" (shorter, matches assistant name) — would conflict with "Neo" the desktop assistant? Maybe fine.
- **`neo-mobile.vercel.app` is taken globally** — using `neomobile.vercel.app` instead. Long-term, consider buying a real domain if John wants something custom.

---

## 8. Constraints & Preferences
- Light/white backgrounds only
- Terminal commands in one shot
- All code files inside `/Users/johnwalsh/Codex/`
- Git push workflow only — Vercel auto-deploys on push
- `oso-tray-tracker` project ID: `pchhtltxdcmvdcwnwaeg`
- Vercel team ID: `team_JdA1PzYEzjypAUH798UGodJJ` (slug `agility-ortho`)
- Vercel project ID: `prj_pJFS54uDFLpqbmUgVYKxiUdv1coe`
- GitHub: `jwalshAO/neo-mobile`
- Reuse Whisper + Anthropic keys from Field Notes (Supabase secrets) — do NOT duplicate
- Edge Function source is version-controlled at `supabase/functions/neo-mobile-chat/index.ts` — keep it in sync with the deployed version

---

## 9. Background Context
- Agility Orthopaedic — upper extremity orthopedic distribution, Eastern/Central PA, South NJ, Northern DE
- 11 team members: John (owner), 4 TMs (Nate, Nick, Noah, Pat), 6 S3 reps
- Field Notes (sibling project) handles CAPTURE — reps write field intel into the CRM via Q-the-sidekick. Live at https://field-intel-webapp.vercel.app since 2026-05-16.
- Neo Mobile handles ASK / ACT — John (and eventually TMs) query and operate the CRM via Neo.
- The two apps share Supabase auth, the same `reps` and CRM tables, and the same Whisper + Claude Edge Function pattern. They differ in surface area (one writes one row type; one queries everything) and audience (all reps vs. leadership).
- The Codex (`/Users/johnwalsh/Codex/`) is John's unified ops vault. Neo (the assistant) lives across desktop + mobile + ops@ email — Neo Mobile is the phone surface.

---

## 10. History Log
- 2026-05-16 — Session 1 (fork day → live in production, single session):
  - Forked Field Notes V4.0.3. Stripped capture flow from `index.html` (2126 → 927 lines). Rebranded manifest + service worker.
  - Wrote Neo system prompt (calm/direct/brief voice, self-expansion pattern).
  - Built Edge Function `neo-mobile-chat` with 6 read tools: `lookup_entity`, `get_surgeon_profile`, `get_location_profile`, `get_recent_notes`, `get_team_member`, `get_tray_status`. Reuses Field Notes RPCs (`fn_lookup_entity`, `fn_recent_notes_about`). Anthropic prompt caching on system+tools, Haiku 4.5 model.
  - Caught schema bugs pre-deploy: trays use `serial`/`tray_type` (text) not `serial_number`/`tray_type_id`; no FKs on `surgeon_locations` so PostgREST nested selects fail (fixed with two-step manual joins). Smoke-tested all 6 tools against Petrucelli (id 1139, Lankenau), Lankenau Medical Center (id 43, territory Philadelphia, rep Nick Diiorio), and `GMN` trays.
  - Created `neo_mobile_interactions` log table with RLS (Owner reads, service_role writes). Wired Edge Function to JWT-decode rep email → look up rep_id → log every turn (message, tools, usage, error). Deployed v3.
  - Created GitHub repo `jwalshAO/neo-mobile` (public). Initial commit + empty trigger commit. Created Vercel project linked to repo via REST API. First deploy READY. Disabled Vercel SSO (was gating with 401). Claimed three short aliases: `neomobile.vercel.app`, `neo-ao.vercel.app`, `neo-mobile-ao.vercel.app`.
  - Set up Codex permissions allowlist (Supabase MCP writes, Vercel MCP, git/gh prefixes, file ops; denied destructive commands). Lives in `.claude/settings.local.json` (gitignored).
  - All 6 candidate tools from §4 deployed. `get_recent_sales` and `build_target_list` left out of v0 — will surface via self-expansion if John asks for them.
  - **Edge Function v4 (later in same session):** Discovered Field Notes had shipped Session 7 in parallel (Brain v1 LIVE + `is_test` flag + `status` lifecycle + 90 synthetic test notes). Without filters, Neo's `get_surgeon_profile` / `get_location_profile` / `get_recent_notes` would surface fictional test notes as if real. Fixed in two places: (1) updated `fn_recent_notes_about` RPC via migration `fn_recent_notes_filter_test_and_draft` to filter `is_test=false AND (status IS NULL OR status='submitted')` — benefits Field Notes V4 chat too. (2) Updated direct queries in the Edge Function with the same PostgREST filter chain. Deployed v4.
