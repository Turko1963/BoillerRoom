# Data sources: what is connected, on what terms, and what is not

Status as of 2026-11-28. "Connected" means the server reads it today. Every round lists the sources it used, with the time
of the data (`round.sources`, shown in the Decision memo); external text is data only and never treated as instructions.

## Connected (free, no key, read only)

| Source | What | Terms to respect | Freshness |
|---|---|---|---|
| Yahoo Finance (unofficial endpoints) | prices, daily candles, company summary, news, options, screeners | Yahoo's terms of service; personal, non-commercial research use; no redistribution | computed per round from the price's own timestamp and the exchange's session as Yahoo reports it (`checks.freshnessOf`) |
| SEC EDGAR | company facts, filings, 8-K items, Form 4 | SEC fair access: a User-Agent with a contact email (`SEC_USER_AGENT`), at most 10 requests a second | filing date |
| Binance public API (data-api.binance.vision first) | coin prices, candles, order books, futures | Binance API terms; public market data | live |
| Bybit, OKX, Deribit public endpoints | futures funding, open interest, volatility | each venue's API terms | live |
| CoinGecko public API | coin market data | CoinGecko's free plan terms, with attribution | read at decision time |
| DefiLlama | on-chain data for coins | open data | read at decision time |
| Google News RSS, FT, Investing.com feeds | headlines | each publisher's terms; headlines only, with a link | the headline's time |
| ApeWisdom | Reddit mention counts | its public API | read at decision time |
| alternative.me | Crypto Fear & Greed | its public API, with attribution | daily |
| CFTC (Socrata) | futures positioning | public data | weekly |
| FTC | merger notices | public data, DEMO_KEY rate limits | read at decision time |

Blocked from the server and therefore unused: StockTwits, FINRA short volume (403), GDELT (rate limited, often times out).
No paid source and no keyed market data source is connected. AI models (Claude, Gemini) are called only for the AI brains
and the Hebrew translation, with keys kept on the server.

## Israel: Maya (TASE disclosures) is NOT connected

- Maya (maya.tase.co.il) is the Tel Aviv Stock Exchange's disclosure system: company reports and immediate reports.
- It is not connected, and nothing in the app reads it. Tel Aviv-only companies therefore have no filings data. Filings
  come from SEC EDGAR only for dual-listed companies.
- **Not verified here:** whether TASE's terms allow automated access to Maya, storage and use of what it returns, and on
  what conditions. TASE also sells data services. Before any connection, read TASE's terms of use for the site and its data
  services, or get TASE's written answer, and record the terms and their date here.
- Tel Aviv prices come from Yahoo, quoted in agorot and converted to shekels (`server/data/yahoo.js`).

## Point in time

Every number is read when the decision is made. The round, and the prediction log entry with its sources and times, keep
what the desks saw then. Nothing refetches history to replace it. The grading reads prices after the decision only to
measure what happened. One caveat: Yahoo's company figures and analyst targets are the current ones, with no history, so a
backtest on them would leak the future; none uses them.

## Trading calendars

There are no weekday or holiday rules in the analysis code:
- **Is a market open, and how old is the price:** both come from the exchange's own session, as Yahoo reports it
  (`currentTradingPeriod`).
- **Horizons:** counted in the asset's own trading sessions (its candles).

**Exception, on hold:** the broker link (`server/broker/service.js`, off by default) still has New York hours written in.
Fix it before that code is used again.
