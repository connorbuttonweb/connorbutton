/* ==========================================================
   § DISTRIBUTIONS — income received and projected
   ========================================================== */
window.DASH = window.DASH || {};
DASH.sections = DASH.sections || {};

(function () {
  'use strict';

  const fmt = DASH.fmt;
  const charts = DASH.charts;
  const T = DASH.table;

  function tile(label, value, sub) {
    return '<div class="is-stacked"><span class="label">' + fmt.esc(label) + '</span>' +
      '<span class="time">' + value + '</span>' +
      (sub ? '<span class="sub">' + sub + '</span>' : '') + '</div>';
  }

  DASH.sections.distributions = {
    id: 'distributions',
    label: 'Distributions',

    shell: function () {
      return '' +
        '<div class="dash-head"><h2>Distributions</h2>' +
        '<p>Income received, and the forward run-rate at current holdings</p></div>' +
        '<div class="splits" id="di-tiles"></div>' +
        '<div class="project-card">' +
        '<div class="dash-head"><h3 style="margin:0">Received by month</h3>' +
        '<p id="di-note"></p></div>' +
        '<div class="dash-chart" id="di-chart"></div>' +
        '</div>' +
        '<div id="di-table"></div>';
    },

    bind: function () { /* no controls */ },

    render: function (el, ctx) {
      const data = ctx.data;
      const fx = data.usdcad;
      const toCad = a => (a.currency === 'USD' ? a.amount * fx : a.amount);

      const divs = (data.activities || []).filter(a => a.type === 'Dividend');
      const asOf = new Date(data.meta.as_of + 'T00:00:00Z');
      const cut = new Date(asOf.getTime());
      cut.setUTCFullYear(cut.getUTCFullYear() - 1);
      const ttmFrom = cut.toISOString().slice(0, 10);
      const ttm = divs.filter(a => a.date >= ttmFrom).reduce((x, a) => x + toCad(a), 0);

      /* Forward run-rate: shares held now x the fund's published annual rate. */
      const held = {};
      ctx.positions.forEach(p => { held[p.symbol] = (held[p.symbol] || 0) + p.quantity; });
      const proj = (data.dividends_projected || [])
        .filter(d => held[d.symbol])
        .map(d => {
          const pos = ctx.positions.find(p => p.symbol === d.symbol);
          const annual = held[d.symbol] * d.annual_rate_per_share;
          const annualCad = pos && pos.currency === 'USD' ? annual * fx : annual;
          const value = ctx.positions.filter(p => p.symbol === d.symbol)
            .reduce((a, p) => a + p.mv_cad, 0);
          return {
            symbol: d.symbol,
            name: (pos && pos.name) || d.symbol,
            frequency: d.frequency,
            annual: annualCad,
            yield: value ? annualCad / value : 0
          };
        }).sort((a, b) => b.annual - a.annual);

      const forward = proj.reduce((a, r) => a + r.annual, 0);
      const portValue = ctx.positions.reduce((a, p) => a + p.mv_cad, 0);

      el.querySelector('#di-tiles').innerHTML =
        tile('Trailing 12-month income', fmt.money(ttm, ctx.fmtCtx, 0), 'received since ' + fmt.date(ttmFrom)) +
        tile('Projected annual income', fmt.money(forward, ctx.fmtCtx, 0), 'at current holdings and rates') +
        tile('Distribution yield', fmt.pct(portValue ? forward / portValue : 0, 2), 'projected income ÷ market value') +
        tile('Average per month', fmt.money(forward / 12, ctx.fmtCtx, 0), 'projected');

      /* Monthly received, with the projected run-rate overlaid as a reference. */
      const months = new Map();
      divs.forEach(a => {
        const k = a.date.slice(0, 7);
        months.set(k, (months.get(k) || 0) + toCad(a));
      });
      const keys = Array.from(months.keys()).sort().slice(-24);
      const rows = keys.map(k => ({
        label: k, short: k.slice(2).replace('-', '/'),
        value: months.get(k), overlay: forward / 12
      }));

      charts.columns(el.querySelector('#di-chart'), rows, {
        ctx: ctx.fmtCtx, height: 230,
        yFormat: v => fmt.moneyCompact(v, ctx.fmtCtx)
      });
      el.querySelector('#di-note').textContent = rows.length
        ? 'Bars are income actually received; the line marks the projected monthly run-rate.'
        : 'No distributions recorded yet.';

      T.render(el.querySelector('#di-table'), {
        title: 'PROJECTED BY HOLDING',
        columns: [
          { key: 'symbol', label: 'Symbol', cls: 'sym', format: r => fmt.esc(r.symbol) },
          { key: 'name', label: 'Name', format: r => fmt.esc(r.name) },
          { key: 'frequency', label: 'Frequency', format: r => '<span class="pill">' + fmt.esc(r.frequency) + '</span>' },
          { key: 'annual', label: 'Annual income', num: true, format: r => fmt.money(r.annual, ctx.fmtCtx, 0) },
          { key: 'yield', label: 'Yield', num: true, format: r => fmt.pct(r.yield, 2) }
        ],
        rows: proj,
        sort: ctx.state.sort.distributions,
        onSort: () => ctx.rerender(),
        rowKey: r => r.symbol,
        emptyText: 'No income-paying positions.',
        totals: rs => ({
          symbol: '<strong>Total</strong>',
          annual: fmt.money(rs.reduce((a, r) => a + r.annual, 0), ctx.fmtCtx, 0),
          yield: fmt.pct(portValue ? rs.reduce((a, r) => a + r.annual, 0) / portValue : 0, 2)
        })
      });
    }
  };
})();
