/* ==========================================================
   DASHBOARD — RETURN & RISK MATH

   These numbers are published on a public page, so they follow
   fund-reporting convention rather than whatever is easiest.

   The trap this module exists to avoid: since-inception return is
   NOT value_now / value_start - 1. With regular contributions that
   figure is mostly deposits. Every return here is derived from a
   time-weighted index, which neutralizes the effect of money going
   in and out and measures only how the investments did.
   ========================================================== */
window.DASH = window.DASH || {};

(function () {
  'use strict';

  const DAY = 86400000;
  const TRADING_DAYS = 252;

  const parse = iso => new Date(iso + 'T00:00:00Z').getTime();
  const yearsBetween = (a, b) => (parse(b) - parse(a)) / (365.25 * DAY);

  /* ---------- the time-weighted index ----------
     Chains each period's return with that period's cash flow removed, then
     normalizes to 1.0 at inception. Everything else on the page derives from
     this array — including growth-of-$10,000, which is index x 10,000 and
     never the raw account balance. */
  function twrIndex(history) {
    const out = [];
    let idx = 1;
    for (let i = 0; i < history.length; i++) {
      if (i > 0) {
        const v0 = history[i - 1].value;
        if (v0 > 0) {
          const r = (history[i].value - (history[i].net_flow || 0)) / v0;
          if (isFinite(r) && r > 0) idx *= r;
        }
      }
      out.push({ date: history[i].date, index: idx });
    }
    return out;
  }

  /* Benchmark levels normalized to the same 1.0 base so the two lines are
     directly comparable on one axis. */
  function normalizeLevels(series) {
    if (!series || !series.length) return [];
    const base = series[0].level;
    return series.map(p => ({ date: p.date, index: base ? p.level / base : 1 }));
  }

  /* Re-base an index series so it starts at 1.0 on its first point — needed
     whenever a range selector shows a window that isn't the whole history. */
  function rebase(series) {
    if (!series.length) return [];
    const base = series[0].index || 1;
    return series.map(p => ({ date: p.date, index: p.index / base }));
  }

  function sliceFrom(series, startISO) {
    const t = parse(startISO);
    const i = series.findIndex(p => parse(p.date) >= t);
    return i <= 0 ? series.slice() : series.slice(i - 1);
  }

  function rangeStart(range, lastISO, firstISO) {
    const end = new Date(parse(lastISO));
    const d = new Date(end.getTime());
    switch (range) {
      case '1M': d.setUTCMonth(d.getUTCMonth() - 1); break;
      case '3M': d.setUTCMonth(d.getUTCMonth() - 3); break;
      case '6M': d.setUTCMonth(d.getUTCMonth() - 6); break;
      case 'YTD': return end.getUTCFullYear() + '-01-01';
      case '1Y': d.setUTCFullYear(d.getUTCFullYear() - 1); break;
      case '3Y': d.setUTCFullYear(d.getUTCFullYear() - 3); break;
      default: return firstISO;
    }
    const iso = d.toISOString().slice(0, 10);
    return iso < firstISO ? firstISO : iso;
  }

  function windowReturn(series, startISO) {
    const w = sliceFrom(series, startISO);
    if (w.length < 2) return null;
    const cum = w[w.length - 1].index / w[0].index - 1;
    const yrs = yearsBetween(w[0].date, w[w.length - 1].date);
    /* Fund convention: periods under a year are shown cumulative, a year and
       over are annualized. Mixing the two unlabelled is how "up 300%" happens. */
    return {
      cumulative: cum,
      annualized: yrs >= 1 ? Math.pow(1 + cum, 1 / yrs) - 1 : null,
      display: yrs >= 1 ? Math.pow(1 + cum, 1 / yrs) - 1 : cum,
      annualizedFlag: yrs >= 1,
      years: yrs,
      from: w[0].date,
      to: w[w.length - 1].date
    };
  }

  const PERIODS = ['1M', '3M', '6M', 'YTD', '1Y', '3Y', 'SI'];

  function trailingReturns(series) {
    if (!series || series.length < 2) return {};
    const first = series[0].date;
    const last = series[series.length - 1].date;
    const out = {};
    PERIODS.forEach(p => {
      const start = p === 'SI' ? first : rangeStart(p, last, first);
      // Don't publish a "3Y" number when only 18 months of history exist.
      if (p !== 'SI' && p !== 'YTD' && parse(start) <= parse(first) && yearsBetween(first, last) < requiredYears(p)) {
        out[p] = null;
        return;
      }
      out[p] = windowReturn(series, start);
    });
    return out;
  }

  function requiredYears(p) {
    return { '1M': 1 / 12, '3M': 0.25, '6M': 0.5, '1Y': 1, '3Y': 3 }[p] || 0;
  }

  /* ---------- risk ---------- */

  function dailyReturns(series) {
    const r = [];
    for (let i = 1; i < series.length; i++) {
      const a = series[i - 1].index, b = series[i].index;
      if (a > 0) r.push(b / a - 1);
    }
    return r;
  }

  function stdev(xs) {
    if (xs.length < 2) return 0;
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    const v = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1);
    return Math.sqrt(v);
  }

  function volatility(series) {
    return stdev(dailyReturns(series)) * Math.sqrt(TRADING_DAYS);
  }

  function maxDrawdown(series) {
    let peak = -Infinity, peakDate = null;
    let worst = 0, from = null, to = null;
    series.forEach(p => {
      if (p.index > peak) { peak = p.index; peakDate = p.date; }
      const dd = p.index / peak - 1;
      if (dd < worst) { worst = dd; from = peakDate; to = p.date; }
    });
    return { value: worst, from: from, to: to };
  }

  function annualizedReturn(series) {
    if (series.length < 2) return 0;
    const cum = series[series.length - 1].index / series[0].index;
    const yrs = yearsBetween(series[0].date, series[series.length - 1].date);
    return yrs > 0 ? Math.pow(cum, 1 / yrs) - 1 : 0;
  }

  function sharpe(series, riskFree) {
    const vol = volatility(series);
    if (!vol) return null;
    return (annualizedReturn(series) - (riskFree || 0)) / vol;
  }

  /* Beta needs both series sampled on the same dates — the benchmark and the
     portfolio can have different holidays, and misaligned pairs silently
     produce a meaningless number rather than an error. */
  function align(a, b) {
    const mb = new Map(b.map(p => [p.date, p.index]));
    const xa = [], xb = [];
    a.forEach(p => {
      if (mb.has(p.date)) { xa.push({ date: p.date, index: p.index }); xb.push({ date: p.date, index: mb.get(p.date) }); }
    });
    return [xa, xb];
  }

  function beta(series, benchmark) {
    const [p, b] = align(series, benchmark);
    if (p.length < 30) return null;
    const rp = dailyReturns(p), rb = dailyReturns(b);
    const n = Math.min(rp.length, rb.length);
    if (n < 30) return null;
    const mp = rp.slice(0, n).reduce((x, y) => x + y, 0) / n;
    const mb = rb.slice(0, n).reduce((x, y) => x + y, 0) / n;
    let cov = 0, varb = 0;
    for (let i = 0; i < n; i++) {
      cov += (rp[i] - mp) * (rb[i] - mb);
      varb += (rb[i] - mb) * (rb[i] - mb);
    }
    return varb ? cov / varb : null;
  }

  function monthlyReturns(series) {
    const byMonth = new Map();
    series.forEach(p => byMonth.set(p.date.slice(0, 7), p.index));
    const keys = Array.from(byMonth.keys()).sort();
    const out = [];
    for (let i = 1; i < keys.length; i++) {
      const a = byMonth.get(keys[i - 1]), b = byMonth.get(keys[i]);
      if (a > 0) out.push({ month: keys[i], ret: b / a - 1 });
    }
    return out;
  }

  function bestWorstMonth(series) {
    const m = monthlyReturns(series);
    if (!m.length) return { best: null, worst: null };
    return {
      best: m.reduce((a, b) => (b.ret > a.ret ? b : a)),
      worst: m.reduce((a, b) => (b.ret < a.ret ? b : a))
    };
  }

  function bestWorstDay(series) {
    let best = null, worst = null;
    for (let i = 1; i < series.length; i++) {
      const r = series[i].index / series[i - 1].index - 1;
      if (!best || r > best.ret) best = { date: series[i].date, ret: r };
      if (!worst || r < worst.ret) worst = { date: series[i].date, ret: r };
    }
    return { best: best, worst: worst };
  }

  /* ---------- money-weighted return (XIRR) ----------
     Answers a different question than TWR: what did MY timing earn? Because it
     is sensitive to when contributions landed, it's offered as a toggle rather
     than as the headline. */
  function mwr(history) {
    if (!history || history.length < 2) return null;
    const flows = [];
    const t0 = parse(history[0].date);
    // Opening balance is money put in at t0, whatever its composition.
    if (history[0].value > 0) flows.push({ t: 0, amount: -history[0].value });
    for (let i = 1; i < history.length; i++) {
      const f = history[i].net_flow || 0;
      if (f !== 0) flows.push({ t: (parse(history[i].date) - t0) / (365.25 * DAY), amount: -f });
    }
    const last = history[history.length - 1];
    flows.push({ t: (parse(last.date) - t0) / (365.25 * DAY), amount: last.value });

    const npv = r => flows.reduce((a, f) => a + f.amount / Math.pow(1 + r, f.t), 0);

    // Newton-Raphson, with a bracketing bisection fallback — Newton alone
    // diverges on flow patterns that put the root near -100%.
    let r = 0.1;
    for (let i = 0; i < 60; i++) {
      const v = npv(r);
      const d = (npv(r + 1e-6) - v) / 1e-6;
      if (!isFinite(d) || Math.abs(d) < 1e-12) break;
      const next = r - v / d;
      if (!isFinite(next) || next <= -0.999) break;
      if (Math.abs(next - r) < 1e-10) return next;
      r = next;
    }
    let lo = -0.95, hi = 10;
    if (npv(lo) * npv(hi) > 0) return isFinite(r) && r > -1 ? r : null;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid;
    }
    return (lo + hi) / 2;
  }

  DASH.metrics = {
    PERIODS: PERIODS,
    twrIndex: twrIndex,
    normalizeLevels: normalizeLevels,
    rebase: rebase,
    sliceFrom: sliceFrom,
    rangeStart: rangeStart,
    windowReturn: windowReturn,
    trailingReturns: trailingReturns,
    volatility: volatility,
    maxDrawdown: maxDrawdown,
    annualizedReturn: annualizedReturn,
    sharpe: sharpe,
    beta: beta,
    align: align,
    monthlyReturns: monthlyReturns,
    bestWorstMonth: bestWorstMonth,
    bestWorstDay: bestWorstDay,
    mwr: mwr,
    yearsBetween: yearsBetween
  };
})();
