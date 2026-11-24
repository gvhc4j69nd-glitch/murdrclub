# MurdrClub: The Reading of the Will

**murdrclub.com**: a ruthless online card game for four.

Four heirs wait out eight stormy nights at the Club for the reading of the
will. The fortune goes to the richest heir still breathing, so the obvious
strategy is to make sure nobody else is. Bank your bequests, blackmail your
rivals, forge the will, betray your partner. When the lights go out, play a
card into the Shadows. Nobody sees who struck.

```sh
npm install
npm start        # http://localhost:4400
npm test         # rules, bots, storage, and whole games over HTTP
```

To try it alone: set a table, press **Fill seats with bots**, and deal.

## How a game works

**Four heirs, eight rounds.** Each heir starts with 4 Blood, 5 cards and an
allowance of 3 Fortune. Each round has three parts:

| Phase | How | What happens |
|---|---|---|
| **Day** | In turn, in the open | Draw 2 cards, play up to 2 Day cards, end your turn. Turn order snakes (1-2-3-4, then 4-3-2-1) so the last to move goes first next round. |
| **Night** | Everyone at once, face down | Every heir plays exactly one card into the Shadows: a weapon aimed at someone, a defense, or anything else as a bluff. Attacks are resolved anonymously. The Proprietor names the weapon, never the attacker. |
| **Inquest** | Public vote | Accuse an heir. A majority of the living arrests them: a fine of 3, their whole hand thrown out, Suspicion wiped, and the next Night in a cell. |

**Winning.** If one heir is left alive, they inherit at once. If nobody
survives, the cat does. Otherwise the will is read after round 8: the living
heir with the most Fortune (bequests plus coins) wins. The most infamous
living heir first gets +4, because the Club rewards ruthlessness. Ties go to
the less suspicious heir, and then are drawn by lot.

**Murdered heirs are out.** Their hand and Estate are lost. They can watch
but can't play, vote or talk at the table.

### The deck (72 cards)

| Weapons (20), Night | Defenses (16) | Schemes (20), Day | Inheritance (16), Day |
|---|---|---|---|
| Dagger ×5: 1 wound, silent | Alibi ×4: Night, cancels one attack; covers your Pact partner too | Blackmail ×4: take 3 Fortune; +1 Infamy, +1 Suspicion | Bequest worth 1, 2, 3 or 4 ×4 each, played face down into your Estate. Others see how many you have, not their value. |
| Poison ×4: 1 wound now, 1 more at the next dawn unless cured; gets past Bodyguards | Bodyguard ×4: Day, takes the next wound | Frame ×3: give an heir 2 Suspicion, shed up to 2 of yours | |
| Candlestick ×4: 1 wound, victim drops 2 cards | Antidote ×3: Day, cures Poison or heals 1 | Forged Will ×3: swap your cheapest bequest for a random one of theirs | |
| Rope ×4: 1 wound; against an heir on their last Blood it ignores Bodyguards | Secret Passage ×3: Night, the first attack on you goes to the heir on your left | Search ×3: secretly see an heir's hand and last night's card | |
| Revolver ×3: 2 wounds, but loud: the shooter is named and gains 2 Suspicion | Locked Door ×2: Night, cancels every attack on you | Pickpocket ×3: take a random card from an heir | |
| | | Power Cut ×2: every hand passes left | |
| | | Fire in the Library ×2: everyone drops 2 random cards | |

### Ruthlessness

- **Pacts:** two heirs can seal a Pact at any time. While it lasts, either
  partner's Alibi covers both. Attacking your own partner is a **stab in the
  back**: double wounds, +3 Infamy, the Pact ends, and everyone hears about
  it.
- **Infamy:** Blackmail and betrayal earn Infamy in public. Each murder earns
  +2 Infamy **in secret**, revealed at the Reading, where the most infamous
  heir collects +4 Fortune.
- **Suspicion:** loud crimes and Blackmail raise it, and it's what the Inquest
  votes on. Frame shifts it onto somebody else.

### Modes

| Mode | Day turn | Night | Inquest |
|---|---|---|---|
| **Live** | 45 seconds | 30 seconds | 30 seconds |
| **Timed** | up to 1 day | up to 1 day | up to 1 day |

In both modes a phase ends as soon as everyone has acted. Bots act instantly.
If an heir runs out of time, their turn ends; at Night, a random card from
their hand is lost as a bluff; at the Inquest, they abstain.

### Tables

- **Private** (the default): invitation only. The host shares the code or
  link privately, or invites players by name, and the invitation appears on
  their My tables page. Only the host sees a private table's code.
- **Public:** listed under Open tables for anyone to take a seat.
- Exactly four seats. Bots fill empty ones. **No late joiners.**
- **Chat:** the Table (everyone) and Whispers (between two heirs). At the end,
  every whisper, every Estate and every card played into the Shadows each
  Night is revealed.

## Balance

`test/game.test.js` plays 500 seeded all-bot games on every test run. A
longer run of 6,000 games, at the time of writing, gave:

| | |
|---|---|
| Wins by seat | 23–26% each |
| Decided at the Reading / last heir standing / nobody survives | 75% / 25% / under 1% |
| Murders per game | 2.1 (first usually on night 3) |
| Arrests per game | 3.3 |

Two rules came out of balance testing. The **snake turn order** spreads the
advantage of moving first. The **starting allowance** gives everyone something
to Blackmail on the first turn; before it, late movers in round 1 were the
only ones who could Blackmail, and they became the obvious targets.

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

If `DATABASE_URL` is mistyped, the deploy fails with a message saying so. If
it is missing altogether, the server falls back to a local file and warns
that everything will be wiped on the next deploy. Nothing is kept in server
memory, so more than one replica can run.

Accounts carry over from the earlier version of the game. Tables from that
version are ignored and no longer listed.

**Storage locally:** without `DATABASE_URL` the server saves to
`data/murdrclub.json`. To run the tests against Postgres too:

```sh
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/murdrclub_test npm test
```

## Layout

```
server.js          HTTP server and API; a timer handles deadlines
lib/game.js        the rules engine and the bots: pure functions on a table object
lib/content.js     the cards, murder notices, bot names
lib/auth.js        passwords and sessions
lib/store.js       storage: Postgres, or a local JSON file in development
lib/db.js          finding and connecting to Postgres
public/            the single-page app
test/              node:test suites
```

## API

All POSTs send JSON (`Content-Type: application/json`), which is the CSRF
guard. The URLs still say `clubs`; a club is a table.

```
POST /api/signup  /api/login  /api/logout      GET /api/me
GET  /api/clubs                your tables + invitations waiting for you
GET  /api/clubs/open           public tables still in the lobby
POST /api/clubs {name, mode: live|timed, visibility: private|public}
POST /api/clubs/join {code} | {id}
POST /api/invitations/:id/decline
GET  /api/clubs/:id            the table as you are allowed to see it
POST /api/clubs/:id/start | leave | bots {count} | invite {name} | uninvite {userId}
POST /api/clubs/:id/play {cardId, targetId?}     Day card
POST /api/clubs/:id/endturn
POST /api/clubs/:id/night {cardId, targetId?}    one card into the Shadows
POST /api/clubs/:id/vote {targetId | null}
POST /api/clubs/:id/pact {op: propose|accept|decline|break, targetId?}
POST /api/clubs/:id/messages {channel: table|whisper, to?, text}
```

## Not built yet

- Quick Play matchmaking and a ratings ladder
- Notifications when it's your move (important for Timed mode)
- Animations, and more card sets
- Password reset, and moderation and reporting for chat
- Smarter bots: they play a plain, ruthless strategy and never seek Pacts
  with each other
