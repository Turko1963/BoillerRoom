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
