![TRKT](assets/trkt-banner.png)

# TRKT — Event Ticketing & Check-in

A reusable QR-code ticketing and live check-in system that runs entirely on
Cloudflare Workers + KV (free tier). Build once, reuse for every event.
Everything is controlled from a web dashboard — no terminal needed for
day-to-day use.

Live: https://trkt.rydr.info

## What it does

- **Create events in the browser** at `/new` — a short form, a guest CSV, and
  you're done. Optionally set custom ticket HTML/CSS, passwords, a check-in
  window, and the check-in mode.
- **Per-guest QR tickets** — each encodes that guest's check-in link.
- **Live check-in** — staff scan a QR; the guest is marked present and the
  dashboard updates within seconds.
- **Two passwords per event** — one for the dashboard, one for scanning. They
  are completely independent.
- **Dashboard** — four tabs: The Door (counts, search, roster), Settings,
  Ticket Design, Data & Access.
- **Manual check-in / undo** — for guests who arrive without their ticket, or
  a mistaken scan.
- **Custom fields** — any extra CSV column becomes editable per-guest data and
  a template placeholder.
- **"Sent" checklist** — a checkbox next to each guest on the dashboard to
  track who you've personally forwarded a ticket link to. Stored in your
  browser's `localStorage`, not KV — costs nothing, but is per-device only
  (won't sync if you check the dashboard from a different browser/computer).
- **CSV export** — full guest list with attendance and arrival times.
- **Bulk add** — append another CSV of late RSVPs without touching existing guests.
- **Arrivals chart** — when people actually turned up, in your local timezone.

## Check-in modes (chosen at creation, fixed after)

| Mode | Attendance stored | Use when |
|---|---|---|
| `standard` (default) | A flag inside the single `roster:SLUG` blob | One person scanning. Cheapest reads. Two staff scanning *different* guests within ~100ms can silently lose one check-in. |
| `highConcurrency` | A separate `checkin:SLUG:TICKETID` key per guest | Several people scanning at once. No check-in is ever lost — two staff write to two different keys, so they can't overwrite each other. Costs more reads. |

Events created before this feature existed default to `standard`. Legacy
roster-baked attendance is backfilled, so nothing is lost on deploy.

> **Read cost of high-concurrency:** each dashboard refresh re-reads *every*
> check-in so far (1 + 1 + N), so cost grows as the event fills. The number of
> scanners does **not** affect this; the number of **open dashboards** does.
> At a big event: scanners stay on `/scan`, and only one organiser dashboard open.

## The two passwords

| Password | Gates | Does NOT gate |
|---|---|---|
| **Dashboard** (`passwordHash`) | `/dashboard`, `/dashboard-data`, `/stats`, `/export`, `/arrivals`, all `/api/*` management | Scanning. A dashboard cookie cannot check anyone in. |
| **Scanner** (`scanHash`) | `/checkin` — only authorised devices may check guests in | The dashboard. A scanner cookie cannot manage anything. |

Guest ticket pages (`/ticket`) are **never** gated.

A device authorises itself once at `/scan?event=SLUG` by entering the scanner
password, and gets a 30-day cookie. Unauthorised devices that scan a QR see a
**NOT AUTHORIZED** page and the guest is not checked in.

**No scanner password set = any phone can check people in.** Set one before a
real event.

Both passwords are hashed with salted PBKDF2 (100,000 iterations) — not
stored or compared as plaintext, and not returned by any API response.
Verification attempts against either password are rate-limited to 8 tries
per 10 minutes per event+IP (see **Security** below for details and caveats).

## Architecture

- **`worker/index.js`** — the entire application. One Cloudflare Worker serves
  every route. Single source of truth for the running system.
- **Cloudflare KV** (`TICKETS_KV`):
  - `cfg:SLUG` → `{ name, subtitle, footer, defaultBadge, date, venue,
    checkinMode, checkinStart?, checkinEnd?, showCheckinWindow?, theme?,
    customFields?, customTemplate?, passwordHash?, scanHash? }`
  - `roster:SLUG` → every guest, keyed by ticket ID
  - `checkin:SLUG:TICKETID` → `{ at, time }` — high-concurrency mode only
  - `eventIndex` → `[{ slug, name, addedAt, guestCount }]`, powers the landing page

  Note: the per-guest "Sent" checklist is **not** in KV at all — it lives
  entirely in the organiser's browser (`localStorage`), scoped per event slug.

### Routes

| Route | Purpose |
|---|---|
| `/` | Landing page, event list, KV usage widget |
| `/new` | Create an event |
| `/dashboard?event=SLUG` | Live check-in + management |
| `/scan?event=SLUG` | Authorise this device as a scanner |
| `/ticket?event=SLUG&id=XXXX` | Guest-facing ticket |
| `/checkin?event=SLUG&id=XXXX` | Staff scan endpoint |
| `/export?event=SLUG` | CSV download of guests + attendance |
| `/arrivals?event=SLUG` | JSON of check-in timestamps |
| `/stats`, `/dashboard-data` | JSON feeds |
| `/api/*` | create-event, add/edit/remove-guest, bulk-add-guests, check-guest (manual check-in), uncheck-guest, delete-event, edit-event, edit-template, add/remove-field, verify/set-password, verify-scan, set-scan-password, kv-usage |

## Timestamps

Check-ins store an **epoch timestamp** (`at`), never a formatted string.
Workers run in UTC, so formatting server-side produced times six hours off for
Dhaka — and silently wrong anywhere outside UTC. The browser formats the epoch
into the viewer's own local time; the arrivals chart buckets client-side and
labels itself with the detected timezone.

Older records that predate this only have a locale string. They still display,
but the arrivals chart reports them as skipped rather than misplacing them.

## Deploy

```bash
cd worker
wrangler deploy
```

Creating and managing events happens in the browser — no redeploy needed except
for code changes.

## CSV format

First row is headers. **Only `Name` is required.** Rows with a blank name are
skipped (enforced both client-side and in the API).

```
Name,Seat,Meal Preference
John Smith,Table 1,Vegetarian
Jane Doe,Table 2,Chicken
```

- `Seat`, `Badge` — optional standard columns.
- Any other column → a custom field (`Meal Preference` → `{{meal_preference}}`).
- Date & venue are set once per event on the dashboard, not per row.
- Quote any value containing a comma: `"18th July, 2026"`.

## Ticket templates

Write custom HTML/CSS per event, at creation or any time from the dashboard.
Placeholders:

`{{name}} {{seat}} {{badge}} {{date}} {{venue}} {{checkinWindow}} {{eventName}}
{{eventSubtitle}} {{footer}} {{ticketId}} {{qrImage}}` plus every custom field
as `{{its_slug}}`.

Leave the template blank to use the built-in themed design, whose colours are
editable from the dashboard's Ticket Design tab. A field only appears on the
ticket if its `{{tag}}` is in the template — that's how you control what shows.

All guest data is HTML-escaped before substitution.

## Free-tier limits (Cloudflare KV)

- Storage 1 GB, reads 100k/day, writes 1,000/day, lists 1,000/day (resets 00:00 UTC).
- Each check-in / add / edit / remove = 1 write. Field add/remove = 2.
  Bulk add = 2 writes total regardless of guest count.
- The "Sent" checklist costs **zero** reads/writes/lists — it's browser-only.
- Rate limiting on login attempts and event creation is in-memory, not
  KV-backed, so it also costs zero reads/writes/lists.
- Finalize guest lists a day before the event so edits and check-ins don't stack
  into the same UTC-day write budget.
- The landing page shows live usage (needs `CF_API_TOKEN` secret +
  `CF_ACCOUNT_ID` var; reads Cloudflare's analytics API, costs no KV quota).
  The numbers lag by minutes — Cloudflare aggregates on a delay.

## Security

- **Password hashing**: salted PBKDF2-SHA256, 100,000 iterations. Events
  created before this was added still verify against their original unsalted
  SHA-256 hash — nothing breaks — and silently upgrade to the salted format
  the next time that password is changed. No migration step needed.
- **Rate limiting**: dashboard/scanner password attempts are capped at 8 per
  10 minutes per event+IP; event creation is capped at 10 per hour per IP.
  Both are **in-memory only** (not KV-backed) — this means zero added KV cost,
  but also means the limit resets on a Worker cold start and isn't shared
  across Cloudflare's edge locations. It'll slow down a basic scripted
  brute-force burst; it won't stop a serious distributed attempt.
- **Slug validation**: event slugs are restricted to `a-z0-9-` (max 80 chars)
  at creation, since they're used directly as KV key segments and in URLs.
- **CSV export** guards against formula injection — a cell value starting
  with `=`, `+`, `-`, or `@` is prefixed to prevent it being interpreted as a
  live formula when opened in Excel/Sheets. Only matters if you import a
  guest list you didn't create yourself.
- **XSS**: all guest and event data is HTML-escaped before being inserted
  into any page, including the post-creation ticket-link list on `/new`.
- No CORS headers are set on any endpoint, and auth cookies are
  `HttpOnly; Secure; SameSite=Lax` — cross-origin reads of authenticated
  data and most CSRF vectors are blocked by default.

## Known limitations

- **Standard mode has a concurrent check-in race** — use `highConcurrency` for
  multi-scanner events.
- **Check-in mode is fixed at creation** — no live migration between modes.
- **High-concurrency dashboard reads grow with attendance** — keep one dashboard open.
- **No password on `/new` itself** — anyone with the link can create events
  (deliberate; per-event passwords protect individual dashboards). It's
  rate-limited (see **Security**), but that's a basic in-memory throttle, not
  a hard wall.
- **Custom ticket CSS is unsanitised** — you're authoring your own template, so
  this is by design. Don't let untrusted people author templates.
- **`csvToGuests` is duplicated** (once on `/new`, once on the dashboard for
  bulk add). If you change CSV parsing rules, change both.
- **Ticket IDs are 32-bit random hex** (8 characters). Not brute-forceable in
  bulk for a single guess, but low-effort enough that this isn't a suitable
  design for events with highly sensitive guest data at large scale.
