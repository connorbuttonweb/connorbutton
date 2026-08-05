/* ==========================================================
   DASHBOARD — ACCOUNTS · ACTIVITY · WATCHLIST · REBALANCING
   ========================================================== */
window.DASH = window.DASH || {};
DASH.tabs = DASH.tabs || {};

(function () {
  'use strict';

  const fmt = DASH.fmt;
  const charts = DASH.charts;
  const D = DASH.data;
  const T = DASH.table;

  const LS_ROOM = 'dash.contributionRoom';
  const LS_TARGETS = 'dash.targets';
  const LS_WATCH = 'dash.watchlistExtra';

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

  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ }
  }

  /* =====================================================================
     7. ACCOUNTS
     ===================================================================== */
  DASH.tabs.accounts = {
    id: 'accounts',
    label: 'Accounts',
    render: function (el, ctx) {
      const data = ctx.data;
      const s = ctx.state;

      buildOnce(el, '<div class="dash-stack">' +
        '<div class="doc-grid" id="ac-cards"></div>' +
        '<div id="ac-table"></div>' +
        '<p class="dash-stamp">Contribution room is entered by hand — Questrade doesn\'t expose it. ' +
        'Values are stored in this browser only.</p></div>');

      const room = load(LS_ROOM, {});
      const totalAll = data.totalValue;

      const stats = data.accounts.map(a => {
        const pos = data.positions.filter(p => p.account_id === a.id);
        const value = pos.reduce((x, p) => x + p.mv_cad, 0);
        const day = pos.reduce((x, p) => x + p.day_change_cad, 0);
        const pnl = pos.reduce((x, p) => x + p.pnl_cad, 0);
        const cost = pos.reduce((x, p) => x + p.cost_cad, 0);
        return {
          id: a.id, label: a.label, type: a.type, cash: a.cash,
          buying_power: a.buying_power, value: value, day: day, pnl: pnl, cost: cost,
          weight: totalAll ? value / totalAll : 0,
          room: room[a.id] !== undefined ? room[a.id] : a.contribution_room
        };
      });

      /* .card, not .doc-card — the latter is a horizontal icon+text row
         (display:flex), which would lay these blocks out side by side. */
      el.querySelector('#ac-cards').innerHTML = stats.map(a =>
        '<div class="card"><div class="card__body">' +
        '<div class="dash-head" style="margin-bottom:var(--space-8)">' +
        '<h2 style="font-size:var(--font-size-lg)">' + fmt.esc(a.label) + '</h2>' +
        '<span class="pill">' + fmt.esc(a.type) + '</span></div>' +
        '<div style="font-family:var(--font-family-mono);font-size:var(--font-size-2xl);font-weight:600">' +
        fmt.money(a.value, ctx.fmtCtx) + '</div>' +
        '<div style="margin:var(--space-8) 0">' + fmt.delta(a.day, ctx.fmtCtx) + ' today</div>' +
        '<dl style="display:grid;grid-template-columns:1fr auto;gap:2px var(--space-12);margin:var(--space-12) 0 0;font-size:var(--font-size-sm)">' +
        '<dt style="color:var(--color-text-secondary)">Cash</dt><dd style="margin:0;font-family:var(--font-family-mono);text-align:right">' + fmt.money(a.cash, ctx.fmtCtx) + '</dd>' +
        '<dt style="color:var(--color-text-secondary)">Buying power</dt><dd style="margin:0;font-family:var(--font-family-mono);text-align:right">' + fmt.money(a.buying_power, ctx.fmtCtx) + '</dd>' +
        '<dt style="color:var(--color-text-secondary)">Contribution room</dt>' +
        '<dd style="margin:0;text-align:right">' + (a.room === null
          ? '<span style="color:var(--color-text-secondary)">n/a</span>'
          : '<input class="form-control" data-room="' + fmt.esc(a.id) + '" type="number" step="100" value="' + a.room +
          '" style="width:110px;padding:2px 6px;text-align:right;font-family:var(--font-family-mono)">') + '</dd>' +
        '</dl>' +
        '<button class="btn btn--sm btn--outline mt-8" data-open="' + fmt.esc(a.id) + '" style="width:100%">' +
        'View in Overview <i class="fas fa-arrow-right" aria-hidden="true"></i></button>' +
        '</div></div>').join('');

      el.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => {
        s.accountId = b.dataset.open;
        ctx.syncGlobals();
        ctx.go('overview');
      }));
      el.querySelectorAll('[data-room]').forEach(inp => {
        inp.addEventListener('click', ev => ev.stopPropagation());
        inp.addEventListener('change', () => {
          const r = load(LS_ROOM, {});
          r[inp.dataset.room] = parseFloat(inp.value) || 0;
          save(LS_ROOM, r);
        });
      });

      T.render(el.querySelector('#ac-table'), {
        title: 'ALL ACCOUNTS SIDE BY SIDE',
        columns: [
          { key: 'label', label: 'Account' },
          { key: 'type', label: 'Type', format: r => '<span class="pill">' + fmt.esc(r.type) + '</span>' },
          { key: 'value', label: 'Value', num: true, format: r => fmt.money(r.value, ctx.fmtCtx) },
          { key: 'weight', label: 'Weight', num: true, format: r => fmt.pct(r.weight, 2) },
          { key: 'day', label: 'Today', num: true, format: r => fmt.delta(r.day, ctx.fmtCtx) },
          { key: 'pnl', label: 'Unrealized', num: true, format: r => fmt.delta(r.pnl, ctx.fmtCtx, r.cost ? r.pnl / r.cost : null) },
          { key: 'cash', label: 'Cash', num: true, format: r => fmt.money(r.cash, ctx.fmtCtx) }
        ],
        rows: stats,
        sort: s.sort.accounts,
        onSort: () => ctx.rerender(),
        rowKey: r => r.id,
        totals: rs => ({
          label: '<strong>Total</strong>',
          value: fmt.money(rs.reduce((a, r) => a + r.value, 0), ctx.fmtCtx),
          weight: fmt.pct(rs.reduce((a, r) => a + r.weight, 0), 2),
          day: fmt.delta(rs.reduce((a, r) => a + r.day, 0), ctx.fmtCtx),
          pnl: fmt.delta(rs.reduce((a, r) => a + r.pnl, 0), ctx.fmtCtx),
          cash: fmt.money(rs.reduce((a, r) => a + r.cash, 0), ctx.fmtCtx)
        })
      });
    }
  };

  /* =====================================================================
     8. ACTIVITY
     ===================================================================== */
  const PAGE = 50;

  DASH.tabs.activity = {
    id: 'activity',
    label: 'Activity',
    render: function (el, ctx) {
      const s = ctx.state;
      const data = ctx.data;
      const f = s.filters;

      if (buildOnce(el, '<div class="dash-stack"><div class="project-card">' +
        '<div class="dash-bar">' +
        '<input class="form-control" id="av-search" type="search" placeholder="Search symbol or description…" aria-label="Search activity" style="max-width:280px">' +
        '<select class="form-control" id="av-type" aria-label="Filter by activity type"></select>' +
        '<select class="form-control" id="av-range" aria-label="Filter by date range">' +
        '<option value="12">Last 12 months</option><option value="24">Last 24 months</option>' +
        '<option value="ytd">Year to date</option><option value="all">All history</option></select>' +
        '<button class="btn btn--sm btn--outline" id="av-clear">Clear</button>' +
        '</div><div id="av-table"></div>' +
        '<div style="text-align:center;margin-top:var(--space-16)"><button class="btn btn--outline" id="av-more">Show more</button></div>' +
        '</div></div>')) {
        const types = Array.from(new Set(data.activities.map(a => a.type))).sort();
        el.querySelector('#av-type').innerHTML = '<option value="">All types</option>' +
          types.map(t => '<option value="' + fmt.esc(t) + '">' + fmt.esc(t) + '</option>').join('');

        el.querySelector('#av-search').addEventListener('input', e => { f.activitySearch = e.target.value; s.activityPage = 1; paint(); });
        el.querySelector('#av-type').addEventListener('change', e => { f.activityType = e.target.value; s.activityPage = 1; paint(); });
        el.querySelector('#av-range').addEventListener('change', e => { f.activityRange = e.target.value; s.activityPage = 1; paint(); });
        el.querySelector('#av-clear').addEventListener('click', () => {
          f.activitySearch = ''; f.activityType = ''; f.activityRange = '12'; s.activityPage = 1;
          el.querySelector('#av-search').value = '';
          el.querySelector('#av-type').value = '';
          el.querySelector('#av-range').value = '12';
          paint();
        });
        el.querySelector('#av-more').addEventListener('click', () => { s.activityPage++; paint(); });
      }

      el.querySelector('#av-range').value = f.activityRange || '12';

      function paint() {
        const q = (f.activitySearch || '').trim().toLowerCase();
        const range = f.activityRange || '12';
        let cut = null;
        if (range === 'ytd') cut = data.meta.as_of.slice(0, 4) + '-01-01';
        else if (range !== 'all') {
          const d = new Date(data.meta.as_of + 'T00:00:00Z');
          d.setUTCMonth(d.getUTCMonth() - parseInt(range, 10));
          cut = d.toISOString().slice(0, 10);
        }

        const all = data.activities.filter(a =>
          (s.accountId === 'all' || a.account_id === s.accountId) &&
          (!f.activityType || a.type === f.activityType) &&
          (!cut || a.date >= cut) &&
          (!q || (a.symbol || '').toLowerCase().indexOf(q) >= 0 || (a.description || '').toLowerCase().indexOf(q) >= 0)
        );
        const shown = all.slice(0, (s.activityPage || 1) * PAGE);

        T.render(el.querySelector('#av-table'), {
          title: 'ACTIVITY — SHOWING ' + shown.length + ' OF ' + all.length,
          columns: [
            { key: 'date', label: 'Date', format: r => fmt.date(r.date) },
            { key: 'type', label: 'Type', format: r => '<span class="pill">' + fmt.esc(r.type) + '</span>' },
            { key: 'symbol', label: 'Symbol', cls: 'sym', format: r => fmt.esc(r.symbol || '—') },
            { key: 'account_id', label: 'Account', format: r => fmt.esc((data.accountsById[r.account_id] || {}).label || r.account_id) },
            { key: 'description', label: 'Description', format: r => fmt.esc(r.description) },
            {
              key: 'amount', label: 'Amount', num: true,
              sortValue: r => (r.currency === 'USD' ? r.amount * data.usdcad : r.amount),
              format: r => {
                const v = r.currency === 'USD' ? r.amount * data.usdcad : r.amount;
                return '<span class="' + fmt.cls(v) + '">' + fmt.money(v, ctx.fmtCtx) + '</span>';
              }
            }
          ],
          rows: shown,
          sort: s.sort.activity,
          onSort: () => paint(),
          rowKey: r => r.date + '|' + r.type + '|' + (r.symbol || '') + '|' + r.account_id + '|' + r.amount,
          onRowClick: r => {
            if (!r.symbol) return;
            const p = data.positions.find(x => x.symbol === r.symbol);
            if (p) ctx.openDetail(p);
          },
          emptyText: 'No activity matches these filters.'
        });

        const more = el.querySelector('#av-more');
        more.style.display = shown.length < all.length ? '' : 'none';
        more.textContent = 'Show ' + Math.min(PAGE, all.length - shown.length) + ' more';
      }
      paint();
    }
  };

  /* =====================================================================
     9. WATCHLIST
     ===================================================================== */
  DASH.tabs.watchlist = {
    id: 'watchlist',
    label: 'Watchlist',
    render: function (el, ctx) {
      const s = ctx.state;
      const data = ctx.data;

      if (buildOnce(el, '<div class="dash-stack">' +
        '<div class="project-card">' +
        '<div class="dash-bar">' +
        '<input class="form-control" id="wl-search" type="search" placeholder="Filter watchlist…" aria-label="Filter watchlist" style="max-width:240px">' +
        '<span class="dash-bar__spacer"></span>' +
        '<input class="form-control" id="wl-add" type="text" placeholder="Add symbol (e.g. BCE.TO)" aria-label="Add symbol" style="max-width:200px">' +
        '<button class="btn btn--sm btn--primary" id="wl-add-btn">Add</button>' +
        '</div><div id="wl-table"></div></div>' +
        '<div id="wl-preview"></div>' +
        '</div>')) {
        el.querySelector('#wl-search').addEventListener('input', e => { s.filters.watchSearch = e.target.value; paint(); });
        el.querySelector('#wl-add-btn').addEventListener('click', addSymbol);
        el.querySelector('#wl-add').addEventListener('keydown', e => { if (e.key === 'Enter') addSymbol(); });
      }

      function extras() { return load(LS_WATCH, []); }

      function addSymbol() {
        const inp = el.querySelector('#wl-add');
        const sym = (inp.value || '').trim().toUpperCase();
        if (!sym) return;
        const list = extras();
        if (!list.some(x => x.symbol === sym) && !data.watchlist.some(x => x.symbol === sym)) {
          list.push({ symbol: sym, name: sym, price: null, prev_close: null, spark: [] });
          save(LS_WATCH, list);
        }
        inp.value = '';
        paint();
      }

      /* Constituent metadata is the only place sector/geography for a
         not-yet-owned symbol can come from, so reuse it for the preview. */
      function metaFor(symbol) {
        for (const sym in data.etfs) {
          const h = data.etfs[sym].holdings.find(x => x.ticker === symbol);
          if (h) return h;
        }
        const p = data.positions.find(x => x.symbol === symbol);
        return p || null;
      }

      function paint() {
        const q = (s.filters.watchSearch || '').trim().toLowerCase();
        const rows = data.watchlist.concat(extras())
          .filter(w => !q || w.symbol.toLowerCase().indexOf(q) >= 0 || (w.name || '').toLowerCase().indexOf(q) >= 0)
          .map(w => Object.assign({}, w, {
            change: w.price !== null && w.prev_close ? w.price - w.prev_close : null,
            pct: w.price !== null && w.prev_close ? w.price / w.prev_close - 1 : null,
            isExtra: extras().some(x => x.symbol === w.symbol)
          }));

        T.render(el.querySelector('#wl-table'), {
          title: 'WATCHLIST — ' + rows.length,
          columns: [
            { key: 'symbol', label: 'Symbol', cls: 'sym', format: r => fmt.esc(r.symbol) },
            { key: 'name', label: 'Name', format: r => fmt.esc(r.name) },
            { key: 'price', label: 'Price', num: true, format: r => r.price === null ? '<span style="color:var(--color-text-secondary)">no quote</span>' : fmt.money(r.price, ctx.fmtCtx) },
            { key: 'pct', label: 'Today', num: true, format: r => r.pct === null ? '—' : fmt.deltaPct(r.pct) },
            { key: 'spark', label: '30 days', sortValue: r => r.pct, format: r => charts.sparkline(r.spark) },
            {
              key: 'actions', label: '', sortValue: () => 0, format: r =>
                '<div class="dash-badge-row" style="justify-content:flex-end">' +
                '<button class="btn btn--sm btn--outline" data-preview="' + fmt.esc(r.symbol) + '">Preview add</button>' +
                (r.isExtra ? '<button class="btn btn--sm btn--outline" data-remove="' + fmt.esc(r.symbol) + '" aria-label="Remove ' + fmt.esc(r.symbol) + '"><i class="fas fa-xmark"></i></button>' : '') +
                '</div>'
            }
          ],
          rows: rows,
          sort: s.sort.watchlist,
          onSort: () => paint(),
          rowKey: r => r.symbol,
          emptyText: 'Nothing on the watchlist yet.'
        });

        el.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', ev => {
          ev.stopPropagation();
          save(LS_WATCH, extras().filter(x => x.symbol !== b.dataset.remove));
          if (s.previewPosition && s.previewPosition.symbol === b.dataset.remove) s.previewPosition = null;
          paint();
        }));
        el.querySelectorAll('[data-preview]').forEach(b => b.addEventListener('click', ev => {
          ev.stopPropagation();
          openPreview(b.dataset.preview);
        }));

        paintPreview();
      }

      function openPreview(symbol) {
        const amount = parseFloat(window.prompt(
          'Preview adding ' + symbol + '.\n\nHow much would you put in? (CAD)\n' +
          'Nothing is bought — this only recalculates the exposure charts.', '5000'));
        if (!amount || amount <= 0) return;
        const meta = metaFor(symbol) || {};
        s.previewPosition = {
          symbol: symbol,
          name: meta.name || symbol,
          account_id: null, account: 'Preview',
          asset_type: 'Stock', currency: meta.currency || 'CAD',
          quantity: 0, avg_cost: 0, price: 0, prev_close: 0,
          market_value: amount, mv_cad: amount, cost_cad: amount, pnl_cad: 0,
          day_change_cad: 0, day_pct: 0, pnl_pct: 0,
          sector: meta.sector || 'Unclassified',
          geography: meta.geography || 'Unclassified',
          market_cap_bucket: meta.market_cap_bucket || 'Unclassified'
        };
        ctx.rerender();
      }

      function paintPreview() {
        const mount = el.querySelector('#wl-preview');
        const pv = s.previewPosition;
        if (!pv) { mount.innerHTML = ''; return; }

        const before = D.buildLookThrough(ctx.positions, data.etfs, { excludedEtfs: s.excludedEtfs });
        const after = D.buildLookThrough(ctx.positions, data.etfs, { excludedEtfs: s.excludedEtfs, extraPositions: [pv] });

        const bSec = new Map(D.rollup(before.rows, 'sector').map(r => [r.key, r.weight]));
        const aSec = D.rollup(after.rows, 'sector');
        const moves = aSec.map(r => ({
          key: r.key, label: r.key,
          before: bSec.get(r.key) || 0, after: r.weight, delta: r.weight - (bSec.get(r.key) || 0)
        })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 6);

        const newFlags = after.rows.filter(r => r.flag && !(before.byKey.get(r.key) || {}).flag);

        mount.innerHTML = '<div class="project-card">' +
          '<div class="dash-head"><h2>Preview: adding ' + fmt.money(pv.market_value, ctx.fmtCtx, 0) + ' of ' + fmt.esc(pv.symbol) + '</h2>' +
          '<button class="btn btn--sm btn--outline" id="wl-clear">Clear preview</button></div>' +
          '<p class="status status--info" style="display:block;margin-bottom:var(--space-16)">' +
          '<i class="fas fa-flask" aria-hidden="true"></i> Hypothetical only — nothing has been bought and no order exists.</p>' +
          '<div class="splits">' +
          stackedTile('Portfolio after', fmt.money(after.total, ctx.fmtCtx, 0), 'from ' + fmt.money(before.total, ctx.fmtCtx, 0)) +
          stackedTile('New position weight', fmt.pct(after.total ? pv.market_value / after.total : 0, 2), fmt.esc(pv.sector)) +
          stackedTile('New concentration flags', newFlags.length ? '<span class="down">' + newFlags.length + '</span>' : '0',
            newFlags.length ? newFlags.map(f => f.ticker).join(', ') : 'none triggered') +
          '</div>' +
          '<div id="wl-moves" style="margin-top:var(--space-16)"></div></div>';

        T.render(mount.querySelector('#wl-moves'), {
          title: 'SECTOR SHIFT',
          columns: [
            { key: 'label', label: 'Sector' },
            { key: 'before', label: 'Before', num: true, format: r => fmt.pct(r.before, 2) },
            { key: 'after', label: 'After', num: true, format: r => fmt.pct(r.after, 2) },
            {
              key: 'delta', label: 'Change', num: true,
              format: r => '<span class="' + fmt.cls(r.delta) + '">' + (r.delta >= 0 ? '+' : '') + (r.delta * 100).toFixed(2) + ' pts</span>'
            }
          ],
          rows: moves,
          sort: { key: 'delta', dir: 'desc' },
          rowKey: r => r.key
        });
        mount.querySelector('#wl-clear').addEventListener('click', () => {
          s.previewPosition = null;
          ctx.rerender();
        });
      }

      paint();
    }
  };

  /* =====================================================================
     10. REBALANCING
     ===================================================================== */
  const REBAL_DIMS = [
    { key: 'asset_class', label: 'Asset Class' },
    { key: 'sector', label: 'Sector' },
    { key: 'symbol', label: 'Holding' }
  ];

  DASH.tabs.rebalancing = {
    id: 'rebalancing',
    label: 'Rebalancing',
    render: function (el, ctx) {
      const s = ctx.state;
      const data = ctx.data;

      if (buildOnce(el, '<div class="dash-stack"><div class="project-card">' +
        '<div class="dash-head"><h2>Current vs target</h2>' +
        '<div class="dash-badge-row" id="rb-dims"></div></div>' +
        '<div class="dash-chart" id="rb-chart"></div>' +
        '<ul class="dash-legend" id="rb-legend"></ul>' +
        '</div>' +
        '<div id="rb-table"></div>' +
        '<div class="dash-bar">' +
        '<span id="rb-sum" class="status"></span>' +
        '<span class="dash-bar__spacer"></span>' +
        '<label style="font-size:var(--font-size-sm);display:flex;align-items:center;gap:8px">Alert above drift ' +
        '<input class="form-control" id="rb-threshold" type="number" min="1" max="50" step="1" style="width:78px;padding:2px 6px"> pts</label>' +
        '<button class="btn btn--sm btn--outline" id="rb-reset">Reset to saved</button>' +
        '<button class="btn btn--sm btn--primary" id="rb-save">Save targets</button>' +
        '</div></div>')) {
        el.querySelector('#rb-dims').addEventListener('click', ev => {
          const b = ev.target.closest('[data-dim]');
          if (b) { s.targets.dimension = b.dataset.dim; ctx.rerender(); }
        });
        el.querySelector('#rb-save').addEventListener('click', () => {
          save(LS_TARGETS, s.targets);
          flash('Targets saved to this browser.', 'success');
        });
        el.querySelector('#rb-reset').addEventListener('click', () => {
          const stored = load(LS_TARGETS, null);
          s.targets = stored ? JSON.parse(JSON.stringify(stored)) : JSON.parse(JSON.stringify(data.targets));
          ctx.rerender();
        });
        el.querySelector('#rb-threshold').addEventListener('change', e => {
          s.targets.drift_threshold = Math.max(0.01, (parseFloat(e.target.value) || 5) / 100);
          ctx.rerender();
        });
      }

      function flash(msg, kind) {
        const n = el.querySelector('#rb-sum');
        const prev = n.className, prevText = n.innerHTML;
        n.className = 'status status--' + kind;
        n.innerHTML = msg;
        setTimeout(() => { n.className = prev; n.innerHTML = prevText; }, 2200);
      }

      const dim = REBAL_DIMS.find(d => d.key === s.targets.dimension) || REBAL_DIMS[0];
      el.querySelector('#rb-dims').innerHTML =
        '<span class="status-badge">Group by</span>' + toggleButtons('dim', REBAL_DIMS, dim.key);
      el.querySelector('#rb-threshold').value = Math.round(s.targets.drift_threshold * 100);

      const current = dim.key === 'sector'
        ? D.rollup(ctx.lookThrough.rows, 'sector')
        : D.rollupPositions(ctx.positions, dim.key);

      if (!s.targets.values) s.targets.values = {};
      const store = s.targets.values;
      const keys = Array.from(new Set(current.map(c => c.key).concat(Object.keys(store))));
      const rows = keys.map(k => {
        const cur = current.find(c => c.key === k);
        return {
          key: k, label: k,
          current: cur ? cur.weight : 0,
          value: cur ? cur.value : 0,
          target: store[k] !== undefined ? store[k] : 0
        };
      }).sort((a, b) => b.current - a.current);
      rows.forEach(r => { r.drift = r.current - r.target; });

      charts.groupedBars(el.querySelector('#rb-chart'), rows, { threshold: s.targets.drift_threshold });
      charts.legend(el.querySelector('#rb-legend'), [
        { key: 'cur', label: 'Current', color: charts.cssVar('--series-1', '#2a78d6'), value: 0 },
        { key: 'tgt', label: 'Target', color: charts.cssVar('--color-border', '#ccc'), value: 0 }
      ], {});
      el.querySelectorAll('#rb-legend button').forEach(b => {
        b.disabled = true; b.style.cursor = 'default';
        b.querySelector('.val').textContent = '';
      });

      const sum = rows.reduce((a, r) => a + r.target, 0);
      const sumNode = el.querySelector('#rb-sum');
      const off = Math.abs(sum - 1) > 0.0005;
      sumNode.className = 'status status--' + (off ? 'warning' : 'success');
      sumNode.innerHTML = '<i class="fas fa-' + (off ? 'triangle-exclamation' : 'check') + '" aria-hidden="true"></i>&nbsp;' +
        'Targets total ' + fmt.pct(sum, 1) + (off ? ' — should be 100%' : '');

      T.render(el.querySelector('#rb-table'), {
        title: 'DRIFT BY ' + dim.label.toUpperCase(),
        columns: [
          { key: 'label', label: dim.label },
          { key: 'value', label: 'Value', num: true, format: r => fmt.money(r.value, ctx.fmtCtx, 0) },
          { key: 'current', label: 'Current', num: true, format: r => fmt.pct(r.current, 2) },
          {
            key: 'target', label: 'Target', num: true,
            format: r => '<input class="form-control" data-target="' + fmt.esc(r.key) + '" type="number" min="0" max="100" step="0.5" ' +
              'value="' + (r.target * 100).toFixed(1) + '" style="width:82px;padding:2px 6px;text-align:right;font-family:var(--font-family-mono)">'
          },
          {
            key: 'drift', label: 'Drift', num: true,
            format: r => {
              const over = Math.abs(r.drift) >= s.targets.drift_threshold;
              return '<span class="status status--' + (over ? 'error' : 'info') + '" style="font-size:var(--font-size-xs)">' +
                (r.drift >= 0 ? '+' : '') + (r.drift * 100).toFixed(1) + ' pts</span>';
            }
          }
        ],
        rows: rows,
        sort: s.sort.rebalancing,
        onSort: () => ctx.rerender(),
        rowKey: r => r.key,
        totals: rs => ({
          label: '<strong>Total</strong>',
          value: fmt.money(rs.reduce((a, r) => a + r.value, 0), ctx.fmtCtx, 0),
          current: fmt.pct(rs.reduce((a, r) => a + r.current, 0), 1),
          target: fmt.pct(rs.reduce((a, r) => a + r.target, 0), 1)
        })
      });

      el.querySelectorAll('[data-target]').forEach(inp => {
        inp.addEventListener('click', ev => ev.stopPropagation());
        inp.addEventListener('change', () => {
          store[inp.dataset.target] = (parseFloat(inp.value) || 0) / 100;
          ctx.rerender();
        });
      });
    }
  };

  /* Shared with main.js so the drift alert can surface outside this tab. */
  DASH.rebalancing = {
    LS_TARGETS: LS_TARGETS,
    loadTargets: fallback => load(LS_TARGETS, fallback),
    worstDrift: function (state, ctx) {
      const dim = state.targets.dimension || 'asset_class';
      const current = dim === 'sector'
        ? D.rollup(ctx.lookThrough.rows, 'sector')
        : D.rollupPositions(ctx.positions, dim);
      const store = state.targets.values || {};
      let worst = null;
      Object.keys(store).forEach(k => {
        const cur = current.find(c => c.key === k);
        const drift = (cur ? cur.weight : 0) - store[k];
        if (!worst || Math.abs(drift) > Math.abs(worst.drift)) worst = { key: k, drift: drift };
      });
      return worst;
    }
  };
})();
