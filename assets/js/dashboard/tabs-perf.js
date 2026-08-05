/* ==========================================================
   DASHBOARD — PERFORMANCE & INCOME TABS
   ========================================================== */
window.DASH = window.DASH || {};
DASH.tabs = DASH.tabs || {};

(function () {
  'use strict';

  const fmt = DASH.fmt;
  const charts = DASH.charts;
  const M = DASH.metrics;
  const T = DASH.table;

  function stackedTile(label, value, sub) {
    return '<div class="is-stacked"><span class="label">' + fmt.esc(label) + '</span>' +
      '<span class="time">' + value + '</span>' +
      (sub ? '<span class="sub">' + sub + '</span>' : '') + '</div>';
  }

  function buildOnce(el, html) {
    if (el.dataset.built === '1') return false;
    el.innerHTML = html;
    el.dataset.built = '1';
    return true;
  }

  function toggleButtons(attr, options, current) {
    return options.map(o =>
      '<button type="button" class="btn btn--sm ' + (o.key === current ? 'btn--primary' : 'btn--outline') +
      '" data-' + attr + '="' + o.key + '">' + fmt.esc(o.label) + '</button>').join('');
  }

  /* =====================================================================
     5. PERFORMANCE
     ===================================================================== */
  const RANGES = [
    { key: '1M', label: '1M' }, { key: '3M', label: '3M' }, { key: '6M', label: '6M' },
    { key: 'YTD', label: 'YTD' }, { key: '1Y', label: '1Y' }, { key: 'All', label: 'All' }
  ];

  DASH.tabs.performance = {
    id: 'performance',
    label: 'Performance',
    render: function (el, ctx) {
      const s = ctx.state;
      const data = ctx.data;
      const benchLabel = data.profile.benchmark_label || 'S&P 500';

      if (buildOnce(el, '' +
        '<div class="dash-stack"><div class="project-card">' +
        '<div class="dash-head"><h2>Portfolio value over time</h2>' +
        '<div class="dash-badge-row" id="pe-ranges"></div></div>' +
        '<div class="dash-bar">' +
        '<div class="dash-badge-row" id="pe-mode"></div>' +
        '<label style="display:flex;align-items:center;gap:8px;font-size:var(--font-size-sm);cursor:pointer">' +
        '<input type="checkbox" id="pe-bench" style="accent-color:var(--color-primary)"> Overlay ' + fmt.esc(benchLabel) + '</label>' +
        '<span class="dash-bar__spacer"></span>' +
        '<label class="sr-only" for="pe-scope">Account scope</label>' +
        '<select class="form-control" id="pe-scope" aria-label="Account scope"></select>' +
        '</div>' +
        '<div id="pe-scope-note"></div>' +
        '<div class="dash-chart" id="pe-chart"></div>' +
        '<ul class="dash-legend" id="pe-legend"></ul>' +
        '</div>' +
        '<div class="splits" id="pe-stats"></div>' +
        '<div class="callout" id="pe-note"></div></div>')) {

        el.querySelector('#pe-ranges').addEventListener('click', ev => {
          const b = ev.target.closest('[data-range]');
          if (b) { s.range = b.dataset.range; ctx.rerender(); }
        });
        el.querySelector('#pe-mode').addEventListener('click', ev => {
          const b = ev.target.closest('[data-mode]');
          if (b) { s.returnMode = b.dataset.mode; ctx.rerender(); }
        });
        el.querySelector('#pe-bench').addEventListener('change', e => {
          s.showBenchmark = e.target.checked; ctx.rerender();
        });
        el.querySelector('#pe-scope').innerHTML =
          '<option value="all">All Accounts</option>' +
          data.accounts.map(a => '<option value="' + fmt.esc(a.id) + '">' + fmt.esc(a.label) + '</option>').join('');
        el.querySelector('#pe-scope').addEventListener('change', e => {
          s.accountId = e.target.value;      // kept consistent with the global filter
          ctx.syncGlobals();
          ctx.rerender();
        });
      }

      el.querySelector('#pe-ranges').innerHTML = toggleButtons('range', RANGES, s.range);
      el.querySelector('#pe-mode').innerHTML =
        '<span class="status-badge">Return basis</span>' +
        toggleButtons('mode', [{ key: 'twr', label: 'Time-weighted' }, { key: 'mwr', label: 'Money-weighted' }], s.returnMode);
      el.querySelector('#pe-bench').checked = !!s.showBenchmark;
      el.querySelector('#pe-scope').value = s.accountId;

      /* Per-account history isn't in the data contract yet, so say so rather
         than silently showing portfolio-level numbers under an account label. */
      el.querySelector('#pe-scope-note').innerHTML = s.accountId === 'all' ? '' :
        '<p class="status status--info" style="display:block;margin-bottom:var(--space-12)">' +
        '<i class="fas fa-circle-info" aria-hidden="true"></i> ' +
        'Holdings and allocation below are filtered to <strong>' + fmt.esc(ctx.scopeLabel) + '</strong>, but this ' +
        'chart shows the whole portfolio — per-account history isn\'t part of the data feed yet.</p>';

      const full = ctx.twr;
      if (full.length < 2) {
        const since = data.history.portfolio.length ? fmt.date(data.history.portfolio[0].date) : '—';
        el.querySelector('#pe-chart').innerHTML =
          '<div class="dash-empty" style="text-align:left">' +
          '<strong><i class="fas fa-hourglass-start" aria-hidden="true"></i> ' +
          'Performance history is still accruing.</strong><br>' +
          'Daily values started being recorded on ' + since + '. The brokerage feed exposes no ' +
          'account-value history, and its transaction records carry no share quantities, so an ' +
          'earlier equity curve can\'t be reconstructed — this chart fills in from that date forward ' +
          'rather than showing an estimate.</div>';
        el.querySelector('#pe-legend').innerHTML = '';
        el.querySelector('#pe-stats').innerHTML = '';
        el.querySelector('#pe-note').innerHTML =
          '<strong>Why this is blank rather than estimated.</strong> Marking today\'s holdings ' +
          'backwards against historical prices would produce a curve, but not <em>your</em> curve — ' +
          'it would ignore every position bought and sold along the way. A wrong performance number ' +
          'is worse than a missing one, so it stays empty until real snapshots exist.';
        return;
      }
      const first = full[0].date, last = full[full.length - 1].date;
      const start = s.range === 'All' ? first : M.rangeStart(s.range, last, first);
      const win = M.rebase(M.sliceFrom(full, start));
      const bwin = M.rebase(M.sliceFrom(ctx.benchmark, start));

      /* The chart plots value; the index is rebased to the window so the
         range buttons answer "how did it do over this period", not "what was
         the balance". Value is reconstructed from the window's opening value. */
      const histFrom = data.history.portfolio.find(h => h.date >= win[0].date) || data.history.portfolio[0];
      const openValue = histFrom.value;
      const c1 = charts.cssVar('--series-1', '#2a78d6');
      const c2 = charts.cssVar('--series-2', '#eb6834');

      const series = [{
        label: 'Portfolio', color: c1,
        points: win.map(x => ({ date: x.date, value: x.index * openValue }))
      }];
      if (s.showBenchmark && bwin.length > 1) {
        series.push({
          label: benchLabel, color: c2, dashed: true,
          points: bwin.map(x => ({ date: x.date, value: x.index * openValue }))
        });
      }

      charts.line(el.querySelector('#pe-chart'), series, {
        title: 'Portfolio value', height: 340,
        yFormat: v => fmt.moneyCompact(v, ctx.fmtCtx),
        tipFormat: v => fmt.money(v, ctx.fmtCtx, 0)
      });
      charts.legend(el.querySelector('#pe-legend'), series.map(x => ({
        key: x.label, label: x.label, color: x.color, value: x.points[x.points.length - 1].value
      })), { valueFormat: v => fmt.money(v, ctx.fmtCtx, 0) });
      el.querySelectorAll('#pe-legend button').forEach(b => { b.disabled = true; b.style.cursor = 'default'; });

      const ret = M.windowReturn(full, start);
      const bret = M.windowReturn(ctx.benchmark, start);
      const bwDay = M.bestWorstDay(win);
      const mwrAll = M.mwr(data.history.portfolio);
      const usingMwr = s.returnMode === 'mwr';

      el.querySelector('#pe-stats').innerHTML =
        stackedTile(usingMwr ? 'Money-weighted return' : 'Total return',
          usingMwr
            ? (mwrAll === null ? '—' : '<span class="' + fmt.cls(mwrAll) + '">' + fmt.signedPct(mwrAll) + '</span>')
            : (ret ? '<span class="' + fmt.cls(ret.cumulative) + '">' + fmt.signedPct(ret.cumulative) + '</span>' : '—'),
          usingMwr ? 'annualized, whole history' : (s.range === 'All' ? 'since inception' : 'over ' + s.range)) +
        stackedTile('Annualized', ret && ret.annualized !== null ? fmt.signedPct(ret.annualized) : '—',
          ret && ret.annualized === null ? 'period under one year' : 'time-weighted') +
        stackedTile('Best day', bwDay.best ? '<span class="up">' + fmt.signedPct(bwDay.best.ret) + '</span>' : '—',
          bwDay.best ? fmt.date(bwDay.best.date) : '') +
        stackedTile('Worst day', bwDay.worst ? '<span class="down">' + fmt.signedPct(bwDay.worst.ret) + '</span>' : '—',
          bwDay.worst ? fmt.date(bwDay.worst.date) : '') +
        stackedTile('vs ' + benchLabel,
          (ret && bret) ? '<span class="' + fmt.cls(ret.cumulative - bret.cumulative) + '">' +
            ((ret.cumulative - bret.cumulative) * 100 >= 0 ? '+' : '') + ((ret.cumulative - bret.cumulative) * 100).toFixed(2) + ' pts</span>' : '—',
          bret ? benchLabel + ' ' + fmt.signedPct(bret.cumulative) : '');

      el.querySelector('#pe-note').innerHTML = usingMwr
        ? '<strong>Money-weighted return (IRR).</strong> This answers “what did my money earn, given when ' +
        'I put it in?” It is sensitive to the timing and size of contributions, so it measures the ' +
        'combination of the investments and the decisions about when to buy. It is quoted annualized over ' +
        'the whole history rather than per range.'
        : '<strong>Time-weighted return.</strong> Deposits and withdrawals are removed from each period ' +
        'before the periods are chained, so this measures the investments alone. It is the basis funds ' +
        'report on, and the basis used everywhere else on this page. Switch to money-weighted to see the ' +
        'effect of contribution timing.';
    }
  };

  /* =====================================================================
     6. INCOME
     ===================================================================== */
  DASH.tabs.income = {
    id: 'income',
    label: 'Income',
    render: function (el, ctx) {
      const s = ctx.state;
      const data = ctx.data;

      if (buildOnce(el, '' +
        '<div class="dash-stack">' +
        '<div class="splits" id="in-tiles"></div>' +
        '<div class="project-card">' +
        '<div class="dash-head"><h2>Income by month</h2>' +
        '<div class="dash-badge-row" id="in-view"></div></div>' +
        '<div class="dash-chart" id="in-chart"></div>' +
        '<p class="dash-stamp" id="in-chart-note" style="margin-top:var(--space-12)"></p>' +
        '</div>' +
        '<div class="dash-cols" style="grid-template-columns:1fr 1fr">' +
        '<div id="in-yield"></div>' +
        '<div class="project-card"><div class="dash-head"><h2>Upcoming</h2>' +
        '<p>Next ex-dividend and pay dates</p></div><div id="in-upcoming"></div></div>' +
        '</div>' +
        '<div class="project-card"><div class="dash-bar">' +
        '<select class="form-control" id="in-range" aria-label="Filter by date range">' +
        '<option value="12">Last 12 months</option><option value="24">Last 24 months</option>' +
        '<option value="ytd">Year to date</option><option value="all">All history</option></select>' +
        '<span class="dash-bar__spacer"></span></div>' +
        '<div id="in-table"></div></div>' +
        '</div>')) {
        el.querySelector('#in-view').addEventListener('click', ev => {
          const b = ev.target.closest('[data-view]');
          if (b) { s.incomeView = b.dataset.view; ctx.rerender(); }
        });
        el.querySelector('#in-range').addEventListener('change', e => {
          s.filters.incomeRange = e.target.value; ctx.rerender();
        });
      }

      el.querySelector('#in-view').innerHTML =
        toggleButtons('view', [{ key: 'received', label: 'Received' }, { key: 'projected', label: 'Projected' }], s.incomeView || 'received');
      el.querySelector('#in-range').value = s.filters.incomeRange || '12';

      const scopeIds = s.accountId === 'all' ? null : new Set([s.accountId]);
      const divs = data.activities.filter(a => a.type === 'Dividend' && (!scopeIds || scopeIds.has(a.account_id)));
      const asOf = new Date(data.meta.as_of + 'T00:00:00Z');

      function toCad(a) { return a.currency === 'USD' ? a.amount * data.usdcad : a.amount; }

      const ttmCut = new Date(asOf.getTime()); ttmCut.setUTCFullYear(ttmCut.getUTCFullYear() - 1);
      const ttmISO = ttmCut.toISOString().slice(0, 10);
      const ttm = divs.filter(a => a.date >= ttmISO).reduce((x, a) => x + toCad(a), 0);

      /* Forward projection: shares held now x the known annual rate. */
      const byPos = {};
      ctx.positions.forEach(p => { (byPos[p.symbol] = byPos[p.symbol] || []).push(p); });
      const projRows = data.dividends_projected
        .filter(d => byPos[d.symbol])
        .map(d => {
          const held = byPos[d.symbol];
          const qty = held.reduce((a, p) => a + p.quantity, 0);
          const ccy = held[0].currency;
          const annual = qty * d.annual_rate_per_share;
          const annualCad = ccy === 'USD' ? annual * data.usdcad : annual;
          const cost = held.reduce((a, p) => a + p.cost_cad, 0);
          const value = held.reduce((a, p) => a + p.mv_cad, 0);
          return {
            symbol: d.symbol, name: held[0].name, frequency: d.frequency,
            qty: qty, rate: d.annual_rate_per_share,
            annual: annualCad, cost: cost, value: value,
            yieldOnCost: cost ? annualCad / cost : 0,
            currentYield: value ? annualCad / value : 0,
            next_ex_date: d.next_ex_date, next_pay_date: d.next_pay_date
          };
        });
      const forward = projRows.reduce((a, r) => a + r.annual, 0);
      const portValue = ctx.positions.reduce((a, p) => a + p.mv_cad, 0);

      el.querySelector('#in-tiles').innerHTML =
        stackedTile('Trailing 12-month income', fmt.money(ttm, ctx.fmtCtx), ctx.scopeLabel) +
        stackedTile('Projected forward annual', fmt.money(forward, ctx.fmtCtx), 'at current holdings and rates') +
        stackedTile('Blended yield', fmt.pct(portValue ? forward / portValue : 0, 2), 'projected income ÷ market value') +
        stackedTile('Average per month', fmt.money(forward / 12, ctx.fmtCtx), 'projected');

      /* monthly chart */
      const months = new Map();
      divs.forEach(a => {
        const k = a.date.slice(0, 7);
        months.set(k, (months.get(k) || 0) + toCad(a));
      });
      const keys = Array.from(months.keys()).sort().slice(-24);
      const projMonthly = forward / 12;
      const showProjected = (s.incomeView || 'received') === 'projected';
      const rows = keys.map(k => ({
        label: k, short: k.slice(2).replace('-', '/'),
        value: showProjected ? projMonthly : months.get(k),
        overlay: showProjected ? months.get(k) : projMonthly
      }));
      charts.columns(el.querySelector('#in-chart'), rows, {
        ctx: ctx.fmtCtx, height: 230,
        yFormat: v => fmt.moneyCompact(v, ctx.fmtCtx)
      });
      el.querySelector('#in-chart-note').textContent = showProjected
        ? 'Bars show the projected monthly run-rate; the line marks what was actually received that month.'
        : 'Bars show income actually received; the line marks the projected monthly run-rate at current holdings.';

      /* yield on cost */
      T.render(el.querySelector('#in-yield'), {
        title: 'YIELD BY HOLDING',
        columns: [
          { key: 'symbol', label: 'Symbol', cls: 'sym', format: r => fmt.esc(r.symbol) },
          { key: 'annual', label: 'Annual', num: true, format: r => fmt.money(r.annual, ctx.fmtCtx, 0) },
          { key: 'yieldOnCost', label: 'Yield on cost', num: true, format: r => fmt.pct(r.yieldOnCost, 2) },
          { key: 'currentYield', label: 'Current yield', num: true, format: r => fmt.pct(r.currentYield, 2) }
        ],
        rows: projRows,
        sort: s.sort.income,
        onSort: () => ctx.rerender(),
        rowKey: r => r.symbol,
        emptyText: 'No income-paying positions in this scope.',
        totals: rs => ({
          symbol: '<strong>Total</strong>',
          annual: fmt.money(rs.reduce((a, r) => a + r.annual, 0), ctx.fmtCtx, 0)
        })
      });

      /* upcoming */
      const upcoming = projRows.slice().sort((a, b) => String(a.next_ex_date).localeCompare(String(b.next_ex_date)));
      el.querySelector('#in-upcoming').innerHTML = upcoming.length
        ? '<ul class="dash-legend">' + upcoming.map(r =>
          '<li><button type="button" disabled style="cursor:default">' +
          '<span class="dash-swatch" style="background:var(--color-primary)"></span>' +
          '<span class="lbl"><strong>' + fmt.esc(r.symbol) + '</strong> · ' + fmt.esc(r.frequency) + '</span>' +
          '<span class="val">ex ' + fmt.date(r.next_ex_date) + ' · pay ' + fmt.date(r.next_pay_date) + '</span>' +
          '</button></li>').join('') + '</ul>'
        : '<div class="dash-empty">Nothing scheduled.</div>';

      /* history table */
      const range = s.filters.incomeRange || '12';
      let cut = null;
      if (range === 'ytd') cut = data.meta.as_of.slice(0, 4) + '-01-01';
      else if (range !== 'all') {
        const d = new Date(asOf.getTime());
        d.setUTCMonth(d.getUTCMonth() - parseInt(range, 10));
        cut = d.toISOString().slice(0, 10);
      }
      const histRows = divs.filter(a => !cut || a.date >= cut);

      T.render(el.querySelector('#in-table'), {
        title: 'DISTRIBUTIONS RECEIVED — ' + histRows.length,
        columns: [
          { key: 'date', label: 'Date', format: r => fmt.date(r.date) },
          { key: 'symbol', label: 'Symbol', cls: 'sym', format: r => fmt.esc(r.symbol) },
          { key: 'account_id', label: 'Account', format: r => '<span class="pill">' + fmt.esc((data.accountsById[r.account_id] || {}).label || r.account_id) + '</span>' },
          { key: 'amount', label: 'Amount', num: true, sortValue: r => toCad(r), format: r => fmt.money(toCad(r), ctx.fmtCtx) },
          { key: 'currency', label: 'Ccy', format: r => fmt.esc(r.currency) }
        ],
        rows: histRows,
        sort: s.sort.incomeHistory,
        onSort: () => ctx.rerender(),
        rowKey: r => r.date + r.symbol + r.account_id,
        emptyText: 'No distributions in this range.',
        totals: rs => ({
          date: '<strong>Total</strong>',
          amount: fmt.money(rs.reduce((a, r) => a + toCad(r), 0), ctx.fmtCtx)
        })
      });
    }
  };
})();
