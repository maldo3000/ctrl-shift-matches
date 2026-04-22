# AGENTS.md — CTRL+SHIFT matches

Onboarding doc for AI agents (Claude, Cursor, etc.) working on this repo. Read this first.

## What this is

Single-page site ([matches.ctrlshift.community](https://matches.ctrlshift.community)) that shows attendees of the monthly CTRL+SHIFT creative-tech meetup who they should meet at the event. Guests register on Luma, the site pulls their registration answers via the Luma API, and a scoring function suggests pairs.

## Architecture

- **`api/matches.js`** — Vercel serverless function. Core logic: pulls guests from Luma (`/v1/event/get-guests`), builds a profile per guest, scores pairs, returns top 5 matches each. Also owns the Luma **calendar discovery** cache used by `api/events.js`.
- **`api/events.js`** — lightweight endpoint. Returns every CTRL+SHIFT volume auto-discovered from the Luma calendar, plus any `LUMA_EVENT_MAP` overrides. Consumed by the event hub on `/`.
- **`public/index.html`** — single-page app. Event hub, name-search UI, password-gated archive gate, `/raffle` route. Everything in one file (intentional, keeps Vercel deploy trivial).

## Auto-discovery (the important part)

Volumes are auto-discovered from the Luma calendar — **there is no manual per-volume wiring**. When a new Vol. N event is created on Luma, the site picks it up within ~5 minutes (calendar cache TTL).

Mechanics:
1. `getDiscoveredEvents()` calls `/v1/calendar/list-events` with `calendar_api_id` set to `LUMA_CALENDAR_API_ID`.
2. Each event's title is filtered by regex `TITLE_FILTER` (default: `/ctrl[\s+\-_]*shift/i` — matches `CTRL SHIFT`, `CTRL+SHIFT`, `CTRL-SHIFT`, etc.).
3. Volume number is extracted via `extractVolumeNumber()` and becomes the key (`vol11`, `vol12`, …).
4. "Current" event = soonest future `start_at` (falls back to most recent past if none upcoming).

The frontend's `renderEventHub()` fetches `/api/events`, reads `current_event_key`, and renders it as the "● Live" card. Clicking it navigates to `?event=volN`, which the matches API resolves via the same discovery.

## Vercel env vars

**Required:**
- `LUMA_API_KEY` — Luma public API key.
- `LUMA_CALENDAR_API_ID` — `cal-...`, found on Luma's developer settings page. Without this, `list-events` returns a partial default.

**Optional / escape hatches:**
- `LUMA_EVENT_MAP` — JSON like `{"vol11":"evt-..."}`. Use to override discovery for events with non-standard titles. Merged with discovery; **env entries win**.
- `LUMA_DEFAULT_EVENT_KEY` — force `/` and bare `?source=live` to a specific key regardless of date.
- `MATCH_CACHE_TTL_SECONDS` (default 120), `LUMA_CALENDAR_TTL_SECONDS` (default 300).
- `LUMA_EVENT_TITLE_FILTER` — custom regex string if you change branding again.

**Do not set** `LUMA_EVENT_API_ID` / `LUMA_EVENT_ID` — these were the source of a silent-fallback bug where `?event=volX` would quietly serve the wrong event. The code now blocks that path but having them set is misleading.

## Workflows

### New volume goes live on Luma
Nothing. Literally nothing. As long as the Luma event title matches the `CTRL[+ ]SHIFT Vol. N` pattern, it shows up on the hub within 5 minutes and becomes "current" on its start date.

### Archiving a finished volume
Manual, intentionally. Archive gating is in `public/index.html`:
1. Add the key to `ARCHIVE_PROTECTED_EVENT_KEYS` (Set).
2. Add an entry to `EVENT_REGISTRY` with `archived: true`, `mode: 'live'`.
3. Rotate `ARCHIVE_PASSWORD` if desired.

Don't auto-archive by date — attendees often revisit their matches the day after an event.

### Renaming the series
If the series is renamed to something that doesn't match `/ctrl[\s+\-_]*shift/i`, either update `TITLE_FILTER_SOURCE` in `api/matches.js` or override via `LUMA_EVENT_TITLE_FILTER` env var.

## Known quirks

- **`git push` to GitHub hangs over HTTP/2** on this user's network. Use `git config --global http.version HTTP/1.1` (already set). If pushes fail with "Failed to connect to github.com port 443 after 75s", retry or check VPN/firewall state.
- **Two "Vol. 10" events exist** on Luma (Mar 6 and Mar 27 2026). Discovery deduplicates by `extractVolumeNumber` key and keeps the most recent `start_at`, which resolves to the Mar 27 one (the actual event).
- **Static preview** via `npm start` serves from `public/` only. `/api/*` won't work locally; frontend gracefully falls back to the "No Live Event" card when `/api/events` 404s.

## Cross-references (user-memory)

These live outside the repo in `~/.claude/projects/...-ctrl-shift-matches/memory/`:
- `project_overview.md`
- `project_new_event_workflow.md`
- `project_archive_workflow.md`

AGENTS.md (this file) is the canonical source. User memory is a redirect to here.
