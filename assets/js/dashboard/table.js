/* ==========================================================
   DASHBOARD — TABLE HELPER

   The site already has a styled table component (.folder, with the
   window-chrome title bar). It is static markup, so this adds the
   behaviour on top rather than replacing it: click-to-sort, live
   filtering, expandable child rows, column show/hide, and a pinned
   totals row. One helper drives all six tables on the dashboard.
   ========================================================== */
window.DASH = window.DASH || {};

(function () {
  'use strict';

  const fmt = DASH.fmt;

  /* opts:
       title          string shown in the .folder title bar
       columns        [{ key, label, num, format(row), sortValue(row), optional }]
       rows           array of row objects
       sort           { key, dir } — dir is 'asc' | 'desc'
       onSort(key)    called after the internal sort state flips
       rowKey(row)    stable id, needed for expand state
       expand(row)    returns child HTML, or null if the row can't expand
       expanded       Set of row keys currently open (owned by the caller so it
                      survives re-render)
       onRowClick(row)
       totals(rows)   { colKey: html } for the pinned footer
       visible        Set of column keys currently shown (optional columns only)
       controls       extra HTML for the right side of the title bar
       emptyText
  */
  function render(mount, opts) {
    const cols = opts.columns.filter(c => !c.optional || !opts.visible || opts.visible.has(c.key));
    const rows = sortRows(opts.rows.slice(), cols, opts.sort);
    const expandable = typeof opts.expand === 'function';
    const expanded = opts.expanded || new Set();

    const head = cols.map(c =>
      '<th class="' + (c.num ? 'num' : '') + '" data-sort="' + fmt.esc(c.key) + '"' +
      (opts.sort && opts.sort.key === c.key ? ' aria-sort="' + (opts.sort.dir === 'asc' ? 'ascending' : 'descending') + '"' : '') +
      '>' + fmt.esc(c.label) + '</th>').join('');

    let body = '';
    if (!rows.length) {
      body = '<tr><td colspan="' + cols.length + '"><div class="dash-empty">' +
        fmt.esc(opts.emptyText || 'Nothing matches the current filters.') + '</div></td></tr>';
    } else {
      rows.forEach(r => {
        const key = opts.rowKey ? String(opts.rowKey(r)) : '';
        const isOpen = expanded.has(key);
        const cells = cols.map((c, ci) => {
          let inner = c.format ? c.format(r) : fmt.esc(r[c.key]);
          if (ci === 0 && expandable) {
            const can = opts.expand(r) !== null;
            inner = (can
              ? '<button class="dash-expand" data-expand="' + fmt.esc(key) + '" aria-expanded="' + isOpen +
              '" aria-label="Toggle breakdown"><i class="fas fa-chevron-' + (isOpen ? 'down' : 'right') + '"></i></button>'
              : '<span class="dash-expand" aria-hidden="true"></span>') + inner;
          }
          return '<td class="' + [c.num ? 'num' : '', c.cls || ''].join(' ').trim() + '">' + inner + '</td>';
        }).join('');

        body += '<tr' + (opts.onRowClick ? ' class="is-clickable"' : '') +
          (key ? ' data-row="' + fmt.esc(key) + '"' : '') + '>' + cells + '</tr>';

        if (isOpen) {
          body += '<tr class="dash-child"><td colspan="' + cols.length + '">' + opts.expand(r) + '</td></tr>';
        }
      });
    }

    let foot = '';
    if (opts.totals && rows.length) {
      const t = opts.totals(rows);
      foot = '<tfoot><tr>' + cols.map(c =>
        '<td class="' + (c.num ? 'num' : '') + '">' + (t[c.key] || '') + '</td>').join('') + '</tr></tfoot>';
    }

    mount.innerHTML =
      '<div class="folder">' +
      '<div class="bar">' +
      '<span class="dot"></span><span class="dot yellow"></span><span class="dot green"></span>' +
      '<span class="status-badge">' + fmt.esc(opts.title || '') + '</span>' +
      '<span class="dash-bar__spacer"></span>' +
      (opts.controls || '') +
      '</div>' +
      '<div class="dash-scroll"><table><thead><tr>' + head + '</tr></thead>' +
      '<tbody>' + body + '</tbody>' + foot + '</table></div>' +
      '</div>';

    /* sorting */
    mount.querySelectorAll('th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        if (!opts.sort) opts.sort = { key: null, dir: 'asc' };
        const k = th.dataset.sort;
        if (opts.sort.key === k) opts.sort.dir = opts.sort.dir === 'asc' ? 'desc' : 'asc';
        else { opts.sort.key = k; opts.sort.dir = defaultDir(cols, k); }
        // Without an onSort the caller owns no state to persist, so repaint here.
        if (opts.onSort) opts.onSort(opts.sort); else render(mount, opts);
      });
    });

    /* expand toggles — stopPropagation so expanding never also opens the
       row-click detail panel */
    mount.querySelectorAll('[data-expand]').forEach(btn => {
      btn.addEventListener('click', ev => {
        ev.stopPropagation();
        const k = btn.dataset.expand;
        if (expanded.has(k)) expanded.delete(k); else expanded.add(k);
        render(mount, opts);
      });
    });

    if (opts.onRowClick) {
      mount.querySelectorAll('tbody tr[data-row]').forEach(tr => {
        tr.addEventListener('click', () => {
          const r = rows.find(x => String(opts.rowKey(x)) === tr.dataset.row);
          if (r) opts.onRowClick(r);
        });
      });
    }
    return mount;
  }

  function defaultDir(cols, key) {
    const c = cols.find(x => x.key === key);
    return c && c.num ? 'desc' : 'asc';   // money reads best largest-first
  }

  function sortRows(rows, cols, sort) {
    if (!sort || !sort.key) return rows;
    const c = cols.find(x => x.key === sort.key);
    if (!c) return rows;
    const val = r => (c.sortValue ? c.sortValue(r) : r[c.key]);
    const dir = sort.dir === 'asc' ? 1 : -1;
    return rows.sort((a, b) => {
      const x = val(a), y = val(b);
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
      return String(x).localeCompare(String(y)) * dir;
    });
  }

  /* Simple nested table used inside expanded child rows (ETF constituents and
     the "which funds built this position" breakdown). */
  function childTable(headers, rows) {
    return '<table><thead><tr>' +
      headers.map(h => '<th class="' + (h.num ? 'num' : '') + '">' + fmt.esc(h.label) + '</th>').join('') +
      '</tr></thead><tbody>' +
      rows.map(r => '<tr>' + r.map((c, i) =>
        '<td class="' + (headers[i].num ? 'num' : '') + '">' + c + '</td>').join('') + '</tr>').join('') +
      '</tbody></table>';
  }

  DASH.table = {
    render: render,
    childTable: childTable
  };
})();
