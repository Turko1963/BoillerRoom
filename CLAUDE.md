# Boiler Room: notes for Claude Code

Read README.md first for the layout, the API and how to run it.

## The one idea to keep in mind

A provider's `round(brief, mode)` produces a whole round as one JSON object: `server/market/live.js` (real data,
default) or `server/market/demo.js` (fictional, offline). Both end in `decide()` in `server/engine/case.js`,
which runs the debate, the vote and the ticket.
`server/views/room.html` (served at `/room`) only animates that object: desks working, tiles filling, the debate, the vote, the memo.
Keep that contract. If you change the shape of the round, update the frontend in the same change.

- Demo rounds are deterministic (same brief and mode, same round); live rounds seed the debate with brief, mode and
  date, so they only change when the data does. Do not trim the brief before
  hashing; "Run again" in the frontend appends a space to get a different round.
- `makeCase()` was ported unchanged from the original in-browser code (verified identical on 400 briefs).
  Tile formats are names (`int`, `pct`, `pct1`, `usd`, `bps`) mapped to formatters by `FMT` in the frontend.
- A market provider exposes `name`, `movers()`, `chart(k)`, `quote(k, assetClass)` and `round(brief, mode)` (all async).
- Live desks are in `server/engine/desks.js`: one function per desk, returning score, conf, headline, three findings,
  a tile metric, the four "work" lines shown while it works, and its sources. Tile format `text` shows the value as is (n/a, Loss).
- Data clients are in `server/data/`. Yahoo needs a cookie + crumb session (handled) and a plain `Mozilla/5.0` user agent
  (a full browser string gets 429). Binance uses the `data-api.binance.vision` mirror first (api.binance.com is geo-blocked
  in some regions). SEC needs a User-Agent with a contact email (`SEC_USER_AGENT`).
- `test/live.test.js` covers the live engine with fake sources, so tests never touch the network.
- AI brains (`server/engine/ai.js`): `think()` rewrites the seven desk views (stance, confidence, headline, findings) and
  returns a debate `plan` for `decide()`; `finish()` adds the memo. Vote, size, stop and ticket stay in code. Each step
  falls back to rules on failure and logs it in `round.brain.fallbacks`. Providers live in `server/ai/` and share
  `ask({system, prompt, schema, effort})` returning `{data, model, usage}`. Claude uses the official SDK
  (`@anthropic-ai/sdk`) with structured outputs and server-side refusal fallbacks. `test/ai.test.js` uses a fake model:
  never call real models from tests.

## Running in a Claude Code cloud session

Outbound HTTPS goes through a proxy there, and Node's fetch only uses it with `NODE_USE_ENV_PROXY=1`:
`NODE_USE_ENV_PROXY=1 npm run dev`. On a normal server this is not needed. The cloud environment "BoillerRoom"
allows Yahoo Finance, Binance and SEC hosts.

## Frontend

- Two pages. `public/index.html` is the public BackStage Capital intro and code screen: keep the room and any secret out of
  it (a test checks). `server/views/room.html` is the room, served at `/room` only with a session (`server/auth.js`).
  Tests that call the API use `createApp({ ..., openRoom: true })`; production never sets it.

- One self-contained file, no build step, no framework. Keep it that way unless asked.
- The code is dense on purpose (short names, one-liners). Match the surrounding style when editing it.
- The API client is the `API` object near the top of the script. All server calls go through it.
- Visual details for the desks (colours, icons, bot faces) live only in the frontend (`AG`, `BOT`).
  Names, ordering and vote weights also exist on the server in `server/engine/team.js`; keep both in sync.
- The header label comes from `/api/health` (live or demo). Execution is paper-only; keep it that way unless the owner
  explicitly decides otherwise.

## Commands

```bash
npm install
npm test          # node --test, must pass before committing
npm run dev       # http://localhost:3000, restarts on changes
```

Node 22.13+ is required (`node:sqlite`). The `--disable-warning=ExperimentalWarning` flag in the npm scripts only
hides the SQLite experimental notice.

## Conventions

- ES modules, no TypeScript, no build. Runtime dependencies: Express and the Anthropic SDK; add others only with a reason.
- Validate every request body in `server/app.js` and return `{ error }` JSON with a proper status code.
- Add or update a test in `test/` for every API change.
