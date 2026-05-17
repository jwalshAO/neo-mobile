// iCloud CalDAV client + iCal VEVENT parser + Agility Ortho case-summary parser
// for the neo-mobile-chat Edge Function. Self-contained, no external deps.
//
// Case parser is a TypeScript port of AO/CRM/Scripts/ao_calendar_parser.py
// (the script that backs the case-reconciliation audit pipeline).

const ICLOUD_USERNAME = Deno.env.get("ICLOUD_USERNAME") ?? "";
const ICLOUD_APP_PASSWORD = Deno.env.get("ICLOUD_APP_PASSWORD") ?? "";
const CALDAV_ROOT = "https://caldav.icloud.com";

export function caldavConfigured(): { ok: boolean; seen: Record<string, string> } {
  const seen = {
    ICLOUD_USERNAME: ICLOUD_USERNAME ? "set" : "missing",
    ICLOUD_APP_PASSWORD: ICLOUD_APP_PASSWORD ? "set" : "missing",
  };
  return { ok: !!ICLOUD_USERNAME && !!ICLOUD_APP_PASSWORD, seen };
}

function authHeader(): string {
  return "Basic " + btoa(`${ICLOUD_USERNAME}:${ICLOUD_APP_PASSWORD}`);
}

async function caldavRequest(url: string, method: string, body: string, depth?: string): Promise<string> {
  const headers: Record<string, string> = {
    "Authorization": authHeader(),
    "Content-Type": "application/xml; charset=utf-8",
    "Accept": "application/xml",
  };
  if (depth) headers["Depth"] = depth;
  const resp = await fetch(url, { method, headers, body });
  const text = await resp.text();
  if (resp.status >= 400) throw new Error(`CalDAV ${method} ${url} → ${resp.status}: ${text.slice(0, 200)}`);
  return text;
}

function extractFirst(xml: string, pattern: RegExp): string | null {
  const m = xml.match(pattern);
  return m ? m[1].trim() : null;
}
function extractAll(xml: string, pattern: RegExp): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(xml)) !== null) out.push(m[1].trim());
  return out;
}

export async function discoverCalendarHome(): Promise<string> {
  const principalXml = await caldavRequest(CALDAV_ROOT + "/", "PROPFIND",
    `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`,
    "0");
  const principalHref = extractFirst(principalXml, /<[^>]*current-user-principal[^>]*>[\s\S]*?<[^>]*href[^>]*>([^<]+)<\/[^>]*href[^>]*>/i);
  if (!principalHref) throw new Error("CalDAV: principal URL not found");
  const principalUrl = principalHref.startsWith("http") ? principalHref : CALDAV_ROOT + principalHref;
  const homeXml = await caldavRequest(principalUrl, "PROPFIND",
    `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`,
    "0");
  const homeHref = extractFirst(homeXml, /<[^>]*calendar-home-set[^>]*>[\s\S]*?<[^>]*href[^>]*>([^<]+)<\/[^>]*href[^>]*>/i);
  if (!homeHref) throw new Error("CalDAV: calendar-home-set not found");
  return homeHref.startsWith("http") ? homeHref : CALDAV_ROOT + homeHref;
}

export async function findCalendarUrls(homeUrl: string, calendarNames: string[]): Promise<Array<{ name: string; url: string }>> {
  const xml = await caldavRequest(homeUrl, "PROPFIND",
    `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:displayname/><d:resourcetype/><c:supported-calendar-component-set/></d:prop></d:propfind>`,
    "1");
  const responseBlocks = xml.split(/<[^>]*\bresponse\b[^>]*>/i).slice(1).map(b => b.split(/<\/[^>]*\bresponse\b[^>]*>/i)[0]);
  const matches: Array<{ name: string; url: string }> = [];
  const wantedLower = calendarNames.map(n => n.toLowerCase());
  for (const block of responseBlocks) {
    const href = extractFirst(block, /<[^>]*\bhref\b[^>]*>([^<]+)<\/[^>]*\bhref\b[^>]*>/i);
    const displayname = extractFirst(block, /<[^>]*\bdisplayname\b[^>]*>([^<]*)<\/[^>]*\bdisplayname\b[^>]*>/i);
    const hasVEvent = /VEVENT/i.test(block);
    if (!href || !displayname || !hasVEvent) continue;
    if (wantedLower.includes(displayname.toLowerCase())) {
      matches.push({ name: displayname, url: href.startsWith("http") ? href : CALDAV_ROOT + href });
    }
  }
  return matches;
}

function formatIcalDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

export async function queryCalendarEvents(calUrl: string, start: Date, end: Date): Promise<string[]> {
  const startIcal = formatIcalDate(start);
  const endIcal = formatIcalDate(end);
  const xml = await caldavRequest(calUrl, "REPORT",
    `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${startIcal}" end="${endIcal}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`,
    "1");
  return extractAll(xml, /<[^>]*calendar-data[^>]*>([\s\S]*?)<\/[^>]*calendar-data[^>]*>/gi);
}

// ── ICS / VEVENT parser ──────────────────────────────────────────────────────
function unfoldIcs(text: string): string[] {
  const raw = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of raw) {
    if (line && (line[0] === " " || line[0] === "\t") && out.length > 0) out[out.length - 1] += line.slice(1);
    else out.push(line);
  }
  return out;
}

function unescapeIcalText(s: string): string {
  return s.replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\n/g, " ").replace(/\\N/g, " ").replace(/\\\\/g, "\\");
}

function parseIcalDate(value: string, params: string): Date | null {
  if (/VALUE=DATE/i.test(params) && /^\d{8}$/.test(value)) {
    return new Date(Date.UTC(+value.slice(0, 4), +value.slice(4, 6) - 1, +value.slice(6, 8), 0, 0, 0));
  }
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (m) {
    const [, y, mo, d, h, mi, s] = m;
    return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
  }
  return null;
}

export interface VEvent {
  uid: string | null;
  summary: string;
  dtstart: Date | null;
  dtend: Date | null;
  all_day: boolean;
  location: string;
  status: string | null;
}

export function parseVEvent(icsBlock: string): VEvent | null {
  const lines = unfoldIcs(icsBlock);
  let inEvent = false;
  let uid: string | null = null;
  let summary = "";
  let dtstart: Date | null = null;
  let dtend: Date | null = null;
  let allDay = false;
  let location = "";
  let status: string | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { inEvent = true; continue; }
    if (line === "END:VEVENT") break;
    if (!inEvent) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const left = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const semi = left.indexOf(";");
    const propName = (semi < 0 ? left : left.slice(0, semi)).toUpperCase();
    const params = semi < 0 ? "" : left.slice(semi + 1);
    if (propName === "UID") uid = value;
    else if (propName === "SUMMARY") summary = unescapeIcalText(value);
    else if (propName === "DTSTART") { dtstart = parseIcalDate(value, params); if (/VALUE=DATE/i.test(params)) allDay = true; }
    else if (propName === "DTEND") dtend = parseIcalDate(value, params);
    else if (propName === "LOCATION") location = unescapeIcalText(value);
    else if (propName === "STATUS") status = value;
  }
  if (!summary && !dtstart) return null;
  return { uid, summary, dtstart, dtend, all_day: allDay, location, status };
}

// ── Case summary parser (port of ao_calendar_parser.py core) ──────────────────
const NON_CASE_KEYWORDS = [
  "lunch", "dinner", "breakfast", "happy hour", "meal",
  "meeting", "webinar", "zoom", "telecon", "call w/", "call with", "call:",
  "cadaver", "sawbones", "saw bones", "wet lab",
  "in-service", "inservice", "in service",
  "conference", "assh", "aaos", "symposium", "annual meeting", "congress", "summit", "expo", "isakos",
  "travel", "flight", "hotel",
  "interview", "training", "orientation", "onboarding",
  "setup", "encompass", "demo", "trial", "evaluation",
  "vacation", "holiday", "pto", "day off", "out of office",
  "course", "review", "audit", "write",
  "beer", "bones", "away",
];

const PRODUCT_KEYWORDS: Record<string, string> = {
  "geminus": "Geminus", "gem": "Geminus", "gmn": "Geminus",
  "wfs": "Wrist & Forearm System", "dsp": "Dorsal Spanning Plate",
  "des": "Distal Elbow System", "align": "Distal Elbow System",
  "thn": "Threaded Hand Nail", "hns": "Hand Nail System",
  "rdt": "Reduct Large", "hcs": "Reduct Small", "reduct": "Reduct",
  "dip": "DIP Fusion", "hnd": "Hand Plating System", "hts": "Hand Trauma System",
  "usp": "Ulna Shortening System", "wan": "IMplate Wrist Fusion",
  "dbr": "Distal Biceps Repair", "twa": "Spherical Wrist Arthroplasty",
  "stx": "STABLYX CMC", "stablyx": "STABLYX CMC", "cmc": "STABLYX CMC",
  "php": "Proximal Humerus Plate", "hps": "Distal Humerus Plating", "hfs": "Freefix Humerus",
  "iol": "IntraOsseous Ligament Repair", "mem": "Marginal Fragment Module", "mfm": "Marginal Fragment Module",
  "fps": "Forearm Plating System", "freefix": "Freefix", "protean": "Protean Plates", "pup": "PUP Plate",
  "orthocell": "Orthocell", "tybr": "TYBR", "integra": "Integra",
  "djo": "DJO", "simparo": "Simparo",
};

export interface ParsedCaseSummary {
  is_case: boolean;
  cancelled: boolean;
  surgeon: string;
  product: string | null;
  case_count: number | null;
  raw: string;
  skip_reason?: string;
}

export function parseCaseSummary(summary: string): ParsedCaseSummary {
  const raw = summary;
  const lower = summary.toLowerCase();
  const xPrefix = /^[xX]\s*[-–—]?\s+\w/.test(summary.trim());
  const cancelled = summary.includes("❌") || /\bcancel/i.test(summary) || xPrefix;
  for (const kw of NON_CASE_KEYWORDS) {
    if (lower.includes(kw)) {
      return { is_case: false, cancelled, surgeon: "", product: null, case_count: null, raw, skip_reason: `keyword: "${kw}"` };
    }
  }
  let clean = summary.replace(/❌/g, "").trim();
  clean = clean.replace(/^[xX]\s*[-–—]\s*/, "").trim();
  let surgeon = "";
  let rest = clean;
  const dashMatch = clean.match(/^([A-Za-z][A-Za-z'\-]*(?:\s+[A-Za-z][A-Za-z'\-]*)?)\s*[-–]\s*(.+)$/);
  if (dashMatch) { surgeon = dashMatch[1].trim(); rest = dashMatch[2].trim(); }
  else {
    const tokens = clean.split(/\s+/);
    if (tokens.length > 0) {
      surgeon = tokens[0];
      rest = tokens.slice(1).join(" ");
      if (tokens.length >= 3 && /^[A-Z][a-z]/.test(tokens[1]) && !PRODUCT_KEYWORDS[tokens[1].toLowerCase()] && !/^x\d+/i.test(tokens[1])) {
        surgeon = `${tokens[0]} ${tokens[1]}`;
        rest = tokens.slice(2).join(" ");
      }
    }
  }
  let case_count: number | null = null;
  const countMatch = rest.match(/[xX]\s*(\d+)/);
  if (countMatch) case_count = parseInt(countMatch[1], 10);
  let product: string | null = null;
  const restLower = rest.toLowerCase();
  for (const [kw, name] of Object.entries(PRODUCT_KEYWORDS)) {
    if (restLower.includes(kw)) { product = name; break; }
  }
  if (!product && !surgeon) {
    return { is_case: false, cancelled, surgeon: "", product: null, case_count: null, raw, skip_reason: "no surgeon or product detected" };
  }
  return { is_case: true, cancelled, surgeon, product, case_count, raw };
}
