# MURD'R CLUB

_Real People. Real Cases. Real Impact._

A community that organizes the world's top unsolved murders by region, lets members join
the hunt on individual cases, contribute evidence (write-ups, links, photos, video), rate
each other's contributions 1-5, and chat one-on-one or within a case's investigation group.
Connect with fellow investigators, investigate a case, and make a difference.

## Stack

- **Client:** React + Vite, `react-router-dom`, `socket.io-client`
- **Server:** Node.js + Express + Socket.io
- **Database:** Postgres via `pg`
- **Auth:** JWT + bcrypt

## Structure

```
murdrclub/
  client/     React + Vite frontend
  server/     Express/Socket.io API + Postgres database
    db/       schema (auto-migrates on boot) + the 20 seeded regions
    routes/   auth, regions, cases, contributions, members, chat, admin
```

## Regions

NE / SE / MW / SW / West US, United Kingdom, France, Portugal/Spain, Ireland,
Germany/Austria/Switzerland, Nordic Region, Russia, Eastern Europe, Italy, Baltic States,
Africa, Middle East, India, Asia, Australia — 20 in total.

## Core features

- **Join / members** — register, log in, public member directory.
- **Rankings** — members are ranked by the average rating their contributions earn from
  fellow hunters, weighted by contribution volume.
- **Regional case listings** — top unsolved murders per region, ranked by hunt activity.
- **Join the hunt** — become a member of a specific case's investigation group.
- **Add information** — contribute text write-ups, links, photos, and video to a case.
- **Chat** — real-time one-to-one DMs and per-case group chat over Socket.io.
- **Regional admins** — superadmins assign admins per region; those admins approve or
  reject new case suggestions submitted for their region before they go public.
- **Club research** — when a case is approved, and again every Monday for every open
  case, the server uses the Claude API's web search tool to look for new material and
  files anything it finds as a contribution from the "MURD'R CLUB" system account.
  Those land in a `pending` state and need a regional/super admin's approval (same
  admin panel as case approvals) before they're visible on the case page. Cases that
  keep turning up nothing back off automatically — every 2 weeks after 2 empty runs,
  every 4 weeks after 4 — and reset to weekly the moment something new turns up.
  Requires an `ANTHROPIC_API_KEY` env var — without it, research silently no-ops and
  the rest of the app is unaffected.
- **"What Claude thinks"** — alongside club research, the same weekly job (and case
  approval) asks Claude to synthesize a short analysis of the case from its currently
  *visible* evidence and leads — no web search, just reasoning over what's already been
  submitted. Skips a case entirely if nothing new has come in since the last analysis.
  Explicitly instructed not to accuse or name any living person. Lands as `pending`,
  same admin review gate as club contributions, and is never sent to non-admin viewers
  until approved — this is AI speculation about a real unsolved case, so it needs a
  human check before anyone else sees it.
- **Solve requests** — a member on a case's hunt can propose it's solved with a written
  explanation. A regional or super admin approves or rejects the closure. Once approved,
  the case is locked (no new joins, contributions, ratings, or chat) but stays visible
  and listed as a historical record — it is never deleted or hidden.
- **Translation** — case summaries and evidence write-ups can be entered in any language;
  a "Translate to English" button under each translates it on demand via the Claude API.
  Requires `ANTHROPIC_API_KEY` and being logged in (each call costs a real API request).
- **Personal notes** — any logged-in member can keep private, timestamped notes on a case,
  shown below the group chat as a list — each save adds a new entry rather than overwriting
  one note. Scoped to that one case and visible only to the member who wrote them — not to
  other members, region admins, or superadmins.
- **Case map** — case pages show an interactive Google Map pinned to the case's location.
  Submitters can optionally give a more precise "exact address" separate from the general
  location text; the map uses that if present, falling back to location. Requires a
  `VITE_GOOGLE_MAPS_API_KEY` env var at **build time** (Maps Embed API) — without it the
  map section just doesn't render, nothing else is affected. Get a key from the
  [Google Cloud Console](https://console.cloud.google.com/google/maps-apis), enable the
  Maps Embed API, and restrict it to your domain via HTTP referrer restrictions since it's
  visible in the page source.
- **All-cases map** — the homepage, below the region/case-count stats, shows every active
  case as a pin on an interactive, zoomed-out world map (`@googlemaps/js-api-loader` +
  `@googlemaps/markerclusterer`), clustering nearby cases into a number until you zoom in.
  Clicking a pin opens that case. Uses the same `VITE_GOOGLE_MAPS_API_KEY`, but also needs
  the **Maps JavaScript API** and **Geocoding API** enabled (in addition to Maps Embed API)
  in the Google Cloud Console — locations are geocoded client-side on each page load, not
  stored, so no extra setup beyond enabling those two APIs.

## Running locally

You need a Postgres database. Quickest way with Docker:

```bash
docker run -d --name murdrclub-db -e POSTGRES_PASSWORD=murdrclub -e POSTGRES_DB=murdrclub -p 5432:5432 postgres:16
```

Then:

```bash
# server
cd server
npm install
echo 'DATABASE_URL=postgres://postgres:murdrclub@localhost:5432/murdrclub' > .env
echo 'JWT_SECRET=dev-secret-change-me' >> .env
npm run dev        # http://localhost:4001 — creates tables and seeds regions on first boot

# client (separate terminal)
cd client
npm install
npm run dev         # http://localhost:5174, proxies /api and /socket.io to :4001
```

`server/db/schema.js` runs its `CREATE TABLE IF NOT EXISTS` migrations automatically every
time the server starts, so there's no separate migration step.

## Production build

```bash
cd client && npm install && npm run build
cd ../server && npm install && npm start
```

The server serves the built client from `client/dist` and answers the API under `/api`.
`GET /cases/:id` for an approved case is server-rendered with per-case
title/description/Open Graph/Twitter Card tags (read live from the DB on
every request, so it covers new and existing cases alike) — search engines
and link-preview bots see real metadata instead of the generic SPA shell.

### SEO

- `client/index.html` carries the site-wide title/description/Open Graph/Twitter Card
  tags (used for every page except case pages, which get their own via `server/lib/seo.js`).
- `client/public/og-image.png` (1200×630) is the shared link-preview image, served at
  `/og-image.png`.
- `client/public/robots.txt` allows crawling of everything except the auth-gated pages
  (`/admin`, `/messages`, `/login`, `/register`) and points to `/sitemap.xml`.
- `GET /sitemap.xml` (`server/lib/sitemap.js`) is generated live from the DB — the static
  pages, one entry per region, and one per **approved** case (matching what `GET /cases/:id`
  actually serves; pending/rejected cases are left out).

### Case search

`GET /cases?q=...` (same endpoint the "Active cases" list uses) matches every typed word
against title, victim name, location, summary, and `cases.keywords` — a case only needs to
contain all the words, not necessarily in the same field. Search boxes live in the nav bar
(site-wide, jumps to `/cases?q=...`) and on the "Active cases" page itself (live/debounced,
no submit needed).

`cases.keywords` is generated once per case, right after admin approval (`server/lib/keywords.js`,
same `ANTHROPIC_API_KEY`-gated no-op-if-unset pattern as club research/analysis) — Claude reads
the case's title/victim/location/summary and produces a short list of alternate names, nearby
places, associated people, and thematic terms, so search can find a case by things that don't
appear verbatim in the title or summary (e.g. searching "Leimert Park" or "Betty Short" finds
the Black Dahlia case). It only fills in empty keywords, so it won't overwrite anything and is
safe to call again.

## Deploying (Railway)

1. Add a **Postgres** plugin to the Railway project — it injects `DATABASE_URL`
   automatically, which `server/db/schema.js` reads directly.
2. Set `JWT_SECRET` as a service environment variable (anything long and random).
   Optionally set `ANTHROPIC_API_KEY` to enable the weekly club research job.
   Optionally set `VITE_GOOGLE_MAPS_API_KEY` to enable the case map — it's read at client
   **build** time, so Railway must have it set before the build step runs, not just at
   runtime.
3. Point the service's start command at `server` the same way as `iberzo`'s `nixpacks.toml` /
   `railway.json` do — install both `client` and `server`, build the client, then
   `node index.js` from `server`.
4. On first boot the server creates all tables and seeds the 20 regions itself — no manual
   migration or seed step needed.
