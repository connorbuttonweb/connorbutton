#!/usr/bin/env node
/* rebuild-history.js — reconstruct the portfolio's daily value series.
 *
 *   node rebuild-history.js [--history assets/data/history.json]
 *                           [--portfolio assets/data/portfolio.json]
 *                           [--worker https://market-proxy.…workers.dev]
 *                           [--snapshot] [--dry-run] [--offline]
 *
 * Why this exists
 * ---------------
 * The brokerage exposes no account-value history, and its transaction records
 * carry no share quantities, so a past equity curve cannot be recovered. What
 * CAN be done is record what is held at each refresh and reprice it against
 * daily closes — which yields a genuine daily series from the first snapshot
 * forward, at daily granularity rather than one point per refresh.
 *
 *   snapshots[]  what was held, appended once per refresh   (input, append-only)
 *   flows[]      deposits / withdrawals / transfers          (input)
 *   daily[]      value per trading day                       (derived, rebuilt)
 *
 * Known limitation, surfaced on the page rather than buried: holdings are
 * assumed constant BETWEEN snapshots, so a trade is recognised at the next
 * refresh rather than on its trade date. Refresh often and the error stays small.
 */
'use strict';

const fs = require('fs');

/* Brokerage symbol -> Yahoo symbol. Any held symbol missing from here is a hard
   error: silently skipping one understates the portfolio and misstates every
   return derived from it. */
const YAHOO_SYMBOLS = {
  'XEQT.TO': 'XEQT.TO',
  'VDY.TO': 'VDY.TO',
  'FINN.TO': 'FINN.NE',      // Cboe Canada listing; Yahoo uses .NE
  'CHAT': 'CHAT',
  'BEPC.TO': 'BEPC.TO',
  'BEPC': 'BEPC',
  'SPCX': 'SPCX',           // Space Exploration Technologies, NASDAQ
  'VFV.TO': 'VFV.TO',        // benchmark: S&P 500 in CAD
  /* Questrade's fractional gold has no Yahoo listing. GC=F (front-month gold
     future) is the closest daily series. Yahoo has no XAUUSD=X. */
  'GOLD.QM': 'GC=F'
};

/* Symbols priced off a proxy rather than the instrument itself. The proxy
   supplies the daily SHAPE; the level is anchored to the brokerage's own price
   at the snapshot date, so the series moves with the underlying without
   inheriting the proxy's basis (GC=F trades at a contango premium to spot,
   which was worth ~$21 on a $34k portfolio before anchoring). */
const PROXIED = { 'GOLD.QM': true };

/* Instruments with no dependable daily history. Carried flat at their last
   known price and reported, never dropped. */
const FLAT_CARRY = {
  // Options: Yahoo has no reliable historical option pricing.
  option: true
};

const FX_SYMBOL = 'CAD=X';         // USD -> CAD
const BENCHMARK = 'VFV.TO';
const DEFAULT_WORKER = 'https://market-proxy.buttonconnor12.workers.dev';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const HISTORY = arg('history', 'assets/data/history.json');
const PORTFOLIO = arg('portfolio', 'assets/data/portfolio.json');
const WORKER = arg('worker', DEFAULT_WORKER);
const DRY = argv.includes('--dry-run');
const OFFLINE = argv.includes('--offline');
const DIRECT = argv.includes('--direct');
/* Implies --snapshot: recording and then stopping is the only thing it means. */
const SNAPSHOT_ONLY = argv.includes('--snapshot-only');
const DO_SNAPSHOT = argv.includes('--snapshot') || SNAPSHOT_ONLY;

const r2 = n => Math.round(n * 100) / 100;
const r6 = n => Math.round(n * 1e6) / 1e6;
function die(m) { console.error('rebuild-history: ' + m); process.exit(1); }

if (!fs.existsSync(PORTFOLIO)) die('no portfolio at ' + PORTFOLIO);
const portfolio = JSON.parse(fs.readFileSync(PORTFOLIO, 'utf8'));

let history = fs.existsSync(HISTORY)
  ? JSON.parse(fs.readFileSync(HISTORY, 'utf8'))
  : { meta: { base_currency: 'CAD' }, snapshots: [], flows: [], daily: [] };

history.snapshots = history.snapshots || [];
history.flows = history.flows || [];
const priorSnapshots = history.snapshots.length;
const priorDaily = (history.daily || []).length;

/* ------------------------------------------------ 1. append today's snapshot */

const AS_OF = portfolio.meta.as_of;
const isOption = p => p.asset_type === 'Option';

if (DO_SNAPSHOT) {
  const positions = {};
  portfolio.positions.forEach(p => {
    positions[p.symbol] = {
      qty: p.quantity,
      currency: p.currency,
      multiplier: p.multiplier || 1,
      /* Kept so instruments without a price series can be carried flat, and so
         a snapshot can be valued even if a feed later drops the symbol. */
      last_price: p.price,
      flat: isOption(p) ? true : undefined
    };
  });

  const snap = {
    date: AS_OF,
    cash: portfolio.accounts.reduce((a, x) => a + (x.cash || 0), 0),
    positions: positions
  };

  const at = history.snapshots.findIndex(s => s.date === AS_OF);
  if (at >= 0) history.snapshots[at] = snap;       // re-running today corrects
  else history.snapshots.push(snap);
  history.snapshots.sort((a, b) => (a.date < b.date ? -1 : 1));

  /* Flows drive TWR. Pull them from the activity feed rather than recomputing:
     one source of truth for what money moved and when. */
  const FLOW = new Set(['Deposit', 'Withdrawal', 'Transfer']);
  const fx = portfolio.meta.fx.USDCAD;
  const byDate = {};
  (portfolio.activities || []).forEach(a => {
    if (!FLOW.has(a.type)) return;
    const cad = a.currency === 'USD' ? a.amount * fx : a.amount;
    byDate[a.date] = (byDate[a.date] || 0) + cad;
  });

  /* Securities transferred in from another broker arrive with NO cash movement,
     so the feed records them as amount 0. Left at zero they look like value that
     appeared from nowhere, and any TWR spanning the transfer date would report
     the entire transferred balance as investment gain. Book value is the only
     figure the feed publishes, so it is used as the flow — it understates the
     contribution by whatever unrealized gain came across, which is why the
     computed return runs a little above the brokerage's own figure.
     Internal CAD/USD journals are excluded: they move a position between
     currency sides of the same account and are not a contribution. */
  const BOOK_VALUE = /book value[:\s]+\$?([\d,]+\.\d{2})/i;
  const IS_JOURNAL = /journal/i;
  const inKind = [];
  (portfolio.activities || []).forEach(a => {
    if (a.amount !== 0) return;
    if (IS_JOURNAL.test(a.description)) return;
    const m = String(a.description).match(BOOK_VALUE);
    if (!m) return;
    const v = parseFloat(m[1].replace(/,/g, ''));
    if (!isFinite(v) || v <= 0) return;
    byDate[a.date] = (byDate[a.date] || 0) + v;
    inKind.push({ date: a.date, amount: v, what: a.description.slice(0, 50) });
  });
  if (inKind.length) {
    const t = inKind.reduce((x, y) => x + y.amount, 0);
    console.log('in-kind transfers  ' + inKind.length + ' securities, $' + t.toFixed(2) +
      ' at book value, counted as contributions (not gains)');
  }

  history.flows = Object.keys(byDate).sort().map(d => ({ date: d, amount: r2(byDate[d]) }));
  history.in_kind = inKind;
}

if (!history.snapshots.length) {
  die('no snapshots recorded yet — run with --snapshot after a portfolio refresh');
}
history.meta = history.meta || {};
history.meta.base_currency = 'CAD';
history.meta.first_snapshot = history.snapshots[0].date;

/* --------------------------------------------- 1b. record without repricing */

/* Recording what is held needs no network; repricing does. Doing both in one
   step means a blocked or unreachable price feed throws the snapshot away too —
   and a day's holdings, unlike the daily series, can never be recovered
   afterwards. That is the one loss this whole script exists to prevent, so
   --snapshot-only writes what was captured and stops.
   `daily`, `benchmark` and `hypothetical` are left exactly as they were, and
   meta.as_of / price_source are deliberately NOT advanced: they describe the
   priced series, which this run did not rebuild. Advancing them would date a
   stale curve to today. A later run with network reprices every snapshot
   banked in the meantime and catches the series up completely. */
if (SNAPSHOT_ONLY) {
  history.meta.reprice_pending = AS_OF;
  console.log('snapshots        ' + priorSnapshots + ' -> ' + history.snapshots.length +
    '   (recorded through ' + AS_OF + ')');
  console.log('flows            ' + (history.flows || []).length);
  console.log('daily            ' + priorDaily + ' day(s), UNCHANGED — repricing deferred');
  console.log('                 run rebuild-history.js without --snapshot from a session that');
  console.log('                 can reach the price feed to catch the daily series up.');
  if (DRY) {
    console.log('\n(DRY RUN — nothing written)');
    process.exit(0);
  }
  fs.writeFileSync(HISTORY, JSON.stringify(history, null, 1));
  console.log('\nwrote ' + HISTORY + ' (' + (fs.statSync(HISTORY).size / 1024).toFixed(1) + ' KB)');
  process.exit(0);
}

/* ------------------------------------------------- 2. which symbols to price */

const needed = new Set();
history.snapshots.forEach(s => {
  Object.keys(s.positions).forEach(sym => {
    if (s.positions[sym].flat) return;             // carried flat, no series needed
    needed.add(sym);
  });
});

const unmapped = Array.from(needed).filter(s => !YAHOO_SYMBOLS[s]);
if (unmapped.length) {
  die('no Yahoo mapping for: ' + unmapped.join(', ') +
    '\n  Add them to YAHOO_SYMBOLS. Skipping a held symbol would understate the\n' +
    '  portfolio and misstate every return derived from it.');
}

const anyUsd = history.snapshots.some(s =>
  Object.keys(s.positions).some(k => s.positions[k].currency === 'USD'));

const fetchList = Array.from(needed).map(s => YAHOO_SYMBOLS[s]);
fetchList.push(YAHOO_SYMBOLS[BENCHMARK] || BENCHMARK);
if (anyUsd) fetchList.push(FX_SYMBOL);

/* The series starts at the first snapshot: before that, what was held is
   genuinely unknown. --to allows extending past the portfolio's as_of when
   prices have moved on since the last brokerage pull. */
const FROM = history.meta.first_snapshot;
const TO = arg('to', AS_OF);
if (TO < FROM) die('--to (' + TO + ') is before the first snapshot (' + FROM + ')');

/* The hypothetical series reaches back to the account's inception — before that
   the account did not exist, so there is nothing meaningful to show. */
const HYP_FROM = arg('hypothetical-from', portfolio.meta.inception_date || FROM);
/* Prices are fetched from whichever is earlier so both series can be built. */
const FETCH_FROM = HYP_FROM < FROM ? HYP_FROM : FROM;

/* ------------------------------------------------------- 3. fetch the prices */

/* This script runs in Node, which has no CORS restriction, so Yahoo can be
   called directly. The worker exists for the browser and for a scheduled agent
   that wants caching and a stable interface — but the rebuild must not be
   blocked on the worker being redeployed, so --direct bypasses it. */
async function yahooDirect(symbol) {
  const p1 = Math.floor(new Date(FETCH_FROM + 'T00:00:00Z').getTime() / 1000);
  const p2 = Math.floor(new Date(TO + 'T23:59:59Z').getTime() / 1000);
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' +
    encodeURIComponent(symbol) + '?period1=' + p1 + '&period2=' + p2 + '&interval=1d';
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  const r = data && data.chart && data.chart.result && data.chart.result[0];
  if (!r || !r.timestamp) return [];
  const adj = (r.indicators && r.indicators.adjclose && r.indicators.adjclose[0]) || {};
  const q = (r.indicators && r.indicators.quote && r.indicators.quote[0]) || {};
  const closes = adj.adjclose || q.close || [];
  const out = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    if (closes[i] == null) continue;
    out.push({
      date: new Date(r.timestamp[i] * 1000).toISOString().slice(0, 10),
      close: Math.round(closes[i] * 10000) / 10000
    });
  }
  return out;
}

async function fetchPrices() {
  if (OFFLINE) {
    if (!history.prices) die('--offline needs prices already cached in history.json');
    return history.prices;
  }

  const symbols = Array.from(new Set(fetchList));

  if (!DIRECT) {
    const url = WORKER + '/history?symbols=' + encodeURIComponent(symbols.join(',')) +
      '&from=' + FETCH_FROM + '&to=' + TO + '&interval=1d';
    const res = await fetch(url);
    let data = null;
    if (res.ok) {
      data = await res.json().catch(() => null);
      /* The worker reports failures as HTTP 200 with an { error } body rather
         than a 4xx, so a non-ok status is not the signal — without this check an
         error payload would be treated as a price map and blow up downstream. */
      if (data && data.error) {
        console.warn('  worker /history returned an error: ' + data.error);
        data = null;
      }
      if (data && data._errors) {
        console.warn('  upstream could not price: ' + JSON.stringify(data._errors));
        delete data._errors;
      }
      /* Guard the shape too: every value must be an array of candles. */
      if (data && Object.keys(data).length &&
        Object.keys(data).every(k => Array.isArray(data[k]))) {
        return data;
      }
      if (data) console.warn('  worker /history returned an unexpected shape — ignoring it.');
    }
    console.warn('  worker /history unavailable (HTTP ' + res.status + ') — falling back to ' +
      'Yahoo directly. Deploy the /history route to use it; see worker/README.md.');
  }

  const results = await Promise.allSettled(symbols.map(yahooDirect));
  const out = {};
  const failed = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value.length) out[symbols[i]] = r.value;
    else failed.push(symbols[i] + ' (' + (r.reason ? r.reason.message : 'no data') + ')');
  });
  if (failed.length) console.warn('  could not price: ' + failed.join(', '));
  if (!Object.keys(out).length) die('no price series could be fetched from any source');
  return out;
}

/* ------------------------------------------------------ 4. reconstruct daily */

function buildSeries(prices) {
  /* symbol -> { date: close }, plus the ordered trading calendar */
  const map = {};
  Object.keys(prices).forEach(y => {
    map[y] = {};
    (prices[y] || []).forEach(p => { map[y][p.date] = p.close; });
  });

  /* Anchor proxied series to the brokerage's own price so the level is right
     and only the daily shape comes from the proxy. */
  const anchors = [];
  Object.keys(PROXIED).forEach(sym => {
    const y = YAHOO_SYMBOLS[sym];
    if (!map[y]) return;
    for (let i = history.snapshots.length - 1; i >= 0; i--) {
      const s = history.snapshots[i];
      const pos = s.positions[sym];
      if (!pos || pos.last_price == null) continue;
      /* Nearest quoted day at or before the snapshot. */
      const dates = Object.keys(map[y]).filter(d => d <= s.date).sort();
      if (!dates.length) continue;
      const proxyPx = map[y][dates[dates.length - 1]];
      if (!proxyPx) continue;
      const factor = pos.last_price / proxyPx;
      Object.keys(map[y]).forEach(d => { map[y][d] *= factor; });
      anchors.push(sym + ' x' + factor.toFixed(5) + ' (' + y + ' anchored at ' + s.date + ')');
      break;
    }
  });
  if (anchors.length) console.log('proxy anchoring  ' + anchors.join('; '));

  /* The trading calendar comes from the benchmark where possible — it is the
     most reliably quoted series — falling back to the union of all dates. */
  const benchKey = YAHOO_SYMBOLS[BENCHMARK] || BENCHMARK;
  let dates = Object.keys(map[benchKey] || {});
  if (dates.length < 2) {
    const all = new Set();
    Object.keys(map).forEach(y => Object.keys(map[y]).forEach(d => all.add(d)));
    dates = Array.from(all);
  }
  const allDates = dates.slice().sort();
  dates = dates.filter(d => d >= FROM && d <= TO).sort();
  if (!dates.length) die('no trading days between ' + FROM + ' and ' + TO);
  /* The hypothetical runs over the whole fetched window, which starts at the
     account's inception rather than at the first snapshot. */
  const hypDates = allDates.filter(d => d >= HYP_FROM && d <= TO);

  const flowByDate = {};
  history.flows.forEach(f => { flowByDate[f.date] = (flowByDate[f.date] || 0) + f.amount; });

  /* Carry the last observed close forward across holidays and halts rather than
     dropping the day — a gap would read as a price move. */
  const lastClose = {};
  const approximated = new Set();
  const daily = [];

  dates.forEach(date => {
    Object.keys(map).forEach(y => {
      if (map[y][date] != null) lastClose[y] = map[y][date];
    });

    /* Most recent snapshot at or before this date. */
    let snap = null;
    for (let i = history.snapshots.length - 1; i >= 0; i--) {
      if (history.snapshots[i].date <= date) { snap = history.snapshots[i]; break; }
    }
    if (!snap) return;                              // before tracking began

    const fx = anyUsd ? (lastClose[FX_SYMBOL] || portfolio.meta.fx.USDCAD) : 1;

    let value = snap.cash || 0;
    let priced = true;
    Object.keys(snap.positions).forEach(sym => {
      const pos = snap.positions[sym];
      let px;
      if (pos.flat) {
        px = pos.last_price;                        // options: carried flat
        approximated.add(sym);
      } else {
        px = lastClose[YAHOO_SYMBOLS[sym]];
        if (px == null) { priced = false; return; }
      }
      const native = pos.qty * px * (pos.multiplier || 1);
      value += pos.currency === 'USD' ? native * fx : native;
    });
    if (!priced) return;                            // not enough data for this day yet

    daily.push({ date: date, value: r2(value), net_flow: r2(flowByDate[date] || 0) });
  });

  /* Hypothetical: the LATEST snapshot's holdings valued across every day for
     which prices exist, cash excluded (cash earns nothing and would damp the
     series toward zero for a portfolio that did not hold it back then). */
  const latest = history.snapshots[history.snapshots.length - 1];
  const hyp = [];
  const hypLast = {};
  hypDates.forEach(date => {
    Object.keys(map).forEach(y => { if (map[y][date] != null) hypLast[y] = map[y][date]; });
    const fx = anyUsd ? hypLast[FX_SYMBOL] : 1;
    if (anyUsd && !fx) return;
    let value = 0, ok = true;
    Object.keys(latest.positions).forEach(sym => {
      const pos = latest.positions[sym];
      if (pos.flat) return;                        // options excluded, not carried flat backwards
      const px = hypLast[YAHOO_SYMBOLS[sym]];
      if (px == null) { ok = false; return; }
      const native = pos.qty * px * (pos.multiplier || 1);
      value += pos.currency === 'USD' ? native * fx : native;
    });
    if (ok && value > 0) hyp.push({ date: date, value: r2(value) });
  });

  return { daily: daily, hyp: hyp, approximated: Array.from(approximated), map: map };
}

/* ---------------------------------------------------------------- 5. execute */

(async () => {
  const prices = await fetchPrices();
  const { daily, hyp, approximated, map } = buildSeries(prices);

  if (!daily.length) die('reconstruction produced no days — check the price data');

  /* Reconcile against the brokerage at the snapshot dates — the only place an
     independent figure exists.
     Both sides are valued at the SAME exchange rate on purpose. The rebuild
     uses each day's actual CAD=X, the brokerage snapshot uses the rate implied
     by its own balances, and those legitimately differ (~0.2%, worth ~$13 on
     this portfolio). Mixing them in would flag a convention difference as if it
     were a pricing error, so the FX gap is reported separately below. */
  const checks = [];
  history.snapshots.forEach(s => {
    const d = daily.find(x => x.date === s.date);
    if (!d) { checks.push({ date: s.date, status: 'no trading day' }); return; }
    const reconFx = (map[FX_SYMBOL] && map[FX_SYMBOL][d.date]) || portfolio.meta.fx.USDCAD;
    let expect = s.cash || 0;
    Object.keys(s.positions).forEach(sym => {
      const p = s.positions[sym];
      const v = p.qty * p.last_price * (p.multiplier || 1);
      expect += p.currency === 'USD' ? v * reconFx : v;
    });
    checks.push({
      date: s.date, recon: d.value, snapshot: r2(expect), diff: r2(d.value - expect),
      fxRecon: r6(reconFx), fxBroker: portfolio.meta.fx.USDCAD
    });
  });

  const benchKey = YAHOO_SYMBOLS[BENCHMARK] || BENCHMARK;
  /* Spans the full fetched window, not just the actual series, so the benchmark
     can be indexed against whichever series and period the page is showing. */
  const benchmark = Object.keys(map[benchKey] || {})
    .filter(d => d >= FETCH_FROM && d <= TO).sort()
    .map(d => ({ date: d, level: r6(map[benchKey][d]) }));

  /* HYPOTHETICAL series — today's holdings marked backwards.
     This is NOT the portfolio's actual return: it ignores every position bought
     and sold along the way. It answers "what would the current allocation have
     done", which is a legitimate and common fund-sheet figure ONLY when labelled
     as hypothetical. The actual series above stays the default; this exists
     because the real record is days old and a fund sheet needs a chart.
     Anything rendering this must label it hypothetical — see the section module. */
  const hypothetical = hyp.length ? hyp : null;

  const out = Object.assign({}, history, {
    meta: Object.assign({}, history.meta, {
      generated_at: new Date().toISOString(),
      as_of: TO,
      price_source: OFFLINE ? 'cached' : 'yahoo via market-proxy',
      approximated: approximated,
      note: 'Holdings are assumed constant between snapshots, so a trade is ' +
        'recognised at the next refresh rather than on its trade date.'
    }),
    daily: daily,
    benchmark: benchmark,
    /* Rendered only under an explicit "hypothetical" label — never as actual
       performance. See the comment where it is computed. */
    hypothetical: hypothetical
  });

  console.log('snapshots        ' + priorSnapshots + ' -> ' + out.snapshots.length);
  console.log('flows            ' + out.flows.length);
  console.log('trading days     ' + priorDaily + ' -> ' + daily.length +
    '   (' + daily[0].date + ' .. ' + daily[daily.length - 1].date + ')');
  console.log('benchmark days   ' + benchmark.length);
  console.log('hypothetical     ' + (hypothetical ? hypothetical.length + ' days from ' + hypothetical[0].date +
    '   (current holdings marked back — labelled hypothetical, never actual)' : 'not built'));
  if (approximated.length) {
    console.log('carried flat     ' + approximated.join(', ') + '   (no dependable daily series)');
  }
  console.log('\nsnapshot reconciliation (like-for-like FX):');
  checks.forEach(c => console.log('  ' + c.date + '   recon $' +
    (c.recon != null ? c.recon.toFixed(2) : '—') + '   snapshot $' +
    (c.snapshot != null ? c.snapshot.toFixed(2) : '—') +
    (c.diff != null ? '   diff $' + c.diff.toFixed(2) +
      '   fx ' + c.fxRecon + ' vs broker ' + c.fxBroker : '   ' + c.status)));

  /* Closing prices vs the brokerage's last trade differ by a few basis points;
     0.1% of the portfolio is the line between that and a genuinely wrong price. */
  const latest = daily[daily.length - 1].value;
  const tolerance = Math.max(5, latest * 0.001);
  const worst = checks.filter(c => c.diff != null)
    .reduce((a, c) => Math.max(a, Math.abs(c.diff)), 0);
  if (worst > tolerance) {
    console.error('\nWARNING: reconstruction differs from a snapshot by $' + worst.toFixed(2) +
      ' (tolerance $' + tolerance.toFixed(2) + '). A gap this size usually means a symbol is ' +
      'mapped to the wrong Yahoo listing, or a proxy is not anchored.');
  } else {
    console.log('  within tolerance ($' + tolerance.toFixed(2) + ') — closing price vs last trade');
  }

  if (DRY) { console.log('\nDRY RUN — history.json not written'); return; }
  fs.writeFileSync(HISTORY, JSON.stringify(out, null, 1));
  console.log('\nwrote ' + HISTORY + ' (' + (fs.statSync(HISTORY).size / 1024).toFixed(1) + ' KB)');
})().catch(e => die(e && e.message || String(e)));
