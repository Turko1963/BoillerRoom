# Audit: how a decision is made (before the data, decision and measurement work)

Date: 2026-11-28. Code at commit 11f7774. Scope: the flow from a brief to a saved decision, and what is measured afterwards.
Nothing in the design, screens, colours or UX changes in this work; new fields appear only inside the Decision memo,
Scoreboard, Performance and Trade plan.

## 1. The flow

1. **Brief to asset** (`server/market/live.js` `resolve()`): `.TA` symbols, Hebrew and English Tel Aviv names
   (`server/data/tase.js`), `XXX-USD` pairs, upper-case tickers checked against SEC, Binance and Yahoo, lower-case tickers
   against SEC and Binance only, then a Yahoo name search that must match the first word. The first hit wins; there is
   no "which one did you mean" step, and no check that the instrument still trades (a delisted name can resolve or simply
   fail as "no ticker found").
2. **Data** (`gather()`): prices (Yahoo daily candles for stocks, Binance for coins), Yahoo company summary, SEC company
   facts and filings, news (Yahoo, Google News, FT, Investing.com), benchmark (S&P 500, TA-35 or Bitcoin), market regime
   (VIX, S&P 500 trend, 10 year yield, Bitcoin trend), and the optional second layer in `x.ext` (crowd, options, insider
   trades, deal news, FINRA, FTC, DefiLlama, derivatives, peers, weekly and hourly candles). Optional sources fail softly
   (`breaker()`, `within()`). **No source carries a timestamp or a real-time/delayed flag into the round.** Only the price
   is critical in practice: without candles the round fails; with a stale last candle it goes on.
3. **Desks** (`server/engine/desks.js`): seven pure functions over the same `x`. Each returns score, confidence,
   headline, three findings, a tile and sources. With fewer than 200 days of history the Technical desk uses an
   N-day average and labels it "N day average": not invented, but it still drives a trend call on thin history.
4. **AI brains** (optional, `server/engine/ai.js`): each desk view is rewritten by the model from the same data (prompt:
   "never invent figures"), then a fact-check call replaces findings whose numbers are not in the data, then the model
   writes the debate and the memo. All seven views of one brain come from **one model**: they are correlated, not seven
   independent opinions. Headlines and filing text are passed to the model inside the prompt; nothing marks them as data
   only, and nothing checks them for instructions.
5. **Debate and vote** (`decide()` in `server/engine/case.js`): the debate changes some desks' stance or confidence. The
   vote is `net = (Σ conf·weight of bulls − Σ conf·weight of bears) / Σ conf·weight of all seven`, with the mode's weights
   (Trader: Technical 1.6, Dealer 1.3, Analyst 1.3, Risk 1.2, M&A 0.8, Fundamental 0.7, Filings 0.7), or learned weights
   after 5 graded calls. Buy if `net > 0.12` (0.20 in a risk-off market), Short/Sell if `net < −0.12`. Then the chart-level
   check can turn a trade into Hold (reward under 1.5 times the risk). **None of these numbers reaches the screen**: the memo
   shows only the head count (2 buy, 3 hold, 2 short), which can disagree with the weighted result. This is the CBRS case:
   a weighted net under −0.12 is a Short even when the head count is level.
6. **Bulls/Bears strip** (`public/bullbear/`): its bar is `Σ bull / (Σ bull + Σ bear)` of conf·weight. Neutral votes are
   left out of the bar but count in the decision, so the bar and the call can look inconsistent. The text that the bears or
   bulls "take it" follows the final call.
7. **Conviction**: `50 + min(1, |net| / 0.65) · 45`, minus penalties. It is a margin of the vote, **not a calibrated
   probability**, but it is shown as "76% conviction" with nothing to say so.
8. **Ticket and plan**: size, leverage and stop from the Risk desk (volatility), stop and target at chart levels when the
   desks found them, else the volatility rule; `round.tradePlan` from the tested management rules.
9. **Saved** (`server/store/db.js`): the whole round as JSON in `rounds` (insert only in code, but the table can be
   edited, there is no version, no hash, and the inputs are only the parts kept in the round).
10. **Graded** (`server/engine/scoreboard.js`): every call **10 sessions later (60 in Investor mode), whatever the ticket's
    horizon**; "right" by direction only; "average edge" is the move in the direction of the call, **not against a
    benchmark**. Desk weights learn from these grades. No calibration of conviction.

## 2. Findings, by priority

**P0, data:** no source, timestamp or delay flag on any number (F1); stale prices are not blocked (F2); thin history
still drives a trend call (F3); no check before the debate that the instrument trades, its type and exchange, a sane price
(F4); external text goes to the models without being marked as data (F5).

**P0, decision:** the weighted vote, its thresholds and the reason a vote was overruled are not shown, so the text can
contradict the head count (F6); the Bulls/Bears bar formula is not explained (F7); Rules is not labelled as a
deterministic engine (F8); the views before and after the debate are not shown side by side (F9); the views of one model
are treated as seven votes (F10); the only vetoes are the chart-level reward check and nothing for missing data or an
illiquid instrument (F11); "Short" and "Sell" are mixed: in Investor mode a bearish call is labelled Sell but stored as
Short, and there is no Watch or No action (F12).

**P0, record:** no append-only log with system version, inputs and outputs (F13).

**P1, measurement:** grading ignores the decision's horizon and the benchmark (F14); conviction is not calibrated (F15);
an ambiguous or delisted name is guessed or fails without a reason (F16); no ranking of candidates (F17); no walk-forward,
ablations or comparison with buy and hold (F18).

## 3. Plan

Small steps, each tested and pushed: F6 to F12 (vote math, vetoes, directions) · F1 to F5 (sources, freshness, gates,
validation, external text) · F13 (prediction log) · F14 to F16 (horizon and benchmark grading, calibration, clarification)
· then P1 (ranking, walk-forward, ablations), which needs graded history before it can say anything.

## 4. Status after the work (2026-11-28)

Done: F1 to F16 except the Israeli filings feed (MAYA) and the paid or keyed sources, which stay off. Each finding now maps to
code: F1 `sourcesOf`; F2, F4 `preflight` vetoes; F3 the Technical desk's thin history finding; F5 `cleanExternal`,
`cleanPassage` and the prompts; F6 to F12 `round.vote`, `overrides`, `direction` and the memo; F13 the `predictions` table;
F14, F15 `evaluate()` with the logged horizon and benchmark, `excessOf`, `calibration`; F16 the name rules in `resolve()`.
The risk-off backdrop is no longer counted twice (it was in the Risk desk's score and in the buy line).
Not done yet (P1): F17 ranking candidates, F18 walk-forward, ablations and buy-and-hold comparisons, which need graded
history before they can say anything.

## 5. Verification of the first spec, item by item (2026-11-28, against the code and tests, not earlier reports)

Status: **T** implemented and covered by a test · **I** implemented, no test (or a test that does not reach it) ·
**M** missing · **?** unknown (could not be verified here). The test file is given where there is one.

| Item | Status | Evidence, and what could not be verified |
|---|---|---|
| Every number with source, timestamp, live/delayed | T, partly | `sourcesOf` (checks.test "sources"). Yahoo's "delayed up to 15 minutes" is a **label**, not computed from the timestamp: fixed in P0-C. |
| LLM never invents numbers | I | Prompts forbid it; the fact-check replaces unsupported findings (ai.test checks the counts). Whether a real model always complies: **?** |
| Critical data missing or stale blocks the decision | T | `preflight` (checks.test); the path through `live.round` and `decide()` (live.test "a stale price vetoes the call", added after the audit). |
| Missing optional data degrades only its feature | T, partly | deep.test covers each second-layer source missing; not every desk. |
| Thin history says "not enough data" | T | live.test "thin history" (added after the audit). |
| Check before the debate: trades, type, exchange, sane price, valid date | I, partly | Type, price, jump, staleness in `preflight`. "Valid date" is not a separate check. The exchange comes from Yahoo's chart meta; **not tested against Yahoo**. |
| Paid sources and broker changes only with approval | I | None connected; the broker link is off by default (`BROKER=off`). By inspection only. |
| Rules shown as deterministic | I | Memo label only; no test. |
| Views before and after the debate | T | `round.vote.rows` (checks.test "the vote in full"); the memo display has no test. |
| One model's views grouped as correlated, added value measured | I, partly | Labelled in `vote.independence`; brains graded separately (`brainRecords`, scoreboard.test). **Missing:** the added value of each group over Rules on the same briefs. |
| Every gap between vote and decision documented | T, partly | `overrides` for the chart-level check (scoreboard.test) and data vetoes; the data-veto override has no test through `decide()`. |
| Deterministic risk veto beats a majority | T | live.test "too little traded a day vetoes the trade" (added after the audit). |
| Prediction log, append only | T | predictions.test (UPDATE and DELETE refused, chain verified). Live: the triggers were checked on a copy of the server database. |
| CBRS: the text matches the count | T | The memo quotes the weighted score (checks.test, ai.test). |
| Calibration of conviction | T | grading.test; with no graded history yet every band shows "unknown". |
| Grading at the decision's horizon, against a benchmark | T | grading.test. |
| Ambiguous names ask; gone names say so | T with fakes | live.test. **Correction:** live "Delta" resolved to DAL without asking, because only one US company matched; the test's "asks which" holds only for the fake data. |
| Directions Buy / Short / Sell / Watch / No action | T | checks.test; the Investor "Sell" branch, which never ran there, now in plan.test. |
| Horizon, trigger, invalidation, scenarios, freshness in the plan | T | checks.test, plan.test. |
| No invented expected return | T | `expectedExcess` is null with a note (checks.test). |
| Risk-off counted once | T | live.test "a risk-off market is counted once" (added after the audit). |
| Crowd attention is interest, not direction | **M** | The Analyst desk still adds StockTwits and news tone to its direction (weight 0.1 each), and its short-interest finding reads "can squeeze". |
| Ranking candidates, walk-forward, ablations, buy and hold, paper simulation | **M** | Not built. |
| Outside text is data, never instructions | T | checks.test; the wiring in `live.round` in live.test "a headline that gives orders". |
| API keys server side only | T | i18n.test checks the public files hold none; by inspection elsewhere. |

## 6. Second spec, part 1 (P0-A to P0-C): status after the work

| Item | Status | Where, and what is not verified |
|---|---|---|
| Canonical instrument apart from broker symbols (exchange, currency, price unit, underlying) | T | `server/execution/instrument.js` (execution.test). MIC codes only for the exchanges in its table; others keep the source's name. |
| Execution profile in configuration (symbols, costs, financing, FX, multiplier, lot, minimum, margin, schedule, availability, short) | T | `server/execution/profiles.js` (execution.test). |
| Every cost field with status, provenance, date; no universal defaults | T | `server/execution/fields.js`; a configured or observed field without a source is refused (execution.test). |
| NoBroker by default; Colmex Israel CFD by hand only; no invented terms, API or connection | T | All Colmex fields unknown; `connected: false`; the choice is a select the person changes (execution.test; the select checked in a browser). Colmex's real terms: **not verified, not filled**. |
| A small adapter contract for another broker | I | Documented at the top of profiles.js; no second broker built, by design. |
| The prediction never depends on the broker; a new profile gives a new evaluation | T | `GET /api/rounds/:id/execution` is computed on demand; execution.test checks the prediction log and the round are unchanged. |
| Quote apart from reference price, with time and freshness; a stale quote blocks only this plan | T | `evaluate()` (execution.test: none and stale quotes). There is never a real quote: nothing is connected. |
| Unknown costs: no claim of an edge, gross or net | T, partly | `net.text` (execution.test); the Scoreboard and the plan's backtest line are labelled hypothetical (labels checked by inspection, not by a test). |
| 0.1% and 3% in configuration as assumed | T | `server/execution/assumptions.js`; the grading reads them (execution.test). |
| Risk: drawdown, exposure, currency exposure, equity vs notional, gaps, no-leverage version; no stop-caps-loss wording | T, partly | Gaps in the round (live.test); the forbidden wording checked in the page and the desks (live.test); the Risk section itself checked in a browser only. Currency exposure assumes nothing about the account's currency (it says so). |
| Thresholds in configuration with reasons | I | `checks.js` `WHY`, `assumptions.js` `THRESHOLDS`; no test that every limit has a reason. |
| "0 units" always explained | I | Trade plan rows and the copied text; checked by reading, no test. |
| Non-US names: clear mapping, a question when unclear | T | Tel Aviv table (live.test); a name listed only abroad asks (live.test "other exchanges"). |
| Price units (agorot vs shekels) in every calculation and display | T, partly | Sub-units converted in `yahoo.js` for chart, candles, summary, insights (unit test of `scale`); not every endpoint has a test with real agorot. |
| Freshness from the real timestamp | T | `freshnessOf` (checks.test) from the exchange's session as Yahoo reports it. Not verified: that Yahoo's `currentTradingPeriod` is right on every holiday. |
| Maya: source and terms documented, not claimed as connected | I | `docs/sources.md`; TASE's terms for automated access **not verified**. |
| Point-in-time data; per-market calendar; no weekday rules | I, partly | Documented in docs/sources.md. **Exception:** the broker link (off) still has New York hours in `server/broker/service.js`. |

## 7. Second spec, part 2 (P1 validation, scanner, approval): status after the work

T = implemented and tested; I = implemented, no automated test; M = missing; ? = unknown, not verified.
Tests are validation infrastructure: they check that numbers are computed honestly and kept apart, not that there is an edge.

| Item | Status | Where, and what is not verified |
|---|---|---|
| Explicit chronological split train / calibration / test, fixed in advance by decision date, no halves | T | `SPLITS` in `server/execution/assumptions.js` (grading.test "calibration: the fixed split"). The first test period starts 2027-04-01: until then every test figure is empty. |
| Adaptive weights without leakage (training period only) | T | `records()` in scoreboard.js reads train only (grading.test). |
| No look-ahead | I, partly | Desks read data at decision time; grading reads prices after it only to measure. Caveat in docs/sources.md: Yahoo's company figures have no history. |
| Survivorship (delisted, vanished) | T, partly | Ungradable outcomes counted (grading.test "survivorship"). **M:** the backtest numbers in `TESTED` (plan.js) come from an earlier run on today's names, so they likely carry survivorship bias; they are labelled a backtest, not a result. |
| Baselines: buy and hold, the benchmark, no action | T | `validation()` (grading.test "baselines and ablations"); Scoreboard "Against doing something simple". |
| Ablation per desk | T | Recomputed from the logged vote rows without that desk (grading.test). |
| With vs without the crowd | I | The crowd does not enter the vote, so both are equal by construction; the Scoreboard says so. |
| Rules vs LLM | T, partly | Per-brain rows in `validation()` and `brainRecords`; the per-brain split is tested with Rules only (no real model in tests). |
| Ranking by horizon, in % and in R, cost-aware; in cash | T, partly | Graded at each decision's own horizon (grading.test); % and R in `validation()`; cash only in the Trade plan's sizing (checked in a browser). |
| No unverified cost in a net score | T | Unknown cost: no net figure, no edge claim (acceptance 2); assumed costs labelled hypothetical. |
| Confidence with uncertainty: band, sample size, interval, or "not enough data" | T | `round.vote.calibration` at decision time (api.test, acceptance 6); Wilson interval on the test period; under 10 a band says "not enough data". |
| Weighted vote = memo = ticket; No action legitimate | T | acceptance 7 (240 demo briefs). |
| Scanner: explicit configurable universe, watch list | T | `UNIVERSE`, `SCAN_UNIVERSE`, `/api/watchlist` (scanner.test). |
| Scanner: non-tradable excluded | T | Same `preflight` as a round: index, stale, thin history, no liquidity (scanner.test). |
| Scanner: cheap stage without AI (catalyst with source and time, liquidity, cost per profile or unknown) | T | scanner.test. **?** The spread is never observed (no broker quote is connected): it is the profile's field, unknown for Colmex. Yahoo's earnings dates can be estimates. |
| Scanner: dedupe, measured vs unverified, no fake EV | T | Dual listings kept once; measured first; no expected value field (scanner.test). |
| Scanner: AI debate on the top N only, by click, with a displayed, configurable budget | T, partly | Budget enforced in `POST /api/rounds` with `origin: 'scan'` (scanner.test: 429 when used up, Rules free); the display checked in a browser (English and Hebrew). |
| No paid or new activation without Ran's approval | I | Nothing in the scanner runs an AI model by itself; the default budget is 3 a day and raising it is a setting for Ran. No paid data source added. |
| Manual approval stays | T | "Approve ticket" and the broker's tap (api.test, broker.test); the broker link stays off by default. |
| Idempotency and checks before saving | T | `idempotencyKey`, `roundGaps()` (api.test, acceptance 6). |
| Acceptance tests 1-9 | T | `test/acceptance.test.js`, all passing. |
| Colmex Israel's actual terms (commission, spread, financing, symbols, schedule, short) | ? | Not verified, not filled: every field is unknown. |
| Maya (TASE disclosures): source and terms of use | ? | Not connected; TASE's terms for automated access not verified (docs/sources.md). |
| A benchmark per market for exchanges other than the US and Tel Aviv | M | Still the S&P 500 for, say, BMW.DE. |
| Broker link session hours | M | `server/broker/service.js` (off) still has New York hours. |
