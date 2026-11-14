# Boiler Room

Seven AI desks research a stock, debate each other, vote, and hand you a decision memo with a trade ticket.
You approve the ticket and the Dealer works the order in slices.

Demo data only: fictional companies, simulated prices, paper fills. Nothing is sent to a broker.

## Run it

Needs **Node.js 22.13 or newer**. Nothing else (the database is SQLite, built into Node).

```bash
npm install
npm start            # http://localhost:3000
npm run dev          # same, restarts on file changes
npm test
```

Settings come from environment variables, or from a `.env` file (copy `.env.example`):

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `HOST` | `0.0.0.0` | Interface to bind |
| `DB_PATH` | `data/boilerroom.db` | SQLite file for rounds and orders |
| `MARKET_PROVIDER` | `demo` | Market data source (only `demo` today) |

## Deploy to a server

**With Node directly** (keep it running with pm2, systemd or tmux):

```bash
git clone https://github.com/Turko1963/BoillerRoom.git && cd BoillerRoom
npm ci --omit=dev
cp .env.example .env        # edit if needed
npm start
# or: npx pm2 start npm --name boiler-room -- start
```

**With Docker:**

```bash
docker build -t boiler-room .
docker run -d --name boiler-room -p 3000:3000 -v boiler-room-data:/app/data boiler-room
```

Put Nginx or Caddy in front for HTTPS. Updating is `git pull` then restart.

## How it fits together

```
public/index.html        The whole frontend (one file, no build). Animates what the API returns.
server/index.js          Entry point: config, database, starts the server
server/app.js            Express app: serves public/ and the /api routes
server/engine/case.js    The brain: brief -> desk reports, debate, vote, decision, ticket
server/engine/team.js    The seven desks, modes and vote weights
server/engine/execute.js Paper fills for an approved ticket
server/engine/random.js  Seeded random helpers (same brief = same round)
server/market/demo.js    Demo market data: names, prices, movers, candles
server/store/db.js       SQLite: rounds and orders
test/                    API and engine tests (node --test)
```

## API

| Method | Path | What it does |
|---|---|---|
| GET | `/api/health` | `{ ok, market, engine }` |
| GET | `/api/market/movers` | Today's top gainers and losers for the tape |
| GET | `/api/market/chart/:ticker` | 56 daily candles, last price, session open |
| POST | `/api/rounds` | Body `{ brief, mode }` (`mode` is `trader` or `investor`). Runs the room and returns the full round. Saved. |
| GET | `/api/rounds?limit=20` | Recent rounds (summary) |
| GET | `/api/rounds/:id` | One round, with its order if executed |
| POST | `/api/rounds/:id/execute` | Approve the ticket: paper fill in slices. 409 if the call was Hold or it was already executed. |
| GET | `/api/orders?limit=50` | Executed paper orders |

A round contains: `tk`, `name`, `p` (last price), `R` (each desk's report: stance, confidence, headline, findings),
`M` (the tile value and format for each desk), `ANN` (chart lines), `debate`, `changes`, `tally`, `call`, `conv`, `why` and `ticket`.

## Roadmap

1. **Real market data:** add a provider next to `server/market/demo.js` with the same four functions and select it with `MARKET_PROVIDER`.
2. **Claude-powered desks:** replace `makeCase()` with one model call per desk plus a real debate, and stream events to the page so the animation plays live.
3. **History and portfolio views** in the frontend, on top of `/api/rounds` and `/api/orders`.
