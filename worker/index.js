// ============================================================
// MULTI-EVENT TICKET + CHECK-IN SYSTEM — Cloudflare Worker (v6)
//
// Everything is controlled from the dashboard now — no terminal
// needed to create an event, add/edit/remove guests, or fix a
// mistaken check-in. The Python CLI scripts still work too, if
// you ever prefer them, they write to the same data.
//
// ROUTES:
//   /                               -> TRKT landing page, lists every event
//   /new                            -> create a new event (upload CSV, set ticket HTML/CSS)
//   /dashboard?event=SLUG           -> live check-in view + full guest management
//   /ticket?event=SLUG&id=XXXX      -> guest-facing ticket page
//   /checkin?event=SLUG&id=XXXX     -> staff-facing scan endpoint
//   /stats?event=SLUG               -> JSON {total, checkedIn}
//   /dashboard-data?event=SLUG      -> JSON feed the dashboard polls
//   /api/create-event  (POST)       -> creates a new event from the /new form
//   /api/add-guest     (POST)       -> adds one guest to a live event
//   /api/edit-guest    (POST)       -> edits one guest's details
//   /api/remove-guest  (POST)       -> removes one guest
//   /api/uncheck-guest (POST)       -> undoes an accidental check-in
//
// DATA (Cloudflare KV):
//   key "cfg:SLUG"     -> { name, subtitle, footer, defaultBadge, theme?, customTemplate? }
//   key "roster:SLUG"  -> single JSON object of every guest for that event
//   key "eventIndex"   -> JSON array of every event ever created
//
// NOTE: there is currently NO password on /new or /dashboard or the
// /api/* routes. Anyone with these links can create events, edit
// guests, or check people in. Treat these links like door keys.
// ============================================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const slug = url.searchParams.get("event");
    const id = url.searchParams.get("id");

    if (request.method === "POST") {
      if (url.pathname === "/api/create-event") return apiCreateEvent(request, env);
      if (url.pathname === "/api/verify-password") return apiVerifyPassword(request, env);
      if (url.pathname === "/api/set-password") return apiSetPassword(request, env);
      if (url.pathname === "/api/set-scan-password") return apiSetScanPassword(request, env);
      if (url.pathname === "/api/verify-scan") return apiVerifyScan(request, env);
      if (url.pathname === "/api/add-guest") return apiAddGuest(request, env);
      if (url.pathname === "/api/bulk-add-guests") return apiBulkAddGuests(request, env);
      if (url.pathname === "/api/edit-guest") return apiEditGuest(request, env);
      if (url.pathname === "/api/remove-guest") return apiRemoveGuest(request, env);
      if (url.pathname === "/api/uncheck-guest") return apiUncheckGuest(request, env);
      if (url.pathname === "/api/check-guest") return apiCheckGuest(request, env);
      if (url.pathname === "/api/delete-event") return apiDeleteEvent(request, env);
      if (url.pathname === "/api/edit-template") return apiEditTemplate(request, env);
      if (url.pathname === "/api/edit-event") return apiEditEvent(request, env);
      if (url.pathname === "/api/add-field") return apiAddField(request, env);
      if (url.pathname === "/api/remove-field") return apiRemoveField(request, env);
    }

    if (url.pathname === "/favicon-16.png") return pngResponse(FAVICON_16_BYTES);
    if (url.pathname === "/favicon-32.png") return pngResponse(FAVICON_32_BYTES);
    if (url.pathname === "/apple-touch-icon.png") return pngResponse(FAVICON_32_BYTES);
    if (url.pathname === "/favicon.ico") return pngResponse(FAVICON_16_BYTES);
    if (url.pathname === "/") return handleLanding(env);
    if (url.pathname === "/api/kv-usage") return handleKvUsage(env);
    if (url.pathname === "/new") return handleNewEventPage();
    if (url.pathname === "/ticket") return handleTicketView(slug, id, env, url.origin);
    if (url.pathname === "/checkin") return handleCheckin(slug, id, env, request);
    if (url.pathname === "/scan") return handleScanPage(slug, env, request);
    if (url.pathname === "/stats") return handleStats(slug, env, request);
    if (url.pathname === "/export") return handleExport(slug, env, request);
    if (url.pathname === "/arrivals") return handleArrivals(slug, env, request);
    if (url.pathname === "/dashboard") return handleDashboardPage(slug, env, request);
    if (url.pathname === "/dashboard-data") return handleDashboardData(slug, env, request);

    return new Response("Not found", { status: 404 });
  },
};


// ---------- Favicon ----------
// The icons are embedded as base64 rather than read from a folder: this Worker
// serves every route itself and has no static file hosting, so a PNG sitting in
// the repo would never reach Cloudflare — only index.js is deployed.
//
// Two sizes, because a favicon is drawn at 16px in a browser tab: the 16px art
// is drawn for that size, the 32px for retina tabs / bookmarks. Both are
// Icons8 doodle tickets.

const FAVICON_16_PNG = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAACLUlEQVR4nGNgoANgCbfjmpTgxtNXGc6/xFGfYzUDAwM30bp9TDnnvlgq939ni8T/z2sV/l+eLv0zxIZrFVGaA625C9ZWi30/3if1/85c2f+9KcL/36+S/392ovRnRz2OdTJ8DEI4NXtbcoYe75V8c3uO7P8H82X/LysT+w9yycR04f8vl8n/31Ar9spYldMMq2Z3Y47IXS0SL2bni/y/MUsG7HQQXlIq9v/lcrn/8wtF/3clCR3C7mxLrsS9bRIvQZpPT5T+v60J4ncQfrVc/v+Jfun/H1Yr/C8OFNiHoTnCjqv+whTpj7PyIJqnZAr//7gGovnWbNn/aZ58YOeH2/Lc1pbikIVrFBJi4PPU5T5xb57Mb5DzjvZK/Z+aJfL/ZL80WPPBLsn/jxbK/T/SLfW/JkLgvJYShxyKzVkG/HfmGor/nxgkArYB5II11eL/D3dLgflhtjz/z02W/p8fwHdJU4FDHsPplZaCGxcaSvy/66Lwf6KPCNi5ZyZK/59XKPr/RJ/U/2dL5f5nevOdUBRjEMcWbswdlsKPZumJ/3/vofz/tbvS/ynuouCom54N8obU/2Q33t3Cwgy8uKKcr0pf8Ot2c+n/SwwlwIaAcIOF0P/TfdL/Yp241zAwMLDh0gwG3KwMeu2GIr8u2sv/79MW/T9XX/z/bgvp/6HavGcZGBiY8GqGgQwj/tJlNhK/JliJvC4w4V+aps+7F+Q6ojTDgL8GTxYDAwM7KZoAPRP8Zgx8708AAAAASUVORK5CYII=";
const FAVICON_32_PNG = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAAFX0lEQVR4nO2XeUwUZxTAP3Z3Zo/Z2WHPmd2dPQFXoHZBRREPBHYBgeBZA2oLWo9ajEcU0RAbr6ptLYkFj7Y2FqutWqhJTWOb2usP4x/VHh41KlbAi0PwamoP5TXfDLOAmggI7T99yct+883O93vvfe+9bwah/6XvhEMIxSGEZO3Xbt4oX8+biUPoXxDGZycuFOUwDYk+Ze2IgaorBUG64dNXuAe5iZqGKDtxFiHk7y94mMdKfHd0s63tbrUbrn7gBPzbWUueY27hSFj1sml9TudN8k1zMnX3JFjZHCMUTwmHO1UdBtyucsPJrTxEWMnjfQrnDLKCgoD2RlEOA68WGELAdxaaoCBAQ+sBV2juxj4X5CVrG12s4hxCyPjUcCMlHxuMVzdg7zDgi/Wc4KXk+aHVHOQmUnDtoS3JS6abvDbioJOV5/QaTpJowOBI5ZXGDzs8xLqn2AIzUmho2S/OHyuzQfpgDZx/1xH6z80DLqguZds8LPFJb/nuQW6ypnaXuOhbLxmFRSUA9hzPSdent/OCET+U20NzcV7yEkIovDdwT4yD/PXieyJ8Y6EB1s7QP5L1WLcVmaDufTH89ZVOyEqg4MgGK/zyNg+RdnJfr+A+nqg71x7ON140wKr88MfCsf5YbodUvwZq2o3F24UT9cJOB0TxRFWPyCSJBvo95EX8sOTd4gki/NtNVpCMelh/qrAL9zvP4ST1OchT3YYbKXnasAHK+iu7xXDuWGCChbmMMP5sDQeTRmqheV/XZOysuEpmpevg+h7x+VlBXZPTJJvbLbjVJJubFq9ubPpIBGyZZ4RF4xnBi4OrWJiY9Hj4z1vt8OZsI7w+yxCqhnEJFBQGdc28WbGgO+ww3igvK8pmmqU6xwsunSSGvbqUhWljuzaazrp/hQXCwsLg5RwxUlgL0uhWl0WxpDtwnZcjvq6Yb7gjPYwzvTRPhO/FtZ5Kdym9hxUbOHW0NlQFC8czTVajYvkTyWo1Gh5rUTalP6tpu/WxuBjO3NfaQ7lriRmeT6MB38MltWxyRxXsXmqG5VPCQcoVCT5vHN3iNCuKnwj3s8o1uV7tvdo0D5REG2B6Ei0kkNTtKuYbYV6WTpg7vJaDySO1IOXG91vswFBy4E0ETE+hQ9k+M0i3OMyKFd0JOxpsVR2pHmaFC6luSDZpoNxvgdmjGGGfz2znYeVUseFUlbICvHPy4fHMdB0c3yJ2O2zktBS60W5SLEI9EE22i/rtZmYEZLNaaM7wwucj7DBhkBaktos9x1uA9/9ypRO+2tBR45d2OYSOh8+BnOHUNVYvy0M9lVSHpgUb8IKDgfqAB/D4RLITApEaOLrZJkRDOu1ObeNBRcpgRLQqNNew1wmjn1FdNjDyQI/htAolLY7W/409z7BQAlxSbMzEAVrYX2IJeYxfOkbFqmF+NiO8BeEIDIlS1jMaNKTHcISQNoFTNVxMc8NOPwtlseYuBmDFhhXG6KBstnjSYSBuMHiMcyTaSdYghCJ7A0daFRo51Kz6ozUzAs6muCDdQsGXifZHjMD3i/0GWJffcQIeK7M9iLIRZ3DjRE8jsSaytiLO0nY+1Q1Xgx7I53WPjcSxUQ6ICVfChnwDHF7H/eVhCfyex6A+EEalkC1bGaO/L8FKIvWw2meEIo8eslgt5HJaCJgpqEl1Q2GEDtwW4ijuX6gPJS6BU91aM8h4Xwr5xmgTfJPEd4nC6bEuiGeVdQghFeoHCRuoJ3+vjOcEWFOGF8rjLG2Zbqo1w0XVBRya20mc+k+EkBf1o4zxGcjrJ5NdMMauueszkIs6fXKpdUoURP0tw23kjqGc6gT+9uh32H8p/wA0rsFRxk2DEQAAAABJRU5ErkJggg==";

// Decode once at module scope, not per request.
function pngBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
const FAVICON_16_BYTES = pngBytes(FAVICON_16_PNG);
const FAVICON_32_BYTES = pngBytes(FAVICON_32_PNG);

function pngResponse(bytes) {
  return new Response(bytes, {
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=86400",
    },
  });
}

// ---------- Data access ----------

async function getConfig(slug, env) {
  if (!slug) return null;
  const raw = await env.TICKETS_KV.get(`cfg:${slug}`);
  return raw ? JSON.parse(raw) : null;
}

async function saveConfig(slug, config, env) {
  await env.TICKETS_KV.put(`cfg:${slug}`, JSON.stringify(config));
}

async function getRoster(slug, env) {
  if (!slug) return null;
  const raw = await env.TICKETS_KV.get(`roster:${slug}`);
  return raw ? JSON.parse(raw) : null;
}

async function saveRoster(slug, roster, env) {
  await env.TICKETS_KV.put(`roster:${slug}`, JSON.stringify(roster));
}

// ---------- Check-in status (stored per-guest, NOT in the roster blob) ----------
//
// Each guest's check-in lives in its own key: `checkin:SLUG:TICKETID`.
// This is what makes concurrent scans safe: two staff scanning two DIFFERENT
// guests write to two DIFFERENT keys, so they can never overwrite each other
// (the old design flipped a flag inside one shared roster blob, where
// simultaneous writes clobbered one another). The roster blob now holds guest
// DETAILS only; attendance is layered on top from these keys.

// "Link sent" is a per-organiser bookkeeping tick — NOT stored in KV at all.
// It lives in the browser's localStorage on whichever device you're checking
// guests off from (see dashboard script, sentStorageKey/getSentMap/setSent).
// That means it costs zero reads/writes/lists no matter how many guests you
// have, and it doesn't sync across devices — it's a personal "have I sent
// this one" scratchpad, not shared event data like check-in status is.

function checkinKey(slug, id) {
  return `checkin:${slug}:${id}`;
}

// Events created before the mode existed have no checkinMode -> treat as
// "standard" so their behavior is unchanged.
function isHighConcurrency(config) {
  return config && config.checkinMode === "highConcurrency";
}

async function getCheckin(slug, id, env) {
  const raw = await env.TICKETS_KV.get(checkinKey(slug, id));
  return raw ? JSON.parse(raw) : null; // { time } or null
}

async function setCheckin(slug, id, env) {
  // Store an epoch timestamp, NOT a formatted string. Workers run in UTC, so
  // toLocaleTimeString() here produces UTC — six hours off for Dhaka, and
  // silently wrong anywhere outside UTC. The epoch is unambiguous; the browser
  // formats it into the viewer's own local time. `time` is kept only as a
  // human-readable fallback for old clients / legacy records.
  const now = Date.now();
  const record = { at: now, time: new Date(now).toISOString() };
  await env.TICKETS_KV.put(checkinKey(slug, id), JSON.stringify(record));
  return record;
}

async function clearCheckin(slug, id, env) {
  await env.TICKETS_KV.delete(checkinKey(slug, id));
}

// Load every check-in for an event in one KV list+get pass. Returns a map
// { TICKETID: { time } }. Used by the dashboard and stats to layer attendance
// onto the roster.
async function getAllCheckins(slug, env) {
  const prefix = `checkin:${slug}:`;
  const result = {};
  let cursor;
  do {
    const list = await env.TICKETS_KV.list({ prefix, cursor });
    for (const k of list.keys) {
      const id = k.name.slice(prefix.length);
      const raw = await env.TICKETS_KV.get(k.name);
      if (raw) result[id] = JSON.parse(raw);
    }
    cursor = list.list_complete ? null : list.cursor;
  } while (cursor);
  return result;
}

// Resolve every guest's attendance for an event, honouring the check-in mode
// and any legacy roster-baked attendance. Returns { TICKETID: { at?, time } }.
// `at` is epoch ms (unambiguous, formatted client-side into local time);
// `time` may be an ISO string, or a legacy locale string from old records.
async function resolveCheckins(slug, config, roster, env) {
  const checkins = {};
  if (isHighConcurrency(config)) {
    Object.assign(checkins, await getAllCheckins(slug, env));
  }
  for (const [id, g] of Object.entries(roster)) {
    if (!checkins[id] && g.attended) {
      checkins[id] = { at: g.checkinAt, time: g.checkinTime || "" };
    }
  }
  return checkins;
}

async function getEventIndex(env) {
  const raw = await env.TICKETS_KV.get("eventIndex");
  return raw ? JSON.parse(raw) : [];
}

async function saveEventIndex(index, env) {
  await env.TICKETS_KV.put("eventIndex", JSON.stringify(index));
}

function generateTicketId() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function jsonHeaders(status) {
  return { status: status || 200, headers: { "content-type": "application/json" } };
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Standard fields every guest always has. Anything else is a custom field.
const STANDARD_FIELDS = ["name", "seat", "date", "venue", "badge"];

// "Meal Preference" -> "meal_preference". Used as both the storage key
// and the template placeholder ({{meal_preference}}).
function slugifyField(label) {
  return String(label || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Date and venue are event-wide by default (stored on config), but any
// individual guest may override them (stored on the guest). Resolution order:
// the guest's own value wins if set, else the event-level value, else blank.
// This also transparently supports old events that only stored per-guest values.
function eventDate(config, guest) {
  return (guest && guest.date) || (config && config.date) || "";
}
function eventVenue(config, guest) {
  return (guest && guest.venue) || (config && config.venue) || "";
}

// The check-in window as display text, e.g. "6:00 PM – 8:00 PM", "From 6:00 PM",
// or "" when not set or not opted-in to show. Used for the {{checkinWindow}}
// placeholder and the default ticket design.
function checkinWindowText(config) {
  if (!config || !config.showCheckinWindow) return "";
  const s = (config.checkinStart || "").trim();
  const e = (config.checkinEnd || "").trim();
  if (s && e) return `${s} – ${e}`;
  if (s) return `From ${s}`;
  if (e) return `Until ${e}`;
  return "";
}

// In-memory only — deliberately NOT backed by KV, so this adds zero reads,
// writes, or list operations no matter how many login attempts or event
// creations happen. Trade-off: it resets on a cold start and isn't shared
// across Cloudflare's edge locations, so it won't stop a truly distributed
// attack — but it's enough to slow down a basic scripted brute-force burst
// hitting the same warm isolate, at exactly zero cost to your KV quota.
const rateLimitBuckets = new Map();
function checkRateLimit(key, limit, windowSeconds) {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return true;
  }
  bucket.count++;
  return bucket.count <= limit;
}

function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || "unknown";
}

// ---------- Event-specific password protection ----------
// Each event can optionally have its own password, set once at
// creation. It gates that event's /dashboard, /dashboard-data, and
// all /api/* management actions. Guest-facing /ticket and /checkin
// are NEVER gated — guests should never need a password to see
// their own ticket or check in.

function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

const PBKDF2_ITERATIONS = 100000;

// Salted, deliberately-slow password hash (PBKDF2-SHA256). Stored/returned as
// "saltHex:hashHex". Pass an existing saltHex to re-derive with the SAME salt
// (used when verifying); omit it to generate a fresh random salt (used when
// setting/changing a password).
async function hashPassword(password, existingSaltHex) {
  const saltBytes = existingSaltHex ? hexToBytes(existingSaltHex) : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial, 256
  );
  return `${bytesToHex(saltBytes)}:${bytesToHex(new Uint8Array(bits))}`;
}

// Verifies a submitted password against a stored hash. Transparently accepts
// BOTH the salted PBKDF2 format above and the old bare-SHA-256 format from
// before this change, so events created earlier don't get locked out — they
// just silently stay on the weaker format until the password is next changed
// (apiSetPassword/apiSetScanPassword always write the new salted format).
async function verifyPassword(password, stored) {
  if (!stored) return false;
  if (stored.includes(":")) {
    const [saltHex] = stored.split(":");
    return (await hashPassword(password, saltHex)) === stored;
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password));
  return bytesToHex(new Uint8Array(digest)) === stored;
}

function parseCookies(request) {
  const header = request.headers.get("Cookie") || "";
  const cookies = {};
  header.split(";").forEach((part) => {
    const [k, ...v] = part.trim().split("=");
    if (k) cookies[k] = v.join("=");
  });
  return cookies;
}

function cookieName(slug) {
  return `trkt_pw_${slug}`;
}

// Separate cookie authorizing a specific device to CHECK PEOPLE IN (distinct
// from the dashboard-management password). Set when someone enters the scanner
// password on /scan; checked by /checkin when a scanner password exists.
function scanCookieName(slug) {
  return `trkt_scan_${slug}`;
}

function isScanAuthed(request, slug, config) {
  // The scanner has its OWN password, deliberately separate from the dashboard
  // one. Door staff get the scanner password and can check people in; they
  // cannot reach the dashboard to edit or delete anything. No scanner password
  // set = check-in is open to any device.
  if (!config.scanHash) return true;
  const cookies = parseCookies(request);
  return cookies[scanCookieName(slug)] === config.scanHash;
}

function isAuthed(request, slug, config) {
  if (!config.passwordHash) return true; // no password set on this event
  const cookies = parseCookies(request);
  return cookies[cookieName(slug)] === config.passwordHash;
}

async function requireEventAuth(request, slugValue, env) {
  const config = await getConfig(slugValue, env);
  if (!config) return { error: new Response(JSON.stringify({ error: "Unknown event" }), jsonHeaders(404)) };
  if (!isAuthed(request, slugValue, config)) {
    return { error: new Response(JSON.stringify({ error: "Password required" }), jsonHeaders(401)) };
  }
  return { config };
}

// ---------- API: create event ----------

async function apiCreateEvent(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), jsonHeaders(400));
  }

  const { slug, name, subtitle, footer, defaultBadge, templateHtml, templateCss, guests, password, checkinMode } = body;

  if (!slug || !name || !Array.isArray(guests)) {
    return new Response(JSON.stringify({ error: "Missing slug, name, or guests" }), jsonHeaders(400));
  }
  // Slugs become KV key segments and URL path/query values, so restrict them
  // to a safe charset up front rather than trusting whatever's typed in.
  if (!/^[a-z0-9-]{1,80}$/i.test(slug)) {
    return new Response(JSON.stringify({ error: "Slug can only contain letters, numbers, and hyphens (max 80 chars)." }), jsonHeaders(400));
  }
  // This endpoint is intentionally open (no password exists yet at creation
  // time), so an IP-based throttle is the only thing stopping it from being
  // spammed to burn through the daily write quota.
  const createOk = checkRateLimit(`create:${clientIp(request)}`, 10, 3600);
  if (!createOk) {
    return new Response(JSON.stringify({ error: "Too many events created from this address recently. Try again in a bit." }), jsonHeaders(429));
  }

  const existing = await getConfig(slug, env);
  if (existing) {
    return new Response(JSON.stringify({ error: `Event slug '${slug}' already exists. Choose a different slug.` }), jsonHeaders(409));
  }

  const config = {
    name,
    subtitle: subtitle || "",
    footer: footer || "",
    defaultBadge: defaultBadge || "guest",
    // Check-in strategy, chosen at creation and fixed after:
    //   "standard"        -> attendance lives in the roster blob (cheap reads,
    //                        safe for single-scanner / low-concurrency events).
    //   "highConcurrency" -> attendance lives in per-guest keys (safe for many
    //                        simultaneous scanners; costs more reads).
    checkinMode: checkinMode === "highConcurrency" ? "highConcurrency" : "standard",
  };
  // Date and venue are event-wide (one value for the whole event), stored on
  // the config. Prefer an explicit event-level value from the form; otherwise
  // fall back to the first guest row that has one (e.g. from a CSV column).
  config.date = (body.date || "").trim() || (guests.find((g) => g.date)?.date || "");
  config.venue = (body.venue || "").trim() || (guests.find((g) => g.venue)?.venue || "");
  // Optional check-in time window (e.g. "6:00 PM" to "8:00 PM"). Purely
  // informational text shown on the ticket via {{checkinWindow}} — only if the
  // creator opted to show it. Stored so it can be edited later too.
  config.checkinStart = (body.checkinStart || "").trim();
  config.checkinEnd = (body.checkinEnd || "").trim();
  config.showCheckinWindow = !!body.showCheckinWindow;
  if (password && password.trim()) {
    config.passwordHash = await hashPassword(password.trim());
  }
  if (body.scanPassword && body.scanPassword.trim()) {
    config.scanHash = await hashPassword(body.scanPassword.trim());
  }
  if (templateHtml && templateHtml.trim()) {
    config.customTemplate = { html: templateHtml, css: templateCss || "" };
  }

  // Discover custom fields: any key on a guest object that isn't a standard
  // field or "custom" becomes a custom field. Each has a { key, label }.
  // The client sends custom values nested under g.custom = { key: value }.
  const customFieldMap = {};
  for (const g of guests) {
    if (g.custom && typeof g.custom === "object") {
      for (const [key, meta] of Object.entries(g.custom)) {
        // meta can be { label, value } or just a raw value string
        const label = (meta && typeof meta === "object" && meta.label) ? meta.label : key;
        if (!customFieldMap[key]) customFieldMap[key] = label;
      }
    }
  }
  config.customFields = Object.entries(customFieldMap).map(([key, label]) => ({ key, label }));

  const roster = {};
  const links = [];
  const usedIds = new Set();

  for (const g of guests) {
    // Skip nameless rows. The CSV parser filters these client-side, but the API
    // must enforce it too — otherwise a direct API call (or a future client)
    // creates ghost tickets with no name. bulk-add-guests already does this.
    const guestName = (g.name || "").trim();
    if (!guestName) continue;

    let ticketId = generateTicketId();
    while (usedIds.has(ticketId)) ticketId = generateTicketId();
    usedIds.add(ticketId);

    const custom = {};
    if (g.custom && typeof g.custom === "object") {
      for (const [key, meta] of Object.entries(g.custom)) {
        custom[key] = (meta && typeof meta === "object" && "value" in meta) ? (meta.value || "") : (meta || "");
      }
    }

    // Store date/venue on the guest ONLY when it differs from the event-level
    // value — i.e. a genuine per-guest override. When it matches (the common
    // case, e.g. same CSV value for everyone), leave it blank so the ticket
    // reads the event-level value and editing the event updates every guest.
    const guestDate = (g.date || "") !== config.date ? (g.date || "") : "";
    const guestVenue = (g.venue || "") !== config.venue ? (g.venue || "") : "";

    roster[ticketId] = {
      name: guestName,
      seat: g.seat || "",
      date: guestDate,
      venue: guestVenue,
      badge: g.badge || "",
      custom,
      attended: false,
      checkinTime: null,
    };
    links.push({ name: guestName, id: ticketId });
  }

  await saveConfig(slug, config, env);
  await saveRoster(slug, roster, env);

  const index = await getEventIndex(env);
  const filtered = index.filter((e) => e.slug !== slug);
  filtered.push({ slug, name, addedAt: new Date().toISOString().slice(0, 10), guestCount: Object.keys(roster).length });
  await saveEventIndex(filtered, env);

  return new Response(JSON.stringify({ slug, links }), jsonHeaders());
}

// ---------- API: guest management ----------

// Append many guests at once (e.g. a second CSV of late RSVPs) to a live event.
// Costs 1 roster write + 1 index write total, no matter how many guests —
// far cheaper than adding them one at a time. Any new columns in the uploaded
// CSV are registered as custom fields and back-filled onto existing guests.
async function apiBulkAddGuests(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || !body.event || !Array.isArray(body.guests)) {
    return new Response(JSON.stringify({ error: "Missing event or guests" }), jsonHeaders(400));
  }

  const auth = await requireEventAuth(request, body.event, env);
  if (auth.error) return auth.error;

  const config = auth.config;
  const roster = (await getRoster(body.event, env)) || {};

  // Register any custom fields the new CSV introduces.
  if (!config.customFields) config.customFields = [];
  let configChanged = false;
  for (const g of body.guests) {
    if (!g.custom || typeof g.custom !== "object") continue;
    for (const [key, meta] of Object.entries(g.custom)) {
      if (STANDARD_FIELDS.includes(key)) continue;
      if (!config.customFields.some((f) => f.key === key)) {
        const label = (meta && typeof meta === "object" && meta.label) ? meta.label : key;
        config.customFields.push({ key, label });
        configChanged = true;
      }
    }
  }
  if (configChanged) {
    await saveConfig(body.event, config, env);
    // back-fill the new fields onto existing guests
    for (const g of Object.values(roster)) {
      if (!g.custom) g.custom = {};
      for (const f of config.customFields) if (!(f.key in g.custom)) g.custom[f.key] = "";
    }
  }

  const added = [];
  for (const g of body.guests) {
    const name = (g.name || "").trim();
    if (!name) continue; // same rule as creation: no name, no ticket

    let ticketId = generateTicketId();
    while (roster[ticketId]) ticketId = generateTicketId();

    const custom = {};
    for (const f of config.customFields) {
      const raw = g.custom ? g.custom[f.key] : undefined;
      custom[f.key] = (raw && typeof raw === "object" && "value" in raw) ? (raw.value || "") : (raw || "");
    }

    roster[ticketId] = {
      name,
      seat: g.seat || "",
      date: (g.date || "") !== (config.date || "") ? (g.date || "") : "",
      venue: (g.venue || "") !== (config.venue || "") ? (g.venue || "") : "",
      badge: g.badge || "",
      custom,
      attended: false,
      checkinTime: null,
    };
    added.push({ name, id: ticketId });
  }

  await saveRoster(body.event, roster, env);

  const index = await getEventIndex(env);
  const entry = index.find((e) => e.slug === body.event);
  if (entry) {
    entry.guestCount = Object.keys(roster).length;
    await saveEventIndex(index, env);
  }

  return new Response(JSON.stringify({ ok: true, added: added.length, links: added }), jsonHeaders());
}

async function apiAddGuest(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || !body.event) return new Response(JSON.stringify({ error: "Missing event" }), jsonHeaders(400));

  const auth = await requireEventAuth(request, body.event, env);
  if (auth.error) return auth.error;

  const roster = (await getRoster(body.event, env)) || {};
  let ticketId = generateTicketId();
  while (roster[ticketId]) ticketId = generateTicketId();

  const custom = {};
  const config = auth.config;
  for (const f of config.customFields || []) {
    custom[f.key] = (body.custom && body.custom[f.key]) || "";
  }

  roster[ticketId] = {
    name: body.name || "",
    seat: body.seat || "",
    date: body.date || "",
    venue: body.venue || "",
    badge: body.badge || "",
    custom,
    attended: false,
    checkinTime: null,
  };
  await saveRoster(body.event, roster, env);

  const index = await getEventIndex(env);
  const entry = index.find((e) => e.slug === body.event);
  if (entry) {
    entry.guestCount = Object.keys(roster).length;
    await saveEventIndex(index, env);
  }

  return new Response(JSON.stringify({ id: ticketId }), jsonHeaders());
}

async function apiEditGuest(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || !body.event || !body.id) return new Response(JSON.stringify({ error: "Missing event or id" }), jsonHeaders(400));

  const auth = await requireEventAuth(request, body.event, env);
  if (auth.error) return auth.error;

  const roster = await getRoster(body.event, env);
  if (!roster || !roster[body.id]) return new Response(JSON.stringify({ error: "Guest not found" }), jsonHeaders(404));

  const guest = roster[body.id];
  for (const field of ["name", "seat", "date", "venue", "badge"]) {
    if (body[field] !== undefined) guest[field] = body[field];
  }
  if (body.custom && typeof body.custom === "object") {
    if (!guest.custom) guest.custom = {};
    for (const [key, value] of Object.entries(body.custom)) {
      guest.custom[key] = value;
    }
  }
  await saveRoster(body.event, roster, env);

  return new Response(JSON.stringify({ ok: true }), jsonHeaders());
}

// Add a new custom field to an event: defines it in config, and back-fills
// an empty value on every existing guest so the field exists everywhere.
async function apiAddField(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || !body.event || !body.label) return new Response(JSON.stringify({ error: "Missing event or label" }), jsonHeaders(400));

  const auth = await requireEventAuth(request, body.event, env);
  if (auth.error) return auth.error;

  const config = auth.config;
  const key = slugifyField(body.label);
  if (!key) return new Response(JSON.stringify({ error: "Field name must contain letters or numbers" }), jsonHeaders(400));

  if (!config.customFields) config.customFields = [];
  if (STANDARD_FIELDS.includes(key) || config.customFields.some((f) => f.key === key)) {
    return new Response(JSON.stringify({ error: `A field with key '${key}' already exists` }), jsonHeaders(409));
  }
  config.customFields.push({ key, label: body.label });
  await saveConfig(body.event, config, env);

  const roster = await getRoster(body.event, env);
  if (roster) {
    for (const g of Object.values(roster)) {
      if (!g.custom) g.custom = {};
      if (!(key in g.custom)) g.custom[key] = "";
    }
    await saveRoster(body.event, roster, env);
  }

  return new Response(JSON.stringify({ ok: true, key, placeholder: `{{${key}}}` }), jsonHeaders());
}

// Remove a custom field: drops it from config and from every guest.
async function apiRemoveField(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || !body.event || !body.key) return new Response(JSON.stringify({ error: "Missing event or key" }), jsonHeaders(400));

  const auth = await requireEventAuth(request, body.event, env);
  if (auth.error) return auth.error;

  const config = auth.config;
  config.customFields = (config.customFields || []).filter((f) => f.key !== body.key);
  await saveConfig(body.event, config, env);

  const roster = await getRoster(body.event, env);
  if (roster) {
    for (const g of Object.values(roster)) {
      if (g.custom) delete g.custom[body.key];
    }
    await saveRoster(body.event, roster, env);
  }

  return new Response(JSON.stringify({ ok: true }), jsonHeaders());
}

async function apiRemoveGuest(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || !body.event || !body.id) return new Response(JSON.stringify({ error: "Missing event or id" }), jsonHeaders(400));

  const auth = await requireEventAuth(request, body.event, env);
  if (auth.error) return auth.error;

  const roster = await getRoster(body.event, env);
  if (!roster || !roster[body.id]) return new Response(JSON.stringify({ error: "Guest not found" }), jsonHeaders(404));

  delete roster[body.id];
  await saveRoster(body.event, roster, env);
  await clearCheckin(body.event, body.id, env); // remove any check-in for this guest

  const index = await getEventIndex(env);
  const entry = index.find((e) => e.slug === body.event);
  if (entry) {
    entry.guestCount = Object.keys(roster).length;
    await saveEventIndex(index, env);
  }

  return new Response(JSON.stringify({ ok: true }), jsonHeaders());
}

// Manual check-in from the dashboard (mirror of undo). Marks a guest present
// without a scan — useful when someone's at the desk without their QR. Honors
// the event's check-in mode so it stays consistent with scanned check-ins.
async function apiCheckGuest(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || !body.event || !body.id) return new Response(JSON.stringify({ error: "Missing event or id" }), jsonHeaders(400));

  const auth = await requireEventAuth(request, body.event, env);
  if (auth.error) return auth.error;

  const roster = await getRoster(body.event, env);
  if (!roster || !roster[body.id]) return new Response(JSON.stringify({ error: "Guest not found" }), jsonHeaders(404));

  const config = auth.config;
  if (isHighConcurrency(config)) {
    const existing = await getCheckin(body.event, body.id, env);
    if (!existing) await setCheckin(body.event, body.id, env);
  } else {
    if (!roster[body.id].attended) {
      roster[body.id].attended = true;
      roster[body.id].checkinAt = Date.now();
      roster[body.id].checkinTime = new Date(roster[body.id].checkinAt).toISOString();
      await saveRoster(body.event, roster, env);
    }
  }

  return new Response(JSON.stringify({ ok: true }), jsonHeaders());
}

async function apiUncheckGuest(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || !body.event || !body.id) return new Response(JSON.stringify({ error: "Missing event or id" }), jsonHeaders(400));

  const auth = await requireEventAuth(request, body.event, env);
  if (auth.error) return auth.error;

  const roster = await getRoster(body.event, env);
  if (!roster || !roster[body.id]) return new Response(JSON.stringify({ error: "Guest not found" }), jsonHeaders(404));

  const config = auth.config;
  if (isHighConcurrency(config)) {
    await clearCheckin(body.event, body.id, env);
    // Also clear any legacy roster-baked flag so it doesn't resurface.
    if (roster[body.id].attended) {
      roster[body.id].attended = false;
      roster[body.id].checkinTime = null;
      await saveRoster(body.event, roster, env);
    }
  } else {
    roster[body.id].attended = false;
    roster[body.id].checkinTime = null;
    await saveRoster(body.event, roster, env);
  }

  return new Response(JSON.stringify({ ok: true }), jsonHeaders());
}

async function apiDeleteEvent(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || !body.event) return new Response(JSON.stringify({ error: "Missing event" }), jsonHeaders(400));

  const auth = await requireEventAuth(request, body.event, env);
  if (auth.error) return auth.error;

  await env.TICKETS_KV.delete(`cfg:${body.event}`);
  await env.TICKETS_KV.delete(`roster:${body.event}`);

  // Remove every per-guest check-in and sent key for this event so none orphan.
  for (const prefix of [`checkin:${body.event}:`]) {
    let cursor;
    do {
      const list = await env.TICKETS_KV.list({ prefix, cursor });
      for (const k of list.keys) await env.TICKETS_KV.delete(k.name);
      cursor = list.list_complete ? null : list.cursor;
    } while (cursor);
  }

  const index = await getEventIndex(env);
  const filtered = index.filter((e) => e.slug !== body.event);
  await saveEventIndex(filtered, env);

  return new Response(JSON.stringify({ ok: true }), jsonHeaders());
}

// Edit event-level settings (name, subtitle, footer, default badge, date,
// venue). These are all text shown on tickets — none touch the slug, ticket
// URLs, or KV keys, so nothing breaks. Only touches the cfg: record — 1 KV
// write. Individual guests can still override date/venue via edit-guest.
async function apiEditEvent(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || !body.event) return new Response(JSON.stringify({ error: "Missing event" }), jsonHeaders(400));

  const auth = await requireEventAuth(request, body.event, env);
  if (auth.error) return auth.error;

  const config = auth.config;
  if (body.name !== undefined) {
    const trimmed = String(body.name).trim();
    if (!trimmed) return new Response(JSON.stringify({ error: "Event name can't be empty" }), jsonHeaders(400));
    config.name = trimmed;
  }
  if (body.subtitle !== undefined) config.subtitle = body.subtitle;
  if (body.footer !== undefined) config.footer = body.footer;
  if (body.defaultBadge !== undefined) config.defaultBadge = body.defaultBadge;
  if (body.date !== undefined) config.date = body.date;
  if (body.venue !== undefined) config.venue = body.venue;
  if (body.checkinStart !== undefined) config.checkinStart = body.checkinStart;
  if (body.checkinEnd !== undefined) config.checkinEnd = body.checkinEnd;
  if (body.showCheckinWindow !== undefined) config.showCheckinWindow = !!body.showCheckinWindow;
  // Theme: accent/card/background/border colors + animated wave.
  // Only applies to the built-in themed ticket (ignored when a customTemplate
  // is set, since that supplies its own CSS).
  if (body.theme !== undefined && body.theme && typeof body.theme === "object") {
    const t = body.theme;
    const hex = (v, fallback) => (/^#[0-9a-fA-F]{3,8}$/.test(String(v || "")) ? v : fallback);
    const current = config.theme || {};
    config.theme = {
      accent: hex(t.accent, current.accent || "#e6a93d"),
      card: hex(t.card, current.card || "#101828"),
      background: hex(t.background, current.background || "#0a0e1a"),
      border: hex(t.border, current.border || "#2a3550"),
      showWave: !!t.showWave,
      waveColor: hex(t.waveColor, current.waveColor || "#e6a93d"),
    };
  }
  await saveConfig(body.event, config, env);

  // If the name changed, mirror it into eventIndex so the landing page (which
  // reads names from the index, not from each cfg) shows the new name.
  if (body.name !== undefined) {
    const index = await getEventIndex(env);
    const entry = index.find((e) => e.slug === body.event);
    if (entry && entry.name !== config.name) {
      entry.name = config.name;
      await saveEventIndex(index, env);
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    name: config.name,
    subtitle: config.subtitle || "",
    footer: config.footer || "",
    defaultBadge: config.defaultBadge || "",
    date: config.date || "",
    venue: config.venue || "",
  }), jsonHeaders());
}

// Edit an event's ticket template (HTML/CSS) after creation.
// Only touches the cfg: record — guest roster and all existing ticket
// links are untouched, so this costs exactly 1 KV write per save.
// Leave both fields blank to remove the custom template and fall back
// to the default themed design.
async function apiEditTemplate(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || !body.event) return new Response(JSON.stringify({ error: "Missing event" }), jsonHeaders(400));

  const auth = await requireEventAuth(request, body.event, env);
  if (auth.error) return auth.error;

  const config = auth.config;
  const html = (body.templateHtml || "").trim();
  const css = body.templateCss || "";

  if (html) {
    config.customTemplate = { html: body.templateHtml, css };
  } else {
    delete config.customTemplate;
  }
  await saveConfig(body.event, config, env);

  return new Response(JSON.stringify({ ok: true, hasCustomTemplate: !!html }), jsonHeaders());
}

// Set or remove the event's SCANNER password (authorizes devices to check
// people in). Requires dashboard auth. Blank removes it -> check-in open again.
async function apiSetScanPassword(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || !body.event) return new Response(JSON.stringify({ error: "Missing event" }), jsonHeaders(400));

  const auth = await requireEventAuth(request, body.event, env);
  if (auth.error) return auth.error;

  const config = auth.config;
  const pw = (body.scanPassword || "").trim();
  if (pw) config.scanHash = await hashPassword(pw);
  else delete config.scanHash;
  await saveConfig(body.event, config, env);

  return new Response(JSON.stringify({ ok: true, protected: !!pw }), jsonHeaders());
}

// A device submits the scanner password here; on success it gets the scan
// cookie authorizing it to check people in for this event.
async function apiVerifyScan(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || !body.event || !body.password) {
    return new Response(JSON.stringify({ ok: false, error: "Missing event or password" }), jsonHeaders(400));
  }

  const allowed = checkRateLimit(`scan:${body.event}:${clientIp(request)}`, 8, 600);
  if (!allowed) {
    return new Response(JSON.stringify({ ok: false, error: "Too many attempts. Try again in a few minutes." }), jsonHeaders(429));
  }

  const config = await getConfig(body.event, env);
  const fail = () => new Response(JSON.stringify({ ok: false, error: "Incorrect password" }), jsonHeaders(401));
  if (!config) return fail();
  if (!config.scanHash) return new Response(JSON.stringify({ ok: true }), jsonHeaders()); // no scanner pw = check-in open

  const hash = config.scanHash;
  if (!(await verifyPassword(body.password, hash))) return fail();

  const headers = jsonHeaders().headers;
  // Long-lived (30 days) so staff don't re-auth mid-event.
  headers["Set-Cookie"] = `${scanCookieName(body.event)}=${hash}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`;
  return new Response(JSON.stringify({ ok: true }), { headers });
}

async function apiSetPassword(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || !body.event) return new Response(JSON.stringify({ error: "Missing event" }), jsonHeaders(400));

  // Uses the same auth rule as everything else: if the event currently
  // has a password, you must already be authed (know the current one)
  // to change or remove it. If it's currently open, anyone with
  // dashboard access can set the first password.
  const auth = await requireEventAuth(request, body.event, env);
  if (auth.error) return auth.error;

  const config = auth.config;
  const newPassword = (body.newPassword || "").trim();

  const headers = jsonHeaders().headers;

  if (newPassword) {
    const hash = await hashPassword(newPassword);
    config.passwordHash = hash;
    await saveConfig(body.event, config, env);
    headers["Set-Cookie"] = `${cookieName(body.event)}=${hash}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`;
  } else {
    delete config.passwordHash;
    await saveConfig(body.event, config, env);
  }

  return new Response(JSON.stringify({ ok: true, protected: !!newPassword }), { headers });
}

async function apiVerifyPassword(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || !body.event || !body.password) {
    return new Response(JSON.stringify({ ok: false, error: "Missing event or password" }), jsonHeaders(400));
  }

  // 8 attempts / 10 minutes per event+IP — before touching the password at
  // all, so a brute-force script can't just fire as fast as the Worker replies.
  const allowed = checkRateLimit(`pw:${body.event}:${clientIp(request)}`, 8, 600);
  if (!allowed) {
    return new Response(JSON.stringify({ ok: false, error: "Too many attempts. Try again in a few minutes." }), jsonHeaders(429));
  }

  const config = await getConfig(body.event, env);
  // Return an identical generic failure for both "no such event" and
  // "wrong password" so the response can't be used to enumerate which
  // event slugs exist. (An open/nonexistent event both just fail to auth.)
  const genericFail = () =>
    new Response(JSON.stringify({ ok: false, error: "Incorrect password" }), jsonHeaders(401));

  if (!config) return genericFail();
  if (!config.passwordHash) return new Response(JSON.stringify({ ok: true }), jsonHeaders());

  const hash = config.passwordHash;
  if (!(await verifyPassword(body.password, hash))) return genericFail();

  const headers = jsonHeaders().headers;
  headers["Set-Cookie"] = `${cookieName(body.event)}=${hash}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`;
  return new Response(JSON.stringify({ ok: true }), { headers });
}

// ---------- KV usage tracking (real Cloudflare account analytics, not self-counted) ----------
// Requires two things set once, ever:
//   1. A Cloudflare API token with "Account Analytics: Read" permission,
//      stored as a secret: wrangler secret put CF_API_TOKEN
//   2. Your Cloudflare Account ID as a plain variable in wrangler.toml under [vars]:
//      CF_ACCOUNT_ID = "your-account-id"
// This queries Cloudflare's own usage numbers directly — it does NOT consume
// any of your KV read/write quota to check, since it's a separate API.

const KV_FREE_LIMITS = { read: 100000, write: 1000, delete: 1000, list: 1000 };

async function fetchKvUsage(env) {
  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) {
    return { configured: false };
  }

  const today = new Date().toISOString().slice(0, 10);
  const query = `
    query KvUsageToday($accountTag: string!, $start: Date, $end: Date) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          kvOperationsAdaptiveGroups(
            filter: { date_geq: $start, date_leq: $end }
            limit: 10000
          ) {
            sum { requests }
            dimensions { actionType }
          }
        }
      }
    }`;

  const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.CF_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      variables: { accountTag: env.CF_ACCOUNT_ID, start: today, end: today },
    }),
  });

  if (!res.ok) {
    return { configured: true, error: `Cloudflare API returned ${res.status}` };
  }

  const data = await res.json();
  if (data.errors && data.errors.length) {
    return { configured: true, error: data.errors[0].message };
  }

  const groups = data?.data?.viewer?.accounts?.[0]?.kvOperationsAdaptiveGroups || [];
  const used = { read: 0, write: 0, delete: 0, list: 0 };
  for (const g of groups) {
    const type = g.dimensions.actionType;
    if (used[type] !== undefined) used[type] += g.sum.requests;
  }

  const result = { configured: true, date: today, usage: {} };
  for (const type of Object.keys(KV_FREE_LIMITS)) {
    const limit = KV_FREE_LIMITS[type];
    result.usage[type] = { used: used[type], limit, remaining: limit - used[type] };
  }
  return result;
}

async function handleKvUsage(env) {
  const result = await fetchKvUsage(env);
  return new Response(JSON.stringify(result), jsonHeaders());
}

async function handleLanding(env) {
  const events = await getEventIndex(env);
  const sorted = [...events].sort((a, b) => (b.addedAt || "").localeCompare(a.addedAt || ""));

  // Recompute each event's guest count fresh from its roster rather than
  // trusting the stored guestCount, which can drift if the CLI scripts (or
  // anything else) write to a roster without updating eventIndex. Reads are
  // effectively free and the landing page is loaded rarely, so this keeps the
  // count always-correct at negligible cost.
  await Promise.all(
    sorted.map(async (e) => {
      const roster = await getRoster(e.slug, env);
      e.liveCount = roster ? Object.keys(roster).length : 0;
    })
  );

  const rows = sorted.length
    ? sorted.map((e) => `
        <a class="event-card" href="/dashboard?event=${encodeURIComponent(e.slug)}" data-slug="${escapeHtml(e.slug)}" data-name="${escapeHtml(e.name || e.slug)}">
          <div class="event-name">${escapeHtml(e.name || e.slug)}</div>
          <div class="event-meta">
            <span>${escapeHtml(e.addedAt || "")}</span>
            <span>${e.liveCount} guests</span>
          </div>
        </a>
      `).join("")
    : `<div class="empty">No events yet.</div>`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TRKT</title>
  <link rel="icon" href="/favicon-16.png" sizes="16x16" type="image/png"><link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <meta name="theme-color" content="#14100e">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Bungee&family=Space+Grotesk:wght@400;500;700&family=JetBrains+Mono:wght@400;700&display=swap');
    :root {
      --void:#14100e; --shell:#1e1815; --shell-2:#171310; --seam:#3a2f28;
      --cream:#f2e6d0; --dim:#a8927a; --faint:#6b5a4a;
      --atomic:#ff6b35; --sun:#ffb100; --turq:#2ec4b6; --coral:#e63946;
      --starburst:#ffb100;
    }
    * { box-sizing:border-box; }
    body {
      margin:0; background:var(--void); color:var(--cream);
      font-family:'Space Grotesk',system-ui,sans-serif; font-size:15px; line-height:1.65;
      background-image:
        radial-gradient(circle at 12% 8%, rgba(255,177,0,.07) 0, transparent 42%),
        radial-gradient(circle at 88% 92%, rgba(46,196,182,.06) 0, transparent 42%);
      background-attachment:fixed;
    }
    a { color:var(--sun); }
    .mono { font-family:'JetBrains Mono',ui-monospace,monospace; }

    body { min-height:100vh; display:flex; flex-direction:column; align-items:center; padding:76px 24px 96px; }
    .hero { text-align:center; margin-bottom:40px; position:relative; }
    .brand {
      font-family:'Bungee',cursive; font-size:60px; line-height:1; color:var(--sun);
      letter-spacing:.06em; text-shadow:3px 3px 0 var(--atomic), 6px 6px 0 rgba(230,57,70,.35);
    }
    .starburst { display:flex; align-items:center; justify-content:center; gap:12px; margin:18px 0 12px; }
    .starburst i { display:block; height:2px; width:44px; background:linear-gradient(90deg,transparent,var(--atomic)); }
    .starburst i:last-child { background:linear-gradient(90deg,var(--atomic),transparent); }
    .starburst b { color:var(--turq); font-size:17px; }
    .tag { color:var(--dim); font-size:12px; letter-spacing:.34em; text-transform:uppercase; font-weight:500; }
    .col { width:100%; max-width:560px; }
    .new-btn {
      display:block; text-align:center; background:var(--atomic); color:#fff6ec;
      font-family:'Bungee',cursive; font-size:15px; letter-spacing:.09em; padding:17px;
      border-radius:32px; text-decoration:none; margin-bottom:34px;
      box-shadow:0 5px 0 #b8431c; transition:.12s;
    }
    .new-btn:hover { transform:translateY(-2px); box-shadow:0 7px 0 #b8431c; }
    .new-btn:active { transform:translateY(3px); box-shadow:0 2px 0 #b8431c; }
    .heading { font-family:'Bungee',cursive; font-size:12px; letter-spacing:.2em; color:var(--faint); margin:0 0 13px 4px; }
    .events { display:flex; flex-direction:column; gap:13px; }
    .event-card {
      background:var(--shell); border:1px solid var(--seam); border-radius:16px; padding:18px 22px;
      text-decoration:none; display:block; position:relative; overflow:hidden; transition:.14s; cursor:pointer;
    }
    .event-card::after {
      content:''; position:absolute; right:-30px; top:-30px; width:80px; height:80px; border-radius:50%;
      background:radial-gradient(circle, rgba(255,177,0,.16), transparent 70%); transition:.2s;
    }
    .event-card:hover { border-color:var(--sun); transform:translateX(4px); }
    .event-card:hover::after { transform:scale(1.5); }
    .event-name { color:var(--cream); font-size:19px; font-weight:700; letter-spacing:-.01em; }
    .event-meta { display:flex; justify-content:space-between; color:var(--faint); font-size:12px; margin-top:7px; letter-spacing:.05em; }
    .empty { color:var(--faint); text-align:center; padding:34px; border:2px dashed var(--seam); border-radius:16px; }
    .usage-box { background:var(--shell); border:1px solid var(--seam); border-radius:16px; padding:17px 20px; margin-bottom:30px; font-size:12px; }
    .usage-title { color:var(--faint); letter-spacing:.16em; margin-bottom:11px; text-transform:uppercase; font-size:10px; font-family:'Bungee',cursive; }
    .usage-row { display:flex; justify-content:space-between; color:var(--dim); margin-bottom:4px; font-size:12px; }
    .usage-bar-track { background:var(--shell-2); border-radius:4px; height:6px; margin:3px 0 10px; overflow:hidden; }
    .usage-bar-fill { height:100%; background:linear-gradient(90deg,var(--sun),var(--atomic)); }
    .usage-bar-fill.high { background:var(--coral); }
    .floating-btn {
      position:fixed; bottom:26px; right:26px; background:var(--shell); color:var(--sun);
      border:1px solid var(--seam); border-radius:30px; padding:11px 19px; font-size:12px;
      letter-spacing:.1em; text-decoration:none; transition:.14s; font-weight:700;
    }
    .floating-btn:hover { border-color:var(--sun); transform:translateY(-2px); }
    .sig { color:var(--faint); font-size:11px; letter-spacing:.2em; margin-top:46px; text-align:center; text-transform:uppercase; }

    /* destination chooser — keeps staff off the dashboard, saving reads */
    .veil { position:fixed; inset:0; background:rgba(10,8,6,.86); display:none; align-items:center; justify-content:center; padding:24px; z-index:50; }
    .veil.on { display:flex; }
    .choice { background:var(--shell); border:1px solid var(--seam); border-radius:22px; padding:32px; max-width:440px; width:100%; text-align:center; }
    .choice h3 { font-family:'Bungee',cursive; color:var(--sun); font-size:20px; margin:0 0 6px; }
    .choice p { color:var(--dim); font-size:13px; margin:0 0 24px; }
    .pick { display:flex; flex-direction:column; gap:12px; }
    .pick a {
      display:block; padding:17px; border-radius:14px; text-decoration:none; font-weight:700;
      font-size:15px; border:2px solid var(--seam); background:var(--shell-2); color:var(--cream); transition:.12s;
    }
    .pick a small { display:block; font-size:11.5px; font-weight:400; color:var(--faint); margin-top:4px; letter-spacing:.04em; }
    .pick a.dash:hover { border-color:var(--sun); color:var(--sun); }
    .pick a.scan:hover { border-color:var(--turq); color:var(--turq); }
    .veil button { margin-top:20px; background:none; border:none; color:var(--faint); font-family:inherit; font-size:12px; cursor:pointer; letter-spacing:.1em; }
    .veil button:hover { color:var(--cream); }
  </style>
</head>
<body>
  <div class="hero">
    <div class="brand">TRKT</div>
    <div class="starburst"><i></i><b>✦</b><i></i></div>
    <div class="tag">Event Ticketing &amp; Check-In</div>
  </div>

  <div class="col">
    <div class="usage-box" id="usageBox">reading the meter…</div>
    <a class="new-btn" href="/new">+ Create New Event</a>
    <div class="heading">// Events</div>
    <div class="events">${rows}</div>
    <div class="sig">✦ built for real doors ✦</div>
  </div>

  <div class="veil" id="veil" onclick="if(event.target===this)closeVeil()">
    <div class="choice">
      <h3 id="veil-name">Event</h3>
      <p>Where are you headed?</p>
      <div class="pick">
        <a class="dash" id="veil-dash" href="#">Dashboard<small>Full control · live counts · uses more reads</small></a>
        <a class="scan" id="veil-scan" href="#">Authorise Scanner<small>For staff phones · check people in · light on reads</small></a>
      </div>
      <button onclick="closeVeil()">cancel</button>
    </div>
  </div>

  <a class="floating-btn" href="https://rydr.info" target="_blank" rel="noopener">rydr.info ↗</a>
  <script>
    async function loadUsage() {
      try {
        const res = await fetch('/api/kv-usage');
        const data = await res.json();
        const box = document.getElementById('usageBox');
        if (!data.configured) {
          box.innerHTML = '<div class="usage-title">USAGE TRACKING NOT SET UP</div>';
          return;
        }
        if (data.error) {
          box.innerHTML = '<div class="usage-title">USAGE CHECK FAILED: ' + data.error + '</div>';
          return;
        }
        const labels = { read: 'READS', write: 'WRITES', delete: 'DELETES', list: 'LISTS' };
        let html = '<div class="usage-title">TODAY\\'S CLOUDFLARE USAGE (' + data.date + ')</div>';
        for (const [type, label] of Object.entries(labels)) {
          const u = data.usage[type];
          const pct = Math.min(100, (u.used / u.limit) * 100);
          const highClass = pct > 70 ? ' high' : '';
          html += '<div class="usage-row"><span>' + label + '</span><span>' + u.used + ' / ' + u.limit + ' (' + u.remaining + ' left)</span></div>';
          html += '<div class="usage-bar-track"><div class="usage-bar-fill' + highClass + '" style="width:' + pct + '%"></div></div>';
        }
        box.innerHTML = html;
      } catch (e) {
        document.getElementById('usageBox').innerHTML = '<div class="usage-title">Could not load usage.</div>';
      }
    }
    loadUsage();

    // Ask where they're going instead of dumping everyone on the dashboard.
    // Staff who only need to scan never open a dashboard, which is what
    // actually burns reads during a busy event.
    //
    // Wired with a delegated listener reading data-* attributes, NOT an inline
    // onclick: the slug/name are user-controlled text, and interpolating them
    // into an onclick="" attribute breaks the moment they contain a quote.
    document.querySelectorAll('.event-card').forEach(function (card) {
      card.addEventListener('click', function (ev) {
        ev.preventDefault();
        var slug = card.dataset.slug;
        document.getElementById('veil-name').textContent = card.dataset.name || slug;
        document.getElementById('veil-dash').href = '/dashboard?event=' + encodeURIComponent(slug);
        document.getElementById('veil-scan').href = '/scan?event=' + encodeURIComponent(slug);
        document.getElementById('veil').classList.add('on');
      });
    });
    function closeVeil() { document.getElementById('veil').classList.remove('on'); }
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeVeil(); });
  </script>
</body>
</html>`;

  return new Response(html, { headers: { "content-type": "text/html;charset=UTF-8" } });
}

// ---------- New event creation page ----------

function handleNewEventPage() {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Create Event — TRKT</title>
  <link rel="icon" href="/favicon-16.png" sizes="16x16" type="image/png"><link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <meta name="theme-color" content="#14100e">
  <style>@import url('https://fonts.googleapis.com/css2?family=Bungee&family=Space+Grotesk:wght@400;500;700&family=JetBrains+Mono:wght@400;700&display=swap');
    :root { --void:#14100e; --shell:#1e1815; --shell-2:#171310; --seam:#3a2f28;
            --cream:#f2e6d0; --dim:#a8927a; --faint:#6b5a4a;
            --atomic:#ff6b35; --sun:#ffb100; --turq:#2ec4b6; --coral:#e63946; }

    * { box-sizing:border-box; }
    body { margin:0; background:var(--void); color:var(--cream); padding:34px 24px 90px;
      font-family:'Space Grotesk',system-ui,sans-serif; font-size:15px; line-height:1.65;
      background-image:radial-gradient(circle at 12% 8%, rgba(255,177,0,.07) 0, transparent 42%); background-attachment:fixed; }
    .wrap { max-width:700px; margin:0 auto; }
    .top { display:flex; align-items:center; gap:12px; margin-bottom:6px; }
    .mark { font-family:'Bungee',cursive; font-size:18px; color:var(--sun); text-decoration:none; text-shadow:2px 2px 0 var(--atomic); }
    h1 { font-family:'Bungee',cursive; color:var(--cream); font-size:27px; margin:14px 0 26px; letter-spacing:.02em; }
    label { display:block; font-size:11px; color:var(--dim); letter-spacing:.14em; text-transform:uppercase;
            margin:20px 0 7px; font-weight:700; }
    input[type=text], textarea, input[type=file] {
      width:100%; background:var(--shell-2); border:1px solid var(--seam); border-radius:9px;
      color:var(--cream); font-family:'Space Grotesk',sans-serif; font-size:14px; padding:11px 13px;
    }
    textarea { min-height:130px; resize:vertical; font-family:'JetBrains Mono',monospace; font-size:12.5px; }
    input:focus, textarea:focus { outline:none; border-color:var(--sun); box-shadow:0 0 0 3px rgba(255,177,0,.14); }
    .hint { color:var(--faint); font-size:12.5px; margin-top:7px; line-height:1.6; }
    .hint code { color:var(--turq); font-family:'JetBrains Mono',monospace; }
    button { margin-top:28px; background:var(--atomic); color:#fff6ec; font-family:'Bungee',cursive;
             border:none; padding:15px 30px; border-radius:30px; font-size:14px; cursor:pointer;
             letter-spacing:.07em; box-shadow:0 4px 0 #b8431c; transition:.12s; }
    button:hover { transform:translateY(-2px); box-shadow:0 6px 0 #b8431c; }
    button:active { transform:translateY(2px); box-shadow:0 2px 0 #b8431c; }
    #status { margin-top:18px; font-size:14px; font-weight:700; color:var(--sun); }
    #result { margin-top:24px; }
    #result table { width:100%; border-collapse:collapse; background:var(--shell); border:1px solid var(--seam); border-radius:14px; overflow:hidden; }
    #result th, #result td { text-align:left; padding:11px 14px; font-size:13.5px; border-bottom:1px solid #2a221c; }
    #result th { font-size:10.5px; letter-spacing:.14em; text-transform:uppercase; color:var(--faint); background:var(--shell-2); }
    .copy-btn { background:var(--shell-2); color:var(--cream); border:1px solid var(--seam); border-radius:18px;
                padding:6px 13px; font-size:12px; cursor:pointer; font-family:inherit; font-weight:700; margin:0; box-shadow:none; }
    .copy-btn:hover { border-color:var(--sun); color:var(--sun); transform:none; box-shadow:none; }
    a.dash-link { color:var(--sun); font-weight:700; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top"><a class="mark" href="/">TRKT</a><span style="color:var(--faint);">✦</span></div>
    <h1>Create a new event</h1>

    <label>Event slug (short, lowercase, no spaces — becomes part of ticket links)</label>
    <input type="text" id="slug" placeholder="my-event-2026">

    <label>Event name</label>
    <input type="text" id="name" placeholder="MY EVENT NAME">

    <label>Subtitle</label>
    <input type="text" id="subtitle" placeholder="A short line under the title">

    <label>Footer text</label>
    <input type="text" id="footer" placeholder="SCAN AT ENTRANCE FOR CHECK-IN">

    <label>Default badge (used if a guest row doesn't set one)</label>
    <input type="text" id="defaultBadge" placeholder="guest">

    <label>Dashboard password (optional — leave blank for no password)</label>
    <input type="text" id="password" placeholder="Leave blank for an open event">
    <div class="hint">Protects the dashboard and guest management. Keep this one to yourself. Guest ticket links always stay open.</div>

    <label>Scanner password (optional — for door staff)</label>
    <input type="text" id="scanPassword" placeholder="Leave blank to let any device check people in">
    <div class="hint">Give this to whoever is scanning. It lets a device check guests in — and nothing else. Leave blank and <em>any</em> phone that scans a ticket QR can check people in.</div>

    <label>Check-in mode (choose based on how many people scan at once — this can't be changed later)</label>
    <div style="display:flex; flex-direction:column; gap:10px; margin-top:4px;">
      <label style="display:flex; gap:10px; align-items:flex-start; cursor:pointer; font-size:13px; color:#e2e8f0; letter-spacing:0;">
        <input type="radio" name="checkinMode" value="standard" checked style="margin-top:3px;">
        <span><strong style="color:#e6a93d;">Standard</strong> — best for most events, especially one person scanning at the door. Uses the fewest resources. If two people happen to scan two different guests at the exact same instant, one check-in could be missed. Fine when scanning is sequential.</span>
      </label>
      <label style="display:flex; gap:10px; align-items:flex-start; cursor:pointer; font-size:13px; color:#e2e8f0; letter-spacing:0;">
        <input type="radio" name="checkinMode" value="highConcurrency" style="margin-top:3px;">
        <span><strong style="color:#e6a93d;">High-concurrency</strong> — for big events with several people scanning at the same time (e.g. multiple doors, hundreds of guests arriving fast). Guarantees no check-in is ever lost to simultaneous scans. Uses more reads, so keep only one dashboard open during the event.</span>
      </label>
    </div>

    <label>Event date &amp; venue</label>
    <div style="display:flex; gap:8px;">
      <input type="text" id="date" placeholder="Date, e.g. 18th July, 2026" style="flex:1;">
      <input type="text" id="venue" placeholder="Venue, e.g. Cadet College Club" style="flex:1;">
    </div>
    <div class="hint">One value for the whole event — every ticket uses it, and you can change it any time from the dashboard. Only fill these in if you want them on the ticket. (If you leave them blank but your CSV has Date/Venue columns, those are used instead.)</div>

    <label>Check-in time window (optional)</label>
    <div style="display:flex; gap:8px;">
      <input type="text" id="checkinStart" placeholder="Start, e.g. 6:00 PM" style="flex:1;">
      <input type="text" id="checkinEnd" placeholder="End, e.g. 8:00 PM" style="flex:1;">
    </div>
    <label style="display:flex; gap:8px; align-items:center; margin-top:10px; cursor:pointer;">
      <input type="checkbox" id="showCheckinWindow"> <span style="font-size:12px; color:#cbd5e1; letter-spacing:0;">Show this check-in time on the ticket</span>
    </label>
    <div class="hint">If ticked, tickets display the time window (and {{checkinWindow}} works in custom templates). Leave unticked for a ticket with no time shown.</div>

    <label>Ticket page HTML (optional — leave blank for the default design)</label>
    <textarea id="templateHtml" placeholder="Use placeholders like {{name}} and {{seat}}"></textarea>
    <div class="hint">Placeholders available: {{name}} {{seat}} {{date}} {{venue}} {{badge}} {{eventName}} {{eventSubtitle}} {{footer}} {{ticketId}} {{qrImage}}</div>

    <label>Ticket page CSS (optional)</label>
    <textarea id="templateCss"></textarea>

    <label>Guest list CSV</label>
    <div class="hint" style="margin-bottom:8px; line-height:1.7;">
      <strong style="color:#e6a93d;">First row must be the column headers.</strong> You choose which columns to include — only Name is required.<br><br>
      • <strong style="color:#e2e8f0;">Name</strong> — <strong style="color:#e6a93d;">mandatory.</strong> Rows with a blank name are skipped.<br>
      • <strong style="color:#e2e8f0;">Seat, Badge</strong> — optional. Include the column only if you use it. Omit it entirely and it simply won't exist for this event.<br>
      • <strong style="color:#e2e8f0;">Any other column</strong> — becomes a custom field automatically. e.g. a column headed <em>Meal Preference</em> → placeholder <code style="color:#7dd3fc;">{{meal_preference}}</code>, editable per guest and removable later.<br>
      • What shows on the ticket is controlled entirely by your template tags — a column only appears if you put its <code style="color:#7dd3fc;">{{tag}}</code> in the HTML.<br><br>
      Date &amp; venue are set once for the whole event on the dashboard, not per row. Wrap any value containing a comma in quotes, e.g. <code style="color:#7dd3fc;">"18th July, 2026"</code>.<br><br>
      <span style="color:#4b5871;">Example — a minimal file with just names:</span><br>
      <code style="color:#7dd3fc; display:block; margin-top:4px;">Name<br>John Smith<br>Jane Doe</code>
      <span style="color:#4b5871; display:block; margin-top:8px;">Example — names plus a table number and a custom field:</span><br>
      <code style="color:#7dd3fc; display:block; margin-top:4px;">Name,Seat,Meal Preference<br>John Smith,Table 1,Vegetarian<br>Jane Doe,Table 2,Chicken</code>
    </div>
    <input type="file" id="csvFile" accept=".csv">

    <button onclick="submitEvent()">Create event</button>
    <div id="status"></div>
    <div id="result"></div>
  </div>

  <script>
    function parseCsv(text) {
      const rows = [];
      let row = [], field = "", inQuotes = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
          if (c === '"') {
            if (text[i + 1] === '"') { field += '"'; i++; }
            else inQuotes = false;
          } else field += c;
        } else {
          if (c === '"') inQuotes = true;
          else if (c === ',') { row.push(field); field = ""; }
          else if (c === '\\n' || c === '\\r') {
            if (field !== "" || row.length > 0) { row.push(field); rows.push(row); row = []; field = ""; }
            if (c === '\\r' && text[i + 1] === '\\n') i++;
          } else field += c;
        }
      }
      if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
      return rows;
    }

    function slugifyField(label) {
      return String(label || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    }

    function csvToGuests(text) {
      const rows = parseCsv(text).filter(r => r.some(c => c.trim() !== ""));
      if (!rows.length) return [];
      const rawHeaders = rows[0].map(h => h.trim());
      const std = ['name', 'seat', 'date', 'venue', 'badge'];
      return rows.slice(1).map(r => {
        const g = { custom: {} };
        rawHeaders.forEach((h, i) => {
          const val = (r[i] || "").trim();
          const lower = h.toLowerCase();
          if (std.includes(lower)) {
            g[lower] = val;
          } else if (h) {
            // extra column -> custom field, keyed by auto-slug, carrying its label
            const key = slugifyField(h);
            if (key) g.custom[key] = { label: h, value: val };
          }
        });
        return g;
      }).filter(g => g.name);
    }

    async function submitEvent() {
      const status = document.getElementById('status');
      const fileInput = document.getElementById('csvFile');
      if (!fileInput.files.length) { status.textContent = 'Choose a CSV file first.'; return; }

      const slug = document.getElementById('slug').value.trim();
      const name = document.getElementById('name').value.trim();
      if (!slug || !name) { status.textContent = 'Slug and name are required.'; return; }

      status.textContent = 'Reading CSV...';
      const text = await fileInput.files[0].text();
      const guests = csvToGuests(text);
      if (!guests.length) { status.textContent = 'No guest rows found in that CSV.'; return; }

      status.textContent = 'Creating event...';
      const res = await fetch('/api/create-event', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug, name,
          subtitle: document.getElementById('subtitle').value.trim(),
          footer: document.getElementById('footer').value.trim(),
          defaultBadge: document.getElementById('defaultBadge').value.trim(),
          date: document.getElementById('date').value.trim(),
          venue: document.getElementById('venue').value.trim(),
          password: document.getElementById('password').value,
          scanPassword: document.getElementById('scanPassword').value,
          checkinMode: (document.querySelector('input[name="checkinMode"]:checked') || {}).value || 'standard',
          checkinStart: document.getElementById('checkinStart').value.trim(),
          checkinEnd: document.getElementById('checkinEnd').value.trim(),
          showCheckinWindow: document.getElementById('showCheckinWindow').checked,
          templateHtml: document.getElementById('templateHtml').value,
          templateCss: document.getElementById('templateCss').value,
          guests,
        }),
      });
      const data = await res.json();
      if (data.error) { status.textContent = data.error; return; }

      status.textContent = guests.length + ' tickets created.';
      const origin = window.location.origin;
      // HTML-escape anything that came from user input (guest names, slug)
      // before it touches innerHTML — a crafted name/slug used to be able to
      // break out of the onclick attribute string and run arbitrary JS.
      function escClient(s) {
        return String(s ?? '')
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      }
      const rows = data.links.map(l => \`
        <tr>
          <td>\${escClient(l.name)}</td>
          <td><button class="copy-btn" data-link="\${escClient(origin + '/ticket?event=' + slug + '&id=' + l.id)}">Copy link</button></td>
        </tr>\`).join('');
      document.getElementById('result').innerHTML =
        '<a class="dash-link" href="/dashboard?event=' + encodeURIComponent(slug) + '">Open the live dashboard for this event →</a>' +
        '<table><thead><tr><th>Guest</th><th>Ticket</th></tr></thead><tbody>' + rows + '</tbody></table>';
      // Event listeners instead of inline onclick — the link never gets
      // concatenated into a JS string this way, so there's nothing to break
      // out of even if a name/slug contains quotes or HTML.
      document.getElementById('result').querySelectorAll('.copy-btn').forEach((btn) => {
        btn.addEventListener('click', () => navigator.clipboard.writeText(btn.dataset.link));
      });
    }
  </script>
</body>
</html>`;

  return new Response(html, { headers: { "content-type": "text/html;charset=UTF-8" } });
}

// ---------- Guest-facing ticket page ----------

async function handleTicketView(slug, id, env, origin) {
  const config = await getConfig(slug, env);
  if (!config) return htmlPage(genericErrorCard("Unknown Event"), fallbackConfig());

  const roster = await getRoster(slug, env);
  const guest = roster ? roster[id] : null;
  if (!guest) {
    return htmlPage(errorCard("Invalid Ticket", "This ticket link isn't recognized. Contact the event desk."), config);
  }

  if (config.customTemplate && config.customTemplate.html) {
    return renderCustomTemplateTicket(guest, config, slug, id, origin);
  }
  return renderThemedTicket(guest, config, slug, id, origin);
}

function renderCustomTemplateTicket(guest, config, slug, id, origin) {
  const checkinLink = `${origin}/checkin?event=${slug}&id=${id}`;
  const qrImg = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(checkinLink)}`;
  const badge = guest.badge || config.defaultBadge || "guest";

  const tokens = {
    "{{name}}": escapeHtml(guest.name),
    "{{seat}}": escapeHtml(guest.seat),
    "{{date}}": escapeHtml(eventDate(config, guest)),
    "{{venue}}": escapeHtml(eventVenue(config, guest)),
    "{{badge}}": escapeHtml(badge),
    "{{eventName}}": escapeHtml(config.name),
    "{{eventSubtitle}}": escapeHtml(config.subtitle),
    "{{footer}}": escapeHtml(config.footer),
    "{{ticketId}}": escapeHtml(id),
    "{{qrImage}}": qrImg,
    "{{checkinWindow}}": escapeHtml(checkinWindowText(config)),
  };

  // Custom fields become {{their_key}} placeholders.
  for (const f of config.customFields || []) {
    const value = guest.custom ? guest.custom[f.key] : "";
    tokens[`{{${f.key}}}`] = escapeHtml(value || "");
  }

  let bodyHtml = config.customTemplate.html;
  for (const [token, value] of Object.entries(tokens)) {
    bodyHtml = bodyHtml.split(token).join(value);
  }

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(config.name)}</title>
  <link rel="icon" href="/favicon-16.png" sizes="16x16" type="image/png"><link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <meta name="theme-color" content="#14100e">
  <style>${config.customTemplate.css || ""}</style>
</head>
<body>${bodyHtml}</body>
</html>`;

  return new Response(html, { headers: { "content-type": "text/html;charset=UTF-8" } });
}

async function handleCheckin(slug, id, env, request) {
  const config = await getConfig(slug, env);
  if (!config) return htmlPage(genericErrorCard("Unknown Event"), fallbackConfig());

  const roster = await getRoster(slug, env);
  const guest = roster ? roster[id] : null;
  if (!guest) {
    return htmlPage(errorCard("Invalid Ticket", "No guest record matches this code."), config);
  }

  // If this event requires an authorized scanner, only devices that entered the
  // scanner password (via /scan) may check people in. Everyone else — a guest
  // scanning their own code, a random phone — sees a not-authorized page.
  if (!isScanAuthed(request, slug, config)) {
    return htmlPage(
      errorCard("NOT AUTHORIZED", "This device isn't authorized to check in guests. Please have event staff scan your ticket."),
      config
    );
  }

  if (isHighConcurrency(config)) {
    // High-concurrency mode: status in a per-guest key. Two staff scanning
    // different guests write to different keys, so they never collide.
    const existing = await getCheckin(slug, id, env);
    const isLegacy = !existing && guest.attended;
    if (existing || isLegacy) {
      const at = existing ? existing.at : guest.checkinAt;
      return htmlPage(
        statusCard("ALREADY CHECKED IN", "#e6a93d", guest, at ? "" : "Checked in earlier", at),
        config
      );
    }
    const rec = await setCheckin(slug, id, env);
    return htmlPage(statusCard("CHECKED IN", "#4ade80", guest, "Welcome.", rec.at), config);
  }

  // Standard mode: status flag lives in the roster blob (cheap, single-scanner).
  if (guest.attended) {
    return htmlPage(
      statusCard("ALREADY CHECKED IN", "#e6a93d", guest, guest.checkinAt ? "" : "Checked in earlier", guest.checkinAt),
      config
    );
  }
  guest.attended = true;
  guest.checkinAt = Date.now();
  guest.checkinTime = new Date(guest.checkinAt).toISOString();
  roster[id] = guest;
  await saveRoster(slug, roster, env);
  return htmlPage(statusCard("CHECKED IN", "#4ade80", guest, "Welcome.", guest.checkinAt), config);
}

// Export the full guest list + attendance as a CSV download. Reads only —
// costs nothing from the write budget. Honors the event's check-in mode so
// attendance is accurate either way, and includes every custom field.
async function handleExport(slug, env, request) {
  const config = await getConfig(slug, env);
  const roster = await getRoster(slug, env);
  if (!config || !roster) return new Response("Unknown event", { status: 404 });
  if (!isAuthed(request, slug, config)) {
    return new Response("Password required", { status: 401 });
  }

  // Resolve attendance the same way the dashboard does.
  const checkins = await resolveCheckins(slug, config, roster, env);

  const fields = config.customFields || [];
  const header = ["Name", "Seat", "Badge", "Date", "Venue", "Checked In", "Check-in Time", "Ticket ID"]
    .concat(fields.map((f) => f.label));

  const csvCell = (v) => {
    let s = String(v ?? "");
    // Formula-injection guard: a cell starting with =, +, -, or @ gets
    // interpreted as a live formula by Excel/Sheets when the CSV is opened.
    // Prefixing with a single quote neutralizes it without changing what's
    // displayed. Only matters if you ever import a guest list you didn't
    // type yourself — harmless otherwise.
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const rows = Object.entries(roster)
    .sort((a, b) => (a[1].name || "").localeCompare(b[1].name || ""))
    .map(([id, g]) => {
      const c = checkins[id];
      const base = [
        g.name || "",
        g.seat || "",
        g.badge || config.defaultBadge || "",
        eventDate(config, g),
        eventVenue(config, g),
        c ? "YES" : "NO",
        c ? (c.at ? new Date(c.at).toISOString() : (c.time || "")) : "",
        id,
      ];
      const extra = fields.map((f) => (g.custom && g.custom[f.key]) || "");
      return base.concat(extra).map(csvCell).join(",");
    });

  const csv = [header.map(csvCell).join(",")].concat(rows).join("\r\n");
  const filename = `${slug}-attendance-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(csv, {
    headers: {
      "content-type": "text/csv;charset=UTF-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

// Arrival analytics: buckets check-in times into 15-minute windows so you can
// see when the rush actually hit. Read-only.
async function handleArrivals(slug, env, request) {
  const config = await getConfig(slug, env);
  const roster = await getRoster(slug, env);
  if (!config || !roster) return new Response(JSON.stringify({ error: "Unknown event" }), jsonHeaders(404));
  if (!isAuthed(request, slug, config)) {
    return new Response(JSON.stringify({ error: "Password required" }), jsonHeaders(401));
  }

  const checkins = await resolveCheckins(slug, config, roster, env);

  // Return raw epoch timestamps and let the BROWSER bucket them. The Worker
  // runs in UTC and has no idea what timezone the organiser is in, so any
  // bucketing done here would be in the wrong clock. Legacy records that only
  // have an unparseable locale string are reported separately rather than
  // silently misplaced into a wrong bucket.
  const times = [];
  let legacyUndated = 0;
  for (const c of Object.values(checkins)) {
    if (typeof c.at === "number") times.push(c.at);
    else if (c.time) {
      const parsed = Date.parse(c.time); // ISO strings parse; old locale strings don't
      if (!isNaN(parsed)) times.push(parsed);
      else legacyUndated++;
    }
  }
  times.sort((a, b) => a - b);

  return new Response(JSON.stringify({
    times,
    legacyUndated,
    totalCheckedIn: Object.keys(checkins).length,
  }), jsonHeaders());
}

async function handleStats(slug, env, request) {
  const config = await getConfig(slug, env);
  const roster = await getRoster(slug, env);
  if (!config || !roster) return new Response(JSON.stringify({ total: 0, checkedIn: 0 }), jsonHeaders());

  // Gate it like every other data endpoint. This leaked headcount for
  // password-protected events to anyone who knew the slug.
  if (!isAuthed(request, slug, config)) {
    return new Response(JSON.stringify({ error: "Password required" }), jsonHeaders(401));
  }

  const ids = Object.keys(roster);

  if (isHighConcurrency(config)) {
    const checkins = await getAllCheckins(slug, env);
    return new Response(JSON.stringify({
      total: ids.length,
      checkedIn: ids.filter((id) => checkins[id] || roster[id].attended).length,
    }), jsonHeaders());
  }

  // Standard mode: attendance is right there in the roster — no extra reads.
  return new Response(JSON.stringify({
    total: ids.length,
    checkedIn: ids.filter((id) => roster[id].attended).length,
  }), jsonHeaders());
}

async function handleDashboardData(slug, env, request) {
  const config = await getConfig(slug, env);
  const roster = await getRoster(slug, env);

  if (!config || !roster) {
    return new Response(JSON.stringify({ error: "Unknown event" }), jsonHeaders(404));
  }
  if (!isAuthed(request, slug, config)) {
    return new Response(JSON.stringify({ error: "Password required" }), jsonHeaders(401));
  }

  // Attendance source depends on the event's check-in mode (handled inside
  // resolveCheckins), including the legacy roster-baked backfill.
  const checkins = await resolveCheckins(slug, config, roster, env);

  const guests = Object.entries(roster)
    .map(([id, g]) => {
      const c = checkins[id];
      return {
        id, ...g,
        attended: !!c,
        // Epoch ms — the browser formats this into the viewer's local time.
        checkinAt: c ? (c.at ?? null) : null,
        // Legacy/fallback string, only used when there's no epoch.
        checkinTime: c ? (c.time || null) : null,
      };
    })
    .sort((a, b) => {
      // Sort by actual timestamp, newest first — string compare on a locale
      // time was wrong across the AM/PM boundary anyway.
      if (a.attended && b.attended) return (b.checkinAt || 0) - (a.checkinAt || 0);
      if (a.attended !== b.attended) return a.attended ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  return new Response(JSON.stringify({
    eventName: config.name,
    eventSubtitle: config.subtitle || "",
    eventFooter: config.footer || "",
    eventDefaultBadge: config.defaultBadge || "",
    eventDate: config.date || "",
    eventVenue: config.venue || "",
    checkinMode: config.checkinMode || "standard",
    theme: resolveTheme(config.theme),
    hasCustomTemplate: !!(config.customTemplate && config.customTemplate.html),
    scanProtected: !!config.scanHash,
    // Names appearing more than once — flagged (not blocked) on the dashboard,
    // since re-uploading the same CSV silently doubles the guest list.
    duplicateNames: (() => {
      const counts = {};
      for (const g of Object.values(roster)) {
        const k = (g.name || "").trim().toLowerCase();
        if (k) counts[k] = (counts[k] || 0) + 1;
      }
      return Object.entries(counts).filter(([, n]) => n > 1).map(([name, n]) => ({ name, count: n }));
    })(),
    showCheckinWindow: !!config.showCheckinWindow,
    checkinStart: config.checkinStart || "",
    checkinEnd: config.checkinEnd || "",
    total: guests.length,
    checkedIn: guests.filter((g) => g.attended).length,
    customFields: config.customFields || [],
    hiddenBuiltins: config.hiddenBuiltins || [],
    guests,
  }), jsonHeaders());
}

// ---------- Dashboard: live view + full guest management ----------

function handlePasswordGate(slug) {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Password required — TRKT</title>
  <link rel="icon" href="/favicon-16.png" sizes="16x16" type="image/png"><link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <meta name="theme-color" content="#14100e">
  <style>@import url('https://fonts.googleapis.com/css2?family=Bungee&family=Space+Grotesk:wght@400;500;700&family=JetBrains+Mono:wght@400;700&display=swap');
    :root { --void:#14100e; --shell:#1e1815; --shell-2:#171310; --seam:#3a2f28;
            --cream:#f2e6d0; --dim:#a8927a; --faint:#6b5a4a;
            --atomic:#ff6b35; --sun:#ffb100; --turq:#2ec4b6; --coral:#e63946; }

    * { box-sizing:border-box; }
    body { margin:0; background:var(--void); color:var(--cream); display:flex; justify-content:center;
           align-items:center; min-height:100vh; padding:24px;
           font-family:'Space Grotesk',system-ui,sans-serif; font-size:15px;
           background-image:radial-gradient(circle at 50% 0%, rgba(255,177,0,.08) 0, transparent 55%); }
    .box { background:var(--shell); border:1px solid var(--seam); border-radius:22px; padding:34px 30px; width:100%; max-width:370px; }
    h1 { font-family:'Bungee',cursive; color:var(--sun); font-size:17px; margin:0 0 18px; letter-spacing:.03em; text-align:center; }
    input { width:100%; background:var(--shell-2); border:1px solid var(--seam); border-radius:9px; color:var(--cream);
            font-family:inherit; font-size:15px; padding:12px; margin-bottom:14px; text-align:center; }
    input:focus { outline:none; border-color:var(--sun); box-shadow:0 0 0 3px rgba(255,177,0,.14); }
    button { width:100%; background:var(--sun); color:#241a08; font-family:'Bungee',cursive; border:none;
             padding:14px; border-radius:26px; font-size:13.5px; cursor:pointer; letter-spacing:.06em; box-shadow:0 4px 0 #b37c00; }
    button:active { transform:translateY(2px); box-shadow:0 2px 0 #b37c00; }
    #err { color:var(--coral); font-size:13px; margin-top:12px; text-align:center; font-weight:700; }
  </style>
</head>
<body>
  <div class="box">
    <h1>This event is password protected</h1>
    <input type="password" id="pw" placeholder="Password" onkeydown="if(event.key==='Enter') submitPw()">
    <button onclick="submitPw()">Unlock</button>
    <div id="err"></div>
  </div>
  <script>
    async function submitPw() {
      const password = document.getElementById('pw').value;
      const res = await fetch('/api/verify-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event: ${JSON.stringify(slug)}, password }),
      });
      const data = await res.json();
      if (data.ok) { window.location.reload(); }
      else { document.getElementById('err').textContent = data.error || 'Wrong password'; }
    }
  </script>
</body>
</html>`;
  return new Response(html, { headers: { "content-type": "text/html;charset=UTF-8" } });
}

async function handleScanPage(slug, env, request) {
  if (!slug) return new Response("Missing ?event=SLUG", { status: 400 });
  const config = await getConfig(slug, env);
  if (!config) return new Response("Unknown event", { status: 404 });

  const authed = isScanAuthed(request, slug, config);
  const needsPassword = !!config.scanHash && !authed;

  const body = needsPassword
    ? `
      <h1>Authorized scanner</h1>
      <p class="sub">Enter the <b>scanner password</b> to authorize <b>this device</b> to check in guests for ${escapeHtml(config.name)}.</p>
      <input type="password" id="pw" placeholder="Scanner password" onkeydown="if(event.key==='Enter')go()">
      <button onclick="go()">Authorize this device</button>
      <div id="err"></div>
      <script>
        async function go() {
          const password = document.getElementById('pw').value;
          const res = await fetch('/api/verify-scan', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ event: ${JSON.stringify(slug)}, password }) });
          const data = await res.json();
          if (data.ok) location.reload();
          else document.getElementById('err').textContent = data.error || 'Wrong password';
        }
      </script>`
    : `
      <h1 style="color:var(--turq);">✓ Device Authorized</h1>
      <p class="sub">This device can now check in guests for <b>${escapeHtml(config.name)}</b>. Use your phone's camera to scan guest QR codes — each opens the check-in page and marks them present.</p>
      ${config.scanHash ? "" : '<p class="sub" style="color:var(--sun);">No scanner password is set for this event, so any device can currently check people in. Set one from the dashboard to lock check-in down.</p>'}
      <a class="btn" href="/">← Back to home</a>`;

  const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Scanner — TRKT</title><link rel="icon" href="/favicon-16.png" sizes="16x16" type="image/png"><link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><meta name="theme-color" content="#14100e">
    <style>@import url('https://fonts.googleapis.com/css2?family=Bungee&family=Space+Grotesk:wght@400;500;700&family=JetBrains+Mono:wght@400;700&display=swap');
    :root { --void:#14100e; --shell:#1e1815; --shell-2:#171310; --seam:#3a2f28;
            --cream:#f2e6d0; --dim:#a8927a; --faint:#6b5a4a;
            --atomic:#ff6b35; --sun:#ffb100; --turq:#2ec4b6; --coral:#e63946; }

    * { box-sizing:border-box; }
    body { margin:0; background:var(--void); color:var(--cream); min-height:100vh;
      display:flex; align-items:center; justify-content:center; padding:24px;
      font-family:'Space Grotesk',system-ui,sans-serif; font-size:15px; line-height:1.6;
      background-image:radial-gradient(circle at 50% 0%, rgba(46,196,182,.09) 0, transparent 55%); }
    .box { background:var(--shell); border:1px solid var(--seam); border-radius:22px; padding:36px 30px;
           width:100%; max-width:400px; text-align:center; }
    h1 { font-family:'Bungee',cursive; font-size:21px; color:var(--sun); margin:0 0 10px; letter-spacing:.03em; }
    .sub { color:var(--dim); font-size:13.5px; margin-bottom:22px; }
    input { width:100%; background:var(--shell-2); border:1px solid var(--seam); border-radius:9px;
            color:var(--cream); font-family:inherit; font-size:15px; padding:12px; margin-bottom:14px; text-align:center; }
    input:focus { outline:none; border-color:var(--turq); box-shadow:0 0 0 3px rgba(46,196,182,.16); }
    button { width:100%; background:var(--turq); color:#08201d; font-family:'Bungee',cursive; border:none;
             padding:14px; border-radius:26px; font-size:13.5px; cursor:pointer; letter-spacing:.06em;
             box-shadow:0 4px 0 #1a7d74; }
    button:active { transform:translateY(2px); box-shadow:0 2px 0 #1a7d74; }
    #err { color:var(--coral); font-size:13px; margin-top:12px; font-weight:700; }
    .btn { display:inline-block; margin-top:20px; color:var(--dim); text-decoration:none; font-size:13px; font-weight:700; }
    .btn:hover { color:var(--sun); }
  </style></head><body><div class="box">${body}</div></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html;charset=UTF-8" } });
}

async function handleDashboardPage(slug, env, request) {
  if (!slug) return new Response("Missing ?event=SLUG", { status: 400 });

  const config = await getConfig(slug, env);
  if (!config) {
    return new Response("Unknown event", { status: 404, headers: { "content-type": "text/plain" } });
  }

  if (!isAuthed(request, slug, config)) {
    return handlePasswordGate(slug);
  }

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Dashboard — TRKT</title>
  <link rel="icon" href="/favicon-16.png" sizes="16x16" type="image/png"><link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <meta name="theme-color" content="#14100e">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Bungee&family=Space+Grotesk:wght@400;500;700&family=JetBrains+Mono:wght@400;700&display=swap');
    :root {
      --void:#14100e; --shell:#1e1815; --shell-2:#171310; --seam:#3a2f28;
      --cream:#f2e6d0; --dim:#a8927a; --faint:#6b5a4a;
      --atomic:#ff6b35; --sun:#ffb100; --turq:#2ec4b6; --coral:#e63946;
    }
    * { box-sizing:border-box; }
    body {
      margin:0; background:var(--void); color:var(--cream);
      font-family:'Space Grotesk',system-ui,sans-serif; font-size:15px; line-height:1.65;
      background-image:
        radial-gradient(circle at 12% 8%, rgba(255,177,0,.07) 0, transparent 42%),
        radial-gradient(circle at 88% 92%, rgba(46,196,182,.06) 0, transparent 42%);
      background-attachment:fixed;
    }
    a { color:var(--sun); }

    .wrap { max-width:1240px; margin:0 auto; padding:30px 24px 90px; }
    .masthead { display:flex; align-items:center; gap:14px; padding-bottom:16px; border-bottom:2px solid var(--seam); margin-bottom:8px; flex-wrap:wrap; }
    .mark { font-family:'Bungee',cursive; font-size:19px; color:var(--sun); text-decoration:none; letter-spacing:.06em;
            text-shadow:2px 2px 0 var(--atomic); }
    .mark:hover { color:var(--atomic); text-shadow:2px 2px 0 var(--sun); }
    .crumb { color:var(--faint); font-size:18px; }
    .evt { font-size:23px; font-weight:700; letter-spacing:-.015em; }
    .whisper { color:var(--dim); font-size:12.5px; margin:9px 0 24px; letter-spacing:.05em; }

    /* top-level nav — replaces the old settings drop-down */
    .tabs { display:flex; gap:8px; margin-bottom:26px; flex-wrap:wrap; }
    .tab {
      background:var(--shell); border:1px solid var(--seam); border-radius:30px; color:var(--dim);
      font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:13.5px; letter-spacing:.03em;
      padding:9px 20px; cursor:pointer; transition:.12s;
      /* Size to the label, never squash: a flex item's default min-width:auto
         still lets long labels wrap mid-word when the row gets tight. */
      flex:0 0 auto; white-space:nowrap;
    }
    .tab:hover { color:var(--cream); border-color:var(--dim); }
    .tab.on { background:var(--sun); border-color:var(--sun); color:#241a08; }
    .view { display:none; } .view.on { display:block; }

    .stat-strip { display:flex; gap:14px; flex-wrap:wrap; margin-bottom:24px; }
    .stat { background:var(--shell); border:1px solid var(--seam); border-radius:16px; padding:16px 24px; min-width:128px; position:relative; overflow:hidden; }
    .stat::after { content:''; position:absolute; right:-24px; top:-24px; width:64px; height:64px; border-radius:50%;
                   background:radial-gradient(circle, rgba(255,177,0,.13), transparent 70%); }
    .stat b { display:block; font-family:'Bungee',cursive; font-size:32px; color:var(--sun); line-height:1.15; }
    .stat span { font-size:10.5px; letter-spacing:.16em; color:var(--faint); text-transform:uppercase; font-weight:700; }
    .stat.wide { flex:1; min-width:280px; }
    .stat.wide::after { display:none; }

    .card { background:var(--shell); border:1px solid var(--seam); border-radius:18px; padding:22px 24px; margin-bottom:18px; }
    .card h4 { font-family:'Bungee',cursive; font-size:14px; color:var(--sun); margin:0 0 4px; letter-spacing:.05em; }
    .card .sub { color:var(--faint); font-size:12.5px; margin-bottom:16px; }
    /* Masonry-ish columns instead of a rigid grid. A CSS grid forced every card
       to the same column width AND row height, so a 3-line card (Export) got
       stretched to match a 12-line one (Bulk Add), and short cards left big
       voids underneath. With columns, each card keeps its natural height and
       the next one flows straight up into the gap. */
    .grid2 { column-width:320px; column-gap:18px; }
    .grid2 > .card {
      break-inside:avoid;          /* never split a card across columns */
      -webkit-column-break-inside:avoid;
      page-break-inside:avoid;
      display:inline-block;        /* Safari needs this to honour break-inside */
      width:100%;
      margin:0 0 18px;
    }
    /* Let a card ask for the full width when its content genuinely needs it. */
    .grid2 > .card.full { column-span:all; }

    @media (max-width:700px) { .grid2 { column-width:auto; column-count:1; } }

    .fld { background:var(--shell-2); border:1px solid var(--seam); border-radius:9px; color:var(--cream);
           font-family:'Space Grotesk',sans-serif; font-size:14px; padding:10px 13px; width:100%; }
    .fld:focus { outline:none; border-color:var(--sun); box-shadow:0 0 0 3px rgba(255,177,0,.14); }
    .fld::placeholder { color:var(--faint); }
    textarea.fld { min-height:170px; resize:vertical; font-family:'JetBrains Mono',monospace; font-size:12.5px; line-height:1.55; }
    label.lbl { display:block; font-size:10.5px; letter-spacing:.14em; color:var(--dim); text-transform:uppercase;
                margin-bottom:6px; font-weight:700; }

    .btn { background:var(--shell-2); color:var(--cream); border:1px solid var(--seam); border-radius:22px;
           padding:8px 16px; font-size:13px; font-weight:700; cursor:pointer;
           font-family:'Space Grotesk',sans-serif; transition:.12s; white-space:nowrap; }
    .btn:hover { border-color:var(--sun); color:var(--sun); }
    .btn.gold { background:var(--sun); color:#241a08; border-color:var(--sun); }
    .btn.gold:hover { background:var(--atomic); border-color:var(--atomic); color:#fff6ec; }
    .btn.bad { border-color:#6b2a2a; color:var(--coral); }
    .btn.bad:hover { background:#2c1414; border-color:var(--coral); }
    .btn.ok { border-color:#1e6b62; color:var(--turq); }
    .btn.ok:hover { background:#0f2b28; border-color:var(--turq); }

    .bar { display:flex; gap:10px; align-items:center; margin-bottom:16px; flex-wrap:wrap; }
    .note { font-size:12.5px; font-weight:700; }
    .note.good { color:var(--turq); } .note.bad { color:var(--coral); } .note.busy { color:var(--faint); }
    .hint { color:var(--faint); font-size:12.5px; line-height:1.6; }

    .roster { width:100%; border-collapse:collapse; background:var(--shell); border:1px solid var(--seam); border-radius:16px; overflow:hidden; }
    .roster th.sortable { cursor:pointer; user-select:none; transition:.12s; }
    .roster th.sortable:hover { color:var(--sun); background:#221b16; }
    .roster th.on { color:var(--sun); }
    .sort-x { opacity:.28; margin-left:6px; font-size:9px; }
    .roster th.sortable:hover .sort-x { opacity:.7; }
    .sort-on { color:var(--sun); margin-left:6px; font-size:10px; }
    .roster th { text-align:left; padding:12px 14px; font-size:10.5px; letter-spacing:.15em; color:var(--faint);
                 text-transform:uppercase; background:var(--shell-2); border-bottom:2px solid var(--seam);
                 white-space:nowrap; font-weight:700; }
    .roster td { padding:11px 14px; font-size:14px; border-bottom:1px solid #2a221c; vertical-align:middle; }
    .roster tr:last-child td { border-bottom:none; }
    .roster tr.in { background:rgba(46,196,182,.06); }
    .roster tr.in td:first-child { box-shadow:inset 3px 0 0 var(--turq); }
    .yes { color:var(--turq); font-weight:700; font-size:12px; letter-spacing:.1em; }
    .no { color:var(--faint); font-size:12px; }
    .sent-check { width:15px; height:15px; accent-color:var(--turq); cursor:pointer; }
    .edit-input { background:var(--shell-2); border:1px solid var(--sun); border-radius:7px; color:var(--cream);
                  font-family:'Space Grotesk',sans-serif; font-size:13.5px; padding:6px 9px; width:100%; }

    .flag { background:#33220c; border:1px solid #7a5410; color:var(--sun); border-radius:12px;
            padding:12px 16px; margin-bottom:18px; font-size:13px; }
    .foot { color:var(--faint); font-size:11.5px; margin-top:20px; letter-spacing:.1em; font-family:'JetBrains Mono',monospace; }
    .chip { display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid #2a221c; }
    .chip:last-child { border-bottom:none; }
    .chip code { color:var(--faint); font-family:'JetBrains Mono',monospace; font-size:12px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="masthead">
      <a class="mark" href="/">TRKT</a>
      <span class="crumb">✦</span>
      <span class="evt" id="eventNameText">…</span>
    </div>
    <div class="whisper" id="modeLine">live check-in desk</div>

    <div class="tabs">
      <button class="tab on" data-view="door" onclick="showView('door')">The Door</button>
      <button class="tab" data-view="settings" onclick="showView('settings')">Settings</button>
      <button class="tab" data-view="design" onclick="showView('design')">Ticket Design</button>
      <button class="tab" data-view="data" onclick="showView('data')">Data &amp; Access</button>
    </div>

    <!-- ============ THE DOOR ============ -->
    <div class="view on" id="view-door">
      <div id="dupe-warning" class="flag" style="display:none;"></div>

      <div class="stat-strip">
        <div class="stat"><b id="checkedInNum">–</b><span>checked in</span></div>
        <div class="stat"><b id="totalNum">–</b><span>on the list</span></div>
      </div>

      <div class="bar">
        <select id="search-field" class="fld" onchange="onSearchFieldChange()" style="flex:0 0 auto; width:auto; min-width:130px;">
          <option value="">All fields</option>
        </select>
        <input id="guest-search" class="fld" placeholder="Search name, seat, badge, any field…" oninput="render(lastData)" style="flex:1; min-width:200px;">
        <label id="exact-wrap" style="display:none; align-items:center; gap:6px; font-size:12.5px; color:var(--dim); cursor:pointer; white-space:nowrap;">
          <input type="checkbox" id="search-exact" onchange="render(lastData)" style="accent-color:var(--turq); cursor:pointer;">
          Exact
        </label>
        <span id="search-count" class="note busy"></span>
      </div>

      <div class="card" style="padding:18px;">
        <div id="add-form" style="display:grid; gap:12px; align-items:end;"></div>
      </div>

      <div style="overflow-x:auto;">
        <table class="roster" style="min-width:max-content;">
          <thead><tr id="table-head"></tr></thead>
          <tbody id="rows"></tbody>
        </table>
      </div>
      <div class="foot" id="updated"></div>
    </div>

    <!-- ============ SETTINGS ============ -->
    <div class="view" id="view-settings">
      <div class="grid2">
        <div class="card">
          <h4>Identity</h4>
          <div class="sub">Text shown on every ticket. Never touches ticket links.</div>
          <label class="lbl">Event name</label><input id="ev-name" class="fld">
          <label class="lbl" style="margin-top:13px;">Subtitle</label><input id="ev-subtitle" class="fld">
          <label class="lbl" style="margin-top:13px;">Footer</label><input id="ev-footer" class="fld">
          <label class="lbl" style="margin-top:13px;">Default badge</label><input id="ev-badge" class="fld">
          <div class="bar" style="margin:16px 0 0;">
            <button class="btn gold" onclick="saveEventText()">Save identity</button>
            <span id="ev-details-status" class="note good"></span>
          </div>
        </div>

        <div class="card">
          <h4>When &amp; Where</h4>
          <div class="sub">One date and venue for the whole event.</div>
          <label class="lbl">Date</label><input id="event-date" class="fld" placeholder="18th July, 2026">
          <label class="lbl" style="margin-top:13px;">Venue</label><input id="event-venue" class="fld" placeholder="Cadet College Club">
          <div class="bar" style="margin:16px 0 0;">
            <button class="btn gold" onclick="saveEventDetails()">Save</button>
            <span id="event-details-status" class="note good"></span>
          </div>
          <div id="checkin-time-box" style="display:none; margin-top:20px; padding-top:18px; border-top:1px dashed var(--seam);">
            <h4 style="font-size:12px;">Check-in Window</h4>
            <div class="sub">Shown on tickets.</div>
            <div style="display:flex; gap:10px;">
              <div style="flex:1;"><label class="lbl">From</label><input id="checkin-start" class="fld"></div>
              <div style="flex:1;"><label class="lbl">Until</label><input id="checkin-end" class="fld"></div>
            </div>
            <div class="bar" style="margin:14px 0 0;">
              <button class="btn" onclick="saveCheckinTime()">Save window</button>
              <span id="checkin-time-status" class="note good"></span>
            </div>
          </div>
        </div>

        <div class="card">
          <h4>Custom Fields</h4>
          <div class="sub">Extra data per guest. Usable in your ticket template.</div>
          <div id="field-list" style="margin-bottom:14px;"></div>
          <label class="lbl">New field</label>
          <div style="display:flex; gap:9px;">
            <input id="new-field-name" class="fld" placeholder="Meal Preference">
            <button class="btn" onclick="addField()">Add</button>
          </div>
          <div id="field-status" class="note good" style="margin-top:9px;"></div>
          <div class="hint" style="margin-top:9px;">"Meal Preference" becomes {{meal_preference}}.</div>
        </div>

        <div class="card">
          <h4 style="color:var(--coral);">Danger Zone</h4>
          <div class="sub">Deletes the event, every guest, and all check-in history. Cannot be undone.</div>
          <button class="btn bad" onclick="deleteEvent()">Delete this event</button>
        </div>
      </div>
    </div>

    <!-- ============ TICKET DESIGN ============ -->
    <div class="view" id="view-design">
      <div class="card">
        <h4>Theme</h4>
        <div class="sub">Colours for the built-in ticket design.</div>
        <div id="theme-note" class="hint" style="color:var(--sun); display:none; margin-bottom:14px;">This event uses a custom HTML/CSS template, so theme colours are ignored.</div>
        <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:14px;">
          <div><label class="lbl">Accent</label><input type="color" id="th-accent" class="fld" style="height:44px; padding:4px;"></div>
          <div><label class="lbl">Card</label><input type="color" id="th-card" class="fld" style="height:44px; padding:4px;"></div>
          <div><label class="lbl">Background</label><input type="color" id="th-background" class="fld" style="height:44px; padding:4px;"></div>
          <div><label class="lbl">Border</label><input type="color" id="th-border" class="fld" style="height:44px; padding:4px;"></div>
        </div>
        <div style="margin-top:18px; display:flex; align-items:center; gap:14px; flex-wrap:wrap;">
          <label style="cursor:pointer; font-weight:700; font-size:13.5px;"><input type="checkbox" id="th-showWave"> Animated wave</label>
          <input type="color" id="th-waveColor" class="fld" style="width:100px; height:36px; padding:4px;">
        </div>
        <div class="bar" style="margin:18px 0 0;">
          <button class="btn gold" onclick="saveTheme()">Save theme</button>
          <button class="btn" onclick="previewTheme()">Save &amp; preview</button>
          <span id="theme-status" class="note good"></span>
        </div>
      </div>

      <div class="card">
        <h4>Custom HTML &amp; CSS</h4>
        <div class="sub">Write the ticket yourself. Leave blank to use the built-in design above.</div>

        <div style="background:var(--shell-2); border:1px solid var(--seam); border-radius:10px; padding:14px 16px; margin:14px 0 18px;">
          <div style="font-weight:700; font-size:13px; margin-bottom:6px;">How this works</div>
          <div style="font-size:12.5px; color:var(--faint); line-height:1.6; margin-bottom:10px;">
            The HTML box below is just the ticket's content — no <code>&lt;html&gt;</code>, <code>&lt;head&gt;</code>, or <code>&lt;body&gt;</code> tags, TRKT wraps those for you automatically. The CSS box goes straight into a <code>&lt;style&gt;</code> tag. Anywhere in either box you write one of the tags below, it gets swapped for that specific guest's real data the moment their ticket opens — this list updates automatically if you add or remove a custom field.
          </div>
          <div id="tpl-tokens" style="display:flex; flex-wrap:wrap; gap:6px;"></div>
          <div class="bar" style="margin-top:14px;">
            <button class="btn" onclick="copyAiPrompt(this)">Copy AI design prompt</button>
          </div>
          <div style="font-size:11.5px; color:var(--faint); margin-top:8px;">
            Paste that into Claude, ChatGPT, or whatever you use — it explains the exact rules above plus every tag for this event, so you can just describe the vibe you want and paste back whatever HTML/CSS it gives you.
          </div>
        </div>

        <label class="lbl">HTML</label>
        <textarea id="tpl-html" class="fld" placeholder="{{name}} {{seat}} {{date}} {{venue}} {{badge}} {{checkinWindow}} {{eventName}} {{eventSubtitle}} {{footer}} {{ticketId}} {{qrImage}}">${escapeHtml(config.customTemplate?.html || "")}</textarea>
        <label class="lbl" style="margin-top:14px;">CSS</label>
        <textarea id="tpl-css" class="fld">${escapeHtml(config.customTemplate?.css || "")}</textarea>
        <div class="bar" style="margin:16px 0 0;">
          <button class="btn gold" onclick="saveTemplate()">Save design</button>
          <button class="btn" onclick="previewTemplate()">Save &amp; preview</button>
          <span id="tpl-status" class="note good"></span>
        </div>
      </div>
    </div>

    <!-- ============ DATA & ACCESS ============ -->
    <div class="view" id="view-data">
      <div class="grid2">
        <div class="card">
          <h4>Export</h4>
          <div class="sub">Full guest list with attendance and every custom field.</div>
          <button class="btn gold" onclick="window.location.href='/export?event=' + encodeURIComponent(SLUG)">Download CSV ↓</button>
        </div>

        <div class="card">
          <h4>Bulk Add</h4>
          <div class="sub">Append another CSV. Existing guests are never touched.</div>
          <input type="file" id="bulk-csv" accept=".csv" class="fld" style="padding:9px;">
          <div class="bar" style="margin:14px 0 0;">
            <button class="btn gold" onclick="bulkAdd()">Append guests</button>
            <span id="bulk-status" class="note good"></span>
          </div>
          <div class="hint" style="margin-top:9px;">Header row required; only <b style="color:var(--cream);">Name</b> is mandatory.</div>
        </div>

        <div class="card">
          <h4>Arrivals</h4>
          <div class="sub">When people actually turned up, in your local time.</div>
          <button class="btn" onclick="loadArrivals()">Plot arrivals</button>
          <div id="arrivals-out" style="margin-top:14px;"></div>
        </div>

        <div class="card">
          <h4>Dashboard Password</h4>
          <div class="sub">${config.passwordHash ? "Protected." : "Currently open."} Controls who can manage this event — edit guests, change the design, delete it. Keep this one to yourself.</div>
          <label class="lbl">${config.passwordHash ? "Change password" : "Set a password"}</label>
          <input id="new-password" type="text" class="fld" placeholder="Type a new password">
          <div class="hint" style="margin-top:9px;">To remove the password completely, leave this box empty and press Save.</div>
          <div class="bar" style="margin:15px 0 0;">
            <button class="btn gold" onclick="setPassword()">Save dashboard password</button>
          </div>
        </div>

        <div class="card">
          <h4>Scanner Password</h4>
          <div class="sub">${config.scanHash ? "Protected." : "Currently open."} Give this to door staff. It lets a phone check guests in — and nothing else. It cannot open this dashboard.</div>
          <label class="lbl">${config.scanHash ? "Change scanner password" : "Set a scanner password"}</label>
          <input id="scan-password" type="text" class="fld" placeholder="Type a new scanner password">
          <div class="hint" style="margin-top:9px;">To remove it completely, leave this box empty and press Save — then <em>any</em> phone that scans a ticket can check people in.</div>
          ${config.scanHash ? "" : '<div class="hint" style="margin-top:10px; color:var(--sun); font-weight:700;">No scanner password set — any phone can check people in right now.</div>'}
          <div class="bar" style="margin:15px 0 0;">
            <button class="btn gold" onclick="setScanPassword()">Save scanner password</button>
            <button class="btn ok" onclick="window.open('/scan?event=' + encodeURIComponent(SLUG), '_blank')">Open scanner ↗</button>
          </div>
        </div>
    </div>
  </div>

  <script>
    const SLUG = ${JSON.stringify(slug)};
    let lastData = null;
    let editingId = null;
    let eventDetailsInitialized = false;

    // Escape guest-controlled text before it goes anywhere near innerHTML.
    // Guest names/seats/badges/custom values come from an uploaded CSV, which is
    // untrusted input — without this, a guest row like
    //   <img src=x onerror="...">
    // executes in the ORGANISER's session, which holds full management auth.
    function esc(s) {
      return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    // Tabs replace the old nested drop-downs: one click to any area, and the
    // door stays uncluttered by settings you only touch once.
    function showView(name) {
      document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === 'view-' + name));
      document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.view === name));
    }

    function customFields() { return (lastData && lastData.customFields) || []; }
    function hiddenBuiltins() { return (lastData && lastData.hiddenBuiltins) || []; }
    function seatShown() { return !hiddenBuiltins().includes('seat'); }
    function badgeShown() { return !hiddenBuiltins().includes('badge'); }

    let addFormSignature = null;

    function buildAddForm() {
      const fields = customFields();
      // Signature includes hidden built-ins so the form rebuilds if they change.
      const signature = 's' + seatShown() + 'b' + badgeShown() + ':' + fields.map(f => f.key).join(',');
      if (signature === addFormSignature && document.getElementById('add-name')) return;

      // Preserve whatever the user has already typed across a structural rebuild.
      const preserved = {};
      const form = document.getElementById('add-form');
      form.querySelectorAll('input').forEach(inp => { preserved[inp.id] = inp.value; });

      // Inputs carry the same classes as the inline edit row, so adding and
      // editing a guest look and feel identical.
      let html = '<div><label class="lbl">Name</label><input id="add-name" class="fld"></div>';
      if (seatShown()) html += '<div><label class="lbl">Seat</label><input id="add-seat" class="fld"></div>';
      if (badgeShown()) html += '<div><label class="lbl">Badge</label><input id="add-badge" class="fld"></div>';
      for (const f of fields) {
        html += '<div><label class="lbl">' + esc(f.label) + '</label><input id="add-custom-' + esc(f.key) + '" class="fld"></div>';
      }
      html += '<button class="btn gold" onclick="addGuest()">+ Add guest</button>';
      form.style.gridTemplateColumns = 'repeat(auto-fit, minmax(150px, 1fr))';
      form.innerHTML = html;
      addFormSignature = signature;

      Object.entries(preserved).forEach(([id, val]) => {
        const el = document.getElementById(id);
        if (el) el.value = val;
      });
    }

    // Sorting is display-only — it reorders the array already in the browser.
    // Nothing is written to KV, no ticket IDs change, live links are untouched.
    let sortKey = null;      // null = default order (checked-in first, then name)
    let sortDir = 1;         // 1 asc, -1 desc

    function sortBy(key) {
      if (sortKey === key) { sortDir = -sortDir; }
      else { sortKey = key; sortDir = 1; }
      render(lastData);
    }

    function sortArrow(key) {
      if (sortKey !== key) return '<span class="sort-x">↕</span>';
      return '<span class="sort-on">' + (sortDir === 1 ? '↑' : '↓') + '</span>';
    }

    function th(label, key) {
      return '<th class="sortable' + (sortKey === key ? ' on' : '') +
             '" onclick="sortBy(' + JSON.stringify(key).replace(/"/g, '&quot;') + ')">' +
             esc(label) + sortArrow(key) + '</th>';
    }

    function buildTableHead() {
      const fields = customFields();
      let html = '<th title="Tick once you have sent this guest their ticket link">Sent</th>' + th('Guest', 'name');
      if (seatShown()) html += th('Seat', 'seat');
      if (badgeShown()) html += th('Badge', 'badge');
      for (const f of fields) html += th(f.label, 'custom:' + f.key);
      html += th('Status', 'attended') + th('Time', 'checkinAt') +
              '<th>Link</th><th>Actions</th>';
      document.getElementById('table-head').innerHTML = html;
    }

    // "Table 10" must not sort before "Table 2", and "Batch 36 · Deck" should
    // order by the number. Compare numerically when both values look numeric,
    // otherwise fall back to a natural (numeric-aware) string compare.
    function cmpValues(a, b) {
      const na = parseFloat(a), nb = parseFloat(b);
      const aNum = a !== '' && !isNaN(na) && /^\s*-?[\d.]+\s*$/.test(String(a));
      const bNum = b !== '' && !isNaN(nb) && /^\s*-?[\d.]+\s*$/.test(String(b));
      if (aNum && bNum) return na - nb;
      if (a === '' && b !== '') return 1;   // blanks always last
      if (b === '' && a !== '') return -1;
      return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
    }

    function valueFor(g, key) {
      if (key === 'attended') return g.attended ? 1 : 0;
      if (key === 'checkinAt') return g.checkinAt || 0;
      if (key && key.indexOf('custom:') === 0) {
        return (g.custom && g.custom[key.slice(7)]) || '';
      }
      return g[key] == null ? '' : g[key];
    }

    function applySort(list) {
      if (!sortKey) return list;   // server order: checked-in first, then name
      return [...list].sort((a, b) => {
        const r = cmpValues(valueFor(a, sortKey), valueFor(b, sortKey));
        return r * sortDir || String(a.name).localeCompare(String(b.name));
      });
    }

    // The dropdown mirrors whatever columns this event actually has, so it
    // stays right when custom fields are added or removed. Rebuilt only when
    // the field set changes, so it never resets your choice mid-typing.
    let searchFieldSig = null;

    function buildSearchFields() {
      const fields = customFields();
      const sig = 's' + seatShown() + 'b' + badgeShown() + ':' + fields.map(f => f.key).join(',');
      if (sig === searchFieldSig) return;

      const sel = document.getElementById('search-field');
      const keep = sel.value;
      let html = '<option value="">All fields</option><option value="name">Guest</option>';
      if (seatShown()) html += '<option value="seat">Seat</option>';
      if (badgeShown()) html += '<option value="badge">Badge</option>';
      for (const f of fields) {
        html += '<option value="custom:' + esc(f.key) + '">' + esc(f.label) + '</option>';
      }
      sel.innerHTML = html;
      // restore the previous selection if it still exists
      if (keep && sel.querySelector('option[value="' + keep.replace(/"/g, '\\"') + '"]')) sel.value = keep;
      searchFieldSig = sig;
      syncSearchUi();
    }

    function syncSearchUi() {
      const sel = document.getElementById('search-field');
      const box = document.getElementById('guest-search');
      const exact = document.getElementById('exact-wrap');
      const label = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : '';
      box.placeholder = sel.value ? ('Search ' + label + '…') : 'Search name, seat, badge, any field…';
      // "Exact" only means something once you've picked a single field
      exact.style.display = sel.value ? 'flex' : 'none';
    }

    function onSearchFieldChange() {
      syncSearchUi();
      render(lastData);
    }

    function buildFieldList() {
      const fields = customFields();
      const list = document.getElementById('field-list');
      if (!fields.length) { list.innerHTML = '<span class="hint">No custom fields yet.</span>'; return; }
      list.innerHTML = fields.map(f =>
        '<div class="chip">' +
        '<span>' + esc(f.label) + ' <code>{{' + esc(f.key) + '}}</code></span>' +
        '<button class="btn bad" onclick="removeField(\\'' + f.key + '\\')">remove</button>' +
        '</div>'
      ).join('');
    }

    async function api(path, body) {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event: SLUG, ...body }),
      });
      return res.json();
    }

    async function refresh() {
      try {
        const res = await fetch('/dashboard-data?event=' + encodeURIComponent(SLUG));
        const data = await res.json();
        if (data.error) { document.getElementById('eventNameText').textContent = 'Unknown event'; return; }
        lastData = data;
        if (editingId === null) render(data);
      } catch (e) {
        document.getElementById('updated').textContent = 'Refresh failed, retrying...';
      }
    }

    function render(data) {
      document.getElementById('eventNameText').textContent = data.eventName;
      document.getElementById('checkedInNum').textContent = data.checkedIn;
      document.getElementById('totalNum').textContent = data.total;
      const modeEl = document.getElementById('modeLine');
      if (modeEl) modeEl.textContent = data.checkinMode === 'highConcurrency'
        ? 'live check-in desk · high-concurrency mode · safe for many scanners at once'
        : 'live check-in desk · standard mode · best with one scanner';

      // Populate the event-level date/venue inputs ONCE, on first load. After
      // that the box belongs to the user — the 5s refresh must never rewrite it,
      // or in-progress (or clicked-away-but-unsaved) text gets stomped. They're
      // re-synced explicitly after a successful Save instead.
      if (!eventDetailsInitialized) {
        document.getElementById('event-date').value = data.eventDate || '';
        document.getElementById('event-venue').value = data.eventVenue || '';
        document.getElementById('ev-name').value = data.eventName || '';
        document.getElementById('ev-subtitle').value = data.eventSubtitle || '';
        document.getElementById('ev-footer').value = data.eventFooter || '';
        document.getElementById('ev-badge').value = data.eventDefaultBadge || '';
        // Only surface the check-in time editor if this event was created to
        // show a check-in window. If not, the box stays hidden — there's simply
        // no check-in time to edit.
        if (data.showCheckinWindow) {
          document.getElementById('checkin-time-box').style.display = '';
          document.getElementById('checkin-start').value = data.checkinStart || '';
          document.getElementById('checkin-end').value = data.checkinEnd || '';
        }
        // Theme controls, populated once so the refresh never stomps a colour
        // the user is mid-way through picking.
        const t = data.theme || {};
        document.getElementById('th-accent').value = t.accent || '#e6a93d';
        document.getElementById('th-card').value = t.card || '#101828';
        document.getElementById('th-background').value = t.background || '#0a0e1a';
        document.getElementById('th-border').value = t.border || '#2a3550';
        document.getElementById('th-showWave').checked = !!t.showWave;
        document.getElementById('th-waveColor').value = t.waveColor || '#e6a93d';
        if (data.hasCustomTemplate) document.getElementById('theme-note').style.display = '';
        eventDetailsInitialized = true;
      }

      buildAddForm();
      buildTableHead();
      buildFieldList();
      buildSearchFields();
      buildTplTokens();

      const fields = customFields();
      const origin = window.location.origin;
      // Duplicate-name warning (flag only, never blocks).
      const dupeEl = document.getElementById('dupe-warning');
      const dupes = data.duplicateNames || [];
      if (dupes.length) {
        dupeEl.style.display = '';
        dupeEl.innerHTML = '⚠ ' + dupes.length + ' duplicated name' + (dupes.length > 1 ? 's' : '') +
          ' — possibly the same CSV uploaded twice: ' +
          dupes.slice(0, 5).map(d => esc(d.name) + ' ×' + d.count).join(', ') +
          (dupes.length > 5 ? ', …' : '');
      } else {
        dupeEl.style.display = 'none';
      }

      // Search filter — matches name, seat, badge, or any custom field value.
      const q = (document.getElementById('guest-search').value || '').trim().toLowerCase();
      const field = document.getElementById('search-field').value;
      const exact = document.getElementById('search-exact').checked;

      const visible = !q ? data.guests : data.guests.filter(g => {
        // One field chosen: match against that field only.
        if (field) {
          const v = String(valueFor(g, field) ?? '').toLowerCase();
          // Exact stops "2" from also matching table 12, 20, 21...
          return exact ? v === q : v.includes(q);
        }
        // "All fields": the original behaviour, unchanged.
        if ((g.name || '').toLowerCase().includes(q)) return true;
        if ((g.seat || '').toLowerCase().includes(q)) return true;
        if ((g.badge || '').toLowerCase().includes(q)) return true;
        for (const f of fields) {
          const v = (g.custom && g.custom[f.key]) || '';
          if (String(v).toLowerCase().includes(q)) return true;
        }
        return false;
      });
      document.getElementById('search-count').textContent =
        q ? (visible.length + ' of ' + data.guests.length + ' shown') : '';

      const rows = applySort(visible).map(g => {
        const link = origin + '/ticket?event=' + encodeURIComponent(SLUG) + '&id=' + g.id;
        let customCells = '';
        for (const f of fields) {
          const val = (g.custom && g.custom[f.key]) || '';
          customCells += '<td class="c-custom-' + esc(f.key) + '">' + esc(val) + '</td>';
        }
        return \`
        <tr class="\${g.attended ? 'in' : ''}" data-id="\${esc(g.id)}">
          <td><input type="checkbox" class="sent-check" \${isSent(g.id) ? 'checked' : ''} onchange="toggleLinkSent('\${g.id}', this.checked)" title="Link sent"></td>
          <td class="c-name">\${esc(g.name)}</td>
          <td class="c-seat">\${esc(g.seat)}</td>
          <td class="c-badge">\${esc(g.badge || '')}</td>
          \${customCells}
          <td class="\${g.attended ? 'yes' : 'no'}">\${g.attended ? 'IN' : '—'}</td>
          <td>\${g.checkinAt ? esc(new Date(g.checkinAt).toLocaleTimeString()) : esc(g.checkinTime || '')}</td>
          <td><button class="btn" onclick="copyLink('\${link}', this)">link</button></td>
          <td>
            <button class="btn" onclick="startEdit('\${g.id}')">edit</button>
            <button class="btn bad" onclick="removeGuest('\${g.id}')">remove</button>
            \${g.attended
              ? '<button class="btn" onclick="undoCheckin(\\'' + g.id + '\\')">undo</button>'
              : '<button class="btn ok" onclick="manualCheckin(\\'' + g.id + '\\')">check in</button>'}
          </td>
        </tr>\`;
      }).join('');
      document.getElementById('rows').innerHTML = rows;
      document.getElementById('updated').textContent = '// synced ' + new Date().toLocaleTimeString();
    }

    function copyLink(link, btn) {
      navigator.clipboard.writeText(link);
      const original = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = original; }, 1200);
    }

    async function addGuest() {
      const name = document.getElementById('add-name').value.trim();
      if (!name) return;
      const custom = {};
      for (const f of customFields()) {
        custom[f.key] = document.getElementById('add-custom-' + f.key).value.trim();
      }
      await api('/api/add-guest', {
        name,
        seat: document.getElementById('add-seat').value.trim(),
        badge: document.getElementById('add-badge').value.trim(),
        custom,
      });
      // Clear the form after a successful add.
      document.getElementById('add-form').querySelectorAll('input').forEach(inp => { inp.value = ''; });
      refresh();
    }

    async function removeGuest(id) {
      if (!confirm('Remove this guest permanently?')) return;
      await api('/api/remove-guest', { id });
      refresh();
    }

    // Bookkeeping only — "have I personally sent this guest their link yet".
    // Lives entirely in this browser's localStorage, keyed per event, so it
    // costs zero KV reads/writes/lists no matter the guest count, and still
    // survives a page refresh. Trade-off: it's local to this device/browser —
    // it won't show up if you (or a co-organiser) open the dashboard on a
    // different device. That's fine for a personal "did I send this" tick;
    // if you ever need it shared across devices, it'd need to go back to KV.
    function sentStorageKey() { return 'trkt_sent_' + SLUG; }
    function getSentMap() {
      try { return JSON.parse(localStorage.getItem(sentStorageKey()) || '{}'); }
      catch { return {}; }
    }
    function isSent(id) { return !!getSentMap()[id]; }
    function toggleLinkSent(id, checked) {
      const map = getSentMap();
      if (checked) map[id] = true; else delete map[id];
      try { localStorage.setItem(sentStorageKey(), JSON.stringify(map)); } catch {}
      if (lastData) {
        const g = lastData.guests.find(x => x.id === id);
        if (g) g.linkSent = checked;
      }
    }

    async function undoCheckin(id) {
      await api('/api/uncheck-guest', { id });
      refresh();
    }

    async function manualCheckin(id) {
      await api('/api/check-guest', { id });
      refresh();
    }

    async function addField() {
      const label = document.getElementById('new-field-name').value.trim();
      if (!label) return;
      const status = document.getElementById('field-status');
      const data = await api('/api/add-field', { label });
      if (data.error) { status.style.color = '#f87171'; status.textContent = data.error; return; }
      status.style.color = '#4ade80';
      status.textContent = 'Added field. Use ' + data.placeholder + ' in your ticket template.';
      document.getElementById('new-field-name').value = '';
      refresh();
    }

    async function removeField(key) {
      if (!confirm('Remove the field "' + key + '" from this event and all guests?')) return;
      await api('/api/remove-field', { key });
      refresh();
    }

    // CSV parsing for bulk add — same logic as the /new page, kept in sync.
    function parseCsv(text) {
      const rows = [];
      let row = [], field = "", inQuotes = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
          if (c === '"') {
            if (text[i + 1] === '"') { field += '"'; i++; }
            else inQuotes = false;
          } else field += c;
        } else {
          if (c === '"') inQuotes = true;
          else if (c === ',') { row.push(field); field = ""; }
          else if (c === '\\n' || c === '\\r') {
            if (field !== "" || row.length > 0) { row.push(field); rows.push(row); row = []; field = ""; }
            if (c === '\\r' && text[i + 1] === '\\n') i++;
          } else field += c;
        }
      }
      if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
      return rows;
    }

    function slugifyFieldClient(label) {
      return String(label || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    }

    function csvToGuests(text) {
      const rows = parseCsv(text).filter(r => r.some(c => c.trim() !== ""));
      if (!rows.length) return [];
      const rawHeaders = rows[0].map(h => h.trim());
      const std = ['name', 'seat', 'date', 'venue', 'badge'];
      return rows.slice(1).map(r => {
        const g = { custom: {} };
        rawHeaders.forEach((h, i) => {
          const val = (r[i] || "").trim();
          const lower = h.toLowerCase();
          if (std.includes(lower)) g[lower] = val;
          else if (h) {
            const key = slugifyFieldClient(h);
            if (key) g.custom[key] = { label: h, value: val };
          }
        });
        return g;
      }).filter(g => g.name);
    }

    function themePayload() {
      return {
        accent: document.getElementById('th-accent').value,
        card: document.getElementById('th-card').value,
        background: document.getElementById('th-background').value,
        border: document.getElementById('th-border').value,
        showWave: document.getElementById('th-showWave').checked,
        waveColor: document.getElementById('th-waveColor').value,
      };
    }

    async function saveTheme() {
      const status = document.getElementById('theme-status');
      status.style.color = '#94a3b8';
      status.textContent = 'Saving...';
      const data = await api('/api/edit-event', { theme: themePayload() });
      if (data.error) { status.style.color = '#f87171'; status.textContent = data.error; return false; }
      status.style.color = '#4ade80';
      status.textContent = 'Theme saved.';
      setTimeout(() => { status.textContent = ''; }, 4000);
      return true;
    }

    async function previewTheme() {
      if (!lastData || !lastData.guests.length) { alert('No guests to preview with yet.'); return; }
      const id = lastData.guests[0].id;
      const url = '/ticket?event=' + encodeURIComponent(SLUG) + '&id=' + id + '&t=' + Date.now();
      const win = window.open('about:blank', '_blank');
      const ok = await saveTheme();
      if (!ok) { if (win) win.close(); return; }
      if (win) win.location = url; else window.open(url, '_blank');
    }

    async function bulkAdd() {
      const status = document.getElementById('bulk-status');
      const input = document.getElementById('bulk-csv');
      if (!input.files.length) { status.style.color = '#f87171'; status.textContent = 'Choose a CSV first.'; return; }
      status.style.color = '#94a3b8';
      status.textContent = 'Reading CSV...';
      const text = await input.files[0].text();
      const guests = csvToGuests(text);
      if (!guests.length) { status.style.color = '#f87171'; status.textContent = 'No guest rows found (needs a header row with a Name column).'; return; }
      status.textContent = 'Adding ' + guests.length + ' guests...';
      const data = await api('/api/bulk-add-guests', { guests });
      if (data.error) { status.style.color = '#f87171'; status.textContent = data.error; return; }
      status.style.color = '#4ade80';
      status.textContent = 'Added ' + data.added + ' guests.';
      input.value = '';
      addFormSignature = null; // field structure may have changed
      refresh();
    }

    async function loadArrivals() {
      const out = document.getElementById('arrivals-out');
      out.textContent = 'reading the door log…';
      try {
        const res = await fetch('/arrivals?event=' + encodeURIComponent(SLUG));
        const data = await res.json();
        if (data.error) { out.textContent = data.error; return; }
        if (!data.times || !data.times.length) {
          out.innerHTML = '<span class="hint">Nobody has checked in yet.' +
            (data.legacyUndated ? ' (' + data.legacyUndated + ' older check-in(s) have no usable timestamp.)' : '') + '</span>';
          return;
        }
        // Bucket into 15-minute windows IN THE VIEWER'S OWN TIMEZONE. The server
        // only ever sends epoch numbers — it has no idea what clock we're on.
        const buckets = {};
        for (const ms of data.times) {
          const d = new Date(ms);
          const h = String(d.getHours()).padStart(2, '0');
          const m = String(Math.floor(d.getMinutes() / 15) * 15).padStart(2, '0');
          const k = h + ':' + m;
          buckets[k] = (buckets[k] || 0) + 1;
        }
        const rows = Object.entries(buckets).sort((a, b) => a[0].localeCompare(b[0]));
        const max = Math.max(...rows.map(r => r[1]));
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'your local time';
        out.innerHTML =
          '<div class="hint" style="margin-bottom:9px;">' + data.totalCheckedIn + ' checked in · 15-minute windows · ' + esc(tz) +
          (data.legacyUndated ? ' · ' + data.legacyUndated + ' older record(s) skipped (no timestamp)' : '') + '</div>' +
          rows.map(([time, count]) => {
            const w = Math.round((count / max) * 100);
            return '<div style="display:flex; align-items:center; gap:9px; margin-bottom:3px;">' +
              '<span style="width:44px; color:var(--ink-dim);">' + esc(time) + '</span>' +
              '<span style="flex:1; background:var(--panel-2); border-radius:3px; overflow:hidden;">' +
                '<span style="display:block; height:13px; width:' + w + '%; background:var(--amber); opacity:.85;"></span>' +
              '</span>' +
              '<span style="width:28px; text-align:right;">' + count + '</span>' +
            '</div>';
          }).join('');
      } catch (e) {
        out.textContent = 'could not load arrivals.';
      }
    }

    async function saveCheckinTime() {
      const status = document.getElementById('checkin-time-status');
      status.style.color = '#94a3b8';
      status.textContent = 'Saving...';
      const data = await api('/api/edit-event', {
        checkinStart: document.getElementById('checkin-start').value.trim(),
        checkinEnd: document.getElementById('checkin-end').value.trim(),
      });
      if (data.error) { status.style.color = '#f87171'; status.textContent = data.error; return; }
      status.style.color = '#4ade80';
      status.textContent = 'Saved. Every ticket updated.';
      setTimeout(() => { status.textContent = ''; }, 4000);
    }

    async function saveEventDetails() {
      const status = document.getElementById('event-details-status');
      status.style.color = '#94a3b8';
      status.textContent = 'Saving...';
      const data = await api('/api/edit-event', {
        date: document.getElementById('event-date').value.trim(),
        venue: document.getElementById('event-venue').value.trim(),
      });
      if (data.error) { status.style.color = '#f87171'; status.textContent = data.error; return; }
      status.style.color = '#4ade80';
      status.textContent = 'Saved — applies to all guests without an override.';
      setTimeout(() => { status.textContent = ''; }, 4000);
      refresh();
    }

    async function saveEventText() {
      const status = document.getElementById('ev-details-status');
      status.style.color = '#94a3b8';
      status.textContent = 'Saving...';
      const data = await api('/api/edit-event', {
        name: document.getElementById('ev-name').value.trim(),
        subtitle: document.getElementById('ev-subtitle').value.trim(),
        footer: document.getElementById('ev-footer').value.trim(),
        defaultBadge: document.getElementById('ev-badge').value.trim(),
      });
      if (data.error) { status.style.color = '#f87171'; status.textContent = data.error; return; }
      status.style.color = '#4ade80';
      status.textContent = 'Saved. Every ticket updated.';
      document.getElementById('eventNameText').textContent = data.name;
      setTimeout(() => { status.textContent = ''; }, 4000);
    }

    async function deleteEvent() {
      const typed = prompt("This permanently deletes the entire event and every guest's check-in status. Type the event slug (" + SLUG + ") to confirm:");
      if (typed !== SLUG) { alert("Slug didn't match. Nothing was deleted."); return; }
      await api('/api/delete-event', {});
      alert("Event deleted.");
      window.location.href = '/';
    }

    async function saveTemplate() {
      const status = document.getElementById('tpl-status');
      status.textContent = 'Saving...';
      status.style.color = '#94a3b8';
      const data = await api('/api/edit-template', {
        templateHtml: document.getElementById('tpl-html').value,
        templateCss: document.getElementById('tpl-css').value,
      });
      if (data.error) { status.textContent = data.error; status.style.color = '#f87171'; return false; }
      status.style.color = '#4ade80';
      status.textContent = data.hasCustomTemplate ? 'Saved. Custom design active.' : 'Saved. Reverted to default design.';
      setTimeout(() => { status.textContent = ''; }, 4000);
      return true;
    }

    async function previewTemplate() {
      if (!lastData || !lastData.guests.length) { alert('No guests to preview with yet.'); return; }
      const id = lastData.guests[0].id;
      const url = '/ticket?event=' + encodeURIComponent(SLUG) + '&id=' + id + '&t=' + Date.now();
      const win = window.open('about:blank', '_blank');
      const ok = await saveTemplate();
      if (!ok) { if (win) win.close(); return; }
      if (win) win.location = url; else window.open(url, '_blank');
    }

    // Fixed tags every event has, regardless of custom fields.
    const TPL_FIXED_TOKENS = [
      ['{{name}}', 'Guest name'], ['{{seat}}', 'Seat'], ['{{badge}}', 'Badge'],
      ['{{date}}', 'Event date'], ['{{venue}}', 'Venue'], ['{{checkinWindow}}', 'Check-in window text'],
      ['{{eventName}}', 'Event name'], ['{{eventSubtitle}}', 'Event subtitle'], ['{{footer}}', 'Event footer'],
      ['{{ticketId}}', 'Ticket ID'], ['{{qrImage}}', 'QR code image URL'],
    ];

    // Renders the token pill list under "How this works" — reruns on every
    // refresh() so it's always accurate to this event's actual custom fields,
    // with no separate save step for the person editing the template.
    function buildTplTokens() {
      const el = document.getElementById('tpl-tokens');
      if (!el) return;
      const pill = (tag, desc) => '<span style="display:inline-flex; align-items:center; gap:5px; background:var(--shell); border:1px solid var(--seam); border-radius:20px; padding:4px 10px; font-size:11.5px;" title="' + esc(desc) + '"><code style="color:var(--sun);">' + esc(tag) + '</code></span>';
      let html = TPL_FIXED_TOKENS.map(([tag, desc]) => pill(tag, desc)).join('');
      for (const f of customFields()) {
        html += pill('{{' + f.key + '}}', f.label + ' (custom field)');
      }
      el.innerHTML = html;
    }

    // Builds a complete, paste-ready brief for an AI tool: explains TRKT's
    // templating rules exactly once, lists every tag valid for THIS event
    // (fixed + whatever custom fields it currently has), and leaves a blank
    // for the person to describe the design they actually want. Saves
    // everyone from re-explaining "here's how my ticket system works" by hand
    // every time they want a new look.
    function copyAiPrompt(btn) {
      const fields = customFields();
      const fixedList = TPL_FIXED_TOKENS.map(([tag, desc]) => tag + ' — ' + desc).join('\\n');
      const customList = fields.length
        ? fields.map((f) => '{{' + f.key + '}} — ' + f.label + ' (custom field)').join('\\n')
        : '(this event has no custom fields yet)';
      const eventName = (lastData && lastData.eventName) || 'my event';

      const prompt = [
        'I\\'m designing a ticket for an event called "' + eventName + '" using TRKT, a QR ticketing tool.',
        '',
        'TRKT renders each guest\\'s ticket by taking an HTML fragment and a CSS block I provide, and inserting them into a page it builds around them. Rules:',
        '- The HTML I give you must be ONLY the ticket content — no <!DOCTYPE>, <html>, <head>, or <body> tags. TRKT wraps those automatically, including the mobile viewport meta tag, so the output is already mobile-responsive by default — just make sure the CSS itself uses responsive units (%, vw, clamp(), flex-wrap) rather than fixed pixel widths.',
        '- The CSS I give you goes directly into a <style> tag in the page\\'s <head> — plain CSS only, no <style> tags of my own, and @import url(...) for Google Fonts works fine there.',
        '- Anywhere in the HTML or CSS I write one of the tags below, TRKT replaces it with that specific guest\\'s real data when their ticket opens. All values are already HTML-escaped, so I don\\'t need to worry about that.',
        '',
        'Fixed tags available on every ticket:',
        fixedList,
        '',
        'Tags for this event\\'s custom fields:',
        customList,
        '',
        'Please design a ticket using this HTML/CSS system. Keep the QR code (' + '{{qrImage}}' + ') clearly visible and a comfortable size to scan on a phone screen, and make sure text doesn\\'t overflow on a narrow screen.',
        '',
        'Here\\'s the design I want: [describe the vibe, colors, theme, or reference style you\\'re going for]',
      ].join('\\n');

      navigator.clipboard.writeText(prompt);
      if (btn) {
        const original = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = original; }, 1200);
      }
    }

    async function setPassword() {
      const newPassword = document.getElementById('new-password').value;
      const data = await api('/api/set-password', { newPassword });
      if (data.error) { alert(data.error); return; }
      alert(data.protected ? 'Password set. This event is now protected.' : 'Password removed. This event is now open.');
      document.getElementById('new-password').value = '';
    }

    async function setScanPassword() {
      const scanPassword = document.getElementById('scan-password').value;
      const data = await api('/api/set-scan-password', { scanPassword });
      if (data.error) { alert(data.error); return; }
      alert(data.protected
        ? 'Scanner password set. Only devices that enter it (via Open scanner) can check people in.'
        : 'Scanner password removed. Any device can now check people in.');
      document.getElementById('scan-password').value = '';
    }

    function startEdit(id) {
      editingId = id;
      const guest = lastData.guests.find(g => g.id === id);
      const row = document.querySelector('tr[data-id="' + id + '"]');
      // (uses the global esc() — the old local one only escaped quotes, which
      // is not enough: a value like "><script> would break out of the attribute)
      row.querySelector('.c-name').innerHTML = '<input class="edit-input" id="edit-name-' + id + '" value="' + esc(guest.name) + '">';
      row.querySelector('.c-seat').innerHTML = '<input class="edit-input" id="edit-seat-' + id + '" value="' + esc(guest.seat) + '">';
      row.querySelector('.c-badge').innerHTML = '<input class="edit-input" id="edit-badge-' + id + '" value="' + esc(guest.badge || '') + '">';
      for (const f of customFields()) {
        const cell = row.querySelector('.c-custom-' + f.key);
        const val = (guest.custom && guest.custom[f.key]) || '';
        if (cell) cell.innerHTML = '<input class="edit-input" id="edit-custom-' + id + '-' + f.key + '" value="' + esc(val) + '">';
      }
      const actionsCell = row.cells[row.cells.length - 1];
      actionsCell.innerHTML =
        '<div style="font-size:9px; color:#4b5871; margin-bottom:3px;">override date/venue for this guest only (blank = use event default)</div>' +
        '<div style="display:flex; gap:6px; margin-bottom:6px;">' +
        '<input class="edit-input" id="edit-date-' + id + '" placeholder="Date override" value="' + esc(guest.date || '') + '" style="width:auto;">' +
        '<input class="edit-input" id="edit-venue-' + id + '" placeholder="Venue override" value="' + esc(guest.venue || '') + '" style="width:auto;">' +
        '</div>' +
        '<button class="btn gold" onclick="saveEdit(\\'' + id + '\\')">save</button>' +
        '<button class="btn" onclick="cancelEdit()">cancel</button>';
    }

    function cancelEdit() {
      editingId = null;
      render(lastData);
    }

    async function saveEdit(id) {
      const custom = {};
      for (const f of customFields()) {
        const el = document.getElementById('edit-custom-' + id + '-' + f.key);
        if (el) custom[f.key] = el.value.trim();
      }
      await api('/api/edit-guest', {
        id,
        name: document.getElementById('edit-name-' + id).value.trim(),
        seat: document.getElementById('edit-seat-' + id).value.trim(),
        badge: document.getElementById('edit-badge-' + id).value.trim(),
        date: document.getElementById('edit-date-' + id).value.trim(),
        venue: document.getElementById('edit-venue-' + id).value.trim(),
        custom,
      });
      editingId = null;
      refresh();
    }

    refresh();
    // Adaptive poll rate. High-concurrency events re-read every check-in key on
    // each refresh, so we slow the poll for them (and slow it further as the
    // event fills) to conserve reads. Standard events stay snappy at 5s.
    function pollInterval() {
      if (!lastData || lastData.checkinMode !== 'highConcurrency') return 5000;
      const n = lastData.checkedIn || 0;
      if (n > 300) return 20000;
      if (n > 100) return 15000;
      return 10000;
    }
    let pollTimer = null;
    function scheduleNextPoll() {
      clearTimeout(pollTimer);
      pollTimer = setTimeout(async () => {
        if (!document.hidden) await refresh();
        scheduleNextPoll();
      }, pollInterval());
    }
    scheduleNextPoll();
    // Refresh immediately when the tab becomes visible again, so a backgrounded
    // dashboard is up to date the moment you return to it.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && editingId === null) refresh();
    });
  </script>
</body>
</html>`;

  return new Response(html, { headers: { "content-type": "text/html;charset=UTF-8" } });
}

// ---------- Themed ticket rendering (default design, used when no customTemplate) ----------

function fallbackConfig() {
  return { name: "EVENT NOT FOUND", subtitle: "", footer: "" };
}

function resolveTheme(rawTheme) {
  const t = rawTheme || {};
  return {
    accent: t.accent || "#e6a93d",
    card: t.card || "#101828",
    background: t.background || "#0a0e1a",
    border: t.border || "#2a3550",
    showWave: !!t.showWave,
    waveColor: t.waveColor || t.accent || "#e6a93d",
  };
}

function wavePathSvg(color) {
  const path = "M0,20 C100,45 300,-5 400,20 L400,40 L0,40 Z";
  return `<svg class="wave-svg" viewBox="0 0 400 40" preserveAspectRatio="none"><path d="${path}" fill="${color}" opacity="0.55"></path></svg>`;
}

function renderThemedTicket(guest, config, slug, id, origin) {
  const theme = resolveTheme(config.theme);
  const checkinLink = `${origin}/checkin?event=${slug}&id=${id}`;
  const qrImg = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(checkinLink)}`;
  const badge = guest.badge || config.defaultBadge || "guest";

  const waveHtml = theme.showWave
    ? `<div class="wave-wrap"><div class="wave-track">${wavePathSvg(theme.waveColor)}${wavePathSvg(theme.waveColor)}</div></div>`
    : "";

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(config.name)}</title>
  <link rel="icon" href="/favicon-16.png" sizes="16x16" type="image/png"><link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <meta name="theme-color" content="#14100e">
  <style>
    body {
      margin: 0; background: ${theme.background};
      background-image: linear-gradient(#12182b 1px, transparent 1px), linear-gradient(90deg, #12182b 1px, transparent 1px);
      background-size: 24px 24px; font-family: 'Courier New', monospace; color: #cbd5e1;
      display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px;
    }
    .card-wrap { position: relative; width: 100%; max-width: 380px; }
    .card { background: ${theme.card}; border: 1px solid ${theme.border}; border-radius: 14px; overflow: hidden; position: relative; }
    .dot { width: 8px; height: 8px; background: ${theme.accent}; border-radius: 50%; position: absolute; }
    .dot.tl { top: 14px; left: 14px; } .dot.tr { top: 14px; right: 14px; }
    .dot.bl { bottom: 60px; left: 14px; } .dot.br { bottom: 60px; right: 14px; }
    .header { padding: 24px 24px 16px 24px; border-bottom: 1px solid ${theme.border}; display: flex; justify-content: space-between; align-items: flex-start; }
    .title { color: ${theme.accent}; font-size: 20px; font-weight: bold; line-height: 1.3; }
    .subtitle { color: #64748b; font-size: 10px; letter-spacing: 1px; margin-top: 8px; }
    .badge { border: 1px solid ${theme.accent}; color: ${theme.accent}; font-size: 11px; padding: 4px 10px; border-radius: 4px; white-space: nowrap; }
    .guest-row { padding: 18px 24px 0 24px; }
    .guest-row label { display: block; color: #4b5871; font-size: 10px; letter-spacing: 1px; margin-bottom: 6px; }
    .guest-row div { color: #e2e8f0; font-size: 16px; font-weight: bold; }
    .seat-hero { text-align: center; padding: 18px 24px; }
    .seat-hero label { display: block; color: #4b5871; font-size: 10px; letter-spacing: 2px; margin-bottom: 8px; }
    .seat-value { display: inline-block; font-size: 34px; font-weight: bold; color: ${theme.accent}; border: 2px solid ${theme.accent}; border-radius: 12px; padding: 10px 28px; background: rgba(255,255,255,0.04); letter-spacing: 1px; }
    .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; padding: 8px 24px 20px 24px; }
    .field label { display: block; color: #4b5871; font-size: 10px; letter-spacing: 1px; margin-bottom: 6px; }
    .field div { color: #e2e8f0; font-size: 14px; }
    .divider { border-top: 1px dashed ${theme.border}; }
    .qr-wrap { display: flex; justify-content: center; padding: 24px; }
    .qr-box { background: #f1f5f9; border: 3px solid ${theme.accent}; border-radius: 10px; padding: 12px; }
    .manifest { text-align: center; color: #4b5871; font-size: 11px; padding-bottom: 16px; letter-spacing: 1px; }
    .footer { background: #0c1220; text-align: center; color: #64748b; font-size: 10px; letter-spacing: 1px; padding: 14px; }
    .wave-wrap { overflow: hidden; height: 36px; width: 100%; position: relative; }
    .wave-track { display: flex; width: 200%; animation: waveScroll 7s linear infinite; }
    .wave-svg { width: 50%; height: 36px; flex-shrink: 0; display: block; }
    @keyframes waveScroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
  </style>
</head>
<body>
  <div class="card-wrap">
    <div class="card">
      <div class="dot tl"></div><div class="dot tr"></div>
      <div class="dot bl"></div><div class="dot br"></div>
      <div class="header">
        <div>
          <div class="title">${escapeHtml(config.name)}</div>
          <div class="subtitle">${escapeHtml(config.subtitle)}</div>
        </div>
        <div class="badge">${escapeHtml(badge)}</div>
      </div>
      <div class="guest-row"><label>// GUEST</label><div>${escapeHtml(guest.name)}</div></div>
      <div class="seat-hero"><label>// TABLE / SEAT</label><div class="seat-value">${escapeHtml(guest.seat)}</div></div>
      <div class="fields">
        <div class="field"><label>// DATE</label><div>${escapeHtml(eventDate(config, guest))}</div></div>
        <div class="field"><label>// VENUE</label><div>${escapeHtml(eventVenue(config, guest))}</div></div>
        ${checkinWindowText(config) ? `<div class="field" style="grid-column:1/3;"><label>// CHECK-IN TIME</label><div>${escapeHtml(checkinWindowText(config))}</div></div>` : ""}
      </div>
      <div class="divider"></div>
      <div class="qr-wrap"><div class="qr-box"><img src="${qrImg}" width="200" height="200"></div></div>
      <div class="manifest">manifest id · ${escapeHtml(id)}</div>
      ${waveHtml}
      <div class="footer">${escapeHtml(config.footer)}</div>
    </div>
  </div>
</body>
</html>`;

  return new Response(html, { headers: { "content-type": "text/html;charset=UTF-8" } });
}

function htmlPage(bodyHtml, config) {
  return new Response(
    `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(config.name)}</title><link rel="icon" href="/favicon-16.png" sizes="16x16" type="image/png"><link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><meta name="theme-color" content="#14100e">
    <style>
@import url('https://fonts.googleapis.com/css2?family=Bungee&family=Space+Grotesk:wght@400;500;700&family=JetBrains+Mono:wght@400;700&display=swap');
      :root { --void:#14100e; --shell:#1e1815; --seam:#3a2f28; --cream:#f2e6d0; --dim:#a8927a; --sun:#ffb100; }
      body { margin:0; background:var(--void); color:var(--cream); display:flex; justify-content:center; align-items:center;
             min-height:100vh; padding:20px; font-family:'Space Grotesk',system-ui,sans-serif;
             background-image:radial-gradient(circle at 50% 0%, rgba(255,177,0,.08) 0, transparent 55%); }
      .card { background:var(--shell); border:1px solid var(--seam); border-radius:22px; width:100%; max-width:390px; overflow:hidden; }
      .status-wrap { padding:52px 26px; text-align:center; }
      .status-title { font-family:'Bungee',cursive; font-size:26px; margin-bottom:22px; letter-spacing:.05em; }
      .status-seat { font-family:'Bungee',cursive; font-size:42px; color:var(--sun); margin:12px 0; }
      .status-sub { color:var(--dim); font-size:14px; margin-top:12px; }
    </style></head><body>${bodyHtml}</body></html>`,
    { headers: { "content-type": "text/html;charset=UTF-8" } }
  );
}

// `atEpoch` (optional) is rendered into the SCANNER'S local time by their own
// browser — the Worker runs in UTC and can't know their timezone.
function statusCard(title, color, guest, sub, atEpoch) {
  const timeHtml = atEpoch
    ? `<div class="status-sub" data-at="${Number(atEpoch)}">Checked in at <span class="local-time">…</span></div>`
    : "";
  return `<div class="card"><div class="status-wrap">
    <div class="status-title" style="color:${color}">${title}</div>
    <div>${escapeHtml(guest.name)}</div>
    <div class="status-seat">${escapeHtml(guest.seat)}</div>
    ${sub ? `<div class="status-sub">${escapeHtml(sub)}</div>` : ""}
    ${timeHtml}
  </div></div>
  <script>
    document.querySelectorAll('[data-at]').forEach(function (el) {
      var n = Number(el.getAttribute('data-at'));
      if (!n) return;
      var span = el.querySelector('.local-time');
      if (span) span.textContent = new Date(n).toLocaleTimeString();
    });
  </script>`;
}

function errorCard(title, sub) {
  return `<div class="card"><div class="status-wrap">
    <div class="status-title" style="color:#f87171">${title}</div>
    <div class="status-sub">${sub}</div>
  </div></div>`;
}

function genericErrorCard(title) {
  return `<div class="card"><div class="status-wrap">
    <div class="status-title" style="color:#f87171">${title}</div>
    <div class="status-sub">This event doesn't exist or hasn't been set up yet.</div>
  </div></div>`;
}
