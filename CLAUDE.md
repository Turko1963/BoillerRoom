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
- Second-layer sources (`crowd.js`, `defillama.js`, `derivs.js`, `finra.js`, `ftc.js`, plus the deeper Yahoo and SEC calls)
  land in `x.ext` in `gather()`. Each is optional: wrapped in `breaker()` (pauses after a block) and `within()` (time cap),
  and missing in tests unless a test passes a fake. Desks still return exactly three findings. `test/deep.test.js` covers them;
  `npm run check:sources` checks them live (server only).
- AI brains (`server/engine/ai.js`): `think()` rewrites the seven desk views (stance, confidence, headline, findings) and
  returns a debate `plan` for `decide()`; `finish()` adds the memo. Vote, size, stop and ticket stay in code. Each step
  falls back to rules on failure and logs it in `round.brain.fallbacks`. Providers live in `server/ai/` and share
  `ask({system, prompt, schema, effort})` returning `{data, model, usage}`. Claude uses the official SDK
  (`@anthropic-ai/sdk`) with structured outputs and server-side refusal fallbacks. `test/ai.test.js` uses a fake model:
  never call real models from tests.

- `decide()` also takes `weights` (learned, from `server/engine/scoreboard.js`) and `adjust` (regime, events and chart
  levels, from `server/engine/regime.js` and `chartLevels()`). Both default to null, which keeps demo rounds identical.
- Brains: `rules`, `claude`, `gemini`, `both` (`server/engine/ai.js`; `mergeViews()` combines two models' desk views).

- Bull vs Bear add-on: `public/bullbear/` (component unchanged; `bullbear-adapter.js` and `bullbear-intro.js` are the only
  callers). The room only emits `boilerroom:*` events; the intro calls `window.BBIntro.start(film)` after the shatter and
  holds its clock while the fight plays. `server/features.js` adds the files to `/` and `/room` only when the flag is on.

- Volatility alert: `server/engine/volwatch.js` (five checks, 3 of 5 = alert, sources injected), `public/watch.js` (shared by
  both pages: polling, ring, notification). `GET /api/watch/:key` sits before `apiGuard` on purpose and answers only the watch.
  `test/watch.test.js` covers it.

- Crowd panel: `server/engine/crowdview.js` (`crowdRead`, `versus`, `crowdFor` with injected sources; `createApp({ crowdSources })`
  in tests), Reddit buzz from ApeWisdom in `server/data/crowd.js`. Unavailable sources are listed, never guessed. `test/crowd.test.js`.

- AI accuracy (see README "Accuracy"): per-brain grading (`brainRecords`), filings text for AI brains (`gather(..., { deep })`),
  a fact-check call in `think()` (the fake model in tests answers the `checks` schema), `deskMemory`, `baseRate`, `splitBrains`.
  `round.baseRate` is new in the round object; the room shows it on the wire.

- Broker (cTrader demo): `server/broker/ctrader.js` (Open API, JSON over WebSocket; payload numbers in `PT`),
  `server/broker/service.js` (rules in `LIMITS`, `preview`, `send`, the position manager `tick()` and the pure `manageStep()`).
  Built in `server/index.js` only with the live market and `CTRADER_*` keys; `createApp({ broker })` in tests with a fake client
  (`test/broker.test.js`). Demo accounts only unless `CTRADER_ENV=live`. Every risk-adding order needs a person's tap;
  protective moves are automatic. Tokens are encrypted in `broker_kv`; never send them to the page or print them.
- Trade plan: `server/engine/plan.js` (`tradePlan(round)`, pure; numbers from `RULES` in manage.js and the backtest in
  `TESTED`), attached as `round.tradePlan` in `POST /api/rounds` (and filled in for older saved rounds). The room's Trade plan tab
  renders it, sizes it for the account typed there, copies it as text and draws it as a PNG. The broker link is on hold:
  `BROKER` defaults to off. `test/plan.test.js`.
- Paper broker: `server/broker/paper.js` has cTrader's client interface on real quotes (`BROKER=paper`; its own
  `data/paper.db`). `client.env` ('paper') and `client.autoLink` are the only things the service checks. `test/paper.test.js`.

- Tel Aviv: `server/data/tase.js` (names, `.TA` symbols, US counterparts), agorot to shekels in `server/data/yahoo.js`,
  `withCurrency()` (`server/engine/currency.js`) around the synchronous desks and `decide()` so `usd()`/`money()` write ₪.
  Round fields `currency`, `exchange`, `counterpart`, `benchName`; the room's `usd(v, k)` picks ₪ for `.TA`.

- Hebrew: `public/i18n.js` (shared by both pages; `I18N.t()`, phrases `E`, templates `P`) translates the interface; the room's
  `type()` and canvas labels call `I18N.t()`. New interface text needs a Hebrew entry there (`test/i18n.test.js`). Round text
  is translated server side by `translateRound()` (`server/engine/translate.js`, cached in `translations`); the round is
  always saved in English. Elements whose text the code reads back carry `translate="no"` (`#tk`).

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
- The header label comes from `/api/health` (live or demo). Execution is paper, or the cTrader DEMO account through the broker
  link; live money only if the owner explicitly decides it (`CTRADER_ENV=live`).

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
