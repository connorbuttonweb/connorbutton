#!/usr/bin/env node
/* parse-holdings.js — vendor holdings file -> holdings/<SYMBOL>.md
 *
 *   node parse-holdings.js --symbol XEQT.TO --name "..." --as-of 2026-08-03 \
 *        --vendor ishares --in <file.csv> [--out holdings/] [--min-weight 0.01]
 *
 * Vendors: ishares | vanguard | roundhill | generic
 *
 * PDF listings (Fidelity) cannot be parsed here — transcribe them to a TSV of
 * `name<TAB>weight` (optionally `ticker<TAB>name<TAB>weight`) and pass
 * --vendor generic. See references/vendor-formats.md.
 *
 * The markdown it writes is the source of truth: hand-editable, diffable, and
 * read back by apply-holdings.js. Nothing writes to portfolio.json from here.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const N = require('./lib/normalize');

/* ------------------------------------------------------------------ args */
const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf('--' + k);
  return i >= 0 ? argv[i + 1] : d;
};
const SYMBOL = arg('symbol');
const NAME = arg('name');
const AS_OF = arg('as-of');
const VENDOR = (arg('vendor') || 'generic').toLowerCase();
const IN = arg('in');
const OUTDIR = arg('out', 'holdings');
const MIN_WEIGHT = parseFloat(arg('min-weight', '0.01'));   // percent

if (!SYMBOL || !AS_OF || !IN) {
  console.error('usage: node parse-holdings.js --symbol SYM --as-of YYYY-MM-DD --vendor V --in FILE [--name N] [--out DIR] [--min-weight 0.01]');
  process.exit(2);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(AS_OF)) { console.error('--as-of must be YYYY-MM-DD'); process.exit(2); }
if (!fs.existsSync(IN)) { console.error('no such file: ' + IN); process.exit(2); }

/* ------------------------------------------------------------- CSV reader */
function parseCSV(text) {
  const rows = [];
  let field = '', row = [], quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const num = v => {
  const n = parseFloat(String(v == null ? '' : v).replace(/[$,%\s]/g, ''));
  return isFinite(n) ? n : 0;
};

const raw = fs.readFileSync(IN, 'utf8').replace(/^﻿/, '');

/* --------------------------------------------------------------- vendors */
/* Each returns [{ ticker, name, weightPct, sector, geography, currency }]. */
const VENDORS = {
  /* iShares: metadata rows, then a header row, then holdings. Weight is a
     number in percent; Location is a full country name. */
  ishares(text) {
    const rows = parseCSV(text);
    const h = rows.findIndex(r => r.indexOf('Ticker') >= 0 && r.indexOf('Weight (%)') >= 0);
    if (h < 0) throw new Error('iShares header row not found');
    const H = rows[h];
    const col = n => H.indexOf(n);
    const [iT, iN, iS, iA, iW, iL, iC] =
      ['Ticker', 'Name', 'Sector', 'Asset Class', 'Weight (%)', 'Location', 'Market Currency'].map(col);
    return rows.slice(h + 1)
      .filter(r => r.length > iW && r[iT] && r[iT].trim())
      .map(r => ({
        ticker: r[iT].trim(), name: (r[iN] || '').trim(),
        weightPct: num(r[iW]), sector: r[iS], geography: r[iL],
        currency: (r[iC] || '').trim() || null, assetClass: r[iA]
      }));
  },

  /* Vanguard: preamble, header at "Ticker,Holding name,% of market value,...".
     Weight is a percent string; Region is a 2-letter country code. */
  vanguard(text) {
    const rows = parseCSV(text);
    const h = rows.findIndex(r => r.indexOf('Ticker') >= 0 && r.some(c => /% of market value/i.test(c)));
    if (h < 0) throw new Error('Vanguard header row not found');
    const H = rows[h];
    const iT = H.indexOf('Ticker');
    const iN = H.findIndex(c => /holding name/i.test(c));
    const iW = H.findIndex(c => /% of market value/i.test(c));
    const iS = H.findIndex(c => /^sector$/i.test(c));
    const iR = H.findIndex(c => /^region$/i.test(c));
    return rows.slice(h + 1)
      .filter(r => r.length > iW && r[iT] && r[iT].trim() && num(r[iW]) > 0)
      .map(r => ({
        ticker: r[iT].trim(), name: (r[iN] || '').trim(),
        weightPct: num(r[iW]), sector: r[iS], geography: r[iR], currency: null
      }));
  },

  /* Roundhill: Ticker,Name,Identifier,Weight,Shares,Market Value.
     Tickers are Bloomberg-style ("2330 TT"); there is no sector column.

     Two row types are not what the Ticker column makes them look like.

     Cash and FX carry an identifier of "CASH<CCY>" ("CASHKRW") and a ticker
     that is just the currency code, which no name-based rule catches; the
     identifier is the reliable tell, so it sets the asset class.

     A swap-based fund holds much of its exposure through total return swaps,
     published with the contract in the Ticker column ("6450267 TRS 052427 GS")
     and the underlying decorated into the Name ("SK HYNIX INC-SWAP-GOLD-L").
     That is real long exposure to the company named — DRAM reaches Micron
     almost entirely this way, and dropping the rows as derivatives would
     understate it by an order of magnitude and hand the weight to Unresolved.
     So the decoration comes off and the row resolves by name like any other.
     The contract is not a ticker and its counterparty is not a country, so both
     are left empty for the fold and the ticker maps to supply. */
  roundhill(text) {
    const rows = parseCSV(text);
    const H = rows[0];
    const iT = H.indexOf('Ticker'), iN = H.indexOf('Name'),
          iI = H.indexOf('Identifier'), iW = H.indexOf('Weight');
    return rows.slice(1)
      .filter(r => r.length > iW && r[iT] && r[iT].trim())
      .map(r => {
        const rawTicker = r[iT].trim();
        const name = (r[iN] || '').trim();
        if (/\bSWAP\b/i.test(name) || /\bTRS\b/.test(rawTicker)) {
          return {
            ticker: null, name: name.replace(/[\s-]*\bSWAP\b.*$/i, '').trim(),
            weightPct: num(r[iW]), sector: null,
            geography: null, currency: null, synthetic: true
          };
        }
        const ident = iI >= 0 ? (r[iI] || '').trim() : '';
        const { country } = N.splitExchange(rawTicker);
        return {
          ticker: rawTicker, name: name,
          weightPct: num(r[iW]), sector: null,
          geography: country || 'United States', currency: null,
          assetClass: /^CASH/i.test(ident) ? 'Cash' : null
        };
      });
  },

  /* Transcribed listings: TSV of name<TAB>weight, or ticker/name/weight, or
     four columns with a geography hint. Lines starting with # are comments. */
  generic(text) {
    return text.split('\n')
      .map(l => l.replace(/\r/g, ''))
      .filter(l => l.trim() && !l.trim().startsWith('#'))
      .map(l => {
        const p = l.split('\t').map(s => s.trim());
        if (p.length >= 4) return { ticker: p[0] || null, name: p[1], weightPct: num(p[2]), sector: null, geography: p[3], currency: null };
        if (p.length === 3) return { ticker: p[0] || null, name: p[1], weightPct: num(p[2]), sector: null, geography: null, currency: null };
        return { ticker: null, name: p[0], weightPct: num(p[1]), sector: null, geography: null, currency: null };
      })
      .filter(r => r.name);
  }
};

if (!VENDORS[VENDOR]) {
  console.error('unknown vendor "' + VENDOR + '" — expected one of: ' + Object.keys(VENDORS).join(', '));
  process.exit(2);
}

/* ------------------------------------------------------------ normalize */
let parsed;
try { parsed = VENDORS[VENDOR](raw); }
catch (e) { console.error('parse failed: ' + e.message); process.exit(1); }

const excludedNonEquity = [];
const dropped = [];
const byTicker = new Map();
let unmatched = 0;

parsed.forEach(r => {
  if (N.isNonEquity(r.name, r.assetClass) || N.isNonEquity(r.ticker, r.assetClass)) {
    excludedNonEquity.push(r); return;
  }
  if (!(r.weightPct >= MIN_WEIGHT)) { dropped.push(r); return; }

  const { ticker, matched } = N.canonicalTicker(r.ticker, r.name);
  if (!ticker) { dropped.push(r); return; }
  if (!matched) unmatched++;

  /* A fund can list the same company twice (an ADR and its local line, or two
     share classes mapped to one ticker); their weights add. */
  const prev = byTicker.get(ticker);
  if (prev) {
    prev.weightPct += r.weightPct;
    /* Rows for one company rarely carry the same detail — a swap row names no
       exchange and no sector, the underlying's own row does. Take the first
       non-empty value for each rather than whichever row happened to be first. */
    if (!prev.sector) prev.sector = N.sectorFor(ticker, r.sector);
    if (!prev.geography) prev.geography = N.geographyFor(ticker, r.geography);
    if (!prev.currency) prev.currency = r.currency;
    /* A swap row carries the underlying in the counterparty's house style
       ("MICRON TECHNOLOGY, INC.-SWAP-GOLD-L"); the company's own row names it
       properly, so let that win when the fund lists both. */
    if (prev.synthetic && !r.synthetic && r.name) prev.name = r.name;
    if (r.synthetic) prev.synthetic = true;
    prev.aliases.add(r.ticker || r.name);
  } else {
    byTicker.set(ticker, {
      ticker: ticker,
      name: r.name || ticker,
      weightPct: r.weightPct,
      sector: N.sectorFor(ticker, r.sector),
      geography: N.geographyFor(ticker, r.geography),
      currency: r.currency,
      matched: matched,
      synthetic: !!r.synthetic,
      aliases: new Set([r.ticker || r.name])
    });
  }
});

const holdings = Array.from(byTicker.values()).sort((a, b) => b.weightPct - a.weightPct);

/* A fund can publish more than 100% in securities when it carries negative cash
   (an unsettled payable) — CHAT does. Passed through unchanged that fund would
   contribute more than its own market value to the look-through, breaking value
   conservation and making the portfolio total wrong. Scale back to 100% and
   record the published figure so the adjustment is visible rather than hidden. */
const publishedTotal = holdings.reduce((a, h) => a + h.weightPct, 0);
let rescaled = null;
if (publishedTotal > 100) {
  const f = 100 / publishedTotal;
  holdings.forEach(h => { h.weightPct *= f; });
  rescaled = publishedTotal;
}
const coverage = holdings.reduce((a, h) => a + h.weightPct, 0) / 100;

/* -------------------------------------------------------------- markdown */
const esc = s => String(s == null ? '' : s).replace(/\|/g, '\\|').trim();
const pct = n => n.toFixed(4);

const nonEquityWeight = excludedNonEquity.reduce((a, r) => a + (r.weightPct || 0), 0);
const syntheticWeight = holdings.filter(h => h.synthetic).reduce((a, h) => a + h.weightPct, 0);
const syntheticNames = holdings.filter(h => h.synthetic).map(h => h.ticker);
const droppedWeight = dropped.reduce((a, r) => a + (r.weightPct || 0), 0);

const md = [
  '---',
  'symbol: ' + SYMBOL,
  'name: ' + (NAME || SYMBOL),
  'as_of: ' + AS_OF,
  'coverage: ' + coverage.toFixed(6),
  'holdings_listed: ' + holdings.length,
  'source_file: ' + path.basename(IN),
  'vendor: ' + VENDOR,
  'generated: ' + new Date().toISOString().slice(0, 10),
  '---',
  '',
  '# ' + (NAME || SYMBOL) + ' (`' + SYMBOL + '`)',
  '',
  'Holdings as published by the fund, as at **' + AS_OF + '**.',
  '',
  '- **' + holdings.length + '** constituents listed, covering **' + (coverage * 100).toFixed(2) + '%** of net assets.',
  nonEquityWeight ? '- ' + nonEquityWeight.toFixed(2) + '% is cash, FX or collateral and is excluded — it surfaces in the dashboard as *Unresolved*.' : null,
  syntheticWeight ? '- ' + syntheticWeight.toFixed(2) + '% is held synthetically through total return swaps rather than as shares (' +
    syntheticNames.join(', ') + '). The exposure is counted against the company each swap references, which is what the look-through is measuring.' : null,
  rescaled ? '- The fund publishes **' + rescaled.toFixed(2) + '%** in securities against negative cash. Weights below are scaled by ' +
    (100 / rescaled).toFixed(6) + ' to total 100%, so this fund contributes exactly its own market value to the look-through.' : null,
  dropped.length ? '- ' + dropped.length + ' holdings below the ' + MIN_WEIGHT + '% reporting floor (' + droppedWeight.toFixed(2) + '% combined) are omitted.' : null,
  unmatched ? '- ' + unmatched + (unmatched === 1 ? ' constituent could' : ' constituents could') +
    ' not be resolved to a ticker and ' + (unmatched === 1 ? 'is' : 'are') +
    ' keyed by name (prefixed `~`). They contribute to sector and geography totals but never match another fund\'s holding.' : null,
  '',
  '> Edit this file to correct a ticker, sector or weight, then re-run',
  '> `apply-holdings.js` to push the change into the dashboard. This file is the',
  '> source of truth — `portfolio.json` is generated from it.',
  '',
  '| Ticker | Name | Weight % | Sector | Geography | Currency |',
  '|---|---|---:|---|---|---|'
].filter(l => l !== null);

holdings.forEach(h => {
  md.push('| ' + [
    esc(h.ticker), esc(h.name), pct(h.weightPct),
    esc(h.sector || ''), esc(h.geography || ''), esc(h.currency || '')
  ].join(' | ') + ' |');
});

md.push('');
md.push('_Total listed: ' + (coverage * 100).toFixed(2) + '%_');
md.push('');

fs.mkdirSync(OUTDIR, { recursive: true });
const outPath = path.join(OUTDIR, SYMBOL + '.md');
fs.writeFileSync(outPath, md.join('\n'));

console.log('wrote ' + outPath);
console.log('  constituents   ' + holdings.length + (unmatched ? '   (' + unmatched + ' unmatched to a ticker)' : ''));
console.log('  coverage       ' + (coverage * 100).toFixed(2) + '%');
if (nonEquityWeight) console.log('  cash/collat    ' + nonEquityWeight.toFixed(2) + '% excluded');
if (syntheticWeight) console.log('  via swaps      ' + syntheticWeight.toFixed(2) + '%   (' + syntheticNames.join(', ') + ')');
if (dropped.length) console.log('  below floor    ' + dropped.length + ' rows, ' + droppedWeight.toFixed(2) + '%');
if (coverage > 1.001) console.log('  WARNING: listed weights exceed 100% — check for double-counted rows.');
