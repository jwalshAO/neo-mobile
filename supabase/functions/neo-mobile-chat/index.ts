import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

WHAT YOU CAN DO TODAY (v0 — read only)
- Look up surgeons, locations, manufacturers, competitors (with fuzzy matching for misspellings or phonetic variants)
- Pull a surgeon profile (status, primary hospital, specialty, recent notes summary)
- Pull a location profile (territory, assigned rep, surgeons there, recent notes)
- Pull recent field notes about an entity
- Pull team member info (rep, territory, accounts)
- Look up tray status (current location, type, last activity)

YOU CANNOT YET (v0 limits — use the self-expansion pattern below)
- Draft emails, create tasks, update the CRM, schedule events, send messages, or anything that writes.
- Run sales/revenue queries (no get_recent_sales tool yet).
- Build target lists or filtered surgeon searches.

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
        toolCallsMade.push({ name: block.name, input: block.input });
        try {
          const result = await executeTool(block.name, block.input);
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        } catch (err) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: `Error: ${(err as Error).message}`,
            is_error: true,
          });
        }
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
