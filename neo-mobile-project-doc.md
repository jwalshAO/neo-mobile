---
title: "Neo Mobile"
cockpit: true
domain: "Field"
description: "Mobile-first PWA where John and the TMs can chat with Neo about anything in the CRM — pull surgeon history, build target lists, look up tray locations, surface recent intel. Forked from Field Notes V4.0.3 (~80% shared shell). Capture stays in Field Notes; Neo Mobile is the read/ask/act side."
next_action: "Refactor index.html: strip Field Notes capture flow (form, confirm-and-edit modal, tags taxonomy, photo, soft-delete) → leave the chat shell. Then build the Neo Edge Function with v0 read tools (~5–8). Then deploy."
rollout_target: "v0 = read-only CRM Q&A for John + 4 TMs. After each answer, Neo prompts 'want me to be able to do X too?' so the roadmap builds itself."
build_machine: "Either — repo on GitHub, Vercel auto-deploys on push. Forking on the laptop."
---

# Neo Mobile — Living Project Document
Last updated: 2026-05-16 | Session #1 (fork day — code copied, rebrand started, doc created)

---

## 1. Project Identity
- **What it is:** A mobile-first PWA where John and the TMs (Nick, Nate, Noah, Pat) chat with **Neo** about anything in the CRM — pull data, build lists, look up trays, draft outreach, surface intel.
- **Goal:** John (and eventually each TM) taps an icon on the home screen, signs in once with an email code, and can ask Neo anything that's currently a 3-app dance: "Pull the last case Dr Petrucelli did," "Build me a target list for Orthocell in Nick's territory," "Where's GMN2258?", "Draft an email to Sue Lee at HSS asking about her August schedule." Voice or text. Conversational.
- **Owner:** John Walsh
- **Key people:** John (owner, primary user), Nick / Nate / Noah / Pat (TMs — Phase 2 users). S3 reps do NOT need this.
- **Key systems/tools:** Supabase (`oso-tray-tracker` — same DB as Field Notes), Vercel (same team, separate project), GitHub (new repo `jwalshAO/neo-mobile`), Anthropic API (shared "Field Notes" workspace for billing visibility, or new "Neo" workspace — decide v0), OpenAI Whisper (same key as Field Notes)
- **Quick start:** To continue this project, say: `"continue Neo Mobile"`

---

## 2. Current Status
**Fork day.** Code copied from Field Notes V4.0.3 → `/Users/johnwalsh/Codex/Projects/Neo Mobile/`. Manifest and service worker rebranded to "Neo Mobile" and `neo-mobile-v0-1`. `index.html` is still the unedited Field Notes V4.0.3 file — capture flow (form, tags taxonomy, photo, soft-delete, confirm-and-edit modal) needs to come out; chat shell + auth stay. No Edge Function yet, no GitHub repo yet, no Vercel project yet. Project doc just created.

The strategic concept was settled in Field Notes session 6 (2026-05-16): Q is for capture (one observation → one `field_notes` row); Neo Mobile is for everything else — open-ended CRM queries, list-building, lookups, drafts. Same Supabase auth, same Edge Function pattern (Whisper + Claude tool loop), same PWA shell — but broader system prompt, ~15–20 tools at maturity (start with ~5–8 read tools at v0), no confirm-and-edit screen.

---

## 3. What Exists (Artifacts & Files)
- `/Users/johnwalsh/Codex/Projects/Neo Mobile/` — new project folder
- `index.html` — copied from Field Notes V4.0.3, NOT yet refactored (still has capture flow)
- `manifest.json` — rebranded to "Neo Mobile" ✓
- `sw.js` — cache bumped to `neo-mobile-v0-1` ✓
- `vercel.json` — copied as-is (rewrites + cache headers same as Field Notes)
- `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` — **placeholders** (still Field Notes kraft notebook). Need new Neo icon.
- `.gitignore` — copied
- `neo-mobile-project-doc.md` — this file

**Reused from Field Notes (no copy needed, shared at the platform layer):**
- Supabase project `oso-tray-tracker` (pchhtltxdcmvdcwnwaeg) — surgeons / locations / reps / manufacturers / competitors / field_notes / trays
- Supabase Auth (email OTP, persistent sessions, same reps table)
- `pg_trgm` + `fuzzystrmatch` extensions (already enabled session 6)
- `fn_lookup_entity` RPC — reusable as-is for entity disambiguation
- OpenAI Whisper API key — reuse the existing Supabase secret
- Anthropic API key — reuse OR new workspace (decide v0)

---

## 4. Settled Decisions
- **Separate project, not a Field Notes mode** — Capture is high-frequency / low-cognition (S3 reps too). Q&A is low-frequency / high-cognition (John + TMs only). Different users, different UX, different system prompts. (Decided Field Notes session 6, locked here.)
- **80% code share from Field Notes V4.0.3** — Same PWA shell, same auth, same chat UI, same Whisper + Claude tool-loop Edge Function pattern. Diverges in: system prompt, tool set, no confirm-and-edit modal, no form, no tags, no photo, no soft-delete UI. (This session.)
- **Assistant name = Neo** — Matches the broader Codex "Neo" brand. Q remains Field Notes-specific. (This session.)
- **v0 scope = read-only CRM Q&A** — ~5–8 read tools. No writes, no email drafts, no task creation. Build trust on read before opening writes. (This session.)
- **Self-expanding roadmap pattern** — After answering, Neo proposes the next capability the user just hinted at needing ("I can't draft emails yet — want me to learn?"). Each "yes" becomes the next tool. The user-driven roadmap replaces upfront 15-tool spec. (This session.)
- **User base for v0** — John only, until the loop feels right. TMs join when v0 is steady. S3 reps never (out of scope). (This session.)
- **Vercel: same team / account, new project** — Separate Vercel project so the domain / deploy hooks / build logs don't collide with Field Notes. Same Vercel team so billing + secrets management stay unified. (This session.)
- **Supabase: one DB** — `oso-tray-tracker` continues as the single operational DB. No new project. (Inherited from Field Notes.)
- **Voice runtime: Whisper API** — Inherited from Field Notes session 5. Same proper-noun priming list (manufacturers + competitors + top hospitals + procedures). (Inherited.)
- **Model: Haiku 4.5 for chat turns** — Same as Field Notes V4.0.3. Re-evaluate at v0.1 if multi-step reasoning over CRM data needs Sonnet. (Inherited, revisit.)
- **No confirm-and-edit modal** — Neo Mobile produces answers in chat, not `field_notes` rows. Tool calls render as system bubbles same as Field Notes. (This session.)

---

## 5. v0 Plan — Read-Only CRM Q&A with Self-Expansion

### 5.1 What v0 does
John opens Neo Mobile on his phone → signs in (email OTP, persistent) → lands on chat with Neo → taps mic or types → asks anything in scope of the v0 tools → Neo answers in chat, surfaces tool calls inline, ends with one of:
- "Want me to do X too?" (proposes a write/draft tool John just implicitly asked for)
- "Anything else?" (open-ended)
- Silent if the answer is fully contained.

### 5.2 v0 read tools (target ~5–8)
First-pass list — refine when refactoring the Edge Function:
1. **`lookup_entity(query, kinds[])`** — already exists as `fn_lookup_entity` RPC; same fuzzy match as Field Notes
2. **`get_surgeon_profile(surgeon_id)`** — names, NPI, specialty, status, primary hospital, recent activity, recent field notes
3. **`get_location_profile(location_id)`** — facility name, territory, assigned rep, surgeons known to operate there, recent field notes
4. **`get_recent_notes(entity_kind, entity_id, days)`** — already exists as `fn_recent_notes_about`; reuse
5. **`get_tray_status(tray_id_or_query)`** — current location / consignment status / last-seen date for a tray. Pulls from tray inventory table.
6. **`build_target_list(criteria)`** — query surgeons by territory / manufacturer / status / funnel stage / recency. Returns ranked list.
7. **`get_team_member(rep_name_or_id)`** — TM / rep info: territory, accounts, contact, role
8. **`get_recent_sales(filters)`** — recent SD revenue rows by rep / surgeon / facility / manufacturer

### 5.3 Out of scope for v0 (deferred)
- Drafting emails (Gmail API)
- Creating Todoist tasks
- Updating surgeon flags / status / next-touch dates in CRM
- Reading/writing Order PO automation data
- Tray reassignment / movement requests
- Anything that mutates Supabase rows

The **self-expansion pattern** means v0 surfaces demand for these without us pre-building them.

### 5.4 Build sequence
1. Refactor `index.html`: strip Field Notes capture flow (form, confirm-and-edit modal, tags taxonomy, photo, soft-delete), keep chat shell + composer + auth + Whisper + mic/text toggle. Rename "Q" → "Neo" everywhere in UI strings. Drop the Notes Feed entirely.
2. Author Neo system prompt: identity, tone (Neo = Codex assistant, professional but warm, brief but not curt; distinct from Q's terse field-sidekick voice), tool-use rules, self-expansion ending pattern.
3. Stand up `neo-mobile-chat` Edge Function: same skeleton as `field-notes-chat`, but new system prompt + tools. Reuse Whisper. Anthropic prompt caching from day one.
4. Build the v0 read tools (5.2). Most map 1:1 to RPCs already in `oso-tray-tracker` or simple SELECTs.
5. Create GitHub repo `jwalshAO/neo-mobile`, push, link to new Vercel project under same team.
6. Test on John's phone for a few days. Tone calibration, transcription quality, latency, tool selection.
7. Capture the "want me to also do X" responses → roadmap.

### 5.5 Cost model
Inherited from Field Notes (~$0.05 / interaction). Neo Mobile interactions will average longer than Field Notes (more tool calls, denser answers) — assume $0.10 / interaction as planning number. John alone at 10 interactions/day → ~$20/mo. With 4 TMs added at 5/day each → ~$50–80/mo. Round to **$50/mo budget cap** at v0, raise once usage is real.

### 5.6 Open questions (v0)
- **Anthropic workspace** — reuse the existing "Field Notes" workspace (simpler, mixed billing) or new "Neo Mobile" workspace (cleaner separation)? Default = reuse for v0, split if costs need attribution.
- **Splash screen / motivational blurb** — Field Notes has one ("Every note you capture..."). Neo Mobile needs its own framing for John, or skip splash entirely for a single-power-user app?
- **Icon** — Field Notes is kraft notebook with "Field Notes" text. Neo Mobile needs its own. Defer until v0 functional.
- **Naming on home screen** — "Neo Mobile" or just "Neo"? Lean "Neo" (shorter, cleaner, matches assistant name). Trade-off: ambiguous vs. desktop Neo. Decide before first install.

---

## 6. Active Work Items
- [ ] **Refactor `index.html`** — strip capture flow, keep chat shell, rebrand "Q" → "Neo" in strings, drop Notes Feed view. ← NEXT
- [ ] Author Neo system prompt (tone, self-expansion ending rule)
- [ ] Build `neo-mobile-chat` Edge Function (clone `field-notes-chat`, swap system prompt + tools)
- [ ] Implement 5–8 v0 read tools as Postgres functions or in-Edge-Function SELECTs
- [ ] Create `jwalshAO/neo-mobile` GitHub repo + push
- [ ] Provision Vercel project (same team), wire domain
- [ ] Test on phone — John, real queries, a few days
- [ ] Capture "want me to also do X" answers → write-tool roadmap

**Deploy command (once repo + Vercel set up):**
```
cd "/Users/johnwalsh/Codex/Projects/Neo Mobile" && git add . && git commit -m "v0.x: ..." && git push origin main
```

---

## 7. Open Questions & Blockers
- v0 read-tool selection — final list of 5–8 (current candidates in §5.2)
- Anthropic workspace decision (reuse vs. new)
- Icon design + home-screen short name
- Splash screen — keep, replace, or drop

---

## 8. Constraints & Preferences
- Light/white backgrounds only
- Terminal commands in one shot
- All files inside `/Users/johnwalsh/Codex`
- Git push workflow only — Vercel auto-deploys on push
- `oso-tray-tracker` project ID: `pchhtltxdcmvdcwnwaeg`
- GitHub repo (planned): `jwalshAO/neo-mobile`
- Vercel URL (planned): `neo-mobile.vercel.app` (or domain TBD)
- Reuse Whisper key + RPCs from Field Notes — do NOT duplicate

---

## 9. Background Context
- Agility Ortho — upper extremity orthopedic distribution, Eastern/Central PA, South NJ, Northern DE
- 11 team members: John (owner), 4 TMs (Nate, Nick, Noah, Pat), 6 S3 reps
- Field Notes (sibling project) handles CAPTURE — reps write field intel into the CRM via Q-the-sidekick. Live at https://field-intel-webapp.vercel.app since 2026-05-16.
- Neo Mobile handles ASK / ACT — John (and eventually TMs) query and operate the CRM via Neo.
- The two apps share Supabase auth, the same `reps` and CRM tables, and the same Whisper + Claude Edge Function pattern. They differ in surface area (one writes one row type; one queries everything) and audience (all reps vs. leadership).
- The Codex (`/Users/johnwalsh/Codex/`) is John's unified ops vault. Neo (the assistant) lives across desktop + mobile + ops@ email — Neo Mobile is the phone surface.

---

## 10. History Log
- 2026-05-16 — Session 1 (fork day): Forked Field Notes V4.0.3 → new `/Users/johnwalsh/Codex/Projects/Neo Mobile/` folder. Copied `index.html` / `manifest.json` / `sw.js` / `vercel.json` / icons / `.gitignore`. Rebranded `manifest.json` ("Neo Mobile — Agility Ortho", short_name "Neo Mobile") and `sw.js` (`CACHE_NAME = 'neo-mobile-v0-1'`). Decisions locked: separate project (not Field Notes mode), assistant name = Neo, v0 = read-only CRM Q&A with self-expansion pattern, John-only at v0, same Vercel team but separate project, reuse Supabase + Whisper. Wrote this project doc.
