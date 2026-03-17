# ctrl-shift-matches

Single-page Ctrl Shift matches site with:
- `live` mode: pulls registrations + answers from Luma API and computes matches automatically.
- `fallback` mode: uses the hardcoded local dataset in `public/index.html`.

## Preview locally

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the local static server:
   ```bash
   npm start
   ```
3. Open:
   ```
   http://localhost:3000
   ```

The page supports query parameters, for example:

```
http://localhost:3000?name=Sahil%20Lulla
```

## Data source modes

Use `source` query param to control mode:

- `?source=auto` (default): tries Luma live sync, then falls back to hardcoded data.
- `?source=live`: forces live mode attempt first; if unavailable, still falls back.
- `?source=fallback`: skips Luma and uses hardcoded data only.

Event selection query params:

- `?event=vol11` (event key; resolved via `LUMA_EVENT_MAP`)
- `?event=vol9` (built-in static archive event in this repo)
- `?event_api_id=evt-...` (direct event override)
- `?event_id=...` (fallback if you use internal event id)

Examples:

```
https://yourdomain.com
https://yourdomain.com?source=auto
https://yourdomain.com?source=live
https://yourdomain.com?source=fallback
https://yourdomain.com?event=vol9
https://yourdomain.com?source=live&event=vol11
https://yourdomain.com?source=live&event_api_id=evt-AIHKhl74s8lpCUH
```

Root path (`/`) now opens an event hub page instead of jumping straight into a specific event.

Event labels are automatic for live events: the API reads the Luma event title and extracts `Vol. #` when present (e.g. `CTRL SHIFT Vol. 12`).

## Luma API configuration (Vercel env vars)

Set these environment variables in Vercel Project Settings:

- `LUMA_API_KEY` (required)
- `LUMA_EVENT_API_ID` (recommended, usually starts with `evt-`)
- `LUMA_EVENT_ID` (optional alternative to `LUMA_EVENT_API_ID`)
- `LUMA_EVENT_MAP` (optional JSON map for multi-event, e.g. `{\"vol10\":\"evt-...\",\"vol11\":\"evt-...\"}`)
- `LUMA_DEFAULT_EVENT_KEY` (optional; key in `LUMA_EVENT_MAP` to use when URL has no `event`)
- `LUMA_GUEST_APPROVAL_STATUS` (optional, defaults to `approved`)
- `MATCH_CACHE_TTL_SECONDS` (optional, defaults to `120`)

Live endpoint used by the frontend:

```
GET /api/matches
```

The API key is only used server-side in Vercel functions and is never exposed in browser code.

## Deploy to Vercel

1. Install Vercel CLI (if needed):
   ```bash
   npm i -g vercel
   ```
2. From this project directory, deploy:
   ```bash
   vercel --prod
   ```

`vercel.json` serves filesystem routes first (including `/api/*`) and then rewrites other routes to `index.html`, so both deep links and API routes work correctly.

## Generate QR codes for guests

Use a bulk QR generator and provide URLs in this format:

```
https://yourdomain.com?name=Guest%20Name
```

For multiple guests, generate one URL per person (URL-encoded names), then export QR codes in bulk.
