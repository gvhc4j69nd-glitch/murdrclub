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
- **Solve requests** — a member on a case's hunt can propose it's solved with a written
  explanation. A regional or super admin approves or rejects the closure. Once approved,
  the case is locked (no new joins, contributions, ratings, or chat) but stays visible
  and listed as a historical record — it is never deleted or hidden.
- **Translation** — case summaries and evidence write-ups can be entered in any language;
  a "Translate to English" button under each translates it on demand via the Claude API.
  Requires `ANTHROPIC_API_KEY` and being logged in (each call costs a real API request).
- **Personal notes** — any logged-in member can keep a private note per case, shown below
  the group chat on the case page. Notes are scoped to that one case and visible only to
  the member who wrote them — not to other members, region admins, or superadmins.

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

## Deploying (Railway)

1. Add a **Postgres** plugin to the Railway project — it injects `DATABASE_URL`
   automatically, which `server/db/schema.js` reads directly.
2. Set `JWT_SECRET` as a service environment variable (anything long and random).
   Optionally set `ANTHROPIC_API_KEY` to enable the weekly club research job.
3. Point the service's start command at `server` the same way as `iberzo`'s `nixpacks.toml` /
   `railway.json` do — install both `client` and `server`, build the client, then
   `node index.js` from `server`.
4. On first boot the server creates all tables and seeds the 20 regions itself — no manual
   migration or seed step needed.
