/* ==========================================================
   DASHBOARD — CORE TABS
   Fund Profile · Overview · Holdings · Fact Sheet

   Each tab exposes { id, label, render(el, ctx) }. Tabs build their
   shell once (so typing in a search box doesn't destroy the input
   under the cursor) and repaint only the data regions afterwards.
   ========================================================== */
window.DASH = window.DASH || {};
DASH.tabs = DASH.tabs || {};

(function () {
  'use strict';

  const fmt = DASH.fmt;
  const charts = DASH.charts;
  const D = DASH.data;
  const M = DASH.metrics;
  const T = DASH.table;

  /* Shared helpers ------------------------------------------------------- */

  /* Questrade exposes no account-value history, and its activity records carry
     no share quantities, so the equity curve can't be back-filled — it accrues
     forward from the first snapshot. Until there are two points, everything
     derived from it says so instead of showing a number. */
  function historyNotice(idx, data, what) {
    const since = data.history.portfolio.length
      ? fmt.date(data.history.portfolio[0].date) : '—';
    return '<div class="dash-empty" style="text-align:left">' +
      '<strong><i class="fas fa-hourglass-start" aria-hidden="true"></i> ' +
      fmt.esc(what) + ' needs more history.</strong><br>' +
      'Daily portfolio values started being recorded on ' + since + ', and ' +
      (idx.length < 2 ? 'only one snapshot exists so far' : 'there are only ' + idx.length + ' so far') + '. ' +
      'The brokerage feed has no account-value history to back-fill from, so this fills in as ' +
      'snapshots accumulate rather than being estimated.' +
      '</div>';
  }

  function tile(label, value, sub, cls) {
    return '<div class="' + (cls || '') + '">' +
      '<span class="label">' + fmt.esc(label) + '</span>' +
      '<span class="time">' + value + '</span>' +
      (sub ? '<span class="sub">' + sub + '</span>' : '') + '</div>';
  }

  function stackedTile(label, value, sub) {
    return tile(label, value, sub, 'is-stacked');
  }

  function buildOnce(el, html) {
    if (el.dataset.built === '1') return false;
    el.innerHTML = html;
    el.dataset.built = '1';
    return true;
  }

  /* An ETF has no single sector, but "—" makes the Holdings sector filter
     useless. Show the dominant look-through sector instead, which is the
     honest summary of what the fund actually is. */
  const sectorCache = {};
  function dominantSector(symbol, etfs) {
    if (sectorCache[symbol] !== undefined) return sectorCache[symbol];
    const spec = etfs[symbol];
    if (!spec) return (sectorCache[symbol] = null);
    const acc = {};
    spec.holdings.forEach(h => { acc[h.sector] = (acc[h.sector] || 0) + h.weight; });
    let best = null, bw = 0;
    for (const k in acc) if (acc[k] > bw) { bw = acc[k]; best = k; }
    return (sectorCache[symbol] = best);
  }

  function positionSector(p, data) {
    if (p.asset_type === 'ETF') return dominantSector(p.symbol, data.etfs) || 'Unclassified';
    return p.sector || 'Unclassified';
  }

  function freshnessTag(spec) {
    const days = (Date.now() - new Date(spec.as_of + 'T00:00:00Z').getTime()) / 86400000;
    const stale = days > 45;
    return '<span class="' + (stale ? 'status status--warning' : 'pill') + '" title="' +
      (stale ? 'Holdings data is ' + Math.round(days) + ' days old' : 'Holdings as at ' + fmt.date(spec.as_of)) +
      '" style="font-size:var(--font-size-xs)">' +
      (stale ? '<i class="fas fa-triangle-exclamation" aria-hidden="true"></i>&nbsp;' : '') +
      fmt.date(spec.as_of) + '</span>';
  }

  /* Icon + word, never colour alone — and no repeat of the percentage, which
     is already in the cell this badge sits next to. */
  function concentrationBadge(row) {
    if (!row.flag) return '';
    const alert = row.flag === 'alert';
    return ' <span class="status status--' + (alert ? 'error' : 'warning') + '" title="' +
      'Combined weight ' + fmt.pct(row.weight, 2) + ' is above the ' +
      (alert ? fmt.pct(D.CONCENTRATION_ALERT, 0) + ' alert' : fmt.pct(D.CONCENTRATION_WARN, 0) + ' warning') +
      ' threshold once every fund is looked through." style="font-size:var(--font-size-xs);padding:2px 8px">' +
      '<i class="fas fa-' + (alert ? 'circle-exclamation' : 'triangle-exclamation') + '" aria-hidden="true"></i>&nbsp;' +
      (alert ? 'concentrated' : 'elevated') + '</span>';
  }

  function groupToggle(name, options, current) {
    return options.map(o =>
      '<button type="button" class="btn btn--sm ' + (o.key === current ? 'btn--primary' : 'btn--outline') +
      '" data-' + name + '="' + o.key + '">' + fmt.esc(o.label) + '</button>').join('');
  }

  /* =====================================================================
     1. FUND PROFILE — the public fact sheet
     ===================================================================== */
  DASH.tabs.profile = {
    id: 'profile',
    label: 'Fund Profile',
    render: function (el, ctx) {
      const data = ctx.data;
      const idx = ctx.twr;
      const bench = ctx.benchmark;
      const hasHistory = idx.length >= 2;
      const tr = M.trailingReturns(idx);
      const btr = M.trailingReturns(bench);
      const si = tr.SI;
      const rf = data.meta.risk_free_rate;
      const dd = M.maxDrawdown(idx);
      const bw = M.bestWorstMonth(idx);
      const benchLabel = data.profile.benchmark_label || 'S&P 500';

      buildOnce(el, '' +
        '<div class="dash-stack">' +
        '<div class="splits" id="pf-hero"></div>' +
        '<div class="splits" id="pf-strip"></div>' +
        '<div class="project-card">' +
        '<div class="dash-head"><h2>Growth of $10,000</h2>' +
        '<p>Since inception, versus ' + fmt.esc(benchLabel) + '</p></div>' +
        '<div class="dash-chart" id="pf-growth"></div>' +
        '<ul class="dash-legend" id="pf-growth-legend"></ul>' +
        '</div>' +
        '<div id="pf-returns"></div>' +
        '<div class="project-card"><div class="dash-head"><h2>Risk</h2>' +
        '<p>Daily data since inception</p></div><div class="splits" id="pf-risk"></div></div>' +
        '<div class="callout" id="pf-note"></div>' +
        '</div>');

      /* hero */
      const contributed = data.history.portfolio.reduce((a, h) => a + h.net_flow, 0);
      el.querySelector('#pf-hero').innerHTML =
        tile('Total portfolio value', fmt.money(data.totalValue, ctx.fmtCtx), 'as at ' + fmt.date(data.meta.as_of), 'is-hero') +
        stackedTile('Since inception', si ? '<span class="' + fmt.cls(si.cumulative) + '">' + fmt.signedPct(si.cumulative) + '</span>' : '—',
          si ? fmt.signedPct(si.display) + ' annualized' : '') +
        stackedTile('Today', '<span class="' + fmt.cls(data.dayChange) + '">' + fmt.arrow(data.dayChange) + ' ' + fmt.money(Math.abs(data.dayChange), ctx.fmtCtx) + '</span>',
          fmt.signedPct(data.totalValue - data.dayChange ? data.dayChange / (data.totalValue - data.dayChange) : 0)) +
        stackedTile('Unrealized gain/loss',
          '<span class="' + fmt.cls(data.unrealized) + '">' + fmt.arrow(data.unrealized) + ' ' + fmt.money(Math.abs(data.unrealized), ctx.fmtCtx) + '</span>',
          data.totalCost ? fmt.signedPct(data.unrealized / data.totalCost) + ' on book cost' : '') +
        stackedTile('Net contributed', fmt.money(contributed, ctx.fmtCtx, 0),
          'growth of ' + fmt.money(data.totalValue - contributed, ctx.fmtCtx, 0));

      /* profile strip */
      const p = data.profile;
      el.querySelector('#pf-strip').innerHTML =
        stackedTile('Inception', fmt.date(data.meta.inception_date), M.yearsBetween(data.meta.inception_date, data.meta.as_of).toFixed(1) + ' years') +
        stackedTile('Positions', fmt.num(data.positions.length), p.etf_count + ' ETFs') +
        stackedTile('Blended MER', fmt.pct(p.blended_mer, 2), 'weighted by market value') +
        stackedTile('Distribution yield', fmt.pct(p.distribution_yield, 2), 'trailing twelve months') +
        stackedTile('Base currency', data.meta.base_currency, '1 USD = ' + data.usdcad.toFixed(4) + ' CAD');

      /* growth of $10,000 — built from the TWR index, never the raw balance */
      const c1 = charts.cssVar('--series-1', '#2a78d6');
      const c2 = charts.cssVar('--series-2', '#eb6834');
      if (!hasHistory) {
        el.querySelector('#pf-growth').innerHTML = historyNotice(idx, data, 'Growth of $10,000');
        el.querySelector('#pf-growth-legend').innerHTML = '';
      } else {
        const series = [
          { label: 'Portfolio', color: c1, points: idx.map(x => ({ date: x.date, value: x.index * 10000 })) },
          { label: benchLabel, color: c2, dashed: true, points: bench.map(x => ({ date: x.date, value: x.index * 10000 })) }
        ];
        charts.line(el.querySelector('#pf-growth'), series, {
          title: 'Growth of $10,000', height: 320,
          yFormat: v => '$' + fmt.num(v, 0),
          tipFormat: v => '$' + fmt.num(v, 0)
        });
        charts.legend(el.querySelector('#pf-growth-legend'), series.map(s => ({
          key: s.label, label: s.label, color: s.color,
          value: s.points[s.points.length - 1].value
        })), { valueFormat: v => '$' + fmt.num(v, 0) + ' today' });
        el.querySelectorAll('#pf-growth-legend button').forEach(b => { b.disabled = true; b.style.cursor = 'default'; });
      }

      /* trailing returns */
      const periodLabel = { '1M': '1 month', '3M': '3 months', '6M': '6 months', YTD: 'Year to date', '1Y': '1 year', '3Y': '3 years', SI: 'Since inception' };
      const rows = M.PERIODS.map(k => ({
        period: k, label: periodLabel[k],
        port: tr[k] ? tr[k].display : null,
        bench: btr[k] ? btr[k].display : null,
        ann: tr[k] ? tr[k].annualizedFlag : false
      }));
      if (!hasHistory) {
        el.querySelector('#pf-returns').innerHTML =
          '<div class="project-card">' + historyNotice(idx, data, 'Trailing returns') + '</div>';
        /* #pf-risk is a .splits grid, so the notice spans every column */
        el.querySelector('#pf-risk').innerHTML =
          '<div style="grid-column:1/-1;background:none;box-shadow:none;border:0;padding:0">' +
          historyNotice(idx, data, 'Risk statistics') + '</div>';
        el.querySelector('#pf-note').innerHTML =
          '<strong>About these figures.</strong> Holdings, balances and transactions come straight from ' +
          'the brokerage and are current as at ' + fmt.date(data.meta.as_of) + '. Return and risk figures ' +
          'are left blank rather than estimated: the feed carries no account-value history and no share ' +
          'quantities on past transactions, so there is nothing to reconstruct a genuine performance ' +
          'record from. Those figures will fill in from ' + fmt.date(data.history.portfolio[0].date) + ' onward.';
        return;
      }

      T.render(el.querySelector('#pf-returns'), {
        title: 'TRAILING RETURNS',
        columns: [
          { key: 'label', label: 'Period' },
          { key: 'port', label: 'Portfolio', num: true, format: r => r.port === null ? '—' : fmt.deltaPct(r.port) },
          { key: 'bench', label: benchLabel, num: true, format: r => r.bench === null ? '—' : fmt.deltaPct(r.bench) },
          {
            key: 'diff', label: 'Difference', num: true,
            sortValue: r => (r.port === null || r.bench === null ? null : r.port - r.bench),
            format: r => (r.port === null || r.bench === null) ? '—' :
              '<span class="' + fmt.cls(r.port - r.bench) + '">' + ((r.port - r.bench) * 100 >= 0 ? '+' : '') + ((r.port - r.bench) * 100).toFixed(2) + ' pts</span>'
          },
          { key: 'ann', label: 'Basis', format: r => r.port === null ? '' : (r.ann ? 'annualized' : 'cumulative') }
        ],
        rows: rows,
        sort: ctx.state.sort.returns,
        rowKey: r => r.period
      });

      /* risk */
      const vol = M.volatility(idx);
      const be = M.beta(idx, bench);
      const sh = M.sharpe(idx, rf);
      el.querySelector('#pf-risk').innerHTML =
        stackedTile('Volatility', fmt.pct(vol, 1), 'annualized standard deviation') +
        stackedTile('Max drawdown', '<span class="down">' + fmt.pct(dd.value, 1) + '</span>',
          dd.from ? fmt.dateShort(dd.from) + ' → ' + fmt.dateShort(dd.to) : '') +
        stackedTile('Sharpe ratio', sh === null ? '—' : sh.toFixed(2), 'vs ' + fmt.pct(rf, 1) + ' risk-free') +
        stackedTile('Beta', be === null ? '—' : be.toFixed(2), 'vs ' + benchLabel) +
        stackedTile('Best month', bw.best ? '<span class="up">' + fmt.signedPct(bw.best.ret, 1) + '</span>' : '—', bw.best ? bw.best.month : '') +
        stackedTile('Worst month', bw.worst ? '<span class="down">' + fmt.signedPct(bw.worst.ret, 1) + '</span>' : '—', bw.worst ? bw.worst.month : '');

      el.querySelector('#pf-note').innerHTML =
        '<strong>How these figures are calculated.</strong> Returns are <em>time-weighted</em>: each ' +
        'period\'s return is measured with that period\'s deposits and withdrawals removed, then the ' +
        'periods are chained together. This isolates investment performance from the effect of adding ' +
        'money. Over this history ' + fmt.money(data.history.portfolio.reduce((a, h) => a + h.net_flow, 0), ctx.fmtCtx, 0) +
        ' was contributed net of withdrawals, so simply comparing the balance to the amount deposited ' +
        'would give a materially different — and misleading — number. Periods of a year or more are ' +
        'annualized; shorter periods are cumulative. Past performance does not predict future results.';
    }
  };

  /* =====================================================================
     2. OVERVIEW
     ===================================================================== */
  const OVERVIEW_GROUPS = [
    { key: 'symbol', label: 'Holdings', source: 'positions' },
    { key: 'sector', label: 'Sector', source: 'lookthrough' },
    { key: 'asset_class', label: 'Asset Class', source: 'positions' },
    { key: 'account', label: 'Account', source: 'positions' },
    { key: 'currency', label: 'Currency', source: 'positions' },
    { key: 'geography', label: 'Geography', source: 'lookthrough' }
  ];

  DASH.tabs.overview = {
    id: 'overview',
    label: 'Overview',
    render: function (el, ctx) {
      const s = ctx.state;

      if (buildOnce(el, '' +
        '<div class="dash-stack">' +
        '<div class="splits" id="ov-kpi"></div>' +
        '<div class="project-card">' +
        '<div class="dash-head"><h2>Allocation</h2><div class="dash-badge-row" id="ov-groups"></div></div>' +
        '<div class="dash-cols">' +
        '<div><div class="dash-chart" id="ov-donut"></div><ul class="dash-legend" id="ov-legend"></ul></div>' +
        '<div id="ov-breakdown"></div>' +
        '</div></div>' +
        '<div class="dash-cols">' +
        '<div class="project-card"><div class="dash-head"><h2>Top movers</h2><p>Today</p></div><div id="ov-movers"></div></div>' +
        '<div class="project-card"><div class="dash-head"><h2>Jump to</h2></div><div class="doc-grid" id="ov-links"></div></div>' +
        '</div></div>')) {
        el.querySelector('#ov-groups').addEventListener('click', ev => {
          const b = ev.target.closest('[data-group]');
          if (!b) return;
          s.groupBy.overview = b.dataset.group;
          s.hiddenSlices.overview = new Set();
          ctx.rerender();
        });
        el.querySelector('#ov-links').addEventListener('click', ev => {
          const a = ev.target.closest('[data-go]');
          if (a) { ev.preventDefault(); ctx.go(a.dataset.go); }
        });
      }

      const data = ctx.data;
      const positions = ctx.positions;
      const totalValue = positions.reduce((a, p) => a + p.mv_cad, 0);
      const dayChange = positions.reduce((a, p) => a + p.day_change_cad, 0);
      const unreal = positions.reduce((a, p) => a + p.pnl_cad, 0);
      const cost = positions.reduce((a, p) => a + p.cost_cad, 0);
      const cash = positions.filter(p => p.asset_type === 'Cash').reduce((a, p) => a + p.mv_cad, 0);
      const prev = totalValue - dayChange;

      el.querySelector('#ov-kpi').innerHTML =
        stackedTile('Portfolio value', fmt.money(totalValue, ctx.fmtCtx), ctx.scopeLabel) +
        stackedTile('Day change', fmt.delta(dayChange, ctx.fmtCtx), prev ? fmt.signedPct(dayChange / prev) : '') +
        stackedTile('Unrealized gain/loss', fmt.delta(unreal, ctx.fmtCtx), cost ? fmt.signedPct(unreal / cost) + ' on cost' : '') +
        stackedTile('Cash', fmt.money(cash, ctx.fmtCtx), totalValue ? fmt.pct(cash / totalValue, 1) + ' of portfolio' : '');

      const group = OVERVIEW_GROUPS.find(g => g.key === s.groupBy.overview) || OVERVIEW_GROUPS[0];
      el.querySelector('#ov-groups').innerHTML =
        '<span class="status-badge">Group by</span>' + groupToggle('group', OVERVIEW_GROUPS, group.key);

      const raw = group.source === 'lookthrough'
        ? D.rollup(ctx.lookThrough.rows, group.key)
        : D.rollupPositions(positions, group.key);
      const slices = D.topN(raw, 9).map((x, i) => Object.assign({}, x, { color: charts.colorFor(x.key, i) }));

      const hidden = s.hiddenSlices.overview;
      charts.donut(el.querySelector('#ov-donut'), slices, {
        ctx: ctx.fmtCtx, hidden: hidden, title: group.label,
        centreLabel: group.label,
        onSelect: sl => { s.selectedSlice = sl.key; ctx.rerender(); }
      });
      charts.legend(el.querySelector('#ov-legend'), slices, {
        hidden: hidden,
        onToggle: k => {
          if (hidden.has(k)) hidden.delete(k); else hidden.add(k);
          ctx.rerender();
        }
      });

      /* Breakdown beneath the chart — clicking a slice focuses it here. */
      const focus = slices.find(x => x.key === s.selectedSlice);
      const bd = el.querySelector('#ov-breakdown');
      if (focus) {
        const members = focus.isOther ? focus.members
          : (group.source === 'lookthrough'
            ? ctx.lookThrough.rows.filter(r => (r[group.key] || 'Unclassified') === focus.key)
              .map(r => ({ key: r.key, label: r.ticker + ' · ' + r.name, value: r.value, weight: r.weight }))
            : positions.filter(p => (p[group.key] || 'Unclassified') === focus.key)
              .map(p => ({ key: p.symbol + p.account_id, label: p.symbol + ' · ' + p.account, value: p.mv_cad, weight: p.weight })));
        T.render(bd, {
          title: 'INSIDE: ' + String(focus.label).toUpperCase(),
          columns: [
            { key: 'label', label: 'Holding' },
            { key: 'value', label: 'Value', num: true, format: r => fmt.money(r.value, ctx.fmtCtx) },
            { key: 'weight', label: 'Weight', num: true, format: r => fmt.pct(r.weight, 2) }
          ],
          rows: members.sort((a, b) => b.value - a.value),
          sort: { key: 'value', dir: 'desc' },
          rowKey: r => r.key,
          controls: '<button class="btn btn--sm btn--outline" id="ov-clear">Clear</button>'
        });
        const clear = bd.querySelector('#ov-clear');
        if (clear) clear.addEventListener('click', () => { s.selectedSlice = null; ctx.rerender(); });
      } else {
        T.render(bd, {
          title: group.label.toUpperCase() + ' BREAKDOWN',
          columns: [
            { key: 'label', label: group.label },
            { key: 'value', label: 'Value', num: true, format: r => fmt.money(r.value, ctx.fmtCtx) },
            { key: 'weight', label: 'Weight', num: true, format: r => fmt.pct(r.weight, 2) }
          ],
          rows: raw,
          sort: { key: 'value', dir: 'desc' },
          rowKey: r => r.key,
          controls: '<span class="dash-stamp">Click a slice to drill in</span>'
        });
      }

      /* top movers */
      const movers = positions.filter(p => p.asset_type !== 'Cash')
        .slice().sort((a, b) => Math.abs(b.day_change_cad) - Math.abs(a.day_change_cad)).slice(0, 6);
      el.querySelector('#ov-movers').innerHTML = movers.length
        ? '<ul class="dash-legend">' + movers.map(p =>
          '<li><button type="button" data-sym="' + fmt.esc(p.symbol) + '">' +
          '<span class="lbl"><strong>' + fmt.esc(p.symbol) + '</strong> <span style="color:var(--color-text-secondary)">' +
          fmt.esc(p.account) + '</span></span>' +
          /* Ranked by dollar impact, so show the dollars — ranking by one
             number while displaying another just looks unsorted. */
          '<span class="val">' + fmt.delta(p.day_change_cad, ctx.fmtCtx, p.day_pct) + '</span></button></li>').join('') + '</ul>'
        : '<div class="dash-empty">No positions in this scope.</div>';
      el.querySelectorAll('#ov-movers [data-sym]').forEach(b =>
        b.addEventListener('click', () => ctx.go('holdings', { highlight: b.dataset.sym })));

      el.querySelector('#ov-links').innerHTML = [
        ['profile', 'fa-file-invoice', 'Fund Profile', 'Returns, risk and the fact sheet'],
        ['factsheet', 'fa-layer-group', 'Fact Sheet', 'What you own once the ETFs are unpacked'],
        ['holdings', 'fa-table-list', 'Holdings', 'Every position, sortable and filterable'],
        ['performance', 'fa-chart-line', 'Performance', 'History against the benchmark']
      ].map(([id, icon, title, sub]) =>
        /* .doc-card is an icon + meta row, so give it exactly that structure
           rather than fighting its flex layout. */
        '<a class="doc-card" href="#' + id + '" data-go="' + id + '">' +
        '<span class="doc-icon"><i class="fas ' + icon + '" style="color:var(--color-primary)" aria-hidden="true"></i></span>' +
        '<span class="doc-meta" style="min-width:0">' +
        '<strong style="display:block;color:var(--color-text)">' + title + '</strong>' +
        '<span style="font-size:var(--font-size-sm);color:var(--color-text-secondary)">' + sub + '</span>' +
        '</span></a>').join('');
    }
  };

  /* =====================================================================
     3. HOLDINGS
     ===================================================================== */
  DASH.tabs.holdings = {
    id: 'holdings',
    label: 'Holdings',
    render: function (el, ctx) {
      const s = ctx.state;
      const data = ctx.data;
      const f = s.filters;

      if (buildOnce(el, '' +
        '<div class="dash-stack"><div class="project-card">' +
        '<div class="dash-bar">' +
        '<input class="form-control" id="hd-search" type="search" placeholder="Search symbol or name…" aria-label="Search holdings" style="max-width:260px">' +
        '<select class="form-control" id="hd-type" aria-label="Filter by asset type"></select>' +
        '<select class="form-control" id="hd-ccy" aria-label="Filter by currency"></select>' +
        '<select class="form-control" id="hd-sector" aria-label="Filter by sector"></select>' +
        '<label style="display:flex;align-items:center;gap:8px;font-size:var(--font-size-sm);cursor:pointer">' +
        '<input type="checkbox" id="hd-group" style="accent-color:var(--color-primary)"> Group ETFs</label>' +
        '<button class="btn btn--sm btn--outline" id="hd-clear">Clear filters</button>' +
        '</div><div id="hd-table"></div></div></div>')) {

        const uniq = (arr) => Array.from(new Set(arr)).sort();
        const opt = (v, cur) => '<option value="' + fmt.esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + fmt.esc(v === '' ? 'All' : v) + '</option>';

        el.querySelector('#hd-type').innerHTML = ['', ...uniq(data.positions.map(p => p.asset_type))].map(v => opt(v, f.assetType)).join('');
        el.querySelector('#hd-ccy').innerHTML = ['', ...uniq(data.positions.map(p => p.currency))].map(v => opt(v, f.currency)).join('');
        el.querySelector('#hd-sector').innerHTML = ['', ...uniq(data.positions.map(p => positionSector(p, data)))].map(v => opt(v, f.sector)).join('');

        el.querySelector('#hd-search').addEventListener('input', e => { f.search = e.target.value; paint(); });
        el.querySelector('#hd-type').addEventListener('change', e => { f.assetType = e.target.value; paint(); });
        el.querySelector('#hd-ccy').addEventListener('change', e => { f.currency = e.target.value; paint(); });
        el.querySelector('#hd-sector').addEventListener('change', e => { f.sector = e.target.value; paint(); });
        el.querySelector('#hd-group').addEventListener('change', e => { s.groupEtfs = e.target.checked; paint(); });
        el.querySelector('#hd-clear').addEventListener('click', () => {
          f.search = ''; f.assetType = ''; f.currency = ''; f.sector = '';
          el.querySelector('#hd-search').value = '';
          el.querySelector('#hd-type').value = '';
          el.querySelector('#hd-ccy').value = '';
          el.querySelector('#hd-sector').value = '';
          paint();
        });
      }

      el.querySelector('#hd-group').checked = !!s.groupEtfs;

      function paint() {
        const q = (f.search || '').trim().toLowerCase();
        const rows = ctx.positions.filter(p =>
          (!q || p.symbol.toLowerCase().indexOf(q) >= 0 || p.name.toLowerCase().indexOf(q) >= 0) &&
          (!f.assetType || p.asset_type === f.assetType) &&
          (!f.currency || p.currency === f.currency) &&
          (!f.sector || positionSector(p, data) === f.sector)
        );

        const columns = [
          { key: 'symbol', label: 'Symbol', cls: 'sym', format: r => fmt.esc(r.symbol) },
          { key: 'name', label: 'Name', format: r => fmt.esc(r.name) },
          { key: 'account', label: 'Account', optional: true, format: r => '<span class="pill">' + fmt.esc(r.account) + '</span>' },
          { key: 'quantity', label: 'Qty', num: true, format: r => fmt.num(r.quantity, r.quantity % 1 ? 2 : 0) },
          { key: 'avg_cost', label: 'Avg cost', num: true, format: r => fmt.money(r.currency === 'USD' ? r.avg_cost * data.usdcad : r.avg_cost, ctx.fmtCtx) },
          { key: 'price', label: 'Price', num: true, format: r => fmt.money(r.currency === 'USD' ? r.price * data.usdcad : r.price, ctx.fmtCtx) },
          { key: 'mv_cad', label: 'Market value', num: true, format: r => fmt.money(r.mv_cad, ctx.fmtCtx) },
          { key: 'pnl_cad', label: 'Unrealized', num: true, format: r => r.asset_type === 'Cash' ? '—' : fmt.delta(r.pnl_cad, ctx.fmtCtx, r.pnl_pct) },
          { key: 'day_change_cad', label: 'Today', num: true, format: r => r.asset_type === 'Cash' ? '—' : fmt.delta(r.day_change_cad, ctx.fmtCtx, r.day_pct) },
          { key: 'weight', label: 'Weight', num: true, format: r => fmt.pct(r.weight, 2) },
          { key: 'asset_type', label: 'Type', optional: true, format: r => '<span class="pill">' + fmt.esc(r.asset_type) + '</span>' },
          { key: 'currency', label: 'Ccy', optional: true, format: r => fmt.esc(r.currency) },
          { key: 'sector', label: 'Sector', optional: true, format: r => fmt.esc(positionSector(r, data)) }
        ];

        T.render(el.querySelector('#hd-table'), {
          title: 'HOLDINGS — ' + rows.length + ' OF ' + ctx.positions.length,
          columns: columns,
          visible: s.columns,
          rows: rows,
          sort: s.sort.holdings,
          onSort: () => paint(),
          rowKey: r => r.symbol + '|' + r.account_id,
          expanded: s.expanded.holdings,
          expand: r => {
            /* With "Group ETFs" on, an ETF row opens to show what is actually
               inside it — the same look-through data the Fact Sheet uses. */
            if (!s.groupEtfs || r.asset_type !== 'ETF') return null;
            const spec = data.etfs[r.symbol];
            if (!spec) return '<div class="dash-empty">No constituent data for ' + fmt.esc(r.symbol) + '.</div>';
            const top = spec.holdings.slice(0, 10);
            return T.childTable(
              [{ label: 'Top 10 in ' + r.symbol }, { label: 'Sector' }, { label: 'Weight', num: true }, { label: 'Your exposure', num: true }],
              top.map(h => [
                '<strong>' + fmt.esc(h.ticker) + '</strong> ' + fmt.esc(h.name),
                fmt.esc(h.sector),
                fmt.pct(h.weight, 2),
                fmt.money(r.mv_cad * h.weight, ctx.fmtCtx)
              ])
            ) + '<div style="padding:8px 12px;font-size:var(--font-size-xs);color:var(--color-text-secondary)">' +
              'Holdings as at ' + fmt.date(spec.as_of) + ' · ' + fmt.pct(spec.coverage, 1) + ' of the fund matched to constituent data' +
              (spec.holdings.length > 10 ? ' · showing 10 of ' + spec.holdings.length : '') + '</div>';
          },
          onRowClick: r => ctx.openDetail(r),
          totals: rs => {
            const mv = rs.reduce((a, r) => a + r.mv_cad, 0);
            const cost = rs.reduce((a, r) => a + r.cost_cad, 0);
            const pnl = rs.reduce((a, r) => a + r.pnl_cad, 0);
            const day = rs.reduce((a, r) => a + r.day_change_cad, 0);
            return {
              symbol: '<strong>Total</strong>',
              name: '<span style="color:var(--color-text-secondary)">' + rs.length + ' row' + (rs.length === 1 ? '' : 's') + ' shown</span>',
              mv_cad: fmt.money(mv, ctx.fmtCtx),
              pnl_cad: fmt.delta(pnl, ctx.fmtCtx, cost ? pnl / cost : null),
              day_change_cad: fmt.delta(day, ctx.fmtCtx),
              weight: fmt.pct(rs.reduce((a, r) => a + r.weight, 0), 2)
            };
          },
          controls: T.columnsMenu('hd-cols', columns, s.columns)
        });
        T.bindColumnsMenu(el, 'hd-cols', s.columns, () => paint());

        if (s.highlight) {
          const tr = el.querySelector('tr[data-row^="' + s.highlight + '|"]');
          if (tr) {
            tr.scrollIntoView({ block: 'center', behavior: 'smooth' });
            tr.style.background = 'rgba(var(--color-teal-500-rgb),0.14)';
          }
          s.highlight = null;
        }
      }
      paint();
    }
  };

  /* =====================================================================
     4. FACT SHEET — combined look-through
     ===================================================================== */
  const FS_GROUPS = [
    { key: 'ticker', label: 'Underlying Holding' },
    { key: 'sector', label: 'Sector' },
    { key: 'geography', label: 'Geography' },
    { key: 'market_cap_bucket', label: 'Market Cap' },
    { key: 'currency', label: 'Currency' }
  ];

  DASH.tabs.factsheet = {
    id: 'factsheet',
    label: 'Fact Sheet',
    render: function (el, ctx) {
      const s = ctx.state;
      const data = ctx.data;

      if (buildOnce(el, '' +
        '<div class="dash-stack">' +
        '<div class="callout" style="margin-top:0">' +
        '<strong>Why this tab exists.</strong> Owning several broad ETFs at once quietly stacks the same ' +
        'companies on top of each other. This view unpacks every fund into its constituents, adds anything ' +
        'held directly, and shows the combined exposure — so overlap and concentration are visible instead of implied.' +
        '</div>' +
        '<div class="project-card">' +
        '<div class="dash-head"><h2>Combined exposure</h2><div class="dash-badge-row" id="fs-groups"></div></div>' +
        '<div class="dash-badge-row" style="margin-bottom:var(--space-16)" id="fs-shape"></div>' +
        '<div class="dash-cols">' +
        '<div><div class="dash-chart" id="fs-chart"></div><ul class="dash-legend" id="fs-legend"></ul></div>' +
        '<div><div class="dash-head"><h2 style="font-size:var(--font-size-lg)">Funds included</h2></div>' +
        '<ul class="dash-check" id="fs-check"></ul>' +
        '<p class="dash-stamp" id="fs-coverage" style="margin-top:var(--space-12)"></p></div>' +
        '</div></div>' +
        '<div class="project-card">' +
        '<div class="dash-bar">' +
        '<input class="form-control" id="fs-search" type="search" placeholder="Find an underlying holding…" aria-label="Search underlying holdings" style="max-width:280px">' +
        '<span class="dash-bar__spacer"></span>' +
        '<span class="status status--warning" style="font-size:var(--font-size-xs)">≥ ' + fmt.pct(D.CONCENTRATION_WARN, 0) + '</span>' +
        '<span class="status status--error" style="font-size:var(--font-size-xs)">≥ ' + fmt.pct(D.CONCENTRATION_ALERT, 0) + '</span>' +
        '</div><div id="fs-table"></div></div>' +
        '</div>')) {
        el.querySelector('#fs-groups').addEventListener('click', ev => {
          const b = ev.target.closest('[data-group]');
          if (!b) return;
          s.groupBy.factsheet = b.dataset.group;
          s.hiddenSlices.factsheet = new Set();
          ctx.rerender();
        });
        el.querySelector('#fs-shape').addEventListener('click', ev => {
          const b = ev.target.closest('[data-shape]');
          if (!b) return;
          s.factsheetShape = b.dataset.shape;
          ctx.rerender();
        });
        el.querySelector('#fs-search').addEventListener('input', e => {
          s.filters.fsSearch = e.target.value;
          paintTable();
        });
      }

      const lt = ctx.lookThrough;

      /* Without constituent data every fund collapses into one "Unresolved"
         blob, which would look like a broken chart rather than a missing
         input. Say what's missing and which funds need it. */
      const heldFunds = Array.from(new Set(ctx.positions.filter(p => p.asset_type === 'ETF').map(p => p.symbol)));
      const withData = heldFunds.filter(sym => data.etfs[sym]);
      if (heldFunds.length && !withData.length) {
        /* .callout, not .dash-error — nothing has failed, an input is simply
           not loaded yet, and the two shouldn't look alike. */
        const banner = el.querySelector('.callout');
        banner.style.marginTop = '0';
        banner.innerHTML =
          '<strong><i class="fas fa-file-circle-plus" aria-hidden="true"></i> ' +
          'No fund holdings loaded yet.</strong><br>' +
          'This tab unpacks each ETF into the companies it holds, but brokerage feeds don\'t publish ' +
          'constituent lists — they come from each fund\'s own fact sheet. Until those are loaded, ' +
          'only directly-held positions can be resolved and every fund is grouped under ' +
          '&ldquo;Unresolved&rdquo; below.<br><br>' +
          '<strong>Waiting on holdings for:</strong> ' +
          heldFunds.map(x => '<span class="pill">' + fmt.esc(x) + '</span>').join(' ');
      }

      const group = FS_GROUPS.find(g => g.key === s.groupBy.factsheet) || FS_GROUPS[0];
      el.querySelector('#fs-groups').innerHTML =
        '<span class="status-badge">Group by</span>' + groupToggle('group', FS_GROUPS, group.key);
      el.querySelector('#fs-shape').innerHTML =
        '<span class="status-badge">Chart</span>' +
        groupToggle('shape', [{ key: 'donut', label: 'Donut' }, { key: 'bar', label: 'Bars' }], s.factsheetShape || 'donut');

      const raw = group.key === 'ticker'
        ? lt.rows.map(r => ({ key: r.key, label: r.ticker === 'Unresolved' ? 'Unresolved' : r.ticker, value: r.value, weight: r.weight }))
        : D.rollup(lt.rows, group.key);
      const slices = D.topN(raw, 9).map((x, i) => Object.assign({}, x, { color: charts.colorFor(x.key, i) }));
      const hidden = s.hiddenSlices.factsheet;

      const chartMount = el.querySelector('#fs-chart');
      if ((s.factsheetShape || 'donut') === 'bar') {
        charts.bars(chartMount, slices.filter(x => !hidden.has(x.key)), {
          ctx: ctx.fmtCtx, title: group.label, labelWidth: 200,
          valueFormat: v => fmt.money(v, ctx.fmtCtx, 0)
        });
      } else {
        charts.donut(chartMount, slices, {
          ctx: ctx.fmtCtx, hidden: hidden, title: group.label, centreLabel: group.label
        });
      }
      charts.legend(el.querySelector('#fs-legend'), slices, {
        hidden: hidden,
        onToggle: k => { if (hidden.has(k)) hidden.delete(k); else hidden.add(k); ctx.rerender(); }
      });

      /* Fund inclusion checklist — unchecking recomputes the whole look-through
         live, which is the "what would selling this do?" preview. */
      const heldEtfs = Array.from(new Set(ctx.positions.filter(p => p.asset_type === 'ETF').map(p => p.symbol)));
      el.querySelector('#fs-check').innerHTML = heldEtfs.length ? heldEtfs.map(sym => {
        const spec = data.etfs[sym];
        const value = ctx.positions.filter(p => p.symbol === sym).reduce((a, p) => a + p.mv_cad, 0);
        return '<li><label><input type="checkbox" data-etf="' + fmt.esc(sym) + '"' +
          (s.excludedEtfs.has(sym) ? '' : ' checked') + '>' +
          '<span class="nm">' + fmt.esc(sym) + '</span>' +
          '<span class="dash-stamp">' + fmt.money(value, ctx.fmtCtx, 0) + '</span>' +
          (spec ? freshnessTag(spec) : '<span class="status status--error" style="font-size:var(--font-size-xs)">no data</span>') +
          '</label></li>';
      }).join('') : '<li class="dash-empty">No ETFs in this scope.</li>';

      el.querySelectorAll('#fs-check input[data-etf]').forEach(cb => {
        cb.addEventListener('change', () => {
          if (cb.checked) s.excludedEtfs.delete(cb.dataset.etf);
          else s.excludedEtfs.add(cb.dataset.etf);
          ctx.rerender();
        });
      });

      const unresolved = lt.byKey.get(D.UNRESOLVED);
      el.querySelector('#fs-coverage').innerHTML =
        'Resolved ' + fmt.pct(1 - (unresolved ? unresolved.weight : 0), 1) + ' of ' +
        fmt.money(lt.total, ctx.fmtCtx, 0) +
        (unresolved ? ' · ' + fmt.money(unresolved.value, ctx.fmtCtx, 0) + ' could not be matched to constituent data and is shown as “Unresolved” rather than dropped.' : '') +
        (s.excludedEtfs.size ? '<br><strong>Previewing without ' + Array.from(s.excludedEtfs).join(', ') + '.</strong>' : '');

      function paintTable() {
        const q = (s.filters.fsSearch || '').trim().toLowerCase();
        const rows = lt.rows.filter(r => !q ||
          String(r.ticker).toLowerCase().indexOf(q) >= 0 ||
          String(r.name).toLowerCase().indexOf(q) >= 0);

        T.render(el.querySelector('#fs-table'), {
          title: 'COMBINED UNDERLYING HOLDINGS — ' + rows.length,
          columns: [
            { key: 'ticker', label: 'Ticker', cls: 'sym', format: r => fmt.esc(r.ticker) + (r.direct ? ' <span class="pill" title="Also held directly">direct</span>' : '') },
            { key: 'name', label: 'Name', format: r => fmt.esc(r.name) },
            { key: 'sector', label: 'Sector', format: r => fmt.esc(r.sector) },
            { key: 'weight', label: 'Combined weight', num: true, format: r => fmt.pct(r.weight, 2) + concentrationBadge(r) },
            { key: 'value', label: 'Implied value', num: true, format: r => fmt.money(r.value, ctx.fmtCtx) },
            { key: 'etfCount', label: '# of ETFs', num: true, format: r => r.etfCount ? '<strong>' + r.etfCount + '</strong>' : '—' }
          ],
          rows: rows,
          sort: s.sort.factsheet,
          onSort: () => paintTable(),
          rowKey: r => r.key,
          expanded: s.expanded.factsheet,
          expand: r => {
            if (!r.sources.length) return null;
            return T.childTable(
              [{ label: 'Source' }, { label: 'Weight within source', num: true }, { label: 'Contribution', num: true }, { label: 'Share of this position', num: true }],
              r.sources.map(src => [
                src.etf ? '<strong>' + fmt.esc(src.etf) + '</strong> ' + fmt.esc((data.etfs[src.etf] || {}).name || '') : fmt.esc(src.label),
                fmt.pct(src.weightInEtf, 3),
                fmt.money(src.value, ctx.fmtCtx),
                fmt.pct(r.value ? src.value / r.value : 0, 1)
              ])
            );
          },
          totals: rs => ({
            ticker: '<strong>Total</strong>',
            name: '<span style="color:var(--color-text-secondary)">' + rs.length + ' underlying holdings</span>',
            weight: fmt.pct(rs.reduce((a, r) => a + r.weight, 0), 2),
            value: fmt.money(rs.reduce((a, r) => a + r.value, 0), ctx.fmtCtx)
          }),
          emptyText: 'No underlying holding matches that search.'
        });
      }
      paintTable();
    }
  };
})();
