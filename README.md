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

More sources (all free, `server/data/news.js` and `server/data/coingecko.js`):

- **News for the Market Analyst**, merged and de-duplicated, newest first: Yahoo Finance, **Google News** (its official
  RSS search, per stock or coin), the **Financial Times** (markets and companies feeds) and **Investing.com** (stock
  market and crypto feeds), plus **Crypto Jungle** (cryptojungle.co.il) for coins. Section feeds are filtered to the
  headlines that name the ticker or company. A feed that fails or blocks us is skipped (Crypto Jungle's Cloudflare
  currently blocks the server, so it is skipped until they allow it).
- **CoinGecko for coins:** market cap and rank, fully diluted value, circulating, total and maximum supply, all-time
  high, volume across all exchanges, sectors and community votes. The Filings desk now reads the **token supply** (how
  much is circulating, hard cap or not, dilution still to come), Fundamental adds rank and distance from the all-time
  high, the Market Analyst weighs the community vote, M&A shows the sector and the Dealer compares Binance volume with all
  exchanges. Optional `COINGECKO_API_KEY` (a free demo key) raises the rate limit.
- Not included: Google Finance and Finviz have no API and do not allow scraping (Finviz Elite's paid export could be
  added later).

**Second layer** (all free and keyless; each one optional, time-capped, and paused for 6 hours after a block, so a slow
or blocked source is skipped, never fatal):

| Desk | Stocks | Crypto |
|---|---|---|
| Market Analyst | StockTwits bullish/bearish tags, GDELT tone of world news (7 days) | Crypto Fear & Greed (alternative.me), StockTwits, GDELT |
| Filings Specialist | SEC Form 4 insider buys and sales (read from the filings), 8-K red flags (restatement, auditor change, delisting, bankruptcy), Yahoo insider summary | Token supply (CoinGecko) |
| Fundamental Analyst | Earnings surprises (last 4 quarters), this year's EPS estimate revisions, forward P/E against the biggest companies in the same industry (Yahoo screener) | DefiLlama TVL and fees (chains and protocols) |
| Technical Analyst | Weekly trend, 3-month strength against the SPDR sector ETF, options put/call ratio | Perpetual funding and open interest (Binance futures, then Bybit, then OKX) |
| M&A Specialist | SEC full-text search for deal language, Google News deal search, FTC early termination notices, new 13G holders | Sector (CoinGecko) |
| Risk and Leverage | VIX curve (9 day, 3 month), options implied volatility, overlap with tickets approved in the last 90 days (size cut by a third above 0.7 correlation) | Deribit DVOL (BTC, ETH), Binance long share, overlap with our tickets |
| Dealer | Bid/ask spread, FINRA short volume, volume by hour | Binance order-book depth within 1% and 2%, CoinGecko depth across exchanges |

The AI brains get the same data. Check every source live with `npm run check:sources` (on the server; it needs the
network). From our DigitalOcean server, StockTwits and FINRA are behind Cloudflare blocks and pause themselves, and
DefiLlama's venture raises need a paid plan, so they are not used.

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

### Personal codes

The same six-digit screen also takes **personal codes**. The shared `ACCESS_CODE` opens the room as a **viewer**
(everything except sending orders); a member's own code opens it with their role: **trader** (can send orders to the
broker) or **admin**. Codes are stored only as a salted scrypt hash. On the server, in the app folder:

```bash
npm run members -- add "Dana" trader    # prints Dana's code once
npm run members -- list
npm run members -- disable <id>         # the code stops working, open sessions end
```

## History: Professor Bubbles

Professor Bubbles (an original underwater history teacher: a round sea sponge with glasses and a sailor cap), on the right of the floor as the Scout's mirror, opens the History class: every brief given to the room,
newest first, with its call, conviction, mode and brain, and what would have happened if we had opened the position
the room offered, approved or not. Each ticket is replayed over the real daily prices since the call with the same rules
as the paper portfolio (first touch of the stop or target closes it, else marked at the last price; closed at the end of
the holding period). Hold calls show how the price moved while we stayed flat. Demo rounds are listed without results.
The top of the class sums it up: tickets offered, won, lost, open, the result as a % of the book, best and worst.
`GET /api/history?limit=100` (`history()` and `replay()` in `server/engine/scoreboard.js`).

## Bull vs Bear (add-on)

A bull and a bear fight in a strip under the room, following what the desks say, and one is knocked out when the
Floor Manager decides (Buy: the bull wins, Short or Sell: the bear wins, Hold: a draw). In the intro, the bull knocks
the bear out before the BackStage Capital logo forms from where the bull bursts.

- **Component:** `public/bullbear/` (`bullbear.js`, `bullbear.css`, `assets/`, its own `README.md` and `demo.html`),
  unchanged from the supplied package.
- **Adapters, the only files that call it:** `bullbear-adapter.js` (room) listens to the room's `boilerroom:*` window
  events (`brief`, `scout`, `report`, `speak`, `change`, `vote`, `decision`); `bullbear-intro.js` (intro) receives hooks
  from the film. `bullbear-boilerroom.css` places the strip and maps the theme colours.
- **Score:** for each side, the sum of confidence x vote weight over the desks that have reported, in the current mode
  (learned weights when the scoreboard has them).
- **Flag:** `BULLBEAR=on|off` in `.env` (default on), or `data/features.json` with `{"bullbear": false}`, which is
  re-read every few seconds: no deploy, no restart. With it off, `/` and `/room` are served exactly as without the add-on.
- **Safety:** if the component fails to load or throws, the strip is removed and the room carries on; if the intro fight
  never finishes, the film resumes on its own after 15 seconds.
- **Pictures:** `assets/bull.webp` and `assets/bear.webp` are watermarked stock previews used as placeholders. Replace
  them with the licensed files (same size and pose) before anyone outside the company sees the site. The intro is on
  the public page.

## Volatility alert (the bell)

The bell above the Technical Analyst watches one symbol (Oil, WTI, by default; also Brent, Gold, BTC, ETH or any stock) for a big
move coming. `server/engine/volwatch.js` runs five checks, each met or not:

1. **Fear index**: OVX (oil), GVZ (gold), VIX (stocks) or Deribit DVOL (BTC, ETH) above its alarm level or up 20% in 5 days.
2. **Futures curve**: front month against the next (Yahoo contracts such as `CLZ26.NYM`), a 1 point move in 5 days or a flip.
   Without a curve: daily swings 1.8x their 60 day norm.
3. **Event calendar**: EIA and API inventories, the rig count, Fed decisions, OPEC+ meetings in the news, earnings.
4. **Crowded positioning**: CFTC managed-money net position in the top or bottom 10% of 3 years (`server/data/cftc.js`),
   or lopsided Binance futures accounts for coins.
5. **Geopolitics and news**: three or more escalation headlines in 2 days (Google News).

3 or more = alert. `public/watch.js` (on the room and the code screen) asks the server every 2 minutes with a watch key it keeps
in the browser, so it keeps working after logout while a tab is open. An alert rings like a phone (Web Audio), shows a system
notification and makes the bell ring. Browsers allow sound only after a click on the page; the notification needs no click.
API: `POST /api/watch {symbol}` (members), `GET /api/watch/:key` and `DELETE /api/watch/:key` (the key alone, nothing else).

## Accuracy: how the AI is kept honest

- **Each brain is graded on its own** (Scoreboard tab, "Brains"): Rules, Claude, Gemini and Both, calls right and the average edge.
  The AI brains are only graded going forward: a model may already know what happened in past years, so a backtest of the AI
  on history would flatter it.
- **The words, not just the numbers** (AI brains only): the Filings desk gets the risk-factor sentences that are new since
  last year's 10-K (and how many were dropped), the Fundamental desk the latest earnings press release (8-K item 2.02,
  exhibit 99.1). `server/data/sec.js`: `riskChanges`, `earningsRelease`.
- **Fact-checker:** one more AI call checks every desk finding against that desk's own data; unsupported findings are
  corrected or replaced by the rules finding, and the wire says how many (`round.brain.factCheck`).
- **Memory:** each AI desk sees its graded record in this mode, its past calls on this ticker and its latest mistakes
  (`deskMemory` in `server/engine/scoreboard.js`).
- **Devil's advocate:** the AI debate must include one desk arguing against the majority, and the majority answering.
- **Base rate** (every brain, `server/engine/baserate.js`): how the price moved over the holding period after past days that
  looked like today; shown on the wire and given to the AI debate (`round.baseRate`).
- **Disagreement means a smaller position:** with Both, if Claude and Gemini agree on fewer than 60% of the desks, the size
  is cut to 60% and the memo says so (`splitBrains` in `server/market/live.js`).

## The crowd

The crowd button (top right of the floor) lights up after the vote and shows what traders and social media
think, next to the room's call (`server/engine/crowdview.js`, `GET /api/crowd/:ticker?assetClass=&call=&name=`):

- **Reddit buzz** from ApeWisdom (WallStreetBets, r/stocks, crypto subreddits): rank, mentions and their change in 24 hours.
  It measures attention, not direction, so it counts for "buzz", not for the lean.
- **Stocks:** the options crowd (put/call ratio), news headline tone. **Coins:** CoinGecko voters, Binance futures accounts long
  against short, Fear & Greed, news tone.
- Verdict: agrees, disagrees or half agrees with the room, with a warning when the crowd is one-sided.
- Not used: X / Twitter (no free API), Reddit itself, StockTwits and Bluesky (they block servers). In their place: short sellers
  and the market mood (VIX) for stocks, Binance top traders and the funding rate for coins.

## Sounds

`public/sfx.js` is one small Web Audio synth shared by both pages; nothing is a recording and nothing is copied. It starts on
the first click or key (browser rule) and a speaker button in the header (and on the code screen) turns it on or off,
remembered in localStorage. Off silences everything except the volatility alert.

- **Alert ringtone:** an original marimba phrase in E major that repeats like an incoming call, with an incoming-call screen
  (big Silence button) and vibration on phones. It rings only on a NEW alert (calm or watch to alert), never when a watch is
  turned on, and stops on Silence or after about 30 seconds.
- **Clicks and typing:** a soft key tick. **Robots:** R2-style chirps while each desk works (a voice per desk), a blip per vote
  and a chord for the decision. **Bull vs Bear:** a whoosh on each charge, the hit, a bull snort or bear growl, a short win
  phrase (from `bullbear-adapter.js` and `bullbear-intro.js`; the component is unchanged).

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
server/data/             Data clients (with caching): Yahoo Finance, Binance, SEC EDGAR, news feeds, CoinGecko,
                         crowd (StockTwits, GDELT, Fear & Greed), DefiLlama, derivatives (futures, DVOL, order
                         books), FINRA, FTC
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
| GET | `/api/market/performance/:ticker` (`?assetClass=stock` or `crypto`) | Asset performance: today, this week, month to date, 1/3/6 months, year to date, 1, 2, 3 and 5 years and since the first day (IPO, or the Binance listing for coins), against the S&P 500 or Bitcoin, plus the 52 week range |
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
