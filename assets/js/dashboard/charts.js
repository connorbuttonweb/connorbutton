/* ==========================================================
   DASHBOARD — SVG CHARTS

   Hand-rolled, no charting library. The repo has no chart code and
   no build step; these draw straight into SVG using the site's own
   design tokens, so the charts move and read like the rest of the
   site and there is no CDN to break.

   Colour rules followed here:
     - categorical hues are assigned in a fixed order and never
       cycled; a 9th slice folds into a grey "Other"
     - gain/loss uses --color-up / --color-down, never a series hue,
       and always ships an arrow so meaning is not colour-only
     - every chart carries a legend and a tooltip, and each one sits
       above a table that states the same numbers as text
   ========================================================== */
window.DASH = window.DASH || {};

(function () {
  'use strict';

  const fmt = DASH.fmt;
  const NS = 'http://www.w3.org/2000/svg';

  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  let SERIES = null;
  function palette() {
    if (!SERIES) {
      SERIES = [];
      for (let i = 1; i <= 8; i++) SERIES.push(cssVar('--series-' + i, '#2a78d6'));
      SERIES.other = cssVar('--series-other', '#a7a9a9');
    }
    return SERIES;
  }

  /* Colour follows the entity, not its rank: the key is hashed to a slot so a
     filter that removes series doesn't repaint the survivors. Reserved keys
     keep their fixed meaning. */
  function colorFor(key, i) {
    const p = palette();
    if (key === '__other__' || key === DASH.data.UNRESOLVED) return p.other;
    return p[i % p.length];
  }

  function el(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  /* ---------- one shared tooltip for every chart ---------- */
  let tipEl = null;
  function tip() {
    if (!tipEl) {
      tipEl = document.createElement('div');
      tipEl.className = 'dash-tip';
      document.body.appendChild(tipEl);
    }
    return tipEl;
  }
  function showTip(html, x, y) {
    const t = tip();
    t.innerHTML = html;
    t.classList.add('is-on');
    const r = t.getBoundingClientRect();
    let left = x + 14, top = y + 14;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
    t.style.left = Math.max(8, left) + 'px';
    t.style.top = Math.max(8, top) + 'px';
  }
  function hideTip() { if (tipEl) tipEl.classList.remove('is-on'); }

  /* ---------- donut ----------
     Built from <circle> + stroke-dasharray rather than <path> arcs: dasharray
     and dashoffset are CSS-animatable, so switching the grouping tweens the
     same rings instead of hard-cutting to a new drawing. */
  function donut(mount, slices, opts) {
    const o = opts || {};
    const hidden = o.hidden || new Set();
    const visible = slices.filter(s => !hidden.has(s.key));
    const total = visible.reduce((a, s) => a + s.value, 0);

    const SIZE = 220, R = 78, W = 30, CX = SIZE / 2, CY = SIZE / 2;
    const C = 2 * Math.PI * R;
    const GAP = total > 0 && visible.length > 1 ? 2 : 0;   // 2px surface gap

    let svg = mount.querySelector('svg.donut');
    if (!svg) {
      mount.innerHTML = '';
      svg = el('svg', { class: 'donut', viewBox: '0 0 ' + SIZE + ' ' + SIZE, role: 'img' }, mount);
      el('g', { class: 'segs' }, svg);
      const t1 = el('text', { class: 'dash-donut-centre', x: CX, y: CY - 2, 'font-size': '17', 'font-weight': '600' }, svg);
      t1.setAttribute('data-role', 'value');
      const t2 = el('text', { class: 'dash-donut-centre', x: CX, y: CY + 16, 'font-size': '10', fill: cssVar('--color-text-secondary', '#626c71') }, svg);
      t2.setAttribute('data-role', 'label');
    }
    const g = svg.querySelector('.segs');
    svg.setAttribute('aria-label', (o.title || 'Allocation') + ' donut chart');

    if (!total) {
      g.innerHTML = '';
      el('circle', { cx: CX, cy: CY, r: R, fill: 'none', stroke: cssVar('--color-border', '#ddd'), 'stroke-width': W }, g);
    } else {
      // Reuse existing <circle> nodes so the CSS transition has something to
      // animate from; only add/remove when the slice count changes.
      const need = visible.length;
      while (g.children.length > need) g.removeChild(g.lastChild);
      while (g.children.length < need) {
        const c = el('circle', {
          class: 'seg', cx: CX, cy: CY, r: R, fill: 'none', 'stroke-width': W,
          transform: 'rotate(-90 ' + CX + ' ' + CY + ')'
        }, g);
        c.style.transition = 'stroke-dasharray var(--duration-normal) var(--ease-standard), stroke-dashoffset var(--duration-normal) var(--ease-standard)';
      }

      let acc = 0;
      visible.forEach((s, i) => {
        const frac = s.value / total;
        const len = Math.max(0, frac * C - GAP);
        const c = g.children[i];
        c.setAttribute('stroke', s.color || colorFor(s.key, slices.indexOf(s)));
        c.setAttribute('stroke-dasharray', len + ' ' + (C - len));
        c.setAttribute('stroke-dashoffset', -acc * C);
        c.dataset.key = s.key;

        c.onmousemove = ev => showTip(
          '<b>' + fmt.esc(s.label) + '</b><br>' + fmt.money(s.value, o.ctx) + ' · ' + fmt.pct(frac, 1),
          ev.clientX, ev.clientY);
        c.onmouseleave = hideTip;
        c.onclick = () => { hideTip(); if (o.onSelect) o.onSelect(s); };
        acc += frac;
      });
    }

    svg.querySelector('[data-role="value"]').textContent = o.centreValue || fmt.moneyCompact(total, o.ctx);
    svg.querySelector('[data-role="label"]').textContent = o.centreLabel || 'Total';
    return svg;
  }

  /* ---------- legend ----------
     Doubles as the visible labelling required by three of the series colours,
     which sit under 3:1 contrast on the cream page surface. */
  function legend(mount, slices, opts) {
    const o = opts || {};
    const hidden = o.hidden || new Set();
    const total = slices.filter(s => !hidden.has(s.key)).reduce((a, s) => a + s.value, 0);

    mount.className = 'dash-legend';
    mount.innerHTML = slices.map((s, i) => {
      const on = !hidden.has(s.key);
      const share = on && total ? s.value / total : 0;
      /* Share-of-total only means something for part-to-whole charts. Line
         charts pass their own formatter (or none) so the legend never prints a
         percentage of a sum that isn't a whole. */
      const val = o.valueFormat ? o.valueFormat(s.value, s) : (on ? fmt.pct(share, 1) : 'hidden');
      return '<li><button type="button" aria-pressed="' + on + '" data-key="' + fmt.esc(s.key) + '">' +
        '<span class="dash-swatch" style="background:' + (s.color || colorFor(s.key, i)) + '"></span>' +
        '<span class="lbl">' + fmt.esc(s.label) + '</span>' +
        '<span class="val">' + val + '</span>' +
        '</button></li>';
    }).join('');

    mount.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => { if (o.onToggle) o.onToggle(b.dataset.key); });
    });
  }

  /* ---------- axis helpers ---------- */
  function niceTicks(min, max, count) {
    if (min === max) { min -= 1; max += 1; }
    const raw = (max - min) / (count || 5);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const out = [];
    for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v / step) * step);
    return out;
  }

  /* ---------- line chart (growth of $10k, performance) ----------
     series: [{ label, color, points:[{date, value}], dashed }] */
  function line(mount, series, opts) {
    const o = opts || {};
    const W = 760, H = o.height || 320;
    const M = { t: 14, r: 14, b: 28, l: 62 };
    const iw = W - M.l - M.r, ih = H - M.t - M.b;

    mount.innerHTML = '';
    const live = series.filter(s => s.points && s.points.length > 1);
    if (!live.length) {
      mount.innerHTML = '<p class="dash-empty">Not enough history for this range.</p>';
      return;
    }

    const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': o.title || 'Line chart' }, mount);
    const all = live.reduce((a, s) => a.concat(s.points.map(p => p.value)), []);
    const ticks = niceTicks(Math.min.apply(null, all), Math.max.apply(null, all), 5);
    const yMin = ticks[0], yMax = ticks[ticks.length - 1];

    const base = live[0].points;
    const t0 = new Date(base[0].date + 'T00:00:00Z').getTime();
    const t1 = new Date(base[base.length - 1].date + 'T00:00:00Z').getTime();
    const span = t1 - t0 || 1;
    const X = iso => M.l + ((new Date(iso + 'T00:00:00Z').getTime() - t0) / span) * iw;
    const Y = v => M.t + ih - ((v - yMin) / (yMax - yMin || 1)) * ih;

    ticks.forEach(t => {
      el('line', { class: 'dash-grid-line', x1: M.l, x2: M.l + iw, y1: Y(t), y2: Y(t) }, svg);
      const lab = el('text', { class: 'dash-tick', x: M.l - 8, y: Y(t) + 3, 'text-anchor': 'end' }, svg);
      lab.textContent = o.yFormat ? o.yFormat(t) : fmt.num(t, 0);
    });
    el('line', { class: 'dash-axis', x1: M.l, x2: M.l + iw, y1: M.t + ih, y2: M.t + ih }, svg);

    const nx = Math.min(6, base.length);
    for (let i = 0; i < nx; i++) {
      const p = base[Math.round((i / (nx - 1)) * (base.length - 1))];
      const lab = el('text', { class: 'dash-tick', x: X(p.date), y: H - 8, 'text-anchor': i === 0 ? 'start' : i === nx - 1 ? 'end' : 'middle' }, svg);
      lab.textContent = fmt.dateShort(p.date);
    }

    live.forEach(s => {
      const d = s.points.map((p, i) => (i ? 'L' : 'M') + X(p.date).toFixed(1) + ' ' + Y(p.value).toFixed(1)).join(' ');
      el('path', {
        d: d, fill: 'none', stroke: s.color, 'stroke-width': 2,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round',
        'stroke-dasharray': s.dashed ? '5 4' : ''
      }, svg);
    });

    /* crosshair layer */
    const cross = el('g', { style: 'display:none' }, svg);
    el('line', { class: 'dash-axis', y1: M.t, y2: M.t + ih, stroke: cssVar('--color-primary', '#21808d'), 'stroke-dasharray': '3 3' }, cross);
    const dots = live.map(s => el('circle', { r: 4, fill: s.color, stroke: cssVar('--color-surface', '#fff'), 'stroke-width': 2 }, cross));

    const hit = el('rect', { x: M.l, y: M.t, width: iw, height: ih, fill: 'transparent', style: 'cursor:crosshair' }, svg);
    hit.addEventListener('mousemove', ev => {
      const box = svg.getBoundingClientRect();
      const px = ((ev.clientX - box.left) / box.width) * W;
      const frac = Math.max(0, Math.min(1, (px - M.l) / iw));
      const idx = Math.round(frac * (base.length - 1));
      const date = base[idx].date;
      cross.style.display = '';
      cross.firstChild.setAttribute('x1', X(date));
      cross.firstChild.setAttribute('x2', X(date));

      let html = '<b>' + fmt.date(date) + '</b>';
      live.forEach((s, i) => {
        const pt = s.points[Math.min(idx, s.points.length - 1)];
        dots[i].setAttribute('cx', X(pt.date));
        dots[i].setAttribute('cy', Y(pt.value));
        html += '<br><span style="color:' + s.color + '">■</span> ' + fmt.esc(s.label) + ' <b>' +
          (o.tipFormat ? o.tipFormat(pt.value, s) : fmt.num(pt.value, 2)) + '</b>';
      });
      showTip(html, ev.clientX, ev.clientY);
    });
    hit.addEventListener('mouseleave', () => { cross.style.display = 'none'; hideTip(); });
    return svg;
  }

  /* ---------- horizontal bars ---------- */
  function bars(mount, rows, opts) {
    const o = opts || {};
    mount.innerHTML = '';
    if (!rows.length) { mount.innerHTML = '<p class="dash-empty">Nothing to show.</p>'; return; }

    const rowH = 26, W = 760, L = o.labelWidth || 190, R = 66;
    const H = rows.length * rowH + 8;
    const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': o.title || 'Bar chart' }, mount);
    const max = Math.max.apply(null, rows.map(r => Math.abs(r.value))) || 1;
    const iw = W - L - R;

    rows.forEach((r, i) => {
      const y = i * rowH + 4;
      const w = Math.max(2, (Math.abs(r.value) / max) * iw);
      const lab = el('text', { class: 'dash-tick', x: L - 10, y: y + 15, 'text-anchor': 'end', 'font-size': '11' }, svg);
      lab.textContent = r.label.length > 30 ? r.label.slice(0, 29) + '…' : r.label;

      const rect = el('rect', {
        class: 'bar', x: L, y: y + 4, width: w, height: rowH - 12,
        rx: 4, fill: r.color || colorFor(r.key, i)
      }, svg);
      rect.onmousemove = ev => showTip('<b>' + fmt.esc(r.label) + '</b><br>' +
        (o.valueFormat ? o.valueFormat(r.value) : fmt.money(r.value, o.ctx)) +
        (r.weight !== undefined ? ' · ' + fmt.pct(r.weight, 1) : ''), ev.clientX, ev.clientY);
      rect.onmouseleave = hideTip;
      if (o.onSelect) { rect.style.cursor = 'pointer'; rect.onclick = () => o.onSelect(r); }

      const val = el('text', { class: 'dash-tick', x: L + w + 8, y: y + 15, 'font-size': '11' }, svg);
      val.textContent = o.valueFormat ? o.valueFormat(r.value) : fmt.pct(r.weight, 1);
    });
    return svg;
  }

  /* ---------- grouped bars (current vs target) ---------- */
  function groupedBars(mount, rows, opts) {
    const o = opts || {};
    mount.innerHTML = '';
    if (!rows.length) { mount.innerHTML = '<p class="dash-empty">Set a target allocation to compare against.</p>'; return; }

    const groupH = 46, W = 760, L = 170, R = 70;
    const H = rows.length * groupH + 10;
    const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Current versus target allocation' }, mount);
    const max = Math.max(0.01, Math.max.apply(null, rows.map(r => Math.max(r.current, r.target))));
    const iw = W - L - R;
    const cCur = cssVar('--series-1', '#2a78d6');
    const cTgt = cssVar('--color-border', '#ccc');

    rows.forEach((r, i) => {
      const y = i * groupH + 6;
      const lab = el('text', { class: 'dash-tick', x: L - 10, y: y + 22, 'text-anchor': 'end', 'font-size': '11' }, svg);
      lab.textContent = r.label;

      [[r.target, cTgt, 'Target', y], [r.current, cCur, 'Current', y + 16]].forEach(([v, col, name, yy]) => {
        const w = Math.max(2, (v / max) * iw);
        const rect = el('rect', { class: 'bar', x: L, y: yy, width: w, height: 13, rx: 4, fill: col }, svg);
        rect.onmousemove = ev => showTip('<b>' + fmt.esc(r.label) + '</b><br>' + name + ': ' + fmt.pct(v, 1), ev.clientX, ev.clientY);
        rect.onmouseleave = hideTip;
      });

      const drift = r.current - r.target;
      const d = el('text', { x: W - R + 8, y: y + 22, 'font-size': '11', 'font-family': cssVar('--font-family-mono', 'monospace') }, svg);
      d.setAttribute('fill', Math.abs(drift) >= (o.threshold || 0.05) ? cssVar('--color-down', '#ef4444') : cssVar('--color-text-secondary', '#626c71'));
      d.textContent = (drift >= 0 ? '+' : '') + (drift * 100).toFixed(1) + 'pt';
    });
    return svg;
  }

  /* ---------- sparkline (returns a string; used inside table cells) ---------- */
  function sparkline(values, opts) {
    const o = opts || {};
    if (!values || values.length < 2) return '';
    const W = 88, H = 24, P = 2;
    const min = Math.min.apply(null, values), max = Math.max.apply(null, values);
    const span = max - min || 1;
    const pts = values.map((v, i) => {
      const x = P + (i / (values.length - 1)) * (W - P * 2);
      const y = H - P - ((v - min) / span) * (H - P * 2);
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    const up = values[values.length - 1] >= values[0];
    const col = o.color || cssVar(up ? '--color-up' : '--color-down', '#888');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H +
      '" aria-hidden="true" style="display:block"><polyline points="' + pts +
      '" fill="none" stroke="' + col + '" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>';
  }

  /* ---------- vertical bars (monthly income) ---------- */
  function columns(mount, rows, opts) {
    const o = opts || {};
    mount.innerHTML = '';
    if (!rows.length) { mount.innerHTML = '<p class="dash-empty">No income recorded in this range.</p>'; return; }

    const W = 760, H = o.height || 220, M = { t: 12, r: 10, b: 30, l: 56 };
    const iw = W - M.l - M.r, ih = H - M.t - M.b;
    const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': o.title || 'Column chart' }, mount);
    const maxV = Math.max.apply(null, rows.map(r => Math.max(r.value, r.overlay || 0))) || 1;
    const ticks = niceTicks(0, maxV, 4);
    const yMax = ticks[ticks.length - 1];
    const Y = v => M.t + ih - (v / yMax) * ih;

    ticks.forEach(t => {
      el('line', { class: 'dash-grid-line', x1: M.l, x2: M.l + iw, y1: Y(t), y2: Y(t) }, svg);
      const lab = el('text', { class: 'dash-tick', x: M.l - 8, y: Y(t) + 3, 'text-anchor': 'end' }, svg);
      lab.textContent = o.yFormat ? o.yFormat(t) : fmt.num(t, 0);
    });

    const bw = iw / rows.length;
    const c1 = cssVar('--series-1', '#2a78d6');
    const c2 = cssVar('--series-4', '#eda100');
    rows.forEach((r, i) => {
      const x = M.l + i * bw;
      const inner = Math.max(3, bw - 4);          // 2px surface gap either side
      const h = Math.max(1, M.t + ih - Y(r.value));
      const rect = el('rect', { class: 'bar', x: x + 2, y: Y(r.value), width: inner, height: h, rx: 4, fill: c1 }, svg);
      rect.onmousemove = ev => showTip('<b>' + fmt.esc(r.label) + '</b><br>' + fmt.money(r.value, o.ctx) +
        (r.overlay !== undefined ? '<br>Projected: ' + fmt.money(r.overlay, o.ctx) : ''), ev.clientX, ev.clientY);
      rect.onmouseleave = hideTip;

      if (r.overlay !== undefined && r.overlay !== null) {
        el('line', {
          x1: x + 2, x2: x + 2 + inner, y1: Y(r.overlay), y2: Y(r.overlay),
          stroke: c2, 'stroke-width': 2, 'stroke-linecap': 'round'
        }, svg);
      }
      if (rows.length <= 18 || i % Math.ceil(rows.length / 12) === 0) {
        const lab = el('text', { class: 'dash-tick', x: x + bw / 2, y: H - 10, 'text-anchor': 'middle' }, svg);
        lab.textContent = r.short || r.label;
      }
    });
    return svg;
  }

  DASH.charts = {
    palette: palette, colorFor: colorFor, niceTicks: niceTicks,
    donut: donut, legend: legend, line: line, bars: bars,
    groupedBars: groupedBars, columns: columns, sparkline: sparkline,
    showTip: showTip, hideTip: hideTip, cssVar: cssVar
  };
})();
