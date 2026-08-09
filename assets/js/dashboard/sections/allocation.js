/* ==========================================================
   § ALLOCATION — sector, geography and asset-class mix

   Every breakdown here is computed from the same look-through map
   that § Holdings tabulates, so the two can never disagree.
   ========================================================== */
window.DASH = window.DASH || {};
DASH.sections = DASH.sections || {};

(function () {
  'use strict';

  const fmt = DASH.fmt;
  const charts = DASH.charts;
  const D = DASH.data;
  const T = DASH.table;

  const DIMENSIONS = [
    { key: 'sector', label: 'Sector' },
    { key: 'geography', label: 'Geography' },
    { key: 'heldVia', label: 'Held Via' },
    { key: 'currency', label: 'Currency' }
  ];

  DASH.sections.allocation = {
    id: 'allocation',
    label: 'Allocation',

    shell: function () {
      return '' +
        '<div class="dash-head">' +
        '<h2>Allocation</h2>' +
        '<div class="dash-badge-row" id="al-dims"></div>' +
        '</div>' +
        '<p class="dash-stamp" id="al-basis"></p>' +
        '<div class="project-card">' +
        '<div class="dash-cols">' +
        '<div><div class="dash-chart" id="al-donut"></div>' +
        '<ul class="dash-legend" id="al-legend"></ul></div>' +
        '<div id="al-table"></div>' +
        '</div></div>' +
        '<div class="dash-cols dash-cols--even">' +
        '<div id="al-positions"></div>' +
        '<div id="al-funds"></div>' +
        '</div>';
    },

    bind: function (el, ctx) {
      el.querySelector('#al-dims').addEventListener('click', ev => {
        const b = ev.target.closest('[data-dim]');
        if (!b) return;
        ctx.state.allocationDim = b.dataset.dim;
        ctx.rerender();
      });
    },

    render: function (el, ctx) {
      const s = ctx.state;
      const data = ctx.data;
      const lt = ctx.lookThrough;
      const dim = DIMENSIONS.find(d => d.key === s.allocationDim) || DIMENSIONS[0];

      el.querySelector('#al-dims').innerHTML = DIMENSIONS.map(d =>
        '<button type="button" class="btn btn--sm ' + (d.key === dim.key ? 'btn--primary' : 'btn--outline') +
        '" data-dim="' + d.key + '">' + fmt.esc(d.label) + '</button>').join('');

      const rows = dim.key === 'heldVia' ? D.rollupBySource(lt.rows) : D.rollup(lt.rows, dim.key);
      const slices = D.topN(rows, 9).map((x, i) => Object.assign({}, x, { color: charts.colorFor(x.key, i) }));

      charts.donut(el.querySelector('#al-donut'), slices, {
        ctx: ctx.fmtCtx, title: dim.label, centreLabel: dim.label,
        centreValue: fmt.pct(slices.length ? slices[0].weight : 0, 1)
      });
      charts.legend(el.querySelector('#al-legend'), slices, {});
      el.querySelectorAll('#al-legend button').forEach(b => { b.disabled = true; b.style.cursor = 'default'; });

      el.querySelector('#al-basis').innerHTML =
        'Computed by looking through every fund to the companies it holds, then combining those with ' +
        'directly-held positions. Percentages are of total portfolio value.' +
        (dim.key === 'heldVia'
          ? ' A company held through more than one fund counts toward each of them, in proportion to what each actually contributed — so every fund’s slice matches its own position weight.'
          : '');

      T.render(el.querySelector('#al-table'), {
        title: dim.label.toUpperCase() + ' MIX',
        columns: [
          { key: 'label', label: dim.label },
          { key: 'weight', label: 'Weight', num: true, format: r => fmt.pct(r.weight, 2) },
          { key: 'value', label: 'Value', num: true, format: r => fmt.money(r.value, ctx.fmtCtx, 0) }
        ],
        rows: rows,
        sort: s.sort.allocation,
        onSort: () => ctx.rerender(),
        rowKey: r => r.key,
        /* Weights total, values deliberately do not: the page reports
           performance per $10,000, so it never states the account's value. */
        totals: rs => ({
          label: '<strong>Total</strong>',
          weight: fmt.pct(rs.reduce((a, r) => a + r.weight, 0), 2)
        })
      });

      /* What was actually bought — the bridge between the funds held and the
         companies owned through them. */
      const positions = ctx.positions.slice().sort((a, b) => b.mv_cad - a.mv_cad);
      T.render(el.querySelector('#al-positions'), {
        title: 'POSITIONS HELD',
        columns: [
          { key: 'symbol', label: 'Symbol', cls: 'sym', format: r => fmt.esc(r.symbol) },
          { key: 'name', label: 'Name', format: r => fmt.esc(r.name) },
          { key: 'asset_type', label: 'Type', format: r => '<span class="pill">' + fmt.esc(r.asset_type) + '</span>' },
          { key: 'weight', label: 'Weight', num: true, format: r => fmt.pct(r.weight, 2) },
          { key: 'mv_cad', label: 'Value', num: true, format: r => fmt.money(r.mv_cad, ctx.fmtCtx, 0) }
        ],
        rows: positions,
        sort: s.sort.positions,
        onSort: () => ctx.rerender(),
        rowKey: r => r.symbol,
        totals: rs => ({
          symbol: '<strong>Total</strong>',
          weight: fmt.pct(rs.reduce((a, r) => a + r.weight, 0), 2)
        })
      });

      /* Fund holdings age drives how much the look-through can be trusted, so
         it is stated rather than left to be discovered. */
      const funds = Object.keys(data.etfs).map(sym => {
        const spec = data.etfs[sym];
        const held = ctx.positions.filter(p => p.symbol === sym);
        const age = Math.round((Date.now() - new Date(spec.as_of + 'T00:00:00Z')) / 86400000);
        return {
          symbol: sym, name: spec.name, as_of: spec.as_of, age: age,
          coverage: spec.coverage, count: spec.holdings.length,
          weight: held.reduce((a, p) => a + p.weight, 0)
        };
      }).sort((a, b) => b.weight - a.weight);

      T.render(el.querySelector('#al-funds'), {
        title: 'FUND HOLDINGS DATA',
        columns: [
          { key: 'symbol', label: 'Fund', cls: 'sym', format: r => fmt.esc(r.symbol) },
          { key: 'count', label: 'Constituents', num: true, format: r => fmt.num(r.count) },
          { key: 'coverage', label: 'Coverage', num: true, format: r => fmt.pct(r.coverage, 1) },
          {
            key: 'as_of', label: 'As at', format: r =>
              r.age > 45
                ? '<span class="status status--warning" style="font-size:var(--font-size-xs)" title="' +
                r.age + ' days old">' + fmt.date(r.as_of) + '</span>'
                : fmt.date(r.as_of)
          }
        ],
        rows: funds,
        sort: s.sort.funds,
        onSort: () => ctx.rerender(),
        rowKey: r => r.symbol,
        emptyText: 'No fund constituent data loaded.',
        controls: '<span class="dash-stamp">flagged if over 45 days old</span>'
      });
    }
  };
})();
