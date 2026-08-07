/* ==========================================================
   DASHBOARD — DATA LAYER
   Loading, normalization, currency, formatting, and the ETF
   look-through engine that the whole Fact Sheet rests on.

   Classic script + a shared window.DASH namespace, matching the
   site's existing convention (nav.js / ticker.js), so no build
   step and no module loader are involved.
   ========================================================== */
window.DASH = window.DASH || {};

(function () {
  'use strict';

  /* The one place V1 touches its data source. In V2 this points at the
     /portfolio route on the existing market-proxy Cloudflare Worker that
     ticker.js already uses; nothing downstream changes. */
  const SOURCE = '/assets/data/portfolio.json';

  /* Combined look-through weight at which a single underlying gets flagged. */
  const CONCENTRATION_WARN = 0.05;
  const CONCENTRATION_ALERT = 0.10;

  /* Sentinel keys. Portions of an ETF that can't be matched to constituent
     data are surfaced under UNRESOLVED rather than silently dropped — leaving
     them out would understate every weight on the page. */
  const UNRESOLVED = '__unresolved__';
  const CASH = '__cash__';

  async function fetchPortfolio() {
    const res = await fetch(SOURCE, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' loading portfolio data');
    return normalize(await res.json());
  }

  /* ---------- normalization ---------- */

  function assetClass(p) {
    if (p.asset_type === 'Cash') return 'Cash';
    if (p.asset_type === 'Option') return 'Derivatives';
    if (p.asset_type === 'Commodity') return 'Commodities';
    if (p.asset_type === 'ETF' && /bond|fixed income|aggregate/i.test(p.name)) return 'Fixed Income';
    return 'Equity';
  }

  function normalize(raw) {
    const fx = raw.meta.fx || {};
    const usdcad = fx.USDCAD || 1;
    const toCad = (v, ccy) => (ccy === 'USD' ? v * usdcad : v);

    const accountsById = {};
    raw.accounts.forEach(a => { accountsById[a.id] = a; });

    /* accounts[].cash is authoritative for cash; the Holdings table needs it as
       rows, so synthesize them here rather than duplicating them in the JSON
       (two sources would eventually disagree). */
    const cashPositions = raw.accounts
      .filter(a => a.cash > 0)
      .map(a => ({
        symbol: 'CASH', name: a.label + ' cash balance', account_id: a.id,
        asset_type: 'Cash', currency: a.currency,
        quantity: a.cash, avg_cost: 1, price: 1, prev_close: 1,
        market_value: a.cash, open_pnl: 0,
        sector: 'Cash', geography: 'Cash', market_cap_bucket: 'Cash'
      }));

    const positions = raw.positions.concat(cashPositions).map(p => {
      /* Option contracts are quoted per share but represent 100 of them, so
         every value derived from price has to carry the multiplier or a $243
         contract shows up as $2.43. */
      const mult = p.multiplier || 1;
      const dayChange = p.quantity * (p.price - p.prev_close) * mult;
      const prevValue = p.quantity * p.prev_close * mult;
      const cost = p.quantity * p.avg_cost * mult;
      return Object.assign({}, p, {
        account: (accountsById[p.account_id] || {}).label || p.account_id,
        account_type: (accountsById[p.account_id] || {}).type || '',
        asset_class: assetClass(p),
        mv_cad: toCad(p.market_value, p.currency),
        cost_cad: toCad(cost, p.currency),
        pnl_cad: toCad(p.open_pnl, p.currency),
        pnl_pct: cost ? p.open_pnl / cost : 0,
        day_change_cad: toCad(dayChange, p.currency),
        day_pct: prevValue ? dayChange / prevValue : 0
      });
    });

    const total = positions.reduce((a, p) => a + p.mv_cad, 0);
    positions.forEach(p => { p.weight = total ? p.mv_cad / total : 0; });

    return Object.assign({}, raw, {
      usdcad,
      accountsById,
      positions,
      totalValue: total,
      dayChange: positions.reduce((a, p) => a + p.day_change_cad, 0),
      unrealized: positions.reduce((a, p) => a + p.pnl_cad, 0),
      totalCost: positions.reduce((a, p) => a + p.cost_cad, 0),
      totalCash: positions.filter(p => p.asset_type === 'Cash').reduce((a, p) => a + p.mv_cad, 0)
    });
  }

  /* Scope every tab to the global account filter. */
  function scope(data, accountId) {
    if (!accountId || accountId === 'all') return data.positions;
    return data.positions.filter(p => p.account_id === accountId);
  }

  /* ---------- the look-through engine ----------
     Turns "6 ETFs and 5 stocks" into "here is every company you actually own
     and how much of it came from where". This is the reason the page exists. */
  function buildLookThrough(positions, etfs, opts) {
    const options = opts || {};
    const excluded = options.excludedEtfs || new Set();
    const map = new Map();

    function bucket(key, meta) {
      let e = map.get(key);
      if (!e) {
        e = {
          key: key,
          ticker: meta.ticker, name: meta.name, value: 0, weight: 0,
          sector: meta.sector || 'Unclassified',
          geography: meta.geography || 'Unclassified',
          market_cap_bucket: meta.market_cap_bucket || 'Unclassified',
          currency: meta.currency || 'CAD',
          sources: []
        };
        map.set(key, e);
      }
      return e;
    }

    positions.forEach(p => {
      const mv = p.mv_cad;
      if (!mv) return;

      if (p.asset_type === 'Cash') {
        const e = bucket(CASH, { ticker: 'Cash', name: 'Cash & equivalents', sector: 'Cash', geography: 'Cash', market_cap_bucket: 'Cash', currency: p.currency });
        e.value += mv;
        e.sources.push({ etf: null, label: p.account, weightInEtf: 1, value: mv });
        return;
      }

      if (p.asset_type === 'ETF') {
        if (excluded.has(p.symbol)) return;
        const spec = etfs[p.symbol];
        if (!spec) {
          // No constituent data at all — the whole holding is unresolved.
          const u = bucket(UNRESOLVED, { ticker: 'Unresolved', name: 'Not matched to constituent data', sector: 'Unresolved', geography: 'Unresolved', market_cap_bucket: 'Unresolved' });
          u.value += mv;
          u.sources.push({ etf: p.symbol, label: p.symbol + ' (no holdings data)', weightInEtf: 1, value: mv });
          return;
        }
        let covered = 0;
        spec.holdings.forEach(h => {
          const v = mv * h.weight;
          covered += h.weight;
          const e = bucket(h.ticker, h);
          e.value += v;
          e.sources.push({ etf: p.symbol, label: p.symbol, weightInEtf: h.weight, value: v });
        });
        const gap = 1 - covered;
        if (gap > 0.0005) {
          const u = bucket(UNRESOLVED, { ticker: 'Unresolved', name: 'Not matched to constituent data', sector: 'Unresolved', geography: 'Unresolved', market_cap_bucket: 'Unresolved' });
          u.value += mv * gap;
          u.sources.push({ etf: p.symbol, label: p.symbol + ' remainder', weightInEtf: gap, value: mv * gap });
        }
        return;
      }

      /* A directly held stock is its own constituent at 100%. That's what lets
         combined Apple = shares held outright + Apple inside every ETF.
         Positions carry `symbol`, not `ticker`, so map it across explicitly.

         canonical_ticker folds cross-listings of one company onto a single key
         (BEPC on the NYSE and BEPC.TO on the TSX are the same business). Without
         it a concentration split across two exchanges reads as two smaller
         positions and never trips a threshold. */
      const key = p.canonical_ticker || p.symbol;
      const e = bucket(key, {
        ticker: key, name: p.name, sector: p.sector,
        geography: p.geography, market_cap_bucket: p.market_cap_bucket, currency: p.currency
      });
      e.value += mv;
      e.sources.push({ etf: null, label: 'Held directly', weightInEtf: 1, value: mv });
    });

    const rows = Array.from(map.values());
    const total = rows.reduce((a, r) => a + r.value, 0);
    rows.forEach(r => {
      r.weight = total ? r.value / total : 0;
      /* One fund held in two accounts is still one fund. Merge the sources by
         symbol before counting, or "# of ETFs" silently double-counts. */
      r.sources = mergeSources(r.sources);
      r.etfCount = r.sources.filter(s => s.etf).length;
      r.direct = r.sources.some(s => !s.etf && s.label === 'Held directly');
      r.flag = r.key === UNRESOLVED || r.key === CASH ? null
        : r.weight >= CONCENTRATION_ALERT ? 'alert'
          : r.weight >= CONCENTRATION_WARN ? 'warn' : null;
      r.sources.sort((a, b) => b.value - a.value);
    });
    rows.sort((a, b) => b.value - a.value);
    return { rows: rows, total: total, byKey: map };
  }

  /* Collapse repeated contributions from the same source into one row, so the
     Fact Sheet breakdown lists each fund once with its combined contribution. */
  function mergeSources(sources) {
    const acc = new Map();
    sources.forEach(s => {
      const k = s.etf || ('~' + s.label);
      const e = acc.get(k);
      if (e) e.value += s.value;
      else acc.set(k, { etf: s.etf, label: s.label, weightInEtf: s.weightInEtf, value: s.value });
    });
    return Array.from(acc.values());
  }

  /* Roll the look-through map up along one dimension. Every grouping on the
     page comes through here, so the Overview sector donut and the Fact Sheet
     sector donut are physically incapable of disagreeing. */
  function rollup(rows, field) {
    const acc = new Map();
    rows.forEach(r => {
      const k = r[field] || 'Unclassified';
      acc.set(k, (acc.get(k) || 0) + r.value);
    });
    const total = rows.reduce((a, r) => a + r.value, 0);
    return Array.from(acc.entries())
      .map(([label, value]) => ({ key: label, label: label, value: value, weight: total ? value / total : 0 }))
      .sort((a, b) => b.value - a.value);
  }

  /* Same shape, but grouped straight off raw positions (Overview's Holdings /
     Asset Class / Account groupings don't want look-through). */
  function rollupPositions(positions, field) {
    const acc = new Map();
    positions.forEach(p => {
      const k = p[field] || 'Unclassified';
      acc.set(k, (acc.get(k) || 0) + p.mv_cad);
    });
    const total = positions.reduce((a, p) => a + p.mv_cad, 0);
    return Array.from(acc.entries())
      .map(([label, value]) => ({ key: label, label: label, value: value, weight: total ? value / total : 0 }))
      .sort((a, b) => b.value - a.value);
  }

  /* Charts get at most 8 hues; everything past that folds into one grey
     "Other" slice rather than inventing a 9th colour nobody can distinguish. */
  function topN(slices, n) {
    if (slices.length <= n) return slices.slice();
    const head = slices.slice(0, n - 1);
    const tail = slices.slice(n - 1);
    const value = tail.reduce((a, s) => a + s.value, 0);
    const weight = tail.reduce((a, s) => a + s.weight, 0);
    head.push({ key: '__other__', label: 'Other (' + tail.length + ')', value: value, weight: weight, isOther: true, members: tail });
    return head;
  }

  DASH.data = {
    SOURCE: SOURCE,
    UNRESOLVED: UNRESOLVED,
    CASH: CASH,
    CONCENTRATION_WARN: CONCENTRATION_WARN,
    CONCENTRATION_ALERT: CONCENTRATION_ALERT,
    fetchPortfolio: fetchPortfolio,
    normalize: normalize,
    scope: scope,
    buildLookThrough: buildLookThrough,
    rollup: rollup,
    rollupPositions: rollupPositions,
    topN: topN
  };
})();

/* ==========================================================
   FORMATTING
   ========================================================== */
(function () {
  'use strict';

  const cache = {};
  function nf(ccy, min, max) {
    const k = ccy + min + max;
    if (!cache[k]) {
      cache[k] = new Intl.NumberFormat('en-CA', {
        style: 'currency', currency: ccy,
        minimumFractionDigits: min, maximumFractionDigits: max
      });
    }
    return cache[k];
  }

  /* Everything is held in CAD internally; the global toggle converts at
     display time only, so no rounding compounds through the aggregations. */
  function convert(cad, ctx) {
    return ctx && ctx.currency === 'USD' ? cad / ctx.usdcad : cad;
  }

  function money(cad, ctx, digits) {
    const ccy = ctx && ctx.currency === 'USD' ? 'USD' : 'CAD';
    const d = digits === undefined ? 2 : digits;
    return nf(ccy, d, d).format(convert(cad, ctx));
  }

  function moneyCompact(cad, ctx) {
    const ccy = ctx && ctx.currency === 'USD' ? 'USD' : 'CAD';
    const v = convert(cad, ctx);
    return new Intl.NumberFormat('en-CA', {
      style: 'currency', currency: ccy, notation: 'compact', maximumFractionDigits: 1
    }).format(v);
  }

  function pct(v, digits) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return (v * 100).toFixed(digits === undefined ? 2 : digits) + '%';
  }

  function signedPct(v, digits) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return (v >= 0 ? '+' : '') + (v * 100).toFixed(digits === undefined ? 2 : digits) + '%';
  }

  function num(v, digits) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return new Intl.NumberFormat('en-CA', {
      minimumFractionDigits: digits === undefined ? 0 : digits,
      maximumFractionDigits: digits === undefined ? 0 : digits
    }).format(v);
  }

  function cls(v) { return v > 0 ? 'up' : v < 0 ? 'down' : 'flat'; }
  function arrow(v) { return v > 0 ? '▲' : v < 0 ? '▼' : '■'; }

  /* Direction is carried by the glyph as well as the colour — the colour alone
     would be invisible to a red/green colour-blind reader. */
  function delta(cad, ctx, pctVal) {
    const sign = cad > 0 ? '+' : cad < 0 ? '−' : '';
    const body = sign + money(Math.abs(cad), ctx) +
      (pctVal === undefined || pctVal === null ? '' : ' (' + signedPct(pctVal) + ')');
    return '<span class="' + cls(cad) + '">' + arrow(cad) + ' ' + body + '</span>';
  }

  function deltaPct(v) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return '<span class="' + cls(v) + '">' + arrow(v) + ' ' + signedPct(v) + '</span>';
  }

  function date(iso) {
    if (!iso) return '—';
    return new Date(iso + (iso.length === 10 ? 'T12:00:00Z' : '')).toLocaleDateString('en-CA', {
      year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC'
    });
  }

  function dateShort(iso) {
    if (!iso) return '—';
    return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-CA', {
      month: 'short', year: '2-digit', timeZone: 'UTC'
    });
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  DASH.fmt = {
    convert: convert, money: money, moneyCompact: moneyCompact,
    pct: pct, signedPct: signedPct, num: num,
    cls: cls, arrow: arrow, delta: delta, deltaPct: deltaPct,
    date: date, dateShort: dateShort, esc: esc
  };
})();
