# Boiler Room

Seven AI desks research a stock, debate each other, vote, and hand you a decision memo with a trade ticket.
You approve the ticket and the Dealer works the order in slices.

Real market data, free and without API keys: US stocks from **Yahoo Finance** and **SEC EDGAR**, crypto from **Binance**.
Execution is **paper only**: approved tickets are simulated and saved, nothing is sent to a broker.
An offline demo mode with fictional companies is still there (`MARKET_PROVIDER=demo`).

## Where each desk gets its data

| Desk | Stocks | Crypto |
|---|---|---|
| Market Analyst | Yahoo analyst ratings, Yahoo news headlines, 1-month move vs the S&P 500 | Binance taker buy/sell share, Yahoo news, 1-month move vs Bitcoin |
| Filings Specialist | SEC 10-K figures: free cash flow vs net income, receivables vs revenue, latest 10-K/10-Q | Not applicable (no audited accounts) |
| Fundamental Analyst | Yahoo analyst target price, operating margin, return on equity, net debt / EBITDA | Price vs its own 1-year average, high and low |
| Technical Analyst | 200 and 50 day averages, RSI 14, volume on up vs down days (Yahoo candles) | Same, from Binance candles |
| M&A Specialist | SEC 13D (activist) and merger filings in the last year, EV/EBITDA, market value (an estimate) | Not applicable |
| Risk and Leverage | 30 day realised volatility: size, leverage, stop | Same, leverage always 1x |
| Dealer | 20 day average volume and dollar volume: slices, days, slippage | Same, from Binance volume |

Each desk shows what it is doing while it works, and its report lists the sources it used (tap a desk).
The debate and the vote run on these real reports; the opinions are rule-based (no AI model yet).

## Brains: Rules, Claude or Gemini

The switch in the header picks who does the thinking:

- **Rules** (default, free, instant): each desk follows fixed rules on its real data.
- **Claude** or **Gemini**: each of the seven desks is a model call that reads its own real data and the news and
  writes its view; one call writes a real debate where desks can change their minds; one call writes the
  Floor Manager's memo. A round takes roughly 20 to 60 seconds and costs a few cents.

The vote, position size, stop and ticket are always computed in code, never by the model.
If a model call fails, that step falls back to the rules version and the wire says so.
Turn a brain on by adding `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` to `.env`; without a key its button is greyed out.

Briefs can name a ticker (`NVDA`, `BTC`, `ETH-USD`) or a company or coin name (`Apple`, `Bitcoin`).

Caveats: Yahoo Finance is unofficial and can change or rate-limit without notice. SEC data covers US filers only.
Nothing here is investment advice.

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
| `MARKET_PROVIDER` | `live` | `live` (Yahoo, SEC, Binance) or `demo` (fictional, offline) |
| `SEC_USER_AGENT` | generic | SEC asks for a contact email: `BoilerRoom you@yourdomain.com` |
| `BOOK_SIZE` | `10000000` | Paper book size in dollars (Dealer slippage estimate) |
| `ANTHROPIC_API_KEY` | none | Turns on the Claude brain |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Claude model |
| `GEMINI_API_KEY` | none | Turns on the Gemini brain |
| `GEMINI_MODEL` | newest stable flash | Gemini model |
| `ACCESS_PASSWORD` | none | Password for the whole site (browser login box, any user name). Set it on any public server |

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
server/engine/case.js    Demo desk reports, and decide(): debate, vote, decision, ticket (shared)
server/engine/desks.js   The seven desks on real data, one function each
server/engine/indicators.js  RSI, moving averages, volatility
server/market/live.js    Live provider: finds the ticker, gathers data in parallel, runs the desks
server/data/             Yahoo Finance, Binance and SEC EDGAR clients (with caching)
server/ai/               Claude (official SDK) and Gemini (REST) clients: one structured JSON call each
server/engine/ai.js      The AI brain: desk prompts and data, the debate, the memo, fallbacks
server/engine/team.js    The seven desks, modes and vote weights
server/engine/execute.js Paper fills for an approved ticket
server/engine/random.js  Seeded random helpers (same brief = same round)
server/market/demo.js    Demo provider: fictional names, prices, movers, candles
server/store/db.js       SQLite: rounds and orders
test/                    API and engine tests (node --test)
```

## API

| Method | Path | What it does |
|---|---|---|
| GET | `/api/health` | `{ ok, market, brains }`: market is `live` or `demo`; brains lists which are set up |
| GET | `/api/market/movers` | Top stock and crypto gainers and losers for the tape |
| GET | `/api/market/chart/:ticker` | 56 daily candles, last price, session open |
| POST | `/api/rounds` | Body `{ brief, mode, brain }` (`mode` is `trader` or `investor`; `brain` is `rules`, `claude` or `gemini`). Runs the room and returns the full round. Saved. 422 if no ticker is found, 502 if a data source is down. |
| GET | `/api/rounds?limit=20` | Recent rounds (summary) |
| GET | `/api/rounds/:id` | One round, with its order if executed |
| POST | `/api/rounds/:id/execute` | Approve the ticket: paper fill in slices at the current price. 409 if the call was Hold or it was already executed. |
| GET | `/api/orders?limit=50` | Executed paper orders |

A round contains: `tk`, `name`, `p` (last price), `R` (each desk's report: stance, confidence, headline, findings),
`M` (the tile value and format for each desk), `ANN` (chart lines), `debate`, `changes`, `tally`, `call`, `conv`, `why` and `ticket`.

## Roadmap

1. **More data:** Finnhub (free key) for richer news and earnings dates; non-US filings.
2. **Live streaming:** stream AI desk results to the page as each finishes, instead of after the whole round.
3. **History and portfolio views** in the frontend, on top of `/api/rounds` and `/api/orders`.
