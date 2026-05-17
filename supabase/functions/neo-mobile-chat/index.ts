import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  caldavConfigured,
  discoverCalendarHome,
  findCalendarUrls,
  queryCalendarEvents,
  parseVEvent,
  parseCaseSummary,
} from "./caldav.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TODOIST_API_TOKEN =
  Deno.env.get("TODOIST_API_TOKEN") ??
  Deno.env.get("Todoist-API-Token") ??
  Deno.env.get("todoist_api_token") ??
  "";

const ICLOUD_CALENDARS = (Deno.env.get("ICLOUD_CALENDARS") ?? "Work,Private").split(",").map(s => s.trim()).filter(Boolean);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Whisper prompt — same proper-noun priming as Field Notes so transcription nails CRM names.
const WHISPER_PROMPT = "Field intelligence and CRM queries for Agility Orthopaedic, an upper-extremity orthopedic distributor in PA and NJ. Manufacturers we sell: Skeletal Dynamics, Orthocell, TYBR Health, Insight Surgery, Enovis DJO, Virak Ortho, Simparo Surgical, Captiox, FX Shoulder. Competitors: Acumed, DePuy Synthes, Stryker, Arthrex, Axogen, Zimmer Biomet, TriMed, Avanti, Smith and Nephew, Integra, Medartis, Biederman, AM Surgical, Globus Medical. Hospitals and surgery centers: Lehigh Valley, Einstein, Methodist, King of Prussia, Penn Presbyterian, York, Wellspan, Bryn Mawr, Lankenau, Coordinated Health, Jefferson, Turk's Head, Holy Redeemer, Temple, Abington, Chester County, Hershey, Lancaster General, Penn State Hershey, Phoenixville, St. Luke's. Procedures: distal radius, scaphoid, carpal tunnel, tendon transfer, cubital tunnel, trigger finger, ulnar nerve, elbow, shoulder.";

const SYSTEM_PROMPT = `You are Neo, the assistant inside Agility Orthopaedic's Neo Mobile app — a phone-side CRM partner for John (the owner) and his team managers. You answer questions about the business by querying the CRM directly. You are calm, direct, professional, and brief.

WHO YOU ARE
- Name: Neo. Mobile sibling of the Codex assistant John works with on his desktop.
- Audience: John Walsh (owner) and the 4 territory managers (Nick, Nate, Noah, Pat). Not S3 reps.
- Voice: senior colleague who knows the business. Confident, succinct, no fluff. No exclamation points. No emojis. Don't say "honestly," "to be honest," "real talk," or "frankly."
- Length: 1–4 short sentences for most answers. Use a brief bulleted list when surfacing a profile or 3+ data points. Never pad.

WHAT YOU CAN DO TODAY
- Look up surgeons, locations, manufacturers, competitors (fuzzy matching for misspellings)
- Pull a surgeon profile (status, primary hospital, specialty, recent notes summary)
- Pull a location profile (territory, assigned rep, surgeons there, recent notes)
- Pull recent field notes about an entity
- Pull team member info (rep, territory, accounts)
- Look up tray status (current location, type, last activity)
- Create a Todoist task when the user mentions an action they need to take
- Pull sales/revenue numbers (get_sales): aggregate revenue + case count for any entity over any window, with optional YoY/MoM comparison and group-by breakdowns
- List recent surgical cases (get_recent_cases) by surgeon, location, or rep
- List upcoming scheduled cases (get_upcoming_cases) from John's iCloud calendars (Work + Private). Non-case events (meetings, conferences, labs, meals) are filtered out automatically.

YOU CANNOT YET (use the self-expansion pattern below)
- Draft emails, update the CRM, schedule calendar events, send messages, or anything else that writes.
- Build target lists or filtered surgeon searches.

SALES & CASE QUERIES — guidance
- For sales by SURGEON, daily_sales.doctor is a TEXT column (not surgeon_id). Pass surgeon_lastname to get_sales / get_recent_cases. Always run lookup_entity first to confirm the right surgeon, then use their lastname for the sales filter.
- For sales by LOCATION or REP, pass entity_id (an integer) from lookup_entity (location) or get_team_member (rep).
- Default windows when user is vague:
  - "sales yesterday" → window=yesterday
  - "this month" → window=mtd
  - "year to date" / "this year" → window=ytd
  - "last year" → window=last_year
  - "running compared to last year" → window=ytd, compare_to=same_window_last_year
- For "Who is Nick's top surgeon?" → entity_kind=rep, entity_id=Nick's rep_id, window=ytd, group_by=surgeon, limit=1.
- Currency: revenue is in dollars. Format big numbers with commas and "$" prefix. Don't include cents unless asked.
- If revenue is $0 and case_count is 0 over a non-trivial window, say so plainly — don't pretend you found something.

TASK CAPTURE (automatic, with entity resolution)
Listen for task-like phrases anywhere in the user's message — even buried inside other content:
- "I have to / need to / should / gotta [verb]"
- "Remind me to [verb]"
- "Follow up with X about Y"
- "Ask X about Y"
- "Schedule / call / email / book / lunch with / meet [person]"
- "Don't forget to [verb]"

ENTITY-FIRST RULE (critical): if the task references a named entity (surgeon, hospital, manufacturer, competitor), call lookup_entity FIRST for each named entity, THEN call create_task using the CRM-resolved names in the content. This corrects user typos and misspellings. Examples:

- "Remind me to discuss Salouf's Lumiere entry"
  → lookup_entity("Salouf") → David Zelouf, MD
  → lookup_entity("Lumiere") → Lumere (competitor)
  → create_task(content="Discuss Lumere entry with Zelouf")
- "I have to talk to Nate about Sibley's TWA case"
  → lookup_entity("Nate") → Nate Fick (team member — get_team_member is fine here too)
  → lookup_entity("Sibley") → Sibley Memorial Hospital
  → create_task(content="Talk to Nate re: Sibley TWA case")
- "Remind me to email Petrucelli tomorrow"
  → lookup_entity("Petrucelli") → Philip Petrucelli, MD
  → create_task(content="Email Petrucelli", due_string="tomorrow")

If lookup returns NO match, fall back to the user's literal spelling. If MULTIPLE matches, pick the most likely from context — only ask the user to disambiguate if it's truly unclear and would change the meaning of the task.

For tasks WITHOUT named entities ("update the slide deck", "buy coffee"), skip lookup and call create_task directly.

After create_task, ONE brief confirmation:
- "Logged — 'Discuss Lumere entry with Zelouf.'"
Then if the user was ALSO asking a question, answer it after the confirmation. Never lose the original ask.

Preserve user-given specifics (dates, urgency, exactly-what-about). Only entity NAMES get corrected via lookup. If multiple tasks are in one message, call create_task multiple times.

DO NOT call create_task for:
- Hypothetical statements ("if I were to talk to Nate...")
- Past tense ("I talked to Nate yesterday")
- Questions ("what should I tell Nate?")
- Things YOU just did via tools ("I pulled Petrucelli's profile" is your action, not a task)
- Vague intentions without a clear verb-object ("I want to be better with my reps")

SELF-EXPANSION PATTERN (CRITICAL — this is how the product grows)
After answering, IF the user's question implies they would naturally want a follow-up action you cannot yet perform, end your reply with exactly one short offer in this form:
   "Want me to learn how to [action]?"
Examples of when to offer:
- They ask about a surgeon → offer drafting a follow-up email or creating a touch-up task.
- They ask about a tray → offer creating a tray pickup task.
- They ask about a rep → offer building a target list for that rep.
- They ask about a competitor → offer pulling a target list of surgeons using that competitor.
Rules:
- One offer per reply, max. Don't pad with multiple "I could also..."
- Only offer if the implied action is genuinely useful AND outside current v0 tools.
- If the user already got exactly what they asked for and no action is implied, DO NOT add a fluff offer. Stay silent. Brevity > engagement-padding.
- If the user says yes to an offer, acknowledge: "Logged. I'll need that capability built — that'll go on the v0.1 list." Do not pretend you can do it.

TOOL USE
- When a user mentions any named entity (person, hospital/surgery center, manufacturer, competitor, tray serial), call lookup_entity FIRST to resolve it. Fuzzy match handles misspellings.
- After lookup_entity, pull the most relevant follow-up:
  - Surgeon → get_surgeon_profile + (if visit/case context) get_recent_notes
  - Location → get_location_profile + (if asking about activity) get_recent_notes
  - Tray serial like "GMN2258" → get_tray_status
  - Rep name → get_team_member
- On multiple matches, ask the user to disambiguate by location or specialty: "Christopher Jones at Bryn Mawr, or Michael Jones at Penn State?"
- On zero matches, say so directly: "No match in the CRM for 'Petrocelli' — closest is Philip Petrucelli at Lankenau. Did you mean that one?"
- Don't invent entities not in lookup results.

ANSWER FORMAT
- Lead with the answer. Don't restate the question.
- When showing a profile, use brief bullets:
  Philip Petrucelli, MD — Lankenau Medical Center
  • Active, Hand/Wrist
  • 12 cases YTD
  • Last note 2026-05-10: "asked about TYBR DRP, agreed to lab"
- For yes/no questions, lead with yes/no, then one supporting line.
- If a tool returns nothing useful, say so plainly: "Nothing in the CRM about that."

CONTEXT
Agility Orthopaedic distributes upper extremity orthopedic implants (distal radius, hand, wrist, elbow, shoulder) in Eastern/Central PA, South NJ, Northern DE. Manufacturers: Skeletal Dynamics, Orthocell, TYBR Health, Insight Surgery, Enovis/DJO, Virak Ortho, Simparo, Captiox, FX Shoulder. Competitors: Acumed, DePuy Synthes, Stryker, Arthrex, Zimmer Biomet, TriMed, Avanti, Smith & Nephew, Integra, Medartis, Biederman, AM Surgical, Globus Medical, Axogen.`;

const TOOLS = [
  {
    name: "lookup_entity",
    description: "Fuzzy search the CRM for a named entity (surgeon, location, manufacturer, competitor). Handles misspellings and phonetic variants. ALWAYS call this first when the user mentions a named entity. Returns up to 12 ranked matches.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Name or partial name" },
        kinds: {
          type: "array",
          items: { type: "string", enum: ["surgeon", "location", "manufacturer", "competitor"] },
          description: "Which entity types to search. Defaults to all four."
        }
      },
      required: ["query"]
    }
  },
  {
    name: "get_surgeon_profile",
    description: "Get a surgeon's full profile: status, specialty, funnel stage, primary hospital, locations they operate at, recent field notes summary. Use after lookup_entity returns a surgeon.",
    input_schema: {
      type: "object",
      properties: {
        surgeon_id: { type: "integer" }
      },
      required: ["surgeon_id"]
    }
  },
  {
    name: "get_location_profile",
    description: "Get a location's full profile: address, category, territory, assigned reps, surgeons known to operate there, recent field notes summary.",
    input_schema: {
      type: "object",
      properties: {
        location_id: { type: "integer" }
      },
      required: ["location_id"]
    }
  },
  {
    name: "get_recent_notes",
    description: "Get recent field notes about an entity (surgeon, location, manufacturer, competitor). Default lookback 60 days.",
    input_schema: {
      type: "object",
      properties: {
        entity_kind: { type: "string", enum: ["surgeon", "location", "manufacturer", "competitor"] },
        entity_id: { type: "integer" },
        days: { type: "integer", description: "Lookback window in days (default 60)" }
      },
      required: ["entity_kind", "entity_id"]
    }
  },
  {
    name: "get_team_member",
    description: "Get info on a rep / team member: name, email, role, territory, rep_type, active status. Pass either the rep_id or a name fragment.",
    input_schema: {
      type: "object",
      properties: {
        rep_id: { type: "integer" },
        name: { type: "string", description: "Name fragment (e.g. 'Nick', 'Pat'). Case-insensitive." }
      }
    }
  },
  {
    name: "get_tray_status",
    description: "Look up a tray by serial number (like 'GMN2258' or 'DES0437'). Returns: tray type, current location, consignment status, last activity date.",
    input_schema: {
      type: "object",
      properties: {
        serial: { type: "string", description: "Tray serial number — exact or partial" }
      },
      required: ["serial"]
    }
  },
  {
    name: "create_task",
    description: "Create a Todoist task. Use whenever the user mentions a task-like phrase ('I have to X', 'remind me to Y', 'follow up with Z', 'ask X about Y', 'schedule X', 'don't forget to X'), even if buried inside an unrelated question. Keep content concise (under 12 words), action-first, preserving specifics. Call multiple times if there are multiple tasks in one message. Do NOT call for hypotheticals, past tense, or vague intentions.",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Task title — action-first, concise, preserves the user's specifics (names, entities, what about). Example: 'Talk to Nate re: Sibley TWA case'." },
        due_string: { type: "string", description: "Optional Todoist natural-language due date like 'tomorrow', 'next Mon', 'Friday at 3pm', 'in 2 days'. Omit if user did not specify a time." },
        priority: { type: "integer", description: "1 (default, low) to 4 (urgent). Use 3+ only if user emphasized urgency." }
      },
      required: ["content"]
    }
  },
  {
    name: "get_sales",
    description: "Get aggregated sales/revenue from Agility Ortho's daily_sales table. Answers: 'How much did we do at Lankenau last year?', 'What were our sales yesterday?', 'How is Petrucelli running compared to this date last year?', 'Who is Nick's top surgeon?'. Pass the entity filter + the date window. Optional compare_to for YoY/MoM. Optional group_by for ranked breakdowns ('top 5 surgeons by rep'). For surgeon filter, pass surgeon_lastname (daily_sales.doctor is a text column).",
    input_schema: {
      type: "object",
      properties: {
        entity_kind: { type: "string", enum: ["surgeon", "location", "rep", "global"], description: "What to filter by. 'global' = no entity filter (company-wide)." },
        entity_id: { type: "integer", description: "Required when entity_kind is 'location' or 'rep'. Pass the ID from lookup_entity or get_team_member." },
        surgeon_lastname: { type: "string", description: "Required when entity_kind='surgeon'. Pass the lastname (e.g., 'Zelouf') since daily_sales.doctor is text." },
        window: { type: "string", enum: ["today", "yesterday", "this_week", "last_week", "mtd", "last_month", "ytd", "last_year", "last_30_days", "last_90_days", "custom"], description: "Date window for the aggregate." },
        custom_start: { type: "string", description: "ISO date (YYYY-MM-DD) when window='custom'." },
        custom_end: { type: "string", description: "ISO date (YYYY-MM-DD) when window='custom'." },
        compare_to: { type: "string", enum: ["same_window_last_year", "prior_month"], description: "Optional: also return the equivalent prior period for comparison." },
        group_by: { type: "string", enum: ["surgeon", "location", "rep", "month"], description: "Optional: break the total into groups. Returns ranked rows instead of one total." },
        limit: { type: "integer", description: "Optional: cap group_by results (e.g., limit=5 for top 5)." }
      },
      required: ["entity_kind", "window"]
    }
  },
  {
    name: "get_recent_cases",
    description: "List recent surgical cases from the case_usage table (iTraycer feed, post-case only). Answers: 'When was Petrucelli's last case?', 'What did Nick run last week?'. Default limit 5, ordered most recent first. Note: case_usage only has PAST cases — for upcoming cases use get_upcoming_cases.",
    input_schema: {
      type: "object",
      properties: {
        entity_kind: { type: "string", enum: ["surgeon", "location", "rep"], description: "What to filter by." },
        entity_id: { type: "integer", description: "Required when entity_kind is 'location' or 'rep'." },
        surgeon_lastname: { type: "string", description: "Required when entity_kind='surgeon' (case_usage.surgeon is text)." },
        limit: { type: "integer", description: "Default 5." }
      },
      required: ["entity_kind"]
    }
  },
  {
    name: "get_upcoming_cases",
    description: "List upcoming/scheduled surgical cases from John's iCloud calendars (Work + Private). Answers: 'How many cases do I have tomorrow?', 'What's on the schedule next week?', 'Any cases at Lankenau this Friday?'. Reads via CalDAV in real time. Non-case events (meetings, conferences, cadaver labs, meals, travel, PTO) are filtered out. Cancelled cases (marked with ❌ or X-prefix or 'cancel') are excluded by default.",
    input_schema: {
      type: "object",
      properties: {
        range: { type: "string", enum: ["today", "tomorrow", "this_week", "next_week", "next_7_days", "next_14_days", "next_30_days", "custom"], description: "Date range. 'this_week' = today through Sunday. 'next_week' = next Monday through Sunday." },
        custom_start: { type: "string", description: "ISO date (YYYY-MM-DD) when range='custom'." },
        custom_end: { type: "string", description: "ISO date (YYYY-MM-DD) when range='custom'." },
        include_cancelled: { type: "boolean", description: "Default false. Set true to include cases marked cancelled." },
        surgeon_lastname: { type: "string", description: "Optional: filter to cases featuring this surgeon (case-insensitive substring match on event summary)." }
      },
      required: ["range"]
    }
  }
];

async function transcribeAudio(audioBase64: string, mimeType: string): Promise<string> {
  const binary = atob(audioBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const ext = mimeType.includes("mp4") ? "mp4"
            : mimeType.includes("ogg") ? "ogg"
            : mimeType.includes("mpeg") ? "mp3"
            : mimeType.includes("wav") ? "wav"
            : "webm";
  const fd = new FormData();
  fd.append("file", new Blob([bytes], { type: mimeType }), `audio.${ext}`);
  fd.append("model", "whisper-1");
  fd.append("language", "en");
  fd.append("prompt", WHISPER_PROMPT);
  const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_API_KEY}` },
    body: fd,
  });
  if (!resp.ok) throw new Error(`Whisper ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  return (data.text ?? "").trim();
}

async function callClaude(messages: any[]): Promise<any> {
  const toolsWithCache = TOOLS.map((t, i) =>
    i === TOOLS.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t
  );
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: toolsWithCache,
      messages,
    }),
  });
  if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${await resp.text()}`);
  return await resp.json();
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function resolveWindow(window: string, customStart?: string, customEnd?: string): { start: string; end: string; label: string } {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  const day = today.getUTCDate();

  const startOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 1));
  const endOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0));
  const addDays = (d: Date, n: number) => { const r = new Date(d); r.setUTCDate(r.getUTCDate() + n); return r; };

  switch (window) {
    case "today":          return { start: isoDate(today), end: isoDate(today), label: "today" };
    case "yesterday": {
      const y = addDays(today, -1);
      return { start: isoDate(y), end: isoDate(y), label: "yesterday" };
    }
    case "this_week": {
      // ISO week: Monday = 1. Start of this week = Monday.
      const dow = today.getUTCDay() || 7;
      const mon = addDays(today, 1 - dow);
      return { start: isoDate(mon), end: isoDate(today), label: "this week" };
    }
    case "last_week": {
      const dow = today.getUTCDay() || 7;
      const thisMon = addDays(today, 1 - dow);
      const lastMon = addDays(thisMon, -7);
      const lastSun = addDays(thisMon, -1);
      return { start: isoDate(lastMon), end: isoDate(lastSun), label: "last week" };
    }
    case "mtd":            return { start: isoDate(startOfMonth(year, month)), end: isoDate(today), label: "month-to-date" };
    case "last_month": {
      const start = startOfMonth(year, month - 1);
      const end = endOfMonth(year, month - 1);
      return { start: isoDate(start), end: isoDate(end), label: `${start.toLocaleString("en-US", { month: "long", timeZone: "UTC" })} ${start.getUTCFullYear()}` };
    }
    case "ytd":            return { start: `${year}-01-01`, end: isoDate(today), label: "year-to-date" };
    case "last_year":      return { start: `${year - 1}-01-01`, end: `${year - 1}-12-31`, label: `${year - 1}` };
    case "last_30_days":   return { start: isoDate(addDays(today, -30)), end: isoDate(today), label: "last 30 days" };
    case "last_90_days":   return { start: isoDate(addDays(today, -90)), end: isoDate(today), label: "last 90 days" };
    case "custom":
      if (!customStart || !customEnd) throw new Error("custom window requires custom_start and custom_end");
      return { start: customStart, end: customEnd, label: `${customStart} to ${customEnd}` };
    default:
      throw new Error(`Unknown window: ${window}`);
  }
}

function resolveComparisonWindow(start: string, end: string, kind: string): { start: string; end: string; label: string } {
  const s = new Date(start + "T00:00:00Z");
  const e = new Date(end + "T00:00:00Z");
  if (kind === "same_window_last_year") {
    const ps = new Date(Date.UTC(s.getUTCFullYear() - 1, s.getUTCMonth(), s.getUTCDate()));
    const pe = new Date(Date.UTC(e.getUTCFullYear() - 1, e.getUTCMonth(), e.getUTCDate()));
    return { start: isoDate(ps), end: isoDate(pe), label: "same period last year" };
  }
  if (kind === "prior_month") {
    const ps = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() - 1, s.getUTCDate()));
    const pe = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth() - 1, e.getUTCDate()));
    return { start: isoDate(ps), end: isoDate(pe), label: "prior month" };
  }
  throw new Error(`Unknown comparison: ${kind}`);
}

async function runSalesQuery(opts: {
  entityKind: string;
  entityId?: number;
  surgeonLastname?: string;
  start: string;
  end: string;
  groupBy?: string;
  limit?: number;
}): Promise<{ total_revenue: number; case_count: number; groups?: any[] }> {
  // Build the WHERE clause inline using parameterized values via .filter() chain
  let query = supabase
    .from("daily_sales")
    .select("net_amount, doctor, rep_id, location_id, surgery_date, document_number");
  query = query.gte("surgery_date", opts.start).lte("surgery_date", opts.end);

  if (opts.entityKind === "surgeon" && opts.surgeonLastname) {
    query = query.ilike("doctor", `%${opts.surgeonLastname}%`);
  } else if (opts.entityKind === "location" && opts.entityId) {
    query = query.eq("location_id", opts.entityId);
  } else if (opts.entityKind === "rep" && opts.entityId) {
    query = query.eq("rep_id", opts.entityId);
  }

  const { data, error } = await query;
  if (error) throw error;
  const rows = data ?? [];

  const total_revenue = rows.reduce((s: number, r: any) => s + Number(r.net_amount ?? 0), 0);
  const case_count = new Set(rows.map((r: any) => r.document_number)).size;

  if (!opts.groupBy) {
    return { total_revenue, case_count };
  }

  // Group + rank
  const buckets = new Map<string, { key: string; label: string; revenue: number; cases: Set<string> }>();
  for (const r of rows) {
    let key: string;
    let label: string;
    if (opts.groupBy === "surgeon")       { key = (r.doctor ?? "(unknown)").toString();          label = key; }
    else if (opts.groupBy === "location") { key = String(r.location_id ?? "null");                label = key; }
    else if (opts.groupBy === "rep")      { key = String(r.rep_id ?? "null");                    label = key; }
    else if (opts.groupBy === "month")    { key = (r.surgery_date ?? "").toString().slice(0, 7); label = key; }
    else                                  { key = "all"; label = "all"; }
    if (!buckets.has(key)) buckets.set(key, { key, label, revenue: 0, cases: new Set() });
    const b = buckets.get(key)!;
    b.revenue += Number(r.net_amount ?? 0);
    if (r.document_number) b.cases.add(r.document_number);
  }
  let groups = [...buckets.values()].map(b => ({ key: b.key, label: b.label, revenue: b.revenue, case_count: b.cases.size }));
  groups.sort((a, b) => b.revenue - a.revenue);
  if (opts.limit) groups = groups.slice(0, opts.limit);

  // Enrich location/rep group labels with names
  if (opts.groupBy === "location") {
    const ids = groups.map(g => Number(g.key)).filter(n => Number.isFinite(n));
    if (ids.length > 0) {
      const { data: locs } = await supabase.from("locations").select("id, name").in("id", ids);
      const map = new Map((locs ?? []).map((l: any) => [String(l.id), l.name]));
      groups = groups.map(g => ({ ...g, label: map.get(g.key) ?? g.key }));
    }
  } else if (opts.groupBy === "rep") {
    const ids = groups.map(g => Number(g.key)).filter(n => Number.isFinite(n));
    if (ids.length > 0) {
      const { data: reps } = await supabase.from("reps").select("id, name").in("id", ids);
      const map = new Map((reps ?? []).map((r: any) => [String(r.id), r.name]));
      groups = groups.map(g => ({ ...g, label: map.get(g.key) ?? g.key }));
    }
  }
  return { total_revenue, case_count, groups };
}

async function executeTool(name: string, input: any): Promise<any> {
  if (name === "lookup_entity") {
    const { data, error } = await supabase.rpc("fn_lookup_entity", {
      p_query: input.query,
      p_kinds: input.kinds ?? ["surgeon", "location", "manufacturer", "competitor"],
    });
    if (error) throw error;
    return data;
  }

  if (name === "get_surgeon_profile") {
    const { data: surgeon, error: e1 } = await supabase
      .from("surgeons")
      .select("id, first_name, last_name, credential, npi, specialty, status, primary_hospital, funnel_stage")
      .eq("id", input.surgeon_id)
      .single();
    if (e1) throw e1;

    const { data: surgeonLocs } = await supabase
      .from("surgeon_locations")
      .select("location_id")
      .eq("surgeon_id", input.surgeon_id);
    const locIds = (surgeonLocs ?? []).map((sl: any) => sl.location_id).filter(Boolean);
    let operates_at: any[] = [];
    if (locIds.length > 0) {
      const { data: locs } = await supabase
        .from("locations")
        .select("id, name, city, state, category")
        .in("id", locIds);
      operates_at = locs ?? [];
    }

    const { data: recentNotes } = await supabase
      .from("field_notes")
      .select("id, note_date, subject_text, tags, note_body, next_action")
      .eq("surgeon_id", input.surgeon_id)
      .is("deleted_at", null)
      .or("status.is.null,status.eq.submitted")
      .or("is_test.is.null,is_test.eq.false")
      .order("note_date", { ascending: false })
      .limit(5);

    return {
      surgeon,
      operates_at,
      recent_notes: recentNotes ?? []
    };
  }

  if (name === "get_location_profile") {
    const { data: location, error: e1 } = await supabase
      .from("locations")
      .select("id, name, city, state, category, active, territory_id, assigned_rep_id, street_address, zip, phone, system")
      .eq("id", input.location_id)
      .single();
    if (e1) throw e1;

    let territory = null;
    if (location.territory_id) {
      const { data: t } = await supabase
        .from("territories")
        .select("id, name, code")
        .eq("id", location.territory_id)
        .single();
      territory = t;
    }

    let assigned_rep = null;
    if (location.assigned_rep_id) {
      const { data: r } = await supabase
        .from("reps")
        .select("id, name, email, role, rep_type")
        .eq("id", location.assigned_rep_id)
        .single();
      assigned_rep = r;
    }

    const { data: locSurgs } = await supabase
      .from("surgeon_locations")
      .select("surgeon_id")
      .eq("location_id", input.location_id);
    const surgIds = (locSurgs ?? []).map((sl: any) => sl.surgeon_id).filter(Boolean);
    let surgeons_there: any[] = [];
    if (surgIds.length > 0) {
      const { data: surgs } = await supabase
        .from("surgeons")
        .select("id, first_name, last_name, credential, specialty, status, funnel_stage")
        .in("id", surgIds);
      surgeons_there = surgs ?? [];
    }

    const { data: recentNotes } = await supabase
      .from("field_notes")
      .select("id, note_date, subject_text, tags, note_body, next_action")
      .eq("location_id", input.location_id)
      .is("deleted_at", null)
      .or("status.is.null,status.eq.submitted")
      .or("is_test.is.null,is_test.eq.false")
      .order("note_date", { ascending: false })
      .limit(5);

    return {
      location,
      territory,
      assigned_rep,
      surgeons_there,
      recent_notes: recentNotes ?? []
    };
  }

  if (name === "get_recent_notes") {
    const { data, error } = await supabase.rpc("fn_recent_notes_about", {
      p_entity_kind: input.entity_kind,
      p_entity_id: input.entity_id,
      p_days: input.days ?? 60,
    });
    if (error) throw error;
    return data;
  }

  if (name === "get_team_member") {
    let query = supabase
      .from("reps")
      .select("id, name, email, role, rep_type, territory_id, active");

    if (input.rep_id) {
      query = query.eq("id", input.rep_id);
    } else if (input.name) {
      query = query.ilike("name", `%${input.name}%`);
    } else {
      throw new Error("Provide rep_id or name");
    }

    const { data: reps, error } = await query;
    if (error) throw error;

    const enriched = await Promise.all((reps ?? []).map(async (r: any) => {
      let territory = null;
      if (r.territory_id) {
        const { data: t } = await supabase
          .from("territories")
          .select("id, name")
          .eq("id", r.territory_id)
          .single();
        territory = t;
      }
      return { ...r, territory };
    }));

    return enriched;
  }

  if (name === "create_task") {
    if (!TODOIST_API_TOKEN) {
      const seen = {
        TODOIST_API_TOKEN: Deno.env.get("TODOIST_API_TOKEN") ? "set" : "missing",
        "Todoist-API-Token": Deno.env.get("Todoist-API-Token") ? "set" : "missing",
        todoist_api_token: Deno.env.get("todoist_api_token") ? "set" : "missing",
      };
      throw new Error(`Todoist token not found in Supabase secrets. Checked: ${JSON.stringify(seen)}`);
    }
    const body: Record<string, unknown> = {
      content: input.content,
      priority: typeof input.priority === "number" ? Math.min(4, Math.max(1, input.priority)) : 1,
    };
    if (input.due_string) body.due_string = input.due_string;
    const resp = await fetch("https://api.todoist.com/api/v1/tasks", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${TODOIST_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Todoist API ${resp.status}: ${errText.slice(0, 200)}`);
    }
    return await resp.json();
  }

  if (name === "get_sales") {
    const win = resolveWindow(input.window, input.custom_start, input.custom_end);
    const primary = await runSalesQuery({
      entityKind: input.entity_kind,
      entityId: input.entity_id,
      surgeonLastname: input.surgeon_lastname,
      start: win.start,
      end: win.end,
      groupBy: input.group_by,
      limit: input.limit,
    });

    const result: any = {
      entity_kind: input.entity_kind,
      entity_id: input.entity_id ?? null,
      surgeon_lastname: input.surgeon_lastname ?? null,
      window: { ...win },
      revenue: primary.total_revenue,
      case_count: primary.case_count,
    };
    if (primary.groups) result.groups = primary.groups;

    if (input.compare_to) {
      const cmpWin = resolveComparisonWindow(win.start, win.end, input.compare_to);
      const cmp = await runSalesQuery({
        entityKind: input.entity_kind,
        entityId: input.entity_id,
        surgeonLastname: input.surgeon_lastname,
        start: cmpWin.start,
        end: cmpWin.end,
      });
      result.comparison = {
        window: cmpWin,
        revenue: cmp.total_revenue,
        case_count: cmp.case_count,
        revenue_delta: primary.total_revenue - cmp.total_revenue,
        revenue_delta_pct: cmp.total_revenue ? ((primary.total_revenue - cmp.total_revenue) / cmp.total_revenue) * 100 : null,
      };
    }
    return result;
  }

  if (name === "get_recent_cases") {
    let query = supabase
      .from("case_usage")
      .select("case_id, surgery_date, surgeon, hospital_raw, location_id, manufacturer, sales_rep, rep_id, total, case_type, line_item_count")
      .order("surgery_date", { ascending: false })
      .limit(input.limit ?? 5);

    if (input.entity_kind === "surgeon" && input.surgeon_lastname) {
      query = query.ilike("surgeon", `%${input.surgeon_lastname}%`);
    } else if (input.entity_kind === "location" && input.entity_id) {
      query = query.eq("location_id", input.entity_id);
    } else if (input.entity_kind === "rep" && input.entity_id) {
      query = query.eq("rep_id", input.entity_id);
    }

    const { data: cases, error } = await query;
    if (error) throw error;

    // Enrich location names
    const locIds = [...new Set((cases ?? []).map((c: any) => c.location_id).filter(Boolean))];
    let locMap: Map<number, string> = new Map();
    if (locIds.length > 0) {
      const { data: locs } = await supabase.from("locations").select("id, name").in("id", locIds);
      locMap = new Map((locs ?? []).map((l: any) => [l.id, l.name]));
    }
    return (cases ?? []).map((c: any) => ({
      ...c,
      location_name: c.location_id ? locMap.get(c.location_id) ?? null : null,
    }));
  }

  if (name === "get_upcoming_cases") {
    const cfg = caldavConfigured();
    if (!cfg.ok) throw new Error(`iCloud not configured. Add app-specific password to Supabase secrets. Seen: ${JSON.stringify(cfg.seen)}`);
    // Resolve range to [start, end] dates (inclusive)
    const now = new Date();
    now.setUTCHours(0, 0, 0, 0);
    const addDays = (d: Date, n: number) => { const r = new Date(d); r.setUTCDate(r.getUTCDate() + n); return r; };
    let start: Date, end: Date, label: string;
    const dow = now.getUTCDay() || 7; // ISO Monday=1
    switch (input.range) {
      case "today":          start = now;                                end = now;                                label = "today"; break;
      case "tomorrow":       start = addDays(now, 1);                    end = addDays(now, 1);                    label = "tomorrow"; break;
      case "this_week":      start = now;                                end = addDays(now, 7 - dow);              label = "this week"; break;
      case "next_week":      start = addDays(now, 8 - dow);              end = addDays(now, 14 - dow);             label = "next week"; break;
      case "next_7_days":    start = now;                                end = addDays(now, 7);                    label = "next 7 days"; break;
      case "next_14_days":   start = now;                                end = addDays(now, 14);                   label = "next 14 days"; break;
      case "next_30_days":   start = now;                                end = addDays(now, 30);                   label = "next 30 days"; break;
      case "custom":
        if (!input.custom_start || !input.custom_end) throw new Error("custom range requires custom_start and custom_end");
        start = new Date(input.custom_start + "T00:00:00Z");
        end = new Date(input.custom_end + "T00:00:00Z");
        label = `${input.custom_start} to ${input.custom_end}`;
        break;
      default: throw new Error(`Unknown range: ${input.range}`);
    }
    // End is end-of-day for inclusive range
    const endInclusive = new Date(end);
    endInclusive.setUTCHours(23, 59, 59, 0);

    // CalDAV discovery + per-calendar query
    const homeUrl = await discoverCalendarHome();
    const cals = await findCalendarUrls(homeUrl, ICLOUD_CALENDARS);
    if (cals.length === 0) {
      throw new Error(`No matching iCloud calendars found among ${JSON.stringify(ICLOUD_CALENDARS)}. Open Fantastical and confirm the exact display names.`);
    }
    const allEvents: any[] = [];
    for (const cal of cals) {
      const icsBlocks = await queryCalendarEvents(cal.url, start, endInclusive);
      for (const block of icsBlocks) {
        const evt = parseVEvent(block);
        if (!evt || !evt.dtstart) continue;
        // Apply optional cancelled/keyword filters via parseCaseSummary
        const parsed = parseCaseSummary(evt.summary);
        if (!parsed.is_case) continue; // skip non-case events
        if (parsed.cancelled && !input.include_cancelled) continue;
        if (input.surgeon_lastname && !evt.summary.toLowerCase().includes(input.surgeon_lastname.toLowerCase())) continue;
        allEvents.push({
          calendar: cal.name,
          date: evt.dtstart.toISOString().slice(0, 10),
          time: evt.all_day ? null : evt.dtstart.toISOString().slice(11, 16),
          all_day: evt.all_day,
          surgeon: parsed.surgeon,
          product: parsed.product,
          case_count: parsed.case_count,
          cancelled: parsed.cancelled,
          location: evt.location,
          raw_summary: evt.summary,
        });
      }
    }
    allEvents.sort((a, b) => (a.date + (a.time ?? "")).localeCompare(b.date + (b.time ?? "")));
    return {
      range: label,
      calendars_queried: cals.map(c => c.name),
      count: allEvents.length,
      cases: allEvents,
    };
  }

  if (name === "get_tray_status") {
    const { data: trays, error } = await supabase
      .from("trays")
      .select("id, serial, tray_type, status, inventory_status, assigned_rep, home_location, team, notes, rep_notes, date_received, updated_at")
      .ilike("serial", `%${input.serial}%`)
      .limit(10);
    if (error) throw error;

    // Enrich each tray with its tray_type description (joined by prefix)
    const prefixes = [...new Set((trays ?? []).map((t: any) => t.tray_type).filter(Boolean))];
    let typeMap: Record<string, string> = {};
    if (prefixes.length > 0) {
      const { data: types } = await supabase
        .from("tray_types")
        .select("prefix, description")
        .in("prefix", prefixes);
      typeMap = Object.fromEntries((types ?? []).map((t: any) => [t.prefix, t.description]));
    }
    return (trays ?? []).map((t: any) => ({
      ...t,
      tray_type_description: typeMap[t.tray_type] ?? null,
    }));
  }

  throw new Error(`Unknown tool: ${name}`);
}

function jsonResponse(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function decodeJwtEmail(authHeader: string): { email: string | null; authUserId: string | null } {
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return { email: null, authUserId: null };
  try {
    const payloadB64 = token.split(".")[1] ?? "";
    // base64url → base64
    const b64 = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded));
    return { email: payload.email ?? null, authUserId: payload.sub ?? null };
  } catch (_) {
    return { email: null, authUserId: null };
  }
}

async function lookupRepId(email: string | null): Promise<number | null> {
  if (!email) return null;
  const { data } = await supabase
    .from("reps")
    .select("id")
    .ilike("email", email)
    .maybeSingle();
  return data?.id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "POST only" }, 405);
  }

  const { email: repEmail } = decodeJwtEmail(req.headers.get("Authorization") || "");
  const repId = await lookupRepId(repEmail);
  let userText = "";
  let viaAudio = false;
  let assistantMessage = "";
  let toolCallsMade: any[] = [];
  const totalUsage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

  async function logInteraction(err?: string) {
    try {
      await supabase.from("neo_mobile_interactions").insert({
        rep_id: repId,
        rep_email: repEmail,
        user_message: userText,
        via_audio: viaAudio,
        assistant_message: assistantMessage,
        tool_calls_made: toolCallsMade,
        usage: totalUsage,
        error: err ?? null,
      });
    } catch (logErr) {
      console.error("interaction log write failed", logErr);
    }
  }

  try {
    const body = await req.json();
    const history: any[] = Array.isArray(body.history) ? body.history : [];
    let transcript: string | null = null;
    viaAudio = !!body.audio_base64;
    userText = (body.text ?? "").trim();

    if (body.audio_base64) {
      transcript = await transcribeAudio(body.audio_base64, body.audio_mime || "audio/webm");
      userText = transcript;
    }

    if (!userText) {
      return jsonResponse({ error: "No text or audio provided" }, 400);
    }

    const messages: any[] = [...history, { role: "user", content: userText }];

    for (let i = 0; i < 6; i++) {
      const resp = await callClaude(messages);
      if (resp.usage) {
        totalUsage.input_tokens += resp.usage.input_tokens ?? 0;
        totalUsage.output_tokens += resp.usage.output_tokens ?? 0;
        totalUsage.cache_creation_input_tokens += resp.usage.cache_creation_input_tokens ?? 0;
        totalUsage.cache_read_input_tokens += resp.usage.cache_read_input_tokens ?? 0;
      }

      const content = resp.content ?? [];
      const toolUseBlocks = content.filter((b: any) => b.type === "tool_use");
      const textBlocks = content.filter((b: any) => b.type === "text");
      const latestText = textBlocks.map((b: any) => b.text).join("\n").trim();
      if (latestText) assistantMessage = latestText;

      messages.push({ role: "assistant", content });

      if (toolUseBlocks.length === 0) break;

      const toolResults: any[] = [];
      for (const block of toolUseBlocks) {
        const callRecord: any = { name: block.name, input: block.input };
        try {
          const result = await executeTool(block.name, block.input);
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        } catch (err) {
          const message = (err as Error).message;
          callRecord.error = message;
          console.error(`tool ${block.name} failed:`, message);
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: `Error: ${message}`,
            is_error: true,
          });
        }
        toolCallsMade.push(callRecord);
      }

      messages.push({ role: "user", content: toolResults });
    }

    console.log(JSON.stringify({ event: "neo_mobile_chat", rep_id: repId, usage: totalUsage, tool_calls: toolCallsMade.length }));

    await logInteraction();

    return jsonResponse({
      transcript,
      assistant_message: assistantMessage,
      tool_calls_made: toolCallsMade,
      updated_history: messages,
      usage: totalUsage,
    });
  } catch (err) {
    console.error("neo-mobile-chat error", err);
    await logInteraction((err as Error).message);
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
