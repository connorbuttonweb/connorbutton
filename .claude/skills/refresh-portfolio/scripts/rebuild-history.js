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

/* Brokerage symbol -> Yahoo symbol, for the cases where the two genuinely
   differ. Everything else resolves to itself and is then reconciled against the
   brokerage's own last price (see resolveSymbols): US tickers and TSX .TO
   suffixes are already Yahoo's own notation.

   This used to be an allowlist naming every holding, and a symbol missing from
   it was a hard error. That made it a trip-wire rather than a safeguard — every
   newly opened position killed the whole rebuild until someone hand-edited this
   file, which is exactly what happened when TSLA was bought on 2026-08-10 and
   the daily series silently stopped advancing. The safeguard that actually
   matters (never price a symbol as the wrong security) is now enforced against
   the brokerage's price instead of against this list. */
const SYMBOL_OVERRIDES = {
  'FINN.TO': 'FINN.NE',      // Cboe Canada listing; Yahoo uses .NE
  'MMY': 'MMY.V',            // TSX Venture
  /* Questrade's fractional gold has no Yahoo listing. GC=F (front-month gold
     future) is the closest daily series. Yahoo has no XAUUSD=X. */
  'GOLD.QM': 'GC=F'
};

/* Resolved lookup: overrides, plus whatever resolveSymbols works out at runtime
   and whatever a previous run cached in history.meta.symbol_map. */
const YAHOO_SYMBOLS = Object.assign({}, SYMBOL_OVERRIDES);

/* Listings to try for a symbol with no override, in the notations the brokerage
   and Yahoo actually disagree about. Ordered cheapest-guess-first; the winner is
   picked by price agreement, not by position in this list. */
function candidatesFor(sym) {
  const m = sym.match(/^(.*?)(\.TO|\.NE|\.V)?$/);
  const suffix = m[2] || '';
  /* Share classes: brokers write BRK.B / CTC.A.TO, Yahoo writes BRK-B /
     CTC-A.TO. Only the class separator becomes a hyphen — the exchange suffix
     stays a dot. */
  const bases = [m[1]];
  if (m[1].indexOf('.') >= 0) bases.push(m[1].replace(/\./g, '-'));

  const c = [];
  bases.forEach(b => {
    if (suffix) {
      c.push(b + suffix);
      if (suffix === '.TO') c.push(b + '.NE', b + '.V');   // Cboe Canada, TSXV
    } else {
      c.push(b);
      /* A bare ticker is ambiguous between US and Canadian listings. One that
         already carries a class separator is not — it is a US class share, so
         don't fabricate Canadian variants of it. */
      if (bases.length === 1) c.push(b + '.TO', b + '.V', b + '.NE');
    }
  });
  return Array.from(new Set(c));
}

/* How far a candidate's close may sit from the brokerage's last price before it
   is judged a different security. Post-market drift against the same day's close
   runs 1-2% on volatile names; a wrong listing is out by tens of percent, or is
   quoted in the other currency, so the two cases separate cleanly. */
const MATCH_TOLERANCE = 0.05;

/* Statement-confirmed net flows, keyed by date, in CAD. These replace the
   derived value for that date entirely.

   An in-kind transfer arrives with NO cash movement, so the feed records it as
   amount 0 and publishes only "BOOK VALUE" in the description. The brokerage
   counts the transfer at MARKET value, which appears nowhere in the feed — so
   the derivation below can only use book value, and it therefore understates
   every transfer that came across at a gain. That understatement flatters the
   return, and it is not a rounding difference: through June it was $748.11 of
   $27,989.00 contributed.

   How each figure is read off a statement: Balance Changes gives "Deposits" as
   the market value of all deposits AND transfers-in. Subtract the month's cash
   contributions to isolate the securities, then net any cash transferred out on
   the same day. Cross-check with A - B - C + D against the stated change in
   balance before trusting it.

   This lives in code, not in history.json, on purpose. Commit befd6ef corrected
   these same two dates by hand-editing history.json without touching any
   script; the next snapshot run recomputed flows and silently reverted it, and
   the file's generated_at stamp did not move, so nothing showed it had happened.
   A constant cannot be rewritten by a pipeline run. */
const FLOW_OVERRIDES = {
  /* TFSA statement 2026-05: deposits 12,315.70 - 1,200.00 cash contributions
     = 11,115.70 securities at market, less 161.96 TD Waterhouse cash out.
     Derived book value was 10,253.00 (understated by 700.74). */
  '2026-05-14': 10953.74,
  /* FHSA statement 2026-06: deposits 12,705.25 - 1,183.40 cash transferred in
     on 06-05 = 11,521.85 securities at market, no cash out that day.
     Derived book value was 11,474.48 (understated by 47.37). */
  '2026-06-08': 11521.85
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

  /* Statement figures win over the book-value derivation. The derived value is
     printed alongside so that if it ever moves — a late-posting activity landing
     on an overridden date — the delta changes visibly instead of being silently
     absorbed by the override. */
  Object.keys(FLOW_OVERRIDES).forEach(d => {
    const v = FLOW_OVERRIDES[d];
    if (typeof v !== 'number' || !isFinite(v)) {
      console.warn('  FLOW_OVERRIDES[' + d + '] is not a finite number — ignored');
      return;
    }
    const derived = byDate[d];
    byDate[d] = v;
    console.log('flow override      ' + d + '  derived ' +
      (derived === undefined ? '(none)' : '$' + r2(derived).toFixed(2)) +
      '  ->  statement $' + v.toFixed(2) +
      (derived === undefined ? '' : '   (' + (v - derived >= 0 ? '+' : '') + (v - derived).toFixed(2) + ')'));
  });

  /* A transfer with no statement figure yet is reported, never fatal: the day
     still publishes at book value and the figure can be corrected once the
     statement arrives. Failing here would stop the daily pipeline over a number
     that is only knowable weeks later. */
  const unconfirmed = Array.from(new Set(inKind.map(x => x.date)))
    .filter(d => !(d in FLOW_OVERRIDES)).sort();
  unconfirmed.forEach(d => {
    const t = inKind.filter(x => x.date === d).reduce((a, x) => a + x.amount, 0);
    console.warn('  in-kind transfer on ' + d + ' ($' + t.toFixed(2) + ' at book value) has no ' +
      'statement figure.\n' +
      '    Book value understates a transfer that came across at a gain. Read the market\n' +
      '    value off that month\'s statement and add it to FLOW_OVERRIDES.');
  });

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

/* A previous run's accepted resolutions. Treated like overrides so the candidate
   fetches happen once per new symbol rather than on every rebuild — but still
   re-verified below, so a cached mistake corrects itself instead of persisting. */
const cachedMap = (history.meta && history.meta.symbol_map) || {};
Object.keys(cachedMap).forEach(s => {
  if (!YAHOO_SYMBOLS[s]) YAHOO_SYMBOLS[s] = cachedMap[s];
});

/* Symbols with no known listing yet. Their candidates all get fetched, and
   resolveSymbols() picks the one that agrees with the brokerage's own price. */
const unresolved = Array.from(needed).filter(s => !YAHOO_SYMBOLS[s]);
const candidates = {};
unresolved.forEach(s => { candidates[s] = candidatesFor(s); });

const anyUsd = history.snapshots.some(s =>
  Object.keys(s.positions).some(k => s.positions[k].currency === 'USD'));

const fetchList = Array.from(needed).filter(s => YAHOO_SYMBOLS[s]).map(s => YAHOO_SYMBOLS[s]);
unresolved.forEach(s => { candidates[s].forEach(c => fetchList.push(c)); });
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

/* ------------------------------------------------ 3b. identify unknown symbols */

/* Symbols no listing could be found for. Carried flat at the brokerage's last
   price and reported, rather than dropped. Deliberately NOT written back into
   history.snapshots as `flat`, so a later run with a working feed still gets to
   resolve them properly instead of inheriting today's failure forever. */
const flatCarry = new Set();

/* The brokerage's own last price is the only independent price this script has,
   and it is already recorded per position per snapshot. Use it to CHOOSE the
   listing rather than merely to sanity-check one: a ticker that exists on Yahoo
   as a DIFFERENT security prices plausibly, and that is the failure mode worse
   than not pricing at all, because it misstates every return without a symptom. */
function resolveSymbols(prices) {
  const closeAtOrBefore = (series, date) => {
    let px = null;
    for (let i = 0; i < series.length; i++) {
      if (series[i].date <= date) px = series[i].close; else break;
    }
    return px;
  };

  /* Most recent snapshot that actually held it, for a same-day comparison. */
  const reference = sym => {
    for (let i = history.snapshots.length - 1; i >= 0; i--) {
      const pos = history.snapshots[i].positions[sym];
      if (pos && !pos.flat && pos.last_price != null) {
        return { date: history.snapshots[i].date, price: pos.last_price };
      }
    }
    return null;
  };

  /* Cached resolutions are re-checked too — their series is already being
     fetched, so verification is free, and a ticker quietly reassigned to another
     company would otherwise keep pricing against the cache forever. Overrides are
     hand-written and exempt; PROXIED symbols carry a deliberate basis (GC=F trades
     at a premium to spot) that anchoring corrects later, so they cannot be judged
     on price agreement at all. */
  const work = unresolved.map(s => ({ sym: s, cands: candidates[s], cached: false }))
    .concat(Array.from(needed)
      .filter(s => cachedMap[s] && !SYMBOL_OVERRIDES[s] && !PROXIED[s])
      .map(s => ({ sym: s, cands: [cachedMap[s]], cached: true })));

  const resolvedNow = {};
  const report = [];

  work.forEach(({ sym, cands, cached }) => {
    const ref = reference(sym);
    const scored = [];
    cands.forEach(c => {
      const series = prices[c];
      if (!series || !series.length) return;
      const px = ref ? closeAtOrBefore(series, ref.date) : series[series.length - 1].close;
      if (px == null) return;
      scored.push({ candidate: c, close: px, delta: ref ? Math.abs(px - ref.price) / ref.price : 0 });
    });

    /* Nothing quoted anywhere — a delisted historical holding, or a feed outage.
       Neither is a reason to refuse to build the series. */
    if (!scored.length) {
      flatCarry.add(sym);
      report.push('  ' + sym + ' -> no listing quoted; carried flat at $' +
        (ref ? ref.price : '?') + ' and reported as approximated');
      return;
    }

    /* No recorded brokerage price means there is nothing to tell the candidates
       apart with. Take the symbol as the brokerage writes it and say so. */
    if (!ref) {
      resolvedNow[sym] = sym;
      report.push('  ' + sym + ' -> ' + sym + ' (unverified: no brokerage price recorded)');
      return;
    }

    scored.sort((a, b) => a.delta - b.delta);
    const best = scored[0];
    if (best.delta > MATCH_TOLERANCE) {
      die('cannot identify ' + sym + ' on Yahoo.\n' +
        '  Brokerage last price $' + ref.price + ' on ' + ref.date + ', but:\n' +
        scored.map(s => '    ' + s.candidate + '  $' + s.close + '  off by ' +
          (s.delta * 100).toFixed(1) + '%').join('\n') + '\n' +
        (cached
          ? '  The cached mapping in history.meta.symbol_map no longer matches this\n' +
            '  security. Delete that entry, or pin the right listing in SYMBOL_OVERRIDES.'
          : '  Every candidate looks like a different security. Add the right listing\n' +
            '  to SYMBOL_OVERRIDES — pricing it wrong would misstate every return.'));
    }
    resolvedNow[sym] = best.candidate;
    if (!cached) {
      report.push('  ' + sym + ' -> ' + best.candidate + '  ($' + best.close +
        ' vs brokerage $' + ref.price + ', ' + (best.delta * 100).toFixed(2) + '% off)');
    }
  });

  Object.keys(resolvedNow).forEach(s => { YAHOO_SYMBOLS[s] = resolvedNow[s]; });

  if (report.length) {
    console.log('symbol resolution');
    report.forEach(r => console.log(r));
    const promote = Object.keys(resolvedNow).filter(s => resolvedNow[s] !== s);
    if (promote.length) {
      console.log('  pin these in SYMBOL_OVERRIDES to skip the candidate fetches next run:');
      promote.forEach(s => console.log("    '" + s + "': '" + resolvedNow[s] + "',"));
    }
  }

  /* Everything actually used, so the next run can skip rediscovery. */
  const map = {};
  Array.from(needed).forEach(s => { if (YAHOO_SYMBOLS[s]) map[s] = YAHOO_SYMBOLS[s]; });
  return map;
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
      if (pos.flat || flatCarry.has(sym)) {
        px = pos.last_price;                        // options, and anything unquoted
        approximated.add(sym);
      } else {
        px = lastClose[YAHOO_SYMBOLS[sym]];
        /* A gap in an otherwise-resolved series used to drop the whole day, which
           truncated the curve with no error anywhere — the same visible symptom
           as a missing mapping. Fall back to the brokerage's own last price and
           declare it instead of losing the day. */
        if (px == null && pos.last_price != null) {
          px = pos.last_price;
          approximated.add(sym);
        }
        if (px == null) { priced = false; return; }
      }
      const native = pos.qty * px * (pos.multiplier || 1);
      value += pos.currency === 'USD' ? native * fx : native;
    });
    if (!priced) return;                            // genuinely nothing to value it with

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
      if (pos.flat || flatCarry.has(sym)) return;  // excluded, not carried flat backwards
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
  const symbolMap = resolveSymbols(prices);
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
      /* The actual last priced day, not the requested TO — dates[] (and so
         daily[]) only contains days a real price was fetched for, while TO is
         just the requested upper bound. A caller asking to reprice "through
         today" on a market holiday would otherwise get a stamp claiming
         prices exist for a day that has none. */
      as_of: daily[daily.length - 1].date,
      price_source: OFFLINE ? 'cached' : 'yahoo via market-proxy',
      approximated: approximated,
      /* What each holding was actually priced against, so the next run skips
         rediscovery and so a wrong series can be traced to a wrong listing. */
      symbol_map: symbolMap,
      note: 'Holdings are assumed constant between snapshots, so a trade is ' +
        'recognised at the next refresh rather than on its trade date.',
      /* Cleared on every successful full reprice — Object.assign otherwise
         carries a flag set by an earlier --snapshot-only run forward forever,
         even once a later run has actually caught the series up. */
      reprice_pending: undefined
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
