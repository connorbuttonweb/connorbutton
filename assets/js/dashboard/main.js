/* ==========================================================
   DASHBOARD — BOOTSTRAP

   One page, four sections, a sticky nav that tracks the section in
   view. No tabs and no routing: the whole fact sheet is one scroll.
   ========================================================== */
(function () {
  'use strict';

  const fmt = DASH.fmt;
  const D = DASH.data;

  const ORDER = ['performance', 'allocation', 'holdings', 'distributions'];

  const state = {
    /* Performance */
    perfMode: null,               // 'actual' | 'hypothetical' — resolved from the data
    range: 'All',
    units: 'dollars',             // 'dollars' | 'percent'
    showBenchmark: true,
    /* Allocation */
    allocationDim: 'sector',
    /* Holdings */
    filters: { holdings: '' },
    sharedOnly: false,
    expanded: { holdings: new Set() },
    /* Sorting, per table */
    sort: {
      trailing: { key: null, dir: 'asc' },
      calendar: { key: null, dir: 'asc' },
      allocation: { key: 'value', dir: 'desc' },
      positions: { key: 'mv_cad', dir: 'desc' },
      funds: { key: 'coverage', dir: 'desc' },
      holdings: { key: 'weight', dir: 'desc' },
      distributions: { key: 'annual', dir: 'desc' }
    },
    currency: 'CAD'
  };

  let data = null;
  let history = null;
  let series = null;

  const mount = document.getElementById('fs-sections');
  const subnavList = document.getElementById('fs-subnav-list');

  /* The previous build stored per-tab preferences that nothing reads any more.
     Clearing them once keeps stale state out of the browser indefinitely. */
  function clearLegacyState() {
    ['dash.contributionRoom', 'dash.targets', 'dash.watchlistExtra']
      .forEach(k => { try { localStorage.removeItem(k); } catch (e) { /* private mode */ } });
  }

  function buildContext() {
    const positions = data.positions;
    const lookThrough = D.buildLookThrough(positions, data.etfs, {});
    return {
      data: data,
      history: history,
      series: series,
      state: state,
      fmtCtx: { currency: state.currency, usdcad: data.usdcad },
      positions: positions,
      lookThrough: lookThrough,
      rerender: render
    };
  }

  function sectionEl(id) {
    let el = document.getElementById('section-' + id);
    if (!el) {
      el = document.createElement('section');
      el.id = 'section-' + id;
      el.className = 'fs-section';
      el.setAttribute('aria-labelledby', 'nav-' + id);
      mount.appendChild(el);
    }
    return el;
  }

  function render() {
    if (!data) return;
    const ctx = buildContext();

    ORDER.forEach(id => {
      const section = DASH.sections[id];
      if (!section) return;
      const el = sectionEl(id);
      if (el.dataset.built !== '1') {
        el.innerHTML = section.shell();
        el.dataset.built = '1';
        if (section.bind) section.bind(el, ctx);
      }
      try {
        section.render(el, ctx);
      } catch (err) {
        console.error('Dashboard: failed to render §' + id, err);
        el.dataset.built = '';
        el.innerHTML = '<div class="dash-error"><strong>This section failed to render.</strong><br>' +
          fmt.esc(err.message) + '</div>';
      }
    });

    paintFacts(ctx);
  }

  /* Key facts: fund-sheet furniture. Deliberately no account value — the whole
     page is expressed per $10,000 invested. */
  function paintFacts(ctx) {
    const p = data.profile || {};
    const lt = ctx.lookThrough;
    const facts = [
      ['Tracking since', fmt.date(series.firstSnapshot || data.meta.inception_date), 'daily valuation'],
      ['Positions', fmt.num(data.positions.length), p.etf_count + ' funds'],
      ['Look-through holdings', fmt.num(lt.rows.length), 'distinct companies'],
      ['Distribution yield', p.distribution_yield ? fmt.pct(p.distribution_yield, 2) : '—', 'projected'],
      ['Management fee', p.blended_mer == null ? '—' : fmt.pct(p.blended_mer, 2), 'not published by the broker'],
      ['Base currency', data.meta.base_currency, '1 USD = ' + data.usdcad.toFixed(4) + ' CAD']
    ];
    document.getElementById('fs-facts').innerHTML = facts.map(([l, v, sub]) =>
      '<div class="is-stacked"><span class="label">' + fmt.esc(l) + '</span>' +
      '<span class="time">' + v + '</span>' +
      '<span class="sub">' + fmt.esc(sub) + '</span></div>').join('');

    document.getElementById('fs-stamp').innerHTML =
      'Holdings as at ' + fmt.date(data.meta.as_of) +
      ' · prices ' + fmt.esc(series.priceSource) +
      (series.asOf ? ' through ' + fmt.date(series.asOf) : '');
  }

  /* ---------------- sticky nav + scroll spy ---------------- */

  function buildSubnav() {
    subnavList.innerHTML = ORDER.map(id => {
      const s = DASH.sections[id];
      return '<li><a class="nav-link" id="nav-' + id + '" href="#section-' + id + '">' +
        fmt.esc(s.label) + '</a></li>';
    }).join('');

    subnavList.addEventListener('click', ev => {
      const a = ev.target.closest('a[href^="#section-"]');
      if (!a) return;
      ev.preventDefault();
      const el = document.getElementById(a.getAttribute('href').slice(1));
      if (!el) return;
      /* Offset for the site navbar plus this sticky bar, which would otherwise
         cover the section heading being scrolled to. */
      const offset = document.querySelector('.fs-subnav').getBoundingClientRect().height +
        (document.querySelector('.navbar') || { offsetHeight: 0 }).offsetHeight + 8;
      window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - offset, behavior: 'smooth' });
      setActive(a.id.replace('nav-', ''));
    });
  }

  function setActive(id) {
    ORDER.forEach(x => {
      const a = document.getElementById('nav-' + x);
      if (a) a.classList.toggle('active', x === id);
    });
  }

  /* Scroll-spy by direct measurement rather than IntersectionObserver.
     The observer only reports sections whose intersection *changed*, so with
     sections taller than the viewport — Holdings runs to ~1,900 rows — a scroll
     can move a long way without producing any entry, leaving the nav stuck on
     the wrong item. Measuring on each frame is both simpler and correct. */
  function spy() {
    let queued = false;

    function update() {
      queued = false;
      const bar = document.querySelector('.fs-subnav');
      const navbar = document.querySelector('.navbar');
      /* The trigger line sits just below the sticky chrome: a section becomes
         active once its top passes under the bars, not when it enters the
         viewport behind them. */
      const line = (bar ? bar.offsetHeight : 0) + (navbar ? navbar.offsetHeight : 0) + 24;

      let current = ORDER[0];
      ORDER.forEach(id => {
        const el = document.getElementById('section-' + id);
        if (el && el.getBoundingClientRect().top <= line) current = id;
      });

      /* At the very bottom the last section may be too short to ever cross the
         line, so bottom-of-page always resolves to the last one. */
      if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 4) {
        current = ORDER[ORDER.length - 1];
      }
      setActive(current);
    }

    window.addEventListener('scroll', () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(update);
    }, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    update();
  }

  /* ------------------------------ boot ------------------------------ */

  async function boot() {
    try {
      const [portfolio, hist] = await Promise.all([
        D.fetchPortfolio(),
        DASH.history.fetch().catch(err => {
          /* A missing history file must not take the whole page down — the
             allocation and holdings sections do not depend on it. */
          console.warn('Dashboard: history unavailable —', err.message);
          return { meta: {}, snapshots: [], flows: [], daily: [], benchmark: [] };
        })
      ]);

      data = portfolio;
      history = hist;
      series = DASH.history.buildSeries(hist);
      if (!state.perfMode) state.perfMode = series.defaultMode;

      const boot = document.getElementById('fs-boot');
      if (boot) boot.remove();

      buildSubnav();
      render();
      spy();
    } catch (err) {
      console.error('Dashboard: could not load portfolio data', err);
      mount.innerHTML = '<div class="dash-error"><strong>Couldn\'t load the portfolio data.</strong><br>' +
        fmt.esc(err.message) + '<br><span class="dash-stamp">Expected at ' + D.SOURCE +
        '. If you opened this file directly from disk, serve it over HTTP instead — ' +
        'browsers block fetch() on file:// URLs.</span></div>';
    }
  }

  clearLegacyState();
  boot();
})();
