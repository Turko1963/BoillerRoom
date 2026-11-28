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
| Critical data missing or stale blocks the decision | T for the checks, I for the path | `preflight` (checks.test). **No test** that a veto passed to `decide()` turns a Buy into Watch/No action, nor that `live.round` passes it on. |
| Missing optional data degrades only its feature | T, partly | deep.test covers each second-layer source missing; not every desk. |
| Thin history says "not enough data" | I | Technical desk finding and label; **no test**. |
| Check before the debate: trades, type, exchange, sane price, valid date | I, partly | Type, price, jump, staleness in `preflight`. "Valid date" is not a separate check. The exchange comes from Yahoo's chart meta; **not tested against Yahoo**. |
| Paid sources and broker changes only with approval | I | None connected; the broker link is off by default (`BROKER=off`). By inspection only. |
| Rules shown as deterministic | I | Memo label only; no test. |
| Views before and after the debate | T | `round.vote.rows` (checks.test "the vote in full"); the memo display has no test. |
| One model's views grouped as correlated, added value measured | I, partly | Labelled in `vote.independence`; brains graded separately (`brainRecords`, scoreboard.test). **Missing:** the added value of each group over Rules on the same briefs. |
| Every gap between vote and decision documented | T, partly | `overrides` for the chart-level check (scoreboard.test) and data vetoes; the data-veto override has no test through `decide()`. |
| Deterministic risk veto beats a majority | I | Liquidity and data vetoes; **no test** through `decide()`. |
| Prediction log, append only | T | predictions.test (UPDATE and DELETE refused, chain verified). Live: the triggers were checked on a copy of the server database. |
| CBRS: the text matches the count | T | The memo quotes the weighted score (checks.test, ai.test). |
| Calibration of conviction | T | grading.test; with no graded history yet every band shows "unknown". |
| Grading at the decision's horizon, against a benchmark | T | grading.test. |
| Ambiguous names ask; gone names say so | T with fakes | live.test. **Correction:** live "Delta" resolved to DAL without asking, because only one US company matched; the test's "asks which" holds only for the fake data. |
| Directions Buy / Short / Sell / Watch / No action | T, partly | checks.test. **The Investor "Sell" branch never ran in that test** (the demo round is Hold): untested until fixed below. |
| Horizon, trigger, invalidation, scenarios, freshness in the plan | T | checks.test, plan.test. |
| No invented expected return | T | `expectedExcess` is null with a note (checks.test). |
| Risk-off counted once | I | Removed from the Risk desk's score; **no test**. |
| Crowd attention is interest, not direction | **M** | The Analyst desk still adds StockTwits and news tone to its direction (weight 0.1 each), and its short-interest finding reads "can squeeze". |
| Ranking candidates, walk-forward, ablations, buy and hold, paper simulation | **M** | Not built. |
| Outside text is data, never instructions | T | checks.test (`cleanExternal`, `cleanPassage`); the wiring in `live.round` has no test. |
| API keys server side only | T | i18n.test checks the public files hold none; by inspection elsewhere. |
