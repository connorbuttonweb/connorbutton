/* ==========================================================
   DASHBOARD — BOOTSTRAP
   State, hash routing, tab switching, the global controls, and
   the shared position detail panel.
   ========================================================== */
(function () {
  'use strict';

  const fmt = DASH.fmt;
  const D = DASH.data;
  const M = DASH.metrics;
  const charts = DASH.charts;

  const TAB_ORDER = [
    'profile', 'overview', 'holdings', 'factsheet', 'performance',
    'income', 'accounts', 'activity', 'watchlist', 'rebalancing'
  ];

  const state = {
    tab: 'profile',
    accountId: 'all',
    currency: 'CAD',
    groupBy: { overview: 'symbol', factsheet: 'ticker' },
    factsheetShape: 'donut',
    sort: {
      holdings: { key: 'mv_cad', dir: 'desc' },
      factsheet: { key: 'weight', dir: 'desc' },
      income: { key: 'annual', dir: 'desc' },
      incomeHistory: { key: 'date', dir: 'desc' },
      activity: { key: 'date', dir: 'desc' },
      watchlist: { key: 'symbol', dir: 'asc' },
      accounts: { key: 'value', dir: 'desc' },
      rebalancing: { key: 'current', dir: 'desc' },
      returns: { key: null, dir: 'asc' }
    },
    filters: {
      search: '', assetType: '', currency: '', sector: '',
      fsSearch: '', watchSearch: '',
      activitySearch: '', activityType: '', activityRange: '12',
      incomeRange: '12'
    },
    columns: new Set(['account', 'asset_type']),
    expanded: { holdings: new Set(), factsheet: new Set() },
    hiddenSlices: { overview: new Set(), factsheet: new Set() },
    excludedEtfs: new Set(),
    selectedSlice: null,
    groupEtfs: true,
    highlight: null,
    previewPosition: null,
    returnMode: 'twr',
    showBenchmark: true,
    incomeView: 'received',
    range: 'All',
    activityPage: 1,
    targets: null
  };

  let data = null;
  let twr = null;
  let benchmark = null;

  const panels = document.getElementById('dash-panels');
  const tabsEl = document.getElementById('dash-tabs');
  const stampEl = document.getElementById('dash-stamp');
  const accountEl = document.getElementById('dash-account');

  /* ---------- market hours, reused from the ticker's convention ---------- */
  function isMarketOpen() {
    const now = new Date();
    const t = new Date(now.toLocaleString('en-US', { timeZone: 'America/Toronto' }));
    const day = t.getDay();
    const mins = t.getHours() * 60 + t.getMinutes();
    return day >= 1 && day <= 5 && mins >= 570 && mins < 960;
  }

  /* ---------- context handed to every tab ---------- */
  function buildContext() {
    const positions = D.scope(data, state.accountId);
    const extras = state.previewPosition ? [state.previewPosition] : [];
    const lookThrough = D.buildLookThrough(positions, data.etfs, {
      excludedEtfs: state.excludedEtfs,
      extraPositions: extras
    });
    const acct = data.accountsById[state.accountId];
    return {
      data: data,
      state: state,
      fmtCtx: { currency: state.currency, usdcad: data.usdcad },
      positions: positions,
      lookThrough: lookThrough,
      twr: twr,
      benchmark: benchmark,
      scopeLabel: state.accountId === 'all' ? 'All accounts' : (acct ? acct.label : state.accountId),
      rerender: render,
      go: go,
      openDetail: openDetail,
      syncGlobals: syncGlobals
    };
  }

  /* ---------- rendering ---------- */
  function panelFor(id) {
    let el = document.getElementById('panel-' + id);
    if (!el) {
      el = document.createElement('div');
      el.id = 'panel-' + id;
      el.setAttribute('role', 'tabpanel');
      panels.appendChild(el);
    }
    return el;
  }

  function render() {
    if (!data) return;
    const ctx = buildContext();

    TAB_ORDER.forEach(id => {
      const el = document.getElementById('panel-' + id);
      if (el && id !== state.tab) el.classList.add('hidden');
    });

    const el = panelFor(state.tab);
    el.classList.remove('hidden');
    const tab = DASH.tabs[state.tab];
    try {
      tab.render(el, ctx);
    } catch (err) {
      console.error('Dashboard: failed to render the ' + state.tab + ' tab', err);
      el.dataset.built = '';
      el.innerHTML = '<div class="dash-error"><strong>This tab failed to render.</strong><br>' +
        fmt.esc(err.message) + '</div>';
    }

    paintTabs(ctx);
    paintDrift(ctx);
  }

  function paintTabs(ctx) {
    tabsEl.innerHTML = TAB_ORDER.map(id => {
      const t = DASH.tabs[id];
      return '<li role="presentation"><a class="nav-link' + (id === state.tab ? ' active' : '') +
        '" href="#' + id + '" role="tab" aria-selected="' + (id === state.tab) + '">' +
        fmt.esc(t.label) + '</a></li>';
    }).join('');
  }

  /* Drift alert lives on the Overview tab, per the spec, and jumps to
     Rebalancing when clicked. */
  function paintDrift(ctx) {
    if (state.tab !== 'overview') return;
    const el = document.getElementById('panel-overview');
    const worst = DASH.rebalancing.worstDrift(state, ctx);
    let slot = el.querySelector('#ov-alert');
    if (!worst || Math.abs(worst.drift) < state.targets.drift_threshold) {
      if (slot) slot.remove();
      return;
    }
    if (!slot) {
      slot = document.createElement('div');
      slot.id = 'ov-alert';
      const stack = el.querySelector('.dash-stack');
      stack.insertBefore(slot, stack.firstChild);
    }
    slot.innerHTML = '<button class="status status--warning" style="width:100%;justify-content:flex-start;cursor:pointer;border-width:1px">' +
      '<i class="fas fa-scale-unbalanced" aria-hidden="true"></i>&nbsp; ' +
      '<strong>' + fmt.esc(worst.key) + '</strong>&nbsp;has drifted ' +
      (worst.drift >= 0 ? '+' : '') + (worst.drift * 100).toFixed(1) + ' pts from target — open Rebalancing' +
      '</button>';
    slot.querySelector('button').addEventListener('click', () => go('rebalancing'));
  }

  /* ---------- navigation ---------- */
  function go(tabId, opts) {
    if (!DASH.tabs[tabId]) return;
    if (opts && opts.highlight) state.highlight = opts.highlight;
    state.tab = tabId;
    if (location.hash.slice(1) !== tabId) location.hash = tabId;
    else render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function readHash() {
    const h = location.hash.replace('#', '');
    if (DASH.tabs[h]) state.tab = h;
  }

  /* ---------- position detail panel ----------
     Reuses the site lightbox shell, the same way /website/ reuses it to show
     source code: fill #lbContent and toggle .is-open. */
  function openDetail(p) {
    const lb = document.getElementById('lightbox');
    const content = document.getElementById('lbContent');
    const caption = document.getElementById('lbCaption');
    if (!lb || !content) return;

    const ctx = { currency: state.currency, usdcad: data.usdcad };
    const series = data.prices[p.symbol];
    const spec = data.etfs[p.symbol];
    const recent = data.activities
      .filter(a => a.symbol === p.symbol && (state.accountId === 'all' || a.account_id === state.accountId))
      .slice(0, 6);

    content.innerHTML =
      '<h3>' + fmt.esc(p.symbol) + ' <span style="font-weight:400;color:var(--color-text-secondary);font-size:var(--font-size-lg)">' +
      fmt.esc(p.name) + '</span></h3>' +
      '<div class="dash-badge-row" style="margin-bottom:var(--space-16)">' +
      '<span class="pill">' + fmt.esc(p.account) + '</span>' +
      '<span class="pill">' + fmt.esc(p.asset_type) + '</span>' +
      '<span class="pill">' + fmt.esc(p.currency) + '</span>' +
      '</div>' +
      (series ? '<div class="dash-chart" id="lb-chart"></div>' : '') +
      '<div class="splits" style="margin:var(--space-16) 0">' +
      ['Quantity|' + fmt.num(p.quantity, p.quantity % 1 ? 2 : 0),
      'Average cost|' + fmt.money(p.currency === 'USD' ? p.avg_cost * data.usdcad : p.avg_cost, ctx),
      'Last price|' + fmt.money(p.currency === 'USD' ? p.price * data.usdcad : p.price, ctx),
      'Market value|' + fmt.money(p.mv_cad, ctx),
      'Unrealized|' + fmt.delta(p.pnl_cad, ctx, p.pnl_pct),
      'Today|' + fmt.delta(p.day_change_cad, ctx, p.day_pct),
      'Portfolio weight|' + fmt.pct(p.weight, 2),
      'Book cost|' + fmt.money(p.cost_cad, ctx)
      ].map(s => {
        const [l, v] = s.split('|');
        return '<div class="is-stacked"><span class="label">' + l + '</span><span class="time">' + v + '</span></div>';
      }).join('') +
      '</div>' +
      (spec ? '<h4 style="margin:var(--space-16) 0 var(--space-8)">Top holdings inside ' + fmt.esc(p.symbol) + '</h4>' +
        '<div class="folder"><table><tbody>' +
        spec.holdings.slice(0, 8).map(h =>
          '<tr><td class="sym">' + fmt.esc(h.ticker) + '</td><td>' + fmt.esc(h.name) + '</td>' +
          '<td class="num">' + fmt.pct(h.weight, 2) + '</td>' +
          '<td class="num">' + fmt.money(p.mv_cad * h.weight, ctx) + '</td></tr>').join('') +
        '</tbody></table></div>' +
        '<p class="dash-stamp" style="margin-top:var(--space-8)">Holdings as at ' + fmt.date(spec.as_of) +
        ' · ' + fmt.pct(spec.coverage, 1) + ' matched</p>' : '') +
      (recent.length ? '<h4 style="margin:var(--space-16) 0 var(--space-8)">Recent activity</h4>' +
        '<div class="folder"><table><tbody>' + recent.map(a =>
          '<tr><td>' + fmt.date(a.date) + '</td><td><span class="pill">' + fmt.esc(a.type) + '</span></td>' +
          '<td>' + fmt.esc(a.description) + '</td>' +
          '<td class="num">' + fmt.money(a.currency === 'USD' ? a.amount * data.usdcad : a.amount, ctx) + '</td></tr>').join('') +
        '</tbody></table></div>' : '');

    if (series) {
      charts.line(content.querySelector('#lb-chart'),
        [{ label: p.symbol, color: charts.cssVar('--series-1', '#2a78d6'), points: series.map(x => ({ date: x.date, value: x.close })) }],
        {
          height: 200, title: p.symbol + ' price',
          yFormat: v => fmt.num(v, 2),
          tipFormat: v => fmt.num(v, 2) + ' ' + p.currency
        });
    }

    caption.textContent = p.symbol + ' — last 90 trading days';
    lb.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    content.focus();
  }

  function closeDetail() {
    const lb = document.getElementById('lightbox');
    if (!lb) return;
    lb.classList.remove('is-open');
    document.body.style.overflow = '';
    document.getElementById('lbContent').innerHTML = '';
    charts.hideTip();
  }

  /* ---------- global controls ---------- */
  function syncGlobals() {
    accountEl.value = state.accountId;
    document.getElementById('dash-ccy-cad').className = 'btn btn--sm ' + (state.currency === 'CAD' ? 'btn--primary' : 'btn--outline');
    document.getElementById('dash-ccy-usd').className = 'btn btn--sm ' + (state.currency === 'USD' ? 'btn--primary' : 'btn--outline');
  }

  function stamp() {
    const open = isMarketOpen();
    stampEl.innerHTML =
      'Data as at ' + fmt.date(data.meta.as_of) +
      ' · loaded ' + new Date().toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' }) +
      ' · <span class="' + (open ? 'up' : 'flat') + '">' + (open ? 'market open' : 'market closed') + '</span>' +
      (data.meta.source === 'mock' ? ' · <span class="status status--info" style="font-size:var(--font-size-xs);padding:1px 8px">sample data</span>' : '');
  }

  function wireControls() {
    accountEl.addEventListener('change', () => {
      state.accountId = accountEl.value;
      state.selectedSlice = null;
      render();
    });
    document.querySelectorAll('[data-ccy]').forEach(b => {
      b.addEventListener('click', () => {
        state.currency = b.dataset.ccy;
        syncGlobals();
        render();
      });
    });
    document.getElementById('dash-refresh').addEventListener('click', boot);

    window.addEventListener('hashchange', () => { readHash(); render(); });

    /* Detail panel close: click the backdrop, the × , or press Escape. */
    const lb = document.getElementById('lightbox');
    document.getElementById('lbClose').addEventListener('click', closeDetail);
    lb.addEventListener('click', ev => { if (ev.target === lb) closeDetail(); });
    document.addEventListener('keydown', ev => {
      if (ev.key === 'Escape' && lb.classList.contains('is-open')) closeDetail();
    });
  }

  /* ---------- boot ---------- */
  async function boot() {
    const btn = document.getElementById('dash-refresh');
    btn.disabled = true;
    stampEl.textContent = 'Refreshing…';
    try {
      data = await D.fetchPortfolio();
      twr = M.twrIndex(data.history.portfolio);
      benchmark = M.normalizeLevels(data.history.benchmarks.SPX);

      if (!state.targets) {
        const stored = DASH.rebalancing.loadTargets(null);
        state.targets = stored || JSON.parse(JSON.stringify(data.targets));
      }

      accountEl.innerHTML = '<option value="all">All Accounts</option>' +
        data.accounts.map(a => '<option value="' + fmt.esc(a.id) + '">' + fmt.esc(a.label) + '</option>').join('');
      if (!data.accountsById[state.accountId]) state.accountId = 'all';

      const bootMsg = document.getElementById('dash-boot');
      if (bootMsg) bootMsg.remove();
      // Force a shell rebuild so refreshed data can't be painted into stale markup.
      TAB_ORDER.forEach(id => {
        const el = document.getElementById('panel-' + id);
        if (el) el.dataset.built = '';
      });

      syncGlobals();
      stamp();
      render();
    } catch (err) {
      console.error('Dashboard: could not load portfolio data', err);
      stampEl.textContent = 'Load failed';
      panels.innerHTML = '<div class="dash-error"><strong>Couldn\'t load the portfolio data.</strong><br>' +
        fmt.esc(err.message) + '<br><span class="dash-stamp">Expected at ' + D.SOURCE +
        '. If you opened this file directly from disk, serve it over HTTP instead — ' +
        'browsers block fetch() on file:// URLs.</span></div>';
    } finally {
      btn.disabled = false;
    }
  }

  readHash();
  wireControls();
  boot();
})();
