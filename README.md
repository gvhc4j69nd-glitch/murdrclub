# MurdrClub

**murdrclub.com**: an online murder-mystery game for up to 25 friends. A few
players are secretly **Murderers**. Every night they murder a **Member**. Every
day the Club meets at **the Tribunal** to blackball the person it suspects. The
Members win by unmasking every Murderer. The Murderers win if any of them
survive to the end.

This folder is the MVP. It has no dependencies and no build step: plain Node on
the server and plain HTML, CSS and JS in the browser.

```sh
cd murdrclub
npm start        # http://localhost:4400
npm test         # rules engine, Club Time, and an end-to-end HTTP game
```

To try a whole game alone: create a **Fast** club, add practice bots
(**+5 bots**), open the club, and use **End phase now** to move through the
phases.

## What the MVP does

| Area | In the MVP |
|---|---|
| Accounts | Name and password (scrypt), HttpOnly session cookie |
| Clubs | Found a club, invite by code or link, 4–25 members (10+ recommended), practice bots |
| Roles | Membership cards dealt at random: 1 Murderer under 10 players, 2 at 10–13, 3 at 14–19, 4 at 20–25. Murderers know each other. |
| Daily cycle | **Errands** (until 18:00) → **The Tribunal** (until 21:00) → **The Back Room** (until 08:00), in the club's own time zone and steady through daylight-saving changes. Fast clubs use minutes instead, for testing. |
| Errands | One trivia question a day. Each correct answer adds 100 to **the Vault**. |
| The Tribunal | Secret votes that can be changed until the deadline. A blackballing needs a **majority of the living**; otherwise the Club is Undecided. The blackballed player's card is revealed, and every ballot goes on the record. |
| The Back Room | Murderers vote on a victim (most votes wins, ties drawn by lot), plus a private chat. The victim is announced at dawn by the Proprietor. |
| Strikes | Missing 3 Tribunals means the player resigns their membership. |
| The Last Toast | At 5 or fewer alive there are no more murders. Each Tribunal blackballs someone unless every survivor chooses **Raise a Glass**. If a Murderer is still alive when that happens, the Murderers take the Vault. |
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
lib/store.js       in-memory state saved to data/murdrclub.json
public/            the single-page app
test/              node:test suites
```

## API

All POSTs send JSON (`Content-Type: application/json`). That requirement is the
CSRF guard.

```
POST /api/signup  /api/login  /api/logout      GET /api/me
GET  /api/clubs                POST /api/clubs {name, pace, timeZone, fastMinutes}
POST /api/clubs/join {code}
GET  /api/clubs/:id            the club as you are allowed to see it
POST /api/clubs/:id/start | leave | bots {count} | advance
POST /api/clubs/:id/errand {choice} | vote {targetId} | toast {choice} | murder {targetId}
POST /api/clubs/:id/messages {channel: lounge|backroom|cellar, text}
```

## Known limits and what comes next

- **Season length.** With a murder every night, a 25-player club usually ends in
  about **12 days**: the median over 300 simulated all-bot seasons was 12, with
  a range of 6 to 17. Stretching a season to a month needs the V2 pacing tools
  from the design: **Alibis** won on Errands that block a murder, and a pacing
  dial that controls how many Alibis are handed out.
- **Storage** is a single JSON file in one process. Before real launch, move it
  to Postgres, which also allows more than one server instance.
- **The host can end phases early**, which a host who is also a Murderer could
  abuse. That is acceptable for private clubs of friends; for public clubs,
  restrict it.
- **Not in the MVP yet:** Alibis, the Invitation (recruiting) and the Sealed
  Envelope, Tribunal runoffs, Whispers (DMs), push and email notifications,
  password reset, chat moderation and reporting, public matchmaking, cash
  Vaults.
