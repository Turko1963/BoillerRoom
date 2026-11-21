// cTrader Open API client (Spotware), JSON over WebSocket. Demo by default (CTRADER_ENV=demo).
//
// Sign-in (OAuth): the admin opens authUrl(), cTrader sends the browser back to CTRADER_REDIRECT_URI with a code,
// exchangeCode() turns it into an access token (and a refresh token). The tokens are kept on the server only.
// Then every call: connect -> application auth (client id + secret) -> account auth (access token) -> requests.
// Messages are { clientMsgId, payloadType, payload }; answers carry the same clientMsgId.
//
// Units, as the API sends them: spot prices and relative SL/TP as integers / 100000 (deal and position prices are
// plain numbers), money as integers /
// 10^moneyDigits, volume in hundredths of a unit (1 share = 100).
// Endpoints and payload numbers follow the Open API documentation; check them live (npm run broker:check).

export const PT = {
  HEARTBEAT: 51, APP_AUTH_REQ: 2100, APP_AUTH_RES: 2101, ACCOUNT_AUTH_REQ: 2102, ACCOUNT_AUTH_RES: 2103,
  NEW_ORDER_REQ: 2106, AMEND_POSITION_SLTP_REQ: 2110, CLOSE_POSITION_REQ: 2111,
  SYMBOLS_LIST_REQ: 2114, SYMBOLS_LIST_RES: 2115, SYMBOL_BY_ID_REQ: 2116, SYMBOL_BY_ID_RES: 2117,
  TRADER_REQ: 2121, TRADER_RES: 2122, RECONCILE_REQ: 2124, RECONCILE_RES: 2125, EXECUTION_EVENT: 2126,
  SUBSCRIBE_SPOTS_REQ: 2127, SUBSCRIBE_SPOTS_RES: 2128, UNSUBSCRIBE_SPOTS_REQ: 2129, SPOT_EVENT: 2131,
  DEAL_LIST_REQ: 2133, DEAL_LIST_RES: 2134, ORDER_ERROR_EVENT: 2132, EXPECTED_MARGIN_REQ: 2139, EXPECTED_MARGIN_RES: 2140, ERROR_RES: 2142,
  ACCOUNTS_BY_TOKEN_REQ: 2149, ACCOUNTS_BY_TOKEN_RES: 2150
};
export const SIDE = { BUY: 1, SELL: 2 }, ORDER = { MARKET: 1, LIMIT: 2, STOP: 3 };

const env = () => ({
  id: process.env.CTRADER_CLIENT_ID || '', secret: process.env.CTRADER_CLIENT_SECRET || '',
  redirect: process.env.CTRADER_REDIRECT_URI || '', live: process.env.CTRADER_ENV === 'live',
  authBase: process.env.CTRADER_AUTH_URL || 'https://id.ctrader.com/my/settings/openapi/grantingaccess/',
  tokenUrl: process.env.CTRADER_TOKEN_URL || 'https://openapi.ctrader.com/apps/token'
});
export const configured = () => { const e = env(); return !!(e.id && e.secret && e.redirect); };
export const host = () => (env().live ? 'wss://live.ctraderapi.com:5036' : 'wss://demo.ctraderapi.com:5036');

/** Where the admin goes to let Boiler Room trade the account (state: a one-time value checked on the way back). */
export function authUrl(state) {
  const e = env(), q = new URLSearchParams({ client_id: e.id, redirect_uri: e.redirect, scope: 'trading', product: 'web', state });
  return `${e.authBase}?${q}`;
}
async function token(params) {
  const e = env(), q = new URLSearchParams({ ...params, client_id: e.id, client_secret: e.secret });
  const r = await fetch(`${e.tokenUrl}?${q}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.accessToken) throw new Error(`cTrader token: ${j.description || j.errorCode || 'HTTP ' + r.status}`);
  return { access: j.accessToken, refresh: j.refreshToken, expiresAt: Date.now() + (+j.expiresIn || 2592000) * 1000 };
}
export const exchangeCode = code => token({ grant_type: 'authorization_code', code, redirect_uri: env().redirect });
export const refreshToken = refresh => token({ grant_type: 'refresh_token', refresh_token: refresh });

/**
 * One connection, authenticated for the application (and the account, when given). Returns { req, on, close }.
 * WS: injected for tests (defaults to the global WebSocket of Node 22).
 */
export async function connect({ accessToken = null, accountId = null, WS = globalThis.WebSocket, url = host(), timeout = 15000 } = {}) {
  const e = env(), ws = new WS(url), pending = new Map(), subs = new Set();
  let n = 0, hb = null;
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('cTrader: cannot connect')); setTimeout(() => rej(new Error('cTrader: connect timed out')), timeout); });
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch { return; }
    const p = m.clientMsgId && pending.get(m.clientMsgId);
    if (p) {
      pending.delete(m.clientMsgId); clearTimeout(p.t);
      if (m.payloadType === PT.ERROR_RES || m.payloadType === PT.ORDER_ERROR_EVENT) p.rej(Object.assign(new Error(`cTrader: ${m.payload?.description || m.payload?.errorCode || 'error'}`), { code: m.payload?.errorCode }));
      else p.res(m);
    }
    for (const f of subs) { try { f(m); } catch { /* a listener must not break the socket */ } }
  };
  ws.onclose = () => { clearInterval(hb); for (const p of pending.values()) p.rej(new Error('cTrader: connection closed')); pending.clear(); };
  const req = (payloadType, payload = {}) => new Promise((res, rej) => {
    const id = `br${++n}`;
    const t = setTimeout(() => { pending.delete(id); rej(new Error('cTrader: no answer in time')); }, timeout);
    pending.set(id, { res, rej, t });
    ws.send(JSON.stringify({ clientMsgId: id, payloadType, payload }));
  });
  hb = setInterval(() => { try { ws.send(JSON.stringify({ payloadType: PT.HEARTBEAT, payload: {} })); } catch { /* closing */ } }, 10000);
  hb.unref?.();
  const close = () => { clearInterval(hb); try { ws.close(); } catch { /* already closed */ } };
  try {
    await req(PT.APP_AUTH_REQ, { clientId: e.id, clientSecret: e.secret });
    if (accessToken && accountId) await req(PT.ACCOUNT_AUTH_REQ, { ctidTraderAccountId: +accountId, accessToken });
  } catch (err) { close(); throw err; }
  return { req, on: f => { subs.add(f); return () => subs.delete(f); }, close };
}

const money = (v, d) => (v == null ? null : +v / Math.pow(10, d ?? 2));

/** The trading accounts behind an access token: [{ accountId, login, live, broker }] */
export async function accounts(accessToken, opts) {
  const c = await connect(opts);
  try {
    const r = await c.req(PT.ACCOUNTS_BY_TOKEN_REQ, { accessToken });
    return (r.payload?.ctidTraderAccount || []).map(a => ({ accountId: +a.ctidTraderAccountId, login: a.traderLogin ? +a.traderLogin : null, live: !!a.isLive, broker: a.brokerTitleShort || a.brokerName || null }));
  } finally { c.close(); }
}

/** A session on one account: balance, positions, symbols, orders. Close it with .close(). */
export async function account({ accessToken, accountId, ...opts }) {
  const c = await connect({ accessToken, accountId, ...opts }), A = { ctidTraderAccountId: +accountId };
  const symCache = new Map();
  const api = {
    close: c.close, on: c.on,
    async info() {
      const t = (await c.req(PT.TRADER_REQ, A)).payload?.trader || {};
      return { login: t.traderLogin ? +t.traderLogin : null, balance: money(t.balance, t.moneyDigits), leverage: t.leverageInCents ? t.leverageInCents / 100 : null, moneyDigits: t.moneyDigits ?? 2 };
    },
    async positions() {
      const r = (await c.req(PT.RECONCILE_REQ, A)).payload || {};
      return (r.position || []).map(p => ({ positionId: +p.positionId, symbolId: +p.tradeData?.symbolId, side: p.tradeData?.tradeSide === SIDE.SELL || p.tradeData?.tradeSide === 'SELL' ? 'sell' : 'buy',
        volume: +p.tradeData?.volume, units: +p.tradeData?.volume / 100, price: +p.price, stop: p.stopLoss != null ? +p.stopLoss : null, target: p.takeProfit != null ? +p.takeProfit : null,
        swap: money(p.swap, p.moneyDigits), commission: money(p.commission, p.moneyDigits), openedAt: p.tradeData?.openTimestamp ? +p.tradeData.openTimestamp : null, label: p.tradeData?.label || null }));
    },
    /** Symbols whose name matches (NVDA -> "NVDA.US"...): [{ symbolId, name }] */
    async findSymbols(text) {
      const list = (await c.req(PT.SYMBOLS_LIST_REQ, A)).payload?.symbol || [];
      const t = String(text).toUpperCase();
      return list.filter(s => s.enabled !== false && String(s.symbolName || '').toUpperCase().replace(/[^A-Z0-9]/g, '').startsWith(t.replace(/[^A-Z0-9]/g, '')))
        .map(s => ({ symbolId: +s.symbolId, name: s.symbolName, description: s.description || '' }));
    },
    /** Trading details of a symbol: digits, lot size, min / step / max volume (in hundredths of a unit). */
    async symbol(symbolId) {
      if (symCache.has(symbolId)) return symCache.get(symbolId);
      const s = (await c.req(PT.SYMBOL_BY_ID_REQ, { ...A, symbolId: [+symbolId] })).payload?.symbol?.[0];
      if (!s) throw new Error('cTrader: unknown symbol');
      const v = { symbolId: +s.symbolId, digits: +s.digits, pipPosition: +s.pipPosition, lotSize: +s.lotSize, minVolume: +s.minVolume, stepVolume: +s.stepVolume, maxVolume: +s.maxVolume,
        swapLong: s.swapLong != null ? +s.swapLong : null, swapShort: s.swapShort != null ? +s.swapShort : null, commission: s.preciseTradingCommissionRate ?? s.commission ?? null };
      symCache.set(symbolId, v);
      return v;
    },
    /** Current bid and ask (subscribes to one spot event, then unsubscribes). */
    async quote(symbolId) {
      const got = new Promise((res, rej) => {
        const t = setTimeout(() => { off(); rej(new Error('cTrader: no price in time')); }, 8000);
        const off = c.on(m => { if (m.payloadType === PT.SPOT_EVENT && +m.payload?.symbolId === +symbolId && (m.payload.bid || m.payload.ask)) { clearTimeout(t); off(); res({ bid: m.payload.bid / 1e5, ask: m.payload.ask / 1e5 }); } });
      });
      await c.req(PT.SUBSCRIBE_SPOTS_REQ, { ...A, symbolId: [+symbolId] });
      try { return await got; } finally { c.req(PT.UNSUBSCRIBE_SPOTS_REQ, { ...A, symbolId: [+symbolId] }).catch(() => {}); }
    },
    /** A market order with its stop loss and take profit attached at the broker (distances from the fill). */
    async marketOrder({ symbolId, side, volume, stopDistance, targetDistance, label = 'BoilerRoom', comment = '' }) {
      const r = await c.req(PT.NEW_ORDER_REQ, { ...A, symbolId: +symbolId, orderType: ORDER.MARKET, tradeSide: side === 'sell' ? SIDE.SELL : SIDE.BUY, volume: Math.round(volume),
        relativeStopLoss: Math.round(stopDistance * 1e5), relativeTakeProfit: targetDistance ? Math.round(targetDistance * 1e5) : undefined, label, comment: String(comment).slice(0, 100) });
      return execution(r.payload);
    },
    /** Move the stop (and target) of an open position. */
    async amend(positionId, { stop, target }) { return execution((await c.req(PT.AMEND_POSITION_SLTP_REQ, { ...A, positionId: +positionId, stopLoss: stop ?? undefined, takeProfit: target ?? undefined })).payload); },
    /** Close all or part of a position (volume in hundredths of a unit). */
    /** Money made by one position from its deals since `from` (ms): gross profit, swap and commission, or null. */
    async positionPnl(positionId, from, to = Date.now()) {
      const deals = ((await c.req(PT.DEAL_LIST_REQ, { ...A, fromTimestamp: Math.floor(from - 60e3), toTimestamp: Math.ceil(to + 60e3) })).payload?.deal || []).filter(d => +d.positionId === +positionId);
      if (!deals.length) return null;
      let sum = 0, closed = false;
      for (const d of deals) {
        sum += money(d.commission, d.moneyDigits) || 0;
        const x = d.closePositionDetail;
        if (x) { closed = true; sum += (money(x.grossProfit, x.moneyDigits ?? d.moneyDigits) || 0) + (money(x.swap, x.moneyDigits ?? d.moneyDigits) || 0) + (money(x.commission, x.moneyDigits ?? d.moneyDigits) || 0); }
      }
      return closed ? +sum.toFixed(2) : null;
    },
    async closePosition(positionId, volume) { return execution((await c.req(PT.CLOSE_POSITION_REQ, { ...A, positionId: +positionId, volume: Math.round(volume) })).payload); }
  };
  return api;
}
function execution(p = {}) {
  return { type: p.executionType ?? null, positionId: p.position?.positionId ? +p.position.positionId : null, price: p.deal?.executionPrice != null ? +p.deal.executionPrice : p.position?.price != null ? +p.position.price : null,
    volume: p.deal?.filledVolume != null ? +p.deal.filledVolume : null, stop: p.position?.stopLoss ?? null, target: p.position?.takeProfit ?? null };
}
