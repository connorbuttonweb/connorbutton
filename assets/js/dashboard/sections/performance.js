/* ==========================================================
   § PERFORMANCE — growth of $10,000, returns, risk

   Everything here is expressed per $10,000 invested. The account's
   actual value is never shown: a fund sheet reports what a unit did,
   not what the holder's balance is.
   ========================================================== */
window.DASH = window.DASH || {};
DASH.sections = DASH.sections || {};

(function () {
  'use strict';

  const fmt = DASH.fmt;
  const charts = DASH.charts;
  const M = DASH.metrics;
  const T = DASH.table;

  const BASE = 10000;
  const RANGES = [
    { key: 'YTD', label: 'YTD' }, { key: '3M', label: '3M' }, { key: '6M', label: '6M' },
    { key: '1Y', label: '1Y' }, { key: 'All', label: 'All' }
  ];

  function tile(label, value, sub) {
    return '<div class="is-stacked"><span class="label">' + fmt.esc(label) + '</span>' +
      '<span class="time">' + value + '</span>' +
      (sub ? '<span class="sub">' + sub + '</span>' : '') + '</div>';
  }

  function toggle(attr, options, current) {
    return options.map(o =>
      '<button type="button" class="btn btn--sm ' + (o.key === current ? 'btn--primary' : 'btn--outline') +
      '" data-' + attr + '="' + o.key + '">' + fmt.esc(o.label) + '</button>').join('');
  }

  DASH.sections.performance = {
    id: 'performance',
    label: 'Performance',

    shell: function () {
      return '' +
        '<div class="dash-head">' +
        '<h2>Performance</h2>' +
        '<div class="dash-badge-row" id="pf-mode"></div>' +
        '</div>' +
        '<div id="pf-notice"></div>' +
        '<div class="project-card">' +
        '<div class="dash-head">' +
        '<div><h3 style="margin:0">Growth of $10,000</h3>' +
        '<p id="pf-window"></p></div>' +
        '<div class="dash-badge-row" id="pf-ranges"></div>' +
        '</div>' +
        '<div class="dash-badge-row" style="margin-bottom:var(--space-16)">' +
        '<span id="pf-units"></span>' +
        '<span class="dash-bar__spacer"></span>' +
        '<label style="display:flex;align-items:center;gap:8px;font-size:var(--font-size-sm);cursor:pointer">' +
        '<input type="checkbox" id="pf-bench" style="accent-color:var(--color-primary)"> Compare to S&amp;P 500</label>' +
        '</div>' +
        '<div class="dash-chart" id="pf-chart"></div>' +
        '<ul class="dash-legend" id="pf-legend"></ul>' +
        '</div>' +
        '<div class="splits" id="pf-headline"></div>' +
        '<div class="dash-cols dash-cols--even">' +
        '<div id="pf-trailing"></div>' +
        '<div id="pf-calendar"></div>' +
        '</div>' +
        '<div class="project-card"><div class="dash-head"><h3 style="margin:0">Risk</h3>' +
        '<p id="pf-risk-window"></p></div><div class="splits" id="pf-risk"></div></div>' +
        '<div class="callout" id="pf-method"></div>';
    },

    bind: function (el, ctx) {
      el.querySelector('#pf-ranges').addEventListener('click', ev => {
        const b = ev.target.closest('[data-range]');
        if (b) { ctx.state.range = b.dataset.range; ctx.rerender(); }
      });
      el.querySelector('#pf-units').addEventListener('click', ev => {
        const b = ev.target.closest('[data-units]');
        if (b) { ctx.state.units = b.dataset.units; ctx.rerender(); }
      });
      el.querySelector('#pf-mode').addEventListener('click', ev => {
        const b = ev.target.closest('[data-mode]');
        if (b) { ctx.state.perfMode = b.dataset.mode; ctx.rerender(); }
      });
      el.querySelector('#pf-bench').addEventListener('change', e => {
        ctx.state.showBenchmark = e.target.checked;
        ctx.rerender();
      });
    },

    render: function (el, ctx) {
      const s = ctx.state;
      const h = ctx.series;
      const benchLabel = 'S&P 500';

      /* Mode selector only appears when there is a genuine choice. */
      const modes = [];
      if (h.hasActual) modes.push({ key: 'actual', label: 'Actual' });
      if (h.hasHypothetical) modes.push({ key: 'hypothetical', label: 'Hypothetical' });
      const mode = modes.some(m => m.key === s.perfMode) ? s.perfMode : h.defaultMode;
      el.querySelector('#pf-mode').innerHTML = modes.length > 1 ? toggle('mode', modes, mode) : '';

      const full = mode === 'actual' ? h.actual : h.hypothetical;
      const notice = el.querySelector('#pf-notice');

      if (!full || full.length < 2) {
        notice.innerHTML = '<div class="dash-empty" style="text-align:left">' +
          '<strong>Performance history is still accruing.</strong><br>' +
          'Daily values began being recorded on ' + fmt.date(h.firstSnapshot) + '. ' +
          'The brokerage publishes no account-value history and its transaction records carry ' +
          'no share quantities, so an earlier curve cannot be reconstructed — this fills in as ' +
          'snapshots accumulate rather than being estimated.</div>';
        ['#pf-chart', '#pf-legend', '#pf-headline', '#pf-trailing', '#pf-calendar', '#pf-risk']
          .forEach(sel => { el.querySelector(sel).innerHTML = ''; });
        el.querySelector('#pf-method').innerHTML = methodology(ctx, mode, h);
        return;
      }

      /* A short real record needs saying so, or a few days' noise reads as a
         result — and it will not match the brokerage's own since-inception
         figure, which covers the whole account life. */
      if (mode === 'actual' && !h.actualIsMeaningful) {
        notice.innerHTML = '<div class="callout" style="margin-top:0">' +
          '<strong>This covers ' + h.actual.length + ' trading days, not the account\'s life.</strong><br>' +
          'Daily tracking began ' + fmt.date(h.firstSnapshot) + '. Your brokerage\'s ' +
          'since-inception figure covers the account from the day it opened and will not match ' +
          'this until tracking has run for longer — the brokerage has no account-value history to ' +
          'hand over, so this can only build forward.</div>';
      } else notice.innerHTML = '';

      /* The hypothetical series is never allowed to render unlabelled. */
      if (mode === 'hypothetical') {
        notice.innerHTML =
          '<div class="callout" style="margin-top:0;border-left-color:var(--color-warning)">' +
          '<strong><i class="fas fa-flask" aria-hidden="true"></i> Hypothetical — not actual performance.</strong><br>' +
          'This is what the <em>current</em> holdings would have returned over the period. It ignores ' +
          'every position bought and sold along the way, so it is not what the portfolio earned and ' +
          'will not match your brokerage. ' +
          (h.hasActual
            ? 'Switch to <strong>Actual</strong> for the real record, which began ' +
            fmt.date(h.firstSnapshot) + '.'
            : 'The actual record began ' + fmt.date(h.firstSnapshot) +
            ' and is charted once it spans more than a day.') +
          '</div>';
      }

      /* Period selection, re-based so $10,000 starts at the period's opening. */
      const first = full[0].date, last = full[full.length - 1].date;
      const start = s.range === 'All' ? first : M.rangeStart(s.range, last, first);
      const win = M.rebase(M.sliceFrom(full, start));
      if (win.length < 2) { s.range = 'All'; return DASH.sections.performance.render(el, ctx); }

      el.querySelector('#pf-ranges').innerHTML = toggle('range', RANGES, s.range);
      el.querySelector('#pf-units').innerHTML =
        '<span class="status-badge">Show</span>' +
        toggle('units', [{ key: 'dollars', label: '$10,000' }, { key: 'percent', label: '% return' }], s.units);
      el.querySelector('#pf-bench').checked = !!s.showBenchmark;
      el.querySelector('#pf-window').textContent =
        fmt.date(win[0].date) + ' – ' + fmt.date(win[win.length - 1].date);

      const asDollars = s.units !== 'percent';
      const toY = idx => (asDollars ? idx * BASE : (idx - 1) * 100);

      const c1 = charts.cssVar('--series-1', '#2a78d6');
      const c2 = charts.cssVar('--series-2', '#eb6834');
      const series = [{
        label: 'Portfolio' + (mode === 'hypothetical' ? ' (hypothetical)' : ''),
        color: c1,
        points: win.map(p => ({ date: p.date, value: toY(p.index) }))
      }];

      const bench = DASH.history.benchmarkFrom(ctx.history, win[0].date);
      if (s.showBenchmark && bench.length >= 2) {
        series.push({
          label: benchLabel, color: c2, dashed: true,
          points: bench.map(p => ({ date: p.date, value: toY(p.index) }))
        });
      }

      charts.line(el.querySelector('#pf-chart'), series, {
        title: 'Growth of $10,000', height: 340,
        yFormat: v => asDollars ? '$' + fmt.num(v, 0) : fmt.num(v, 1) + '%',
        tipFormat: v => asDollars ? '$' + fmt.num(v, 0) : fmt.signedPct(v / 100)
      });
      charts.legend(el.querySelector('#pf-legend'), series.map(x => ({
        key: x.label, label: x.label, color: x.color, value: x.points[x.points.length - 1].value
      })), {
        valueFormat: v => asDollars ? '$' + fmt.num(v, 0) : fmt.signedPct(v / 100)
      });
      el.querySelectorAll('#pf-legend button').forEach(b => { b.disabled = true; b.style.cursor = 'default'; });

      /* Headline: the period's return per $10,000 — never a balance. */
      const periodRet = win[win.length - 1].index - 1;
      const benchRet = bench.length >= 2 ? bench[bench.length - 1].index - 1 : null;
      el.querySelector('#pf-headline').innerHTML =
        tile('Growth of $10,000', '$' + fmt.num(BASE * (1 + periodRet), 0),
          s.range === 'All' ? 'since ' + fmt.date(win[0].date) : 'over ' + s.range) +
        tile('Period return',
          '<span class="' + fmt.cls(periodRet) + '">' + fmt.signedPct(periodRet) + '</span>',
          fmt.date(win[0].date) + ' – ' + fmt.date(win[win.length - 1].date)) +
        tile('vs ' + benchLabel,
          benchRet === null ? '—' : '<span class="' + fmt.cls(periodRet - benchRet) + '">' +
            ((periodRet - benchRet) * 100 >= 0 ? '+' : '') + ((periodRet - benchRet) * 100).toFixed(2) + ' pts</span>',
          benchRet === null ? 'enable the comparison' : benchLabel + ' ' + fmt.signedPct(benchRet)) +
        tile('Tracked since', fmt.date(h.firstSnapshot),
          mode === 'hypothetical' ? 'actual record starts here' : 'daily');

      /* Trailing returns */
      const tr = M.trailingReturns(full);
      const btrSource = DASH.history.benchmarkFrom(ctx.history, full[0].date);
      const btr = btrSource.length >= 2 ? M.trailingReturns(btrSource) : {};
      const periodLabel = { '1M': '1 month', '3M': '3 months', '6M': '6 months', YTD: 'Year to date', '1Y': '1 year', '3Y': '3 years', SI: 'Since tracking began' };
      T.render(el.querySelector('#pf-trailing'), {
        title: 'TRAILING RETURNS',
        columns: [
          { key: 'label', label: 'Period' },
          { key: 'port', label: 'Portfolio', num: true, format: r => r.port === null ? '—' : fmt.deltaPct(r.port) },
          { key: 'bench', label: benchLabel, num: true, format: r => r.bench === null || r.bench === undefined ? '—' : fmt.deltaPct(r.bench) },
          { key: 'basis', label: 'Basis', format: r => r.port === null ? '' : (r.ann ? 'annualized' : 'cumulative') }
        ],
        rows: M.PERIODS.map(k => ({
          period: k, label: periodLabel[k],
          port: tr[k] ? tr[k].display : null,
          bench: btr[k] ? btr[k].display : null,
          ann: tr[k] ? tr[k].annualizedFlag : false
        })),
        sort: s.sort.trailing,
        onSort: () => ctx.rerender(),
        rowKey: r => r.period
      });

      /* Calendar-year returns */
      const cal = M.calendarYearReturns(full);
      const benchCal = btrSource.length >= 2 ? M.calendarYearReturns(btrSource) : [];
      T.render(el.querySelector('#pf-calendar'), {
        title: 'CALENDAR YEAR RETURNS',
        columns: [
          { key: 'year', label: 'Year', format: r => fmt.esc(r.year) + (r.partial ? ' <span class="pill">partial</span>' : '') },
          { key: 'ret', label: 'Portfolio', num: true, format: r => fmt.deltaPct(r.ret) },
          {
            key: 'bench', label: benchLabel, num: true,
            format: r => {
              const b = benchCal.find(x => x.year === r.year);
              return b ? fmt.deltaPct(b.ret) : '—';
            }
          }
        ],
        rows: cal,
        sort: s.sort.calendar,
        onSort: () => ctx.rerender(),
        rowKey: r => r.year,
        emptyText: 'Not yet a full calendar year of data.'
      });

      /* Risk — only meaningful with enough observations to be worth quoting. */
      const riskEl = el.querySelector('#pf-risk');
      el.querySelector('#pf-risk-window').textContent =
        'Daily data, ' + fmt.date(full[0].date) + ' – ' + fmt.date(full[full.length - 1].date);
      if (full.length < 20) {
        riskEl.innerHTML = '<div style="grid-column:1/-1;background:none;box-shadow:none;border:0;padding:0">' +
          '<div class="dash-empty" style="text-align:left">Risk statistics need at least 20 trading days; ' +
          'there are ' + full.length + '. Quoting volatility off a handful of observations would be noise ' +
          'presented as a measurement.</div></div>';
      } else {
        const vol = M.volatility(full);
        const dd = M.maxDrawdown(full);
        const be = btrSource.length >= 2 ? M.beta(full, btrSource) : null;
        const sh = M.sharpe(full, ctx.data.meta.risk_free_rate);
        const bw = M.bestWorstMonth(full);
        riskEl.innerHTML =
          tile('Volatility', fmt.pct(vol, 1), 'annualized standard deviation') +
          tile('Max drawdown', '<span class="down">' + fmt.pct(dd.value, 1) + '</span>',
            dd.from ? fmt.dateShort(dd.from) + ' → ' + fmt.dateShort(dd.to) : '') +
          tile('Sharpe ratio', sh === null ? '—' : sh.toFixed(2),
            'vs ' + fmt.pct(ctx.data.meta.risk_free_rate, 1) + ' risk-free') +
          tile('Beta', be === null ? '—' : be.toFixed(2), 'vs ' + benchLabel) +
          tile('Best month', bw.best ? '<span class="up">' + fmt.signedPct(bw.best.ret, 1) + '</span>' : '—', bw.best ? bw.best.month : '') +
          tile('Worst month', bw.worst ? '<span class="down">' + fmt.signedPct(bw.worst.ret, 1) + '</span>' : '—', bw.worst ? bw.worst.month : '');
      }

      el.querySelector('#pf-method').innerHTML = methodology(ctx, mode, h);
    }
  };

  function methodology(ctx, mode, h) {
    const approx = h.approximated && h.approximated.length
      ? ' ' + h.approximated.join(', ') + ' has no dependable daily price series and is carried flat.'
      : '';
    return '<strong>How these figures are calculated.</strong> ' +
      (mode === 'actual'
        ? 'Returns are <em>time-weighted</em>: each period\'s return is measured with that period\'s ' +
        'deposits and withdrawals removed, then the periods are chained. This isolates investment ' +
        'performance from the effect of adding money. Daily values are reconstructed by repricing ' +
        'the holdings recorded at each refresh against that day\'s closing prices, so holdings are ' +
        'assumed unchanged between refreshes and a trade is recognised at the next one.'
        : 'This series values <em>today\'s</em> holdings at historical prices. It is a hypothetical ' +
        'illustration of the current allocation, not a record of what the portfolio earned — the ' +
        'portfolio did not hold these positions in these proportions throughout.') +
      approx +
      ' All figures are shown per $10,000 invested rather than as account values. ' +
      'Past performance does not predict future results.';
  }
})();
