# Boiler Room: notes for Claude Code

Read README.md first for the layout, the API and how to run it.

## The one idea to keep in mind

`server/engine/case.js` `makeCase(brief, mode, market)` produces a whole round as one JSON object.
`public/index.html` only animates that object: desks working, tiles filling, the debate, the vote, the memo.
Keep that contract. If you change the shape of the round, update the frontend in the same change.

- The engine is deterministic: the same brief and mode always give the same round. Do not trim the brief before
  hashing; "Run again" in the frontend appends a space to get a different round.
- `makeCase()` was ported unchanged from the original in-browser code (verified identical on 400 briefs).
  Tile formats are names (`int`, `pct`, `pct1`, `usd`, `bps`) mapped to formatters by `FMT` in the frontend.
- A market provider exposes `name`, `priceOf(k)`, `companyName(k)`, `movers()` and `chart(k)`. See `server/market/demo.js`.

## Frontend

- One self-contained file, no build step, no framework. Keep it that way unless asked.
- The code is dense on purpose (short names, one-liners). Match the surrounding style when editing it.
- The API client is the `API` object near the top of the script. All server calls go through it.
- Visual details for the desks (colours, icons, bot faces) live only in the frontend (`AG`, `BOT`).
  Names, ordering and vote weights also exist on the server in `server/engine/team.js`; keep both in sync.
- The header says "Demo data, fictional companies". Keep it true: if real tickers or prices are added, update the
  label and keep execution paper-only unless the owner explicitly decides otherwise.

## Commands

```bash
npm install
npm test          # node --test, must pass before committing
npm run dev       # http://localhost:3000, restarts on changes
```

Node 22.13+ is required (`node:sqlite`). The `--disable-warning=ExperimentalWarning` flag in the npm scripts only
hides the SQLite experimental notice.

## Conventions

- ES modules, no TypeScript, no build. Express is the only runtime dependency; add others only with a reason.
- Validate every request body in `server/app.js` and return `{ error }` JSON with a proper status code.
- Add or update a test in `test/` for every API change.
