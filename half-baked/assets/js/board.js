// Notepad board. Pan: drag, plain wheel, shift+wheel for sideways.
// Zoom: the slider, ctrl+wheel (which is also how browsers report
// trackpad pinch), two-finger pinch, and ctrl/cmd + '+' / '-' / '0' --
// the browser's own page-zoom keys, taken over so the board owns every
// zoom gesture while this page has focus. One transform on .nd-board
// does all of it -- translate then scale, origin top-left -- so a zoom
// about any screen point is just a pan correction. Nothing is
// persisted; the board opens zoomed out and centred on its first note
// every time.
(function () {
  const viewport = document.querySelector('[data-nd-board]');
  const board = viewport && viewport.querySelector('.nd-board');
  const slider = document.querySelector('.nd-zoom-slider');
  const readout = document.querySelector('.nd-zoom-readout');
  if (!viewport || !board || !slider) return;

  // The slider's range is the single source of truth for the zoom limits.
  const MIN_SCALE = Number(slider.min) / 100;
  const MAX_SCALE = Number(slider.max) / 100;
  // How much of the board must stay on screen when panning, in px.
  const EDGE_MARGIN = 80;
  // Keyboard zoom step -- close to the browser's own 10% increments so
  // ctrl+'+' feels like the key it replaces.
  const ZOOM_STEP = 1.1;

  const INITIAL_SCALE = Number(slider.value) / 100;
  let scale = INITIAL_SCALE;
  let panX = 0;
  let panY = 0;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function apply() {
    board.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    const pct = Math.round(scale * 100);
    slider.value = String(pct);
    if (readout) readout.value = `${pct}%`;
  }

  function clampPan() {
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    const bw = board.offsetWidth * scale;
    const bh = board.offsetHeight * scale;
    panX = clamp(panX, EDGE_MARGIN - bw, vw - EDGE_MARGIN);
    panY = clamp(panY, EDGE_MARGIN - bh, vh - EDGE_MARGIN);
  }

  // Zoom so the board point currently under viewport point (px, py)
  // stays put.
  function zoomAbout(next, px, py) {
    next = clamp(next, MIN_SCALE, MAX_SCALE);
    const k = next / scale;
    panX = px - (px - panX) * k;
    panY = py - (py - panY) * k;
    scale = next;
    clampPan();
    apply();
  }

  function panBy(dx, dy) {
    panX += dx;
    panY += dy;
    clampPan();
    apply();
  }

  // Opening view: the first note dead-centre (or the board's centre if
  // there are no notes yet).
  function centreOnStart() {
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    const note = board.querySelector('.nd-note');
    const tx = note ? note.offsetLeft + note.offsetWidth / 2 : board.offsetWidth / 2;
    const ty = note ? note.offsetTop + note.offsetHeight / 2 : board.offsetHeight / 2;
    panX = vw / 2 - tx * scale;
    panY = vh / 2 - ty * scale;
    clampPan();
    apply();
  }

  // Slider zooms about the viewport centre -- the board shouldn't lurch
  // toward a corner when the control is nowhere near the content.
  slider.addEventListener('input', () => {
    zoomAbout(Number(slider.value) / 100, viewport.clientWidth / 2, viewport.clientHeight / 2);
  });

  viewport.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      // Line/page delta modes (Firefox with a mouse) come in far smaller
      // units than pixels; normalise so the feel matches.
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewport.clientHeight : 1;
      let dx = e.deltaX * unit;
      let dy = e.deltaY * unit;
      if (e.ctrlKey || e.metaKey) {
        const rect = viewport.getBoundingClientRect();
        zoomAbout(scale * Math.exp(-dy * 0.0025), e.clientX - rect.left, e.clientY - rect.top);
        return;
      }
      // Shift+wheel scrolls sideways. Chrome and Safari already deliver
      // it as deltaX; Firefox and some mice leave it on deltaY, so swap
      // the axes only when the browser hasn't.
      if (e.shiftKey && Math.abs(dx) < Math.abs(dy)) {
        dx = dy;
        dy = 0;
      }
      panBy(-dx, -dy);
    },
    { passive: false }
  );

  // ctrl/cmd + '+' / '-' / '0': zoom in, out, and back to the opening
  // zoom, about the viewport centre. preventDefault is what stops the
  // browser zooming the whole page instead. Left alone inside text
  // entry so a future note with a field keeps its normal editing keys.
  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const t = e.target;
    if (
      t instanceof Element &&
      (t.closest('textarea, [contenteditable]') ||
        (t instanceof HTMLInputElement && t.type !== 'range'))
    ) return;
    let next;
    if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') {
      next = scale * ZOOM_STEP;
    } else if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract') {
      next = scale / ZOOM_STEP;
    } else if (e.key === '0' || e.code === 'Numpad0') {
      next = INITIAL_SCALE;
    } else {
      return;
    }
    e.preventDefault();
    zoomAbout(next, viewport.clientWidth / 2, viewport.clientHeight / 2);
  });

  // Pointer handling: one pointer drags, two pinch. Drags that start on
  // a control are left alone so buttons/links stay clickable.
  const pointers = new Map();
  let pinchStart = null; // { dist, scale, midX, midY }

  const midpoint = () => {
    const [a, b] = [...pointers.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y) };
  };

  viewport.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (e.target.closest('button, a, input, textarea, select')) return;
    viewport.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const m = midpoint();
      pinchStart = { dist: m.dist, scale };
    }
    viewport.classList.add('nd-board-grabbing');
  });

  viewport.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    if (pointers.size === 1) {
      panBy(cur.x - prev.x, cur.y - prev.y);
      pointers.set(e.pointerId, cur);
      return;
    }
    const before = midpoint();
    pointers.set(e.pointerId, cur);
    const after = midpoint();
    if (pinchStart && pinchStart.dist > 0) {
      const rect = viewport.getBoundingClientRect();
      // Pan by the midpoint's travel, then zoom about it.
      panX += after.x - before.x;
      panY += after.y - before.y;
      zoomAbout(pinchStart.scale * (after.dist / pinchStart.dist), after.x - rect.left, after.y - rect.top);
    }
  });

  const release = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (viewport.hasPointerCapture(e.pointerId)) viewport.releasePointerCapture(e.pointerId);
    pinchStart = null;
    if (pointers.size === 0) viewport.classList.remove('nd-board-grabbing');
  };
  viewport.addEventListener('pointerup', release);
  viewport.addEventListener('pointercancel', release);

  window.addEventListener('resize', () => {
    clampPan();
    apply();
  });

  centreOnStart();
})();
