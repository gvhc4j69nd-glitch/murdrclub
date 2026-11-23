# MurdrClub

**murdrclub.com**: an online murder-mystery game for 8 to 25 friends. A few
players are secretly **Murderers**. Every night they murder a **Member**. Every
day the Club meets at **the Tribunal** to blackball the person it suspects. The
Members win by unmasking every Murderer. The Murderers win if any of them
survive to the end. A season lasts **half a day per player**, so 8 players
play 4 days and 25 play 13. The Vault is counted in **points**, not money.

This is the MVP. There is no build step: plain Node on the server (its one
dependency is `pg`, for Postgres) and plain HTML, CSS and JS in the browser.

```sh
npm install
npm start        # http://localhost:4400
npm test         # rules engine, Club Time, storage, and end-to-end HTTP games
```

**Storage.** With `DATABASE_URL` set, everything is kept in Postgres. Without
it, for local development, the server saves to `data/murdrclub.json`. To run
the tests against Postgres as well as the file store:

```sh
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/murdrclub_test npm test
```

Each test uses its own throwaway schema, so any database you can write to will
do.

To try a whole game alone: create a **Fast** club, add at least 7 practice
bots, open the club, and use **End phase now** to move through the phases.

## Deploying on Railway

`railway.json` sets up the build, starts `node server.js`, and checks
`/healthz` before switching traffic to a new deploy.

1. In Railway, create a service from this GitHub repository. It redeploys on
   every push to `main`.
2. Add a **Postgres** database to the project (New → Database → PostgreSQL).
3. In the app service's **Variables**, add
   `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   (the name inside `${{ }}` must match the database service's name exactly).
4. Deploy. The log should say `Storage: Postgres (from DATABASE_URL).` and
   `/healthz` reports `"storage":"postgres"`. The tables (`mc_users`,
   `mc_sessions`, `mc_clubs`) are created automatically on first start.
5. Under Settings → Networking, generate a domain or add `murdrclub.com`.

If `DATABASE_URL` is mistyped, the deploy fails with a message saying so,
rather than quietly running without the database. If it is missing
altogether, the server falls back to the file store and warns that
everything will be wiped on the next deploy.

Nothing is kept in server memory, so you can raise the replica count:
requests lock the club's row while they change it, and the phase timers on
different replicas skip clubs another replica is already handling.

## What the MVP does

| Area | In the MVP |
|---|---|
| Accounts | Name and password (scrypt), HttpOnly session cookie |
| Clubs | 8–25 members. **Private** (the default): invitation only. The host sends the code or link privately, or invites registered players by name, and the invitation appears on their My clubs page. Only the host can see a private club's code. **Public**: listed under Open clubs for anyone to join. **No late joiners**: nobody joins after the season starts. Practice bots available. |
| Season length | `ceil(players × 0.5)` days, fixed when the club opens. Shown as "Day 3 of 13". |
| Roles | Membership cards dealt at random: 1 Murderer with 8–9 players, 2 at 10–13, 3 at 14–19, 4 at 20–25. Murderers know each other. |
| Daily cycle | **Errands** (until 18:00) → **The Tribunal** (until 21:00) → **The Back Room** (until 08:00), in the club's own time zone and steady through daylight-saving changes. Fast clubs use minutes instead, for testing. |
| Errands | One trivia question a day. Each correct answer adds 100 points to **the Vault**. |
| The Tribunal | Secret votes that can be changed until the deadline. A blackballing needs a **majority of the living**; otherwise the Club is Undecided. Every ballot goes on the record. |
| Revealing cards | The card of anyone eliminated (blackballed, murdered or resigned) is turned over **until only 5 players remain**. After that, cards stay face down until the season ends, when every card is revealed. |
| The Back Room | Murderers vote on a victim (most votes wins, ties drawn by lot), plus a private chat. The victim is announced at dawn by the Proprietor. |
| Strikes | Missing 3 Tribunals means the player resigns their membership. |
| The Last Toast | Starts when 5 or fewer are alive, **or** on the season's final day, whichever comes first. There are no more murders, and each Tribunal blackballs someone (most votes; ties drawn by lot) unless every survivor chooses **Raise a Glass**. The final day's Tribunal closes the season. If a Murderer is still alive at the end, the Murderers take the Vault. Otherwise the surviving Members share it. |
| Chat | **The Lounge** (everyone), **the Back Room** (Murderers only), **the Cellar** (the departed only). After the season ends, every room and every card opens up for the recap. |
| Host | Starts the season, adds bots, and can **End phase now** |

### What each player can see

The server works out each player's view in `game.view()` and sends only that.
A Member's browser never receives anyone else's role, the Back Room chat, the
Murderers' picks, or the Errand's answer key. There are tests for this.

## Layout

```
server.js          HTTP server and API; a timer moves clubs to their next phase
lib/game.js        the rules engine: pure functions on a club object
lib/schedule.js    Club Time: the next 18:00 / 21:00 / 08:00 in a time zone
lib/content.js     Errand questions, murder notices, bot names
lib/auth.js        passwords and sessions
lib/store.js       storage: Postgres, or a local JSON file in development
lib/db.js          finding and connecting to Postgres
public/            the single-page app
test/              node:test suites
```

## API

All POSTs send JSON (`Content-Type: application/json`). That requirement is the
CSRF guard.

```
POST /api/signup  /api/login  /api/logout      GET /api/me
GET  /api/clubs                your clubs + invitations waiting for you
GET  /api/clubs/open           public clubs still in the lobby
POST /api/clubs {name, visibility: private|public, pace, timeZone, fastMinutes}
POST /api/clubs/join {code} | {id}   (id: public clubs, or private ones you were invited to)
POST /api/invitations/:clubId/decline
GET  /api/clubs/:id            the club as you are allowed to see it
POST /api/clubs/:id/start | leave | bots {count} | advance | invite {name} | uninvite {userId}
POST /api/clubs/:id/errand {choice} | vote {targetId} | toast {choice} | murder {targetId}
POST /api/clubs/:id/messages {channel: lounge|backroom|cellar, text}
```

## Known limits and what comes next

- **Seasons often end early.** In 300 simulated all-bot seasons per size, a
  season ended before its last day when the Members caught every Murderer or
  the Murderers reached parity: about 1 in 3 at 8 players and 2 in 3 at 25.
  That is by design. The length is a maximum.
- **Invitations by name only.** There is no email yet, so the host invites
  people who already have an account, or sends the code or link privately
  themselves.
- **The host can end phases early**, which a host who is also a Murderer could
  abuse. That is acceptable for private clubs of friends; for public clubs,
  restrict it.
- **Not in the MVP yet:** Alibis, the Invitation (recruiting) and the Sealed
  Envelope, Tribunal runoffs, Whispers (DMs), push and email notifications,
  password reset, chat moderation and reporting, public matchmaking, cash
  Vaults.
