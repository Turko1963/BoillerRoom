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

## Market backdrop, events and chart levels

- **Regime** (`server/engine/regime.js`): VIX, the S&P 500 against its 200 day average, the 10 year yield and the
  dollar (plus the Bitcoin trend for crypto) give risk-on, neutral or risk-off. Risk-off halves the size, raises the bar
  for a Buy and trims conviction.
- **Events:** the next earnings report and ex-dividend date inside the horizon (Yahoo calendar). Earnings ahead: half
  size, and lower conviction for traders when the report is 2 days away or less.
- **Chart levels:** stops sit half an ATR beyond real support (or resistance for shorts), at least 1.5 ATR away; targets
  sit at the next real resistance (or support), or the analyst target for investors. If the reward is under 1.5 times the
  risk at those levels, the room holds.

## Scoreboard (`server/engine/scoreboard.js`)

- Every live call is graded against the real close 10 sessions later (Trader) or 60 (Investor), and so is each desk's
  stance after the debate.
- After 5 graded calls in a mode, vote weights follow the record: standard weight x (2 x hit rate), with a prior of 5
  right out of 10, limited to 0.6x to 1.5x.
- Approved tickets are replayed over real candles: target hit, stopped out, closed at the horizon (20 sessions for
  traders, 250 for investors) or still open, with P&L and book exposure.
- `GET /api/scoreboard` and `GET /api/portfolio`; the Scoreboard tab in the room shows both. Grading runs a minute
  after start and every 30 minutes.

## Brains: Rules, Claude, Gemini or Both

- **Both:** Claude and Gemini each read every desk. When they agree the desk's confidence rises (average + 5); when they
  disagree it keeps the more confident view at average - 10 and notes the other model's view. Claude writes the debate
  and the memo (Gemini if Claude fails). Needs both keys and costs about twice a single brain.


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
| `ACCESS_CODE` | none | **Required.** The six digit members code for the BackStage Capital gate. Unset: the room stays locked |
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

### Automatic deploy

`scripts/deploy.sh` checks GitHub for new commits on the server's current branch. If there are any, it pulls them,
installs packages if they changed, runs the tests and restarts the pm2 app `boiler-room`, but only when the tests
pass (otherwise it rolls back). Log: `data/deploy.log`. Run it every minute from cron:

```bash
chmod +x ~/BoillerRoom/scripts/deploy.sh
(crontab -l 2>/dev/null; echo "* * * * * $HOME/BoillerRoom/scripts/deploy.sh") | crontab -
```

## The members gate

`/` is public: the BackStage Capital intro and the code screen (`public/index.html`, no room code in it).
`/room` is the Boiler Room (`server/views/room.html`), served only with a valid session.

| Method | Path | What it does |
|---|---|---|
| POST | `/api/unlock` | Body `{ code }`. Right code: 200 and a 12 hour `HttpOnly; Secure; SameSite=Lax` session cookie. Wrong: 401. More than 5 failed tries in 15 minutes from one IP: 429 |
| GET | `/api/session` | 200 with a valid session, else 401 |
| POST | `/api/logout` | Ends the session and clears the cookie (the lock button) |

A code opens the room for one page load: reloading `/room` (or opening it in another tab, or coming back with the
browser's back button) ends the session and goes back to the intro, and `/` always plays the intro and asks for the
code. The open room keeps working until then.
Every other `/api/*` route answers 401 without a session; `/room` redirects to `/`. Sessions are stored in SQLite as
SHA-256 hashes, so a deploy does not log anyone out. Every code attempt is logged (pm2 logs and the `auth_attempts` table).

## How it fits together

```
public/index.html        Public: the BackStage Capital intro and members code screen
server/views/room.html   The Boiler Room (one file, no build), served at /room behind a session
server/auth.js           Members gate: code check, sessions, rate limit, attempt log
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
