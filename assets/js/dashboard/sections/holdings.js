/* ==========================================================
   § HOLDINGS — the aggregate look-through

   The reason the page exists. Owning several broad funds at once
   quietly stacks the same companies; this unpacks every fund into
   its constituents, adds anything held directly, and reports the
   combined exposure.
   ========================================================== */
window.DASH = window.DASH || {};
DASH.sections = DASH.sections || {};

(function () {
  'use strict';

  const fmt = DASH.fmt;
  const D = DASH.data;
  const T = DASH.table;

  function badge(row) {
    if (!row.flag) return '';
    const alert = row.flag === 'alert';
    return ' <span class="status status--' + (alert ? 'error' : 'warning') + '" title="' +
      'Combined weight ' + fmt.pct(row.weight, 2) + ' is above the ' +
      (alert ? fmt.pct(D.CONCENTRATION_ALERT, 0) + ' alert' : fmt.pct(D.CONCENTRATION_WARN, 0) + ' warning') +
      ' threshold once every fund is looked through." style="font-size:var(--font-size-xs);padding:2px 8px">' +
      '<i class="fas fa-' + (alert ? 'circle-exclamation' : 'triangle-exclamation') + '" aria-hidden="true"></i>&nbsp;' +
      (alert ? 'concentrated' : 'elevated') + '</span>';
  }

  DASH.sections.holdings = {
    id: 'holdings',
    label: 'Holdings',

    shell: function () {
      return '' +
        '<div class="dash-head"><h2>Holdings</h2>' +
        '<p>Every company owned, whether directly or through a fund</p></div>' +
        '<div class="splits" id="hl-stats"></div>' +
        '<div id="hl-top"></div>' +
        '<div class="project-card">' +
        '<div class="dash-bar">' +
        '<input class="form-control" id="hl-search" type="search" placeholder="Find a holding…" ' +
        'aria-label="Search holdings" style="max-width:280px">' +
        '<label style="display:flex;align-items:center;gap:8px;font-size:var(--font-size-sm);cursor:pointer">' +
        '<input type="checkbox" id="hl-shared" style="accent-color:var(--color-primary)"> Shared across funds only</label>' +
        '<span class="dash-bar__spacer"></span>' +
        '<span class="status status--warning" style="font-size:var(--font-size-xs)">≥ 5%</span>' +
        '<span class="status status--error" style="font-size:var(--font-size-xs)">≥ 10%</span>' +
        '</div>' +
        '<div id="hl-table"></div></div>';
    },

    bind: function (el, ctx) {
      el.querySelector('#hl-search').addEventListener('input', e => {
        ctx.state.filters.holdings = e.target.value;
        paint(el, ctx);
      });
      el.querySelector('#hl-shared').addEventListener('change', e => {
        ctx.state.sharedOnly = e.target.checked;
        paint(el, ctx);
      });
    },

    render: function (el, ctx) {
      const lt = ctx.lookThrough;
      const shared = lt.rows.filter(r => r.etfCount >= 2);
      const unresolved = lt.byKey.get(D.UNRESOLVED);
      const flagged = lt.rows.filter(r => r.flag);

      el.querySelector('#hl-stats').innerHTML = [
        ['Distinct companies', fmt.num(lt.rows.length), 'after combining every fund'],
        ['Held via more than one fund', fmt.num(shared.length),
          shared.length ? 'top: ' + shared[0].ticker + ' at ' + fmt.pct(shared[0].weight, 2) : ''],
        ['Flagged concentrations', flagged.length
          ? '<span class="down">' + flagged.length + '</span>' : '0',
          flagged.length ? flagged.map(f => f.ticker).join(', ') : 'none above 5%'],
        ['Unresolved', unresolved ? fmt.pct(unresolved.weight, 2) : '0%',
          'cash, derivatives and unlisted tail']
      ].map(([l, v, sub]) =>
        '<div class="is-stacked"><span class="label">' + l + '</span>' +
        '<span class="time">' + v + '</span>' +
        (sub ? '<span class="sub">' + fmt.esc(sub) + '</span>' : '') + '</div>').join('');

      /* Top ten — the figure a fund sheet leads its holdings section with. */
      const top = lt.rows.slice(0, 10);
      const topWeight = top.reduce((a, r) => a + r.weight, 0);
      T.render(el.querySelector('#hl-top'), {
        title: 'TOP 10 HOLDINGS — ' + fmt.pct(topWeight, 1) + ' OF PORTFOLIO',
        columns: [
          { key: 'ticker', label: 'Ticker', cls: 'sym', format: r => fmt.esc(r.ticker) },
          { key: 'name', label: 'Name', format: r => fmt.esc(r.name) },
          { key: 'sector', label: 'Sector', format: r => fmt.esc(r.sector) },
          { key: 'weight', label: 'Weight', num: true, format: r => fmt.pct(r.weight, 2) + badge(r) },
          { key: 'etfCount', label: 'Funds', num: true, format: r => r.etfCount || (r.direct ? 'direct' : '—') }
        ],
        rows: top,
        sort: { key: 'weight', dir: 'desc' },
        rowKey: r => r.key
      });

      paint(el, ctx);
    }
  };

  function paint(el, ctx) {
    const s = ctx.state;
    const data = ctx.data;
    const lt = ctx.lookThrough;
    const q = (s.filters.holdings || '').trim().toLowerCase();

    const rows = lt.rows.filter(r =>
      (!s.sharedOnly || r.etfCount >= 2) &&
      (!q || String(r.ticker).toLowerCase().indexOf(q) >= 0 ||
        String(r.name).toLowerCase().indexOf(q) >= 0));

    T.render(el.querySelector('#hl-table'), {
      title: 'ALL HOLDINGS — ' + fmt.num(rows.length) + ' OF ' + fmt.num(lt.rows.length),
      columns: [
        { key: 'ticker', label: 'Ticker', cls: 'sym', format: r => fmt.esc(r.ticker) + (r.direct ? ' <span class="pill" title="Also held directly">direct</span>' : '') },
        { key: 'name', label: 'Name', format: r => fmt.esc(r.name) },
        { key: 'sector', label: 'Sector', format: r => fmt.esc(r.sector) },
        { key: 'geography', label: 'Geography', format: r => fmt.esc(r.geography) },
        { key: 'weight', label: 'Weight', num: true, format: r => fmt.pct(r.weight, 3) + badge(r) },
        { key: 'value', label: 'Value', num: true, format: r => fmt.money(r.value, ctx.fmtCtx, 0) },
        { key: 'etfCount', label: '# of funds', num: true, format: r => r.etfCount ? '<strong>' + r.etfCount + '</strong>' : '—' }
      ],
      rows: rows,
      sort: s.sort.holdings,
      onSort: () => paint(el, ctx),
      rowKey: r => r.key,
      expanded: s.expanded.holdings,
      /* Expanding shows exactly how the combined figure was built — which funds
         contributed, at what weight inside each, and for how much. */
      expand: r => {
        if (!r.sources.length) return null;
        return T.childTable(
          [{ label: 'Source' }, { label: 'Weight within source', num: true },
          { label: 'Contribution', num: true }, { label: 'Share of this position', num: true }],
          r.sources.map(src => [
            src.etf
              ? '<strong>' + fmt.esc(src.etf) + '</strong> ' + fmt.esc((data.etfs[src.etf] || {}).name || '')
              : fmt.esc(src.label),
            fmt.pct(src.weightInEtf, 3),
            fmt.money(src.value, ctx.fmtCtx),
            fmt.pct(r.value ? src.value / r.value : 0, 1)
          ])
        );
      },
      totals: rs => ({
        ticker: '<strong>Total</strong>',
        name: '<span style="color:var(--color-text-secondary)">' + fmt.num(rs.length) + ' holdings shown</span>',
        weight: fmt.pct(rs.reduce((a, r) => a + r.weight, 0), 2)
      }),
      emptyText: 'No holding matches that search.'
    });
  }
})();
