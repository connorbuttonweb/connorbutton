#!/usr/bin/env node
/* merge-portfolio.js — fold a Questrade snapshot into assets/data/portfolio.json.
 *
 *   node merge-portfolio.js <snapshot.json> <portfolio.json> [--dry-run]
 *
 * This is a MERGE, not a rebuild. Two parts of the target file are either
 * accumulated or hand-maintained and must survive untouched:
 *
 *   history.portfolio  append-only; it is the ONLY source of return data and
 *                      cannot be reconstructed from the brokerage feed
 *   etfs               fund constituents typed in from fact sheet PDFs
 *
 * Every transformation that was originally worked out by hand lives here so it
 * is applied identically on every refresh. See references/data-contract.md for
 * field-by-field provenance and references/questrade-mcp.md for feed quirks.
 */
'use strict';

const fs = require('fs');
const crypto = require('crypto');

/* ------------------------------------------------------------------ config */

const ACCOUNT_LABEL = "Connor's Account";
const ACCOUNT_ID = 'main';          // logical id; never a real account number
const ACCOUNT_TYPE = 'Registered';

/* Questrade's category names -> the singular vocabulary the dashboard filters
   on. An unmapped type is thrown rather than passed through: silently emitting
   "Dividends" makes the Income tab match nothing and looks like empty data. */
const TYPE_MAP = {
  'Trades': 'Trade',
  'Dividends': 'Dividend',
  'Dividend reinvestment': 'Dividend',
  'Deposits': 'Deposit',
  'Withdrawals': 'Withdrawal',
  'Fees and rebates': 'Fee',
  'Transfers': 'Transfer',
  'FX conversion': 'FX',
  'Interest': 'Interest',
  'Corporate actions': 'Corporate action',
  'Other': 'Other'
};

/* Flows that move money in or out of the portfolio. TWR removes these before
   chaining returns, so misclassifying one corrupts every published figure. */
const FLOW_TYPES = new Set(['Deposit', 'Withdrawal', 'Transfer']);

const OPTION_RE = /^[A-Z.]+\d{2}[A-Z]{3}\d{2}[CP][\d.]+$/;
const SECRET_RE = /\b\d{7,}\b/;                       // account numbers
const UUID_RE = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/;

/* --------------------------------------------------------------- utilities */

const r2 = n => Math.round(n * 100) / 100;
const r4 = n => Math.round(n * 10000) / 10000;
const r6 = n => Math.round(n * 1e6) / 1e6;

function die(msg) {
  console.error('merge-portfolio: ' + msg);
  process.exit(1);
}

/* Balances arrive as formatted currency strings ("$14,572.58", "-$29.48"). */
function parseMoney(v) {
  if (typeof v === 'number') return v;
  if (v === null || v === undefined) return 0;
  const neg = /^\s*-|\(/.test(String(v));
  const n = parseFloat(String(v).replace(/[^0-9.]/g, ''));
  if (!isFinite(n)) return 0;
  return neg ? -n : n;
}

/* Transaction fingerprint for exact de-duplication. Hashed one-way so no
   brokerage identifier is ever written, and prefixed so the digits can't be
   mistaken for an account number. Needed because two accounts can produce
   byte-identical activity rows (the same ETF distribution paid into both),
   which a date+amount+description key would wrongly collapse into one. */
function fingerprint(a) {
  const basis = a.transactionId ||
    [a.tradeDate, a.transactionType, a.amount, a.currency, a.description, a.accountKey].join('|');
  return 't_' + crypto.createHash('sha256').update(String(basis)).digest('hex').slice(0, 10);
}

function assertClean(value, where) {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  if (SECRET_RE.test(s)) {
    die('refusing to write what looks like an account number in ' + where + ': ' + s.slice(0, 160) +
      '\n  Scrub it at the source. Do not relax this check.');
  }
  if (UUID_RE.test(s)) {
    die('refusing to write a brokerage UUID in ' + where + ': ' + s.slice(0, 160));
  }
}

/* ------------------------------------------------------------------- input */

const [, , snapPath, portPath, ...flags] = process.argv;
if (!snapPath || !portPath) {
  die('usage: node merge-portfolio.js <snapshot.json> <portfolio.json> [--dry-run]');
}
const DRY = flags.includes('--dry-run');

if (!fs.existsSync(portPath)) {
  die('no existing portfolio at ' + portPath + '.\n' +
    '  A refresh merges into the current file — it never creates one from scratch,\n' +
    '  because history.portfolio and etfs cannot be rebuilt from the brokerage feed.');
}

const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
const prev = JSON.parse(fs.readFileSync(portPath, 'utf8'));

const AS_OF = snap.as_of || new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(AS_OF)) die('snapshot as_of must be YYYY-MM-DD, got ' + AS_OF);

/* -------------------------------------------------------- 1. exchange rate */

/* Every account reports equity split cad / usd / combinedCad, so the rate the
   broker actually applied can be recovered rather than guessed:
   combinedCad = cad + usd * fx. Accounts are cross-checked against each other;
   a disagreement means the parse is wrong, not that the rate moved. */
function deriveFx(accounts) {
  const rates = [];
  accounts.forEach(a => {
    const eq = (a.balances && a.balances.balances && a.balances.balances.totalEquity) || null;
    if (!eq) return;
    const cad = parseMoney(eq.cad);
    const usd = parseMoney(eq.usd);
    const comb = parseMoney(eq.combinedCad);
    if (usd > 0.01) rates.push((comb - cad) / usd);
  });
  if (!rates.length) {
    if (snap.fx && snap.fx.USDCAD) return snap.fx.USDCAD;
    die('could not derive USDCAD: no account reported a USD equity balance, and the ' +
      'snapshot carries no fx fallback.');
  }
  const lo = Math.min.apply(null, rates), hi = Math.max.apply(null, rates);
  if (hi - lo > 0.001) {
    die('accounts disagree on the implied USDCAD rate (' + lo.toFixed(5) + ' vs ' +
      hi.toFixed(5) + '). The balance figures are probably being parsed wrong.');
  }
  return r4(rates.reduce((a, b) => a + b, 0) / rates.length);
}

const accountsIn = snap.accounts || [];
if (!accountsIn.length) die('snapshot contains no accounts');
const USDCAD = deriveFx(accountsIn);

/* --------------------------------------------------- 2. combined cash/equity */

let cash = 0, buyingPower = 0, reportedEquity = 0, reportedMarketValue = 0;
accountsIn.forEach(a => {
  const b = (a.balances && a.balances.balances) || {};
  cash += parseMoney(b.cash && b.cash.combinedCad);
  buyingPower += parseMoney(b.buyingPower && b.buyingPower.combinedCad);
  reportedEquity += parseMoney(b.totalEquity && b.totalEquity.combinedCad);
  reportedMarketValue += parseMoney(b.marketValue && b.marketValue.combinedCad);
});

const account = {
  id: ACCOUNT_ID,
  type: ACCOUNT_TYPE,
  label: ACCOUNT_LABEL,
  cash: r2(cash),
  currency: 'CAD',
  buying_power: r2(buyingPower)
};

/* --------------------------------------------------------- 3. quotes index */

const quotes = {};
(snap.quotes || []).forEach(q => { quotes[q.symbol] = q; });

function classify(symbol, q) {
  if (OPTION_RE.test(symbol)) return 'Option';
  const t = (q && q.securityType) || '';
  if (/gold|metal|commodit/i.test(t) || /\.QM$/.test(symbol)) return 'Commodity';
  const name = ((q && q.description) || '') + ' ' + symbol;
  if (/\bETF\b|INDEX FUND|PORTFOLIO UNITS|TRUST II/i.test(name)) return 'ETF';
  return 'Stock';
}

/* ------------------------------------------- 4. positions merged and priced */

/* The same security held in two accounts is one position. Quantities add;
   average cost must be weighted by quantity — averaging the two averages is
   wrong whenever the share counts differ. */
const bySymbol = new Map();
accountsIn.forEach(a => {
  (a.positions || []).forEach(p => {
    const sym = p.instrument || p.symbol;
    if (!sym) return;
    const e = bySymbol.get(sym) || { symbol: sym, qty: 0, cost: 0 };
    e.qty += p.qty;
    e.cost += p.qty * p.avgPrice;
    bySymbol.set(sym, e);
  });
});

const prevBySymbol = {};
(prev.positions || []).forEach(p => { prevBySymbol[p.symbol] = p; });

const positions = Array.from(bySymbol.values()).map(e => {
  const q = quotes[e.symbol];
  if (!q) die('no quote for held symbol ' + e.symbol + ' — add it to the get_quotes call.');
  if (typeof q.lastPrice !== 'number') die('quote for ' + e.symbol + ' has no lastPrice');

  const assetType = classify(e.symbol, q);
  const multiplier = assetType === 'Option' ? 100 : 1;
  const price = q.lastPrice;
  /* Questrade reports today's move, not yesterday's close. */
  const prevClose = r4(price - (q.priceChangeAmount || 0));
  const avgCost = e.qty ? e.cost / e.qty : 0;
  const old = prevBySymbol[e.symbol] || {};

  const pos = {
    symbol: e.symbol,
    name: old.name || q.description || e.symbol,
    account_id: ACCOUNT_ID,
    asset_type: assetType,
    currency: q.currency || 'CAD',
    quantity: r4(e.qty),
    avg_cost: r4(avgCost),
    price: price,
    prev_close: prevClose,
    market_value: r2(e.qty * price * multiplier),
    open_pnl: r2(e.qty * (price - avgCost) * multiplier),
    /* Sector/geography are not in the brokerage feed for equities; whatever was
       classified before is kept so hand-tagging survives a refresh. */
    sector: old.sector !== undefined ? old.sector : null,
    geography: old.geography !== undefined ? old.geography : null,
    market_cap_bucket: old.market_cap_bucket !== undefined ? old.market_cap_bucket : null
  };
  if (multiplier !== 1) pos.multiplier = multiplier;
  /* Set by the fund-holdings skill to fold cross-listings (BEPC / BEPC.TO) onto
     one exposure; carried forward so a refresh doesn't undo it. */
  if (old.canonical_ticker) pos.canonical_ticker = old.canonical_ticker;
  return pos;
}).sort((a, b) => b.market_value - a.market_value);

if (!positions.length) die('snapshot produced zero positions — refusing to publish an empty portfolio');

const toCad = p => (p.currency === 'USD' ? p.market_value * USDCAD : p.market_value);
const marketValue = positions.reduce((a, p) => a + toCad(p), 0);
const totalValue = marketValue + account.cash;

/* ------------------------------------------------------- 5. activities merge */

function normalizeActivity(a) {
  const type = TYPE_MAP[a.transactionType];
  if (!type) {
    die('unmapped activity type "' + a.transactionType + '".\n' +
      '  Add it to TYPE_MAP. Passing it through unchanged would silently break the ' +
      'Income and Activity filters, which match on the singular names.');
  }
  const description = String(a.description || '').replace(/\s+/g, ' ').trim();
  assertClean(description, 'activity description');
  return {
    uid: fingerprint(a),
    date: a.tradeDate,
    type: type,
    account_id: ACCOUNT_ID,
    symbol: a.symbol || null,
    description: description,
    amount: a.amount,
    currency: a.currency,
    quantity: a.quantity === undefined ? null : a.quantity,
    price: a.price === undefined ? null : a.price
  };
}

/* Content hash, used only for rows stored before uids existed. */
function compositeKey(a) {
  return 'c_' + crypto.createHash('sha256')
    .update([a.date, a.type, a.amount, a.currency, a.description].join('|'))
    .digest('hex').slice(0, 10);
}

/* Legacy rows carry no uid, and two accounts can produce byte-identical rows
   (the same ETF distribution paid into both). Keying those purely on content
   would silently merge two real transactions into one, so each repeat of a
   given content hash gets its own numbered slot. */
const merged = new Map();
const slots = new Map();                       // composite hash -> [map keys, in order]
(prev.activities || []).forEach(a => {
  const comp = compositeKey(a);
  const arr = slots.get(comp) || [];
  const key = a.uid || comp + '#' + arr.length;
  arr.push(key);
  slots.set(comp, arr);
  merged.set(key, Object.assign({ uid: key }, a));
});

let added = 0;
const seenIncoming = new Map();
(snap.activities || []).forEach(raw => {
  const a = normalizeActivity(raw);
  const comp = compositeKey(a);
  const n = seenIncoming.get(comp) || 0;
  seenIncoming.set(comp, n + 1);

  if (merged.has(a.uid)) { merged.set(a.uid, a); return; }   // already keyed by uid

  /* The refresh window deliberately overlaps, so an incoming row may already be
     stored under a legacy content key. Match it to the nth occurrence of the
     same content and upgrade that slot in place rather than duplicating it. */
  const arr = slots.get(comp) || [];
  const legacyKey = arr[n];
  if (legacyKey && merged.has(legacyKey) && legacyKey.charAt(0) === 'c') {
    merged.delete(legacyKey);
    arr[n] = a.uid;
    merged.set(a.uid, a);
    return;
  }

  added++;
  arr.push(a.uid);
  slots.set(comp, arr);
  merged.set(a.uid, a);
});

const activities = Array.from(merged.values())
  .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

/* --------------------------------------------------- 6. history: APPEND ONLY */

const prevHistory = (prev.history && prev.history.portfolio) || [];
const lastSnapshot = prevHistory.length ? prevHistory[prevHistory.length - 1] : null;

/* net_flow is money that entered or left between the previous snapshot and this
   one. TWR strips it out before chaining returns, so a wrong value here shows up
   as fictitious performance on a public page. */
let netFlow = 0;
if (lastSnapshot) {
  activities.forEach(a => {
    if (!FLOW_TYPES.has(a.type)) return;
    if (a.date <= lastSnapshot.date || a.date > AS_OF) return;
    netFlow += a.currency === 'USD' ? a.amount * USDCAD : a.amount;
  });
}

const history = prevHistory.slice();          // never truncate
const todayPoint = { date: AS_OF, value: r2(totalValue), net_flow: r2(netFlow) };
const sameDay = history.findIndex(h => h.date === AS_OF);
if (sameDay >= 0) history[sameDay] = todayPoint;   // re-running today corrects, not duplicates
else history.push(todayPoint);
history.sort((a, b) => (a.date < b.date ? -1 : 1));

if (history.length < prevHistory.length) {
  die('internal error: history shrank from ' + prevHistory.length + ' to ' + history.length);
}

/* ------------------------------------------------------ 7. prices, watchlist */


const benchmarks = Object.assign({}, (prev.history && prev.history.benchmarks) || {});
if (snap.benchmark && Array.isArray(snap.benchmark.series) && snap.benchmark.series.length) {
  benchmarks.SPX = snap.benchmark.series;
}


/* ------------------------------------------------------------- 8. projections */

const dividends_projected = positions
  .filter(p => quotes[p.symbol] && quotes[p.symbol].dividendYield > 0)
  .map(p => {
    const old = (prev.dividends_projected || []).find(d => d.symbol === p.symbol) || {};
    return {
      symbol: p.symbol,
      annual_rate_per_share: r4(p.price * quotes[p.symbol].dividendYield),
      frequency: old.frequency || 'quarterly',
      next_ex_date: old.next_ex_date || null,
      next_pay_date: old.next_pay_date || null
    };
  });

const income = positions.reduce(
  (a, p) => a + toCad(p) * ((quotes[p.symbol] && quotes[p.symbol].dividendYield) || 0), 0);

/* ------------------------------------------------------------- 9. assemble */

const out = {
  meta: {
    generated_at: new Date().toISOString(),
    as_of: AS_OF,
    base_currency: 'CAD',
    fx: { USDCAD: USDCAD },
    /* Inception is when the brokerage history starts; it never moves. */
    inception_date: (prev.meta && prev.meta.inception_date) || AS_OF,
    risk_free_rate: (prev.meta && prev.meta.risk_free_rate) || 0.029,
    source: 'questrade',
    notes: (prev.meta && prev.meta.notes) ||
      'Positions, balances and transactions pulled from Questrade. Account numbers are ' +
      'deliberately not stored. Self-directed accounts are combined; the custom-indexing ' +
      'account is excluded.'
  },
  profile: {
    /* Not published by the brokerage. Left null rather than estimated — this
       page presents itself as a fund fact sheet, and a guessed fee would read
       as a stated one. */
    blended_mer: (prev.profile && prev.profile.blended_mer) || null,
    distribution_yield: marketValue ? r4(income / marketValue) : 0,
    holdings_count: positions.length,
    etf_count: positions.filter(p => p.asset_type === 'ETF').length,
    benchmark_label: (prev.profile && prev.profile.benchmark_label) || 'S&P 500 (VFV.TO, CAD)'
  },
  accounts: [account],
  positions: positions,
  etfs: prev.etfs || {},              // PRESERVED — hand-entered from fact sheets
  activities: activities,
  dividends_projected: dividends_projected,
  history: { portfolio: history, benchmarks: benchmarks },
};

/* Final sweep over everything except the generated timestamp. */
assertClean(JSON.stringify(out).replace(/"generated_at":"[^"]*"/, ''), 'output document');

/* --------------------------------------------------------------- 10. report */

const prevValue = lastSnapshot ? lastSnapshot.value : null;
const prevSymbols = new Set(Object.keys(prevBySymbol));
const nowSymbols = new Set(positions.map(p => p.symbol));
const opened = positions.filter(p => !prevSymbols.has(p.symbol)).map(p => p.symbol);
const closed = Array.from(prevSymbols).filter(s => !nowSymbols.has(s));

const lines = [
  'as of            ' + AS_OF + (DRY ? '   (DRY RUN — nothing written)' : ''),
  'USDCAD           ' + USDCAD,
  'total value      $' + totalValue.toFixed(2) +
  (prevValue !== null ? '   (was $' + prevValue.toFixed(2) + ', ' +
    (totalValue - prevValue >= 0 ? '+' : '') + (totalValue - prevValue).toFixed(2) + ')' : ''),
  'reconciles to    $' + reportedEquity.toFixed(2) + ' reported   diff $' +
  Math.abs(totalValue - reportedEquity).toFixed(2),
  'positions        ' + positions.length +
  (opened.length ? '   opened: ' + opened.join(', ') : '') +
  (closed.length ? '   closed: ' + closed.join(', ') : ''),
  'activities       ' + activities.length + '   (+' + added + ' new)',
  'net flow         $' + netFlow.toFixed(2) + ' since ' + (lastSnapshot ? lastSnapshot.date : 'inception'),
  'history          ' + prevHistory.length + ' -> ' + history.length + ' snapshots',
  'etfs preserved   ' + Object.keys(out.etfs).length + ' fund(s)'
];
console.log(lines.join('\n'));

if (Math.abs(totalValue - reportedEquity) > 25) {
  console.error('\nWARNING: computed total is more than $25 from the brokerage figure. ' +
    'Check for a position missing a quote, or an option missing its multiplier.');
}

if (DRY) process.exit(0);

fs.writeFileSync(portPath, JSON.stringify(out, null, 1));
console.log('\nwrote ' + portPath + ' (' + (fs.statSync(portPath).size / 1024).toFixed(1) + ' KB)');
console.log('Run validate-portfolio.js next — the refresh is not done until it passes.');
