#!/usr/bin/env node
/* apply-holdings.js — holdings/*.md -> the etfs{} block of portfolio.json
 *
 *   node apply-holdings.js [--holdings holdings] [--portfolio assets/data/portfolio.json]
 *                          [--dry-run] [--prune]
 *
 * The markdown files are the source of truth. This regenerates etfs{} from
 * them, touching nothing else in portfolio.json — positions, history,
 * activities and targets are all left exactly as found.
 *
 * By default a fund already in portfolio.json but with no markdown file is left
 * alone (so a partially-documented set never silently loses data). --prune
 * removes those instead.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const HOLDINGS_DIR = arg('holdings', 'holdings');
const PORTFOLIO = arg('portfolio', 'assets/data/portfolio.json');
const DRY = argv.includes('--dry-run');
const PRUNE = argv.includes('--prune');

function die(m) { console.error('apply-holdings: ' + m); process.exit(1); }

if (!fs.existsSync(HOLDINGS_DIR)) die('no holdings directory at ' + HOLDINGS_DIR);
if (!fs.existsSync(PORTFOLIO)) die('no portfolio at ' + PORTFOLIO);

/* ------------------------------------------------------- markdown parsing */

function parseMarkdown(file) {
  const text = fs.readFileSync(file, 'utf8');
  const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fm) die(path.basename(file) + ': missing YAML frontmatter');
  const meta = {};
  fm[1].split('\n').forEach(line => {
    const m = line.match(/^([a-z_]+):\s*(.*)$/i);
    if (m) meta[m[1]] = m[2].trim();
  });
  if (!meta.symbol) die(path.basename(file) + ': frontmatter has no symbol');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.as_of || '')) {
    die(path.basename(file) + ': as_of must be YYYY-MM-DD, got "' + meta.as_of + '"');
  }

  const lines = text.slice(fm[0].length).split('\n');
  const head = lines.findIndex(l => /^\|\s*Ticker\s*\|/i.test(l));
  if (head < 0) die(path.basename(file) + ': no holdings table found');

  const holdings = [];
  for (let i = head + 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim().startsWith('|')) { if (holdings.length) break; else continue; }
    const cells = line.split('|').slice(1, -1).map(c => c.replace(/\\\|/g, '|').trim());
    if (cells.length < 3) continue;
    const [ticker, name, weight, sector, geography, currency] = cells;
    const w = parseFloat(weight);
    if (!ticker || !isFinite(w)) continue;
    holdings.push({
      ticker: ticker,
      name: name || ticker,
      /* Rounded, not raw: w/100 yields artifacts like 0.06287899999999999,
         which bloat the file and read as noise in a published document. */
      weight: Math.round((w / 100) * 1e8) / 1e8,
      sector: sector || null,
      geography: geography || null,
      market_cap_bucket: null,               // not published by any of the funds
      currency: currency || null
    });
  }
  if (!holdings.length) die(path.basename(file) + ': holdings table is empty');

  /* Trust the table, not the frontmatter: coverage must equal the weights that
     are actually listed or every look-through figure is misstated. */
  const summed = holdings.reduce((a, h) => a + h.weight, 0);
  const declared = parseFloat(meta.coverage);
  if (isFinite(declared) && Math.abs(declared - summed) > 0.005) {
    console.log('  note: ' + meta.symbol + ' frontmatter coverage ' + declared.toFixed(4) +
      ' differs from the listed weights (' + summed.toFixed(4) + '); using the listed weights.');
  }
  if (summed > 1.001) {
    die(meta.symbol + ': listed weights total ' + (summed * 100).toFixed(2) + '% — over 100%. ' +
      'Check for a duplicated row before applying.');
  }

  const dupes = holdings.map(h => h.ticker)
    .filter((t, i, a) => a.indexOf(t) !== i);
  if (dupes.length) {
    die(meta.symbol + ': duplicate tickers in the table (' +
      Array.from(new Set(dupes)).slice(0, 5).join(', ') + '). Merge them into one row.');
  }

  return {
    symbol: meta.symbol,
    entry: {
      name: meta.name || meta.symbol,
      as_of: meta.as_of,
      coverage: Math.round(summed * 1e6) / 1e6,
      holdings: holdings.sort((a, b) => b.weight - a.weight)
    }
  };
}

/* ------------------------------------------------------------------- run */

const files = fs.readdirSync(HOLDINGS_DIR)
  .filter(f => f.endsWith('.md') && f.toLowerCase() !== 'readme.md')
  .map(f => path.join(HOLDINGS_DIR, f));

if (!files.length) die('no holdings markdown files in ' + HOLDINGS_DIR);

const portfolio = JSON.parse(fs.readFileSync(PORTFOLIO, 'utf8'));
const before = Object.keys(portfolio.etfs || {});
const etfs = PRUNE ? {} : Object.assign({}, portfolio.etfs || {});

console.log('Parsing ' + files.length + ' holdings file(s):');
files.forEach(f => {
  const { symbol, entry } = parseMarkdown(f);
  etfs[symbol] = entry;
  console.log('  ' + symbol.padEnd(10) + entry.holdings.length.toString().padStart(5) + ' holdings   ' +
    (entry.coverage * 100).toFixed(2) + '% coverage   as at ' + entry.as_of);
});

/* Which held funds still have no constituent data */
const heldFunds = (portfolio.positions || [])
  .filter(p => p.asset_type === 'ETF').map(p => p.symbol);
const missing = heldFunds.filter(s => !etfs[s]);
const unheld = Object.keys(etfs).filter(s => heldFunds.indexOf(s) < 0);

console.log('\nHeld funds        ' + heldFunds.length + '   (' + heldFunds.join(', ') + ')');
console.log('With holdings     ' + heldFunds.filter(s => etfs[s]).length);
if (missing.length) console.log('STILL MISSING     ' + missing.join(', '));
if (unheld.length) console.log('Not currently held ' + unheld.join(', ') + '   (kept for reference)');

/* Stale-data notice — the dashboard flags anything older than 45 days. */
const today = new Date();
Object.keys(etfs).forEach(s => {
  const age = Math.round((today - new Date(etfs[s].as_of + 'T00:00:00Z')) / 86400000);
  if (age > 45) console.log('  stale: ' + s + ' holdings are ' + age + ' days old (' + etfs[s].as_of + ')');
});

/* Stamp canonical tickers on directly-held positions so a company held on two
   exchanges aggregates as one exposure. Brookfield Renewable trades as BEPC.TO
   in Toronto and BEPC in New York; left separate, a 10% position reads as 7%
   plus 3% and never trips the concentration threshold. */
const N = require('./lib/normalize');
const stamped = [];
(portfolio.positions || []).forEach(p => {
  if (p.asset_type === 'ETF' || p.asset_type === 'Cash') return;
  const resolved = N.TICKER_ALIASES[String(p.symbol).toUpperCase()];
  if (resolved && resolved !== p.symbol) {
    p.canonical_ticker = resolved;
    stamped.push(p.symbol + ' -> ' + resolved);
  } else if (p.canonical_ticker && !resolved) {
    delete p.canonical_ticker;
  }
});
if (stamped.length) console.log('\nCross-listings folded onto one ticker: ' + stamped.join(', '));

if (DRY) { console.log('\nDRY RUN — portfolio.json not written'); process.exit(0); }

portfolio.etfs = etfs;
portfolio.profile = portfolio.profile || {};
fs.writeFileSync(PORTFOLIO, JSON.stringify(portfolio, null, 1));

console.log('\nwrote ' + PORTFOLIO + ' (' + (fs.statSync(PORTFOLIO).size / 1024).toFixed(1) + ' KB)');
console.log('etfs: ' + before.length + ' -> ' + Object.keys(etfs).length + ' fund(s)');
console.log('Run the portfolio validator next to confirm the contract still holds.');
