#!/usr/bin/env node
/* validate-portfolio.js — gate on the invariants that matter.
 *
 *   node validate-portfolio.js <portfolio.json> [--prev-history-count N]
 *                                               [--prev-etf-count N]
 *                                               [--allow-etf-shrink]
 *
 * Exits non-zero on any breach. A refresh is not complete until this passes.
 *
 * Written independently of merge-portfolio.js on purpose: a validator that
 * shares the writer's assumptions cannot catch the writer's mistakes. Where a
 * check needs contract semantics it loads the dashboard's own engine rather
 * than restating the schema, so drift between the data and the app fails here
 * instead of in the browser.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const flag = name => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : null;
};
const PREV_HISTORY = flag('prev-history-count') === null ? null : parseInt(flag('prev-history-count'), 10);
const PREV_ETFS = flag('prev-etf-count') === null ? null : parseInt(flag('prev-etf-count'), 10);
const ALLOW_ETF_SHRINK = args.includes('--allow-etf-shrink');

if (!file) {
  console.error('usage: node validate-portfolio.js <portfolio.json> [--prev-history-count N] [--prev-etf-count N] [--allow-etf-shrink]');
  process.exit(2);
}

let failures = 0, checks = 0, warnings = 0;
function check(name, cond, detail) {
  checks++;
  if (cond) { console.log('  PASS  ' + name); return true; }
  failures++;
  console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : ''));
  return false;
}
function warn(name, detail) {
  warnings++;
  console.log('  WARN  ' + name + (detail ? '\n        ' + detail : ''));
}

const raw = fs.readFileSync(file, 'utf8');
let d;
try { d = JSON.parse(raw); } catch (e) {
  console.error('  FAIL  file is not valid JSON: ' + e.message);
  process.exit(1);
}

/* ---------------------------------------------- 1. nothing identifying leaked */
console.log('\n1. No brokerage identifiers');
{
  /* Walk string values and keys only. Scanning the raw JSON text would flag the
     digits inside floating-point weights (0.06287899999999999) as account
     numbers, which is both wrong and would train the reader to ignore this
     check — the one check that must never be ignored. */
  const hits = [];
  const uuidHits = [];
  (function walk(node, pathStr) {
    if (typeof node === 'string') {
      if (/\b\d{7,}\b/.test(node)) hits.push(pathStr + ': ' + node.slice(0, 80));
      if (/\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/.test(node)) {
        uuidHits.push(pathStr + ': ' + node.slice(0, 80));
      }
      return;
    }
    if (Array.isArray(node)) { node.forEach((v, i) => walk(v, pathStr + '[' + i + ']')); return; }
    if (node && typeof node === 'object') {
      Object.keys(node).forEach(k => {
        if (/\b\d{7,}\b/.test(k)) hits.push('key ' + pathStr + '.' + k);
        if (pathStr === '' && k === 'generated_at') return;      // ISO timestamp
        if (k === 'uid' && /^t_[0-9a-f]+$/.test(node[k])) return; // hashed fingerprint
        walk(node[k], pathStr + '.' + k);
      });
    }
  })(d, '');

  check('no 7+ digit runs in any string (account numbers)', hits.length === 0,
    hits.slice(0, 4).join('\n        '));
  check('no brokerage UUIDs', uuidHits.length === 0, uuidHits.slice(0, 3).join('\n        '));
  check('account ids are logical, not numeric',
    (d.accounts || []).every(a => /^[a-z][a-z0-9_-]*$/i.test(String(a.id))),
    JSON.stringify((d.accounts || []).map(a => a.id)));
}

/* ------------------------------------------------ 2. history is append-only */
console.log('\n2. History is append-only');
{
  const h = (d.history && d.history.portfolio) || [];
  check('history exists', h.length > 0);
  const dates = h.map(p => p.date);
  const sorted = dates.slice().sort();
  check('dates strictly increasing', JSON.stringify(dates) === JSON.stringify(sorted),
    'stored order: ' + dates.slice(0, 6).join(', '));
  check('no duplicate dates', new Set(dates).size === dates.length,
    'count ' + dates.length + ' vs unique ' + new Set(dates).size);
  check('every point has a finite value and net_flow',
    h.every(p => isFinite(p.value) && isFinite(p.net_flow)));
  if (PREV_HISTORY !== null) {
    check('history did not shrink (was ' + PREV_HISTORY + ', now ' + h.length + ')',
      h.length >= PREV_HISTORY,
      'The return record cannot be rebuilt from the brokerage feed. Restore the previous ' +
      'file from git and re-run the merge rather than accepting this.');
  } else {
    warn('previous history count not supplied',
      'pass --prev-history-count N to prove nothing was dropped');
  }
}

/* ------------------------------------------- 3. hand-maintained data survived */
console.log('\n3. Hand-maintained sections preserved');
{
  const etfCount = Object.keys(d.etfs || {}).length;
  if (PREV_ETFS !== null && !ALLOW_ETF_SHRINK) {
    check('etfs not silently emptied (was ' + PREV_ETFS + ', now ' + etfCount + ')',
      etfCount >= PREV_ETFS,
      'Fund constituents are typed in from fact sheet PDFs and are not in the feed.');
  } else if (PREV_ETFS === null) {
    warn('previous etf count not supplied', 'pass --prev-etf-count N');
  }
  check('etfs is an object', d.etfs && typeof d.etfs === 'object' && !Array.isArray(d.etfs));
  Object.keys(d.etfs || {}).forEach(sym => {
    const e = d.etfs[sym];
    const sum = (e.holdings || []).reduce((a, x) => a + x.weight, 0);
    check(sym + ': coverage matches the sum of its weights',
      Math.abs(sum - e.coverage) < 0.005, 'weights ' + sum.toFixed(4) + ' vs coverage ' + e.coverage);
    check(sym + ': weights within 0..1', (e.holdings || []).every(x => x.weight > 0 && x.weight <= 1));
  });
}

/* --------------------------------------------- 4. the dashboard engine loads it */
console.log('\n4. The live dashboard engine accepts the file');
{
  const root = path.resolve(path.dirname(file), '../..');
  const dataJs = path.join(root, 'assets/js/dashboard/data.js');
  if (!fs.existsSync(dataJs)) {
    warn('dashboard engine not found at ' + dataJs, 'skipping contract check');
  } else {
    global.window = global;
    try {
      // eslint-disable-next-line no-eval
      eval(fs.readFileSync(dataJs, 'utf8'));
    } catch (e) {
      check('data.js evaluates', false, e.message);
    }
    const D = global.DASH && global.DASH.data;
    if (D) {
      let norm = null;
      try { norm = D.normalize(JSON.parse(raw)); }
      catch (e) { check('normalize() accepts the file', false, e.message); }

      if (norm) {
        check('normalize() succeeded', true);
        const sum = norm.positions.reduce((a, p) => a + p.mv_cad, 0);
        check('positions sum to totalValue', Math.abs(sum - norm.totalValue) < 0.01,
          sum.toFixed(2) + ' vs ' + norm.totalValue.toFixed(2));
        check('every weight is finite', norm.positions.every(p => isFinite(p.weight)));
        check('weights sum to 1', Math.abs(norm.positions.reduce((a, p) => a + p.weight, 0) - 1) < 1e-9);
        check('no NaN in derived money fields',
          norm.positions.every(p => isFinite(p.mv_cad) && isFinite(p.pnl_cad) && isFinite(p.day_change_cad)));

        /* Tolerance scales with the total: summing thousands of tiny constituent
           contributions accumulates cents of float drift, which is expected. A
           real conservation break is dollars, not cents. */
        const tol = Math.max(0.05, norm.totalValue * 1e-6);
        const lt = D.buildLookThrough(norm.positions, norm.etfs, {});
        check('look-through conserves the total', Math.abs(lt.total - norm.totalValue) < tol,
          lt.total.toFixed(2) + ' vs ' + norm.totalValue.toFixed(2));
        ['sector', 'geography', 'currency'].forEach(dim => {
          const roll = D.rollup(lt.rows, dim);
          check('rollup by ' + dim + ' conserves the total',
            Math.abs(roll.reduce((a, r) => a + r.value, 0) - lt.total) < tol);
        });
      }
    }
  }
}

/* ------------------------------------------------------- 5. reconciliation */
console.log('\n5. Reconciliation and field sanity');
{
  const acct = (d.accounts || [])[0] || {};
  const fx = (d.meta && d.meta.fx && d.meta.fx.USDCAD) || 1;
  const mv = (d.positions || []).reduce((a, p) => {
    const m = p.multiplier || 1;
    const v = p.quantity * p.price * m;
    return a + (p.currency === 'USD' ? v * fx : v);
  }, 0);
  const total = mv + (acct.cash || 0);
  const h = (d.history && d.history.portfolio) || [];
  const latest = h.length ? h[h.length - 1] : null;
  check('latest history point matches the positions total',
    latest ? Math.abs(latest.value - total) < 1 : false,
    latest ? latest.value.toFixed(2) + ' vs ' + total.toFixed(2) : 'no history');

  check('every position has finite price / prev_close / quantity / avg_cost',
    (d.positions || []).every(p =>
      isFinite(p.price) && isFinite(p.prev_close) && isFinite(p.quantity) && isFinite(p.avg_cost)));
  check('option positions carry a multiplier',
    (d.positions || []).every(p => p.asset_type !== 'Option' || p.multiplier === 100),
    'an option priced without its 100x multiplier reads ~1/100th of its true value');
  check('USDCAD in a plausible band (1.0 - 2.0)', fx > 1 && fx < 2, String(fx));

  const ALLOWED = new Set(['Trade', 'Dividend', 'Deposit', 'Withdrawal', 'Fee',
    'Transfer', 'FX', 'Interest', 'Corporate action', 'Other']);
  const bad = Array.from(new Set((d.activities || []).map(a => a.type))).filter(t => !ALLOWED.has(t));
  check('activity types use the singular contract vocabulary', bad.length === 0,
    bad.length ? 'unmapped: ' + bad.join(', ') + ' (the Income/Activity filters match singular names)' : '');

  const today = new Date().toISOString().slice(0, 10);
  check('meta.as_of is not in the future', (d.meta && d.meta.as_of) <= today,
    (d.meta && d.meta.as_of) + ' vs today ' + today);
  check('inception is not after as_of', (d.meta.inception_date || '') <= d.meta.as_of);
  check('activities are sorted newest first',
    (d.activities || []).every((a, i, arr) => i === 0 || arr[i - 1].date >= a.date));
}

/* ------------------------------------------------------------------ summary */
console.log('\n' + '='.repeat(58));
console.log(checks + ' checks, ' + failures + ' failed, ' + warnings + ' warning(s)');
if (failures) {
  console.log('\nDo NOT commit this file. Restore from git and re-run the merge.');
  process.exit(1);
}
console.log('Portfolio data is safe to commit.');
