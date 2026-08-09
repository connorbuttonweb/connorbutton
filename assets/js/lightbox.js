// lightbox.js
(function () {
  // 1. Image loading priorities
  document.addEventListener('DOMContentLoaded', function () {
    const imgs = Array.from(document.querySelectorAll('img'));
    imgs.forEach((img, i) => {
      if (i < 2) {
        // First couple: eager
        img.loading = 'eager';
        img.fetchPriority = 'high';
      } else {
        img.loading = 'lazy';
        img.decoding = 'async';
        img.fetchPriority = 'low';
      }
    });

    // 2. Video lazy behavior (only metadata until viewed, pause when off-screen)
    const videos = Array.from(document.querySelectorAll('video'));
    videos.forEach(v => {
      v.preload = 'none';
    });

    if ('IntersectionObserver' in window) {
      const iv = new IntersectionObserver(
        entries => {
          entries.forEach(({ isIntersecting, target }) => {
            const v = target;
            if (!isIntersecting && !v.paused) {
              v.pause();
            }
          });
        },
        { threshold: 0.1 }
      );

      videos.forEach(v => iv.observe(v));
    }

    // 3. Gallery lightbox (images + videos)
    const galleries = Array.from(document.querySelectorAll('.gallery, [data-gallery]'));
    const lightbox = document.getElementById('lightbox');
    const lbContent = document.getElementById('lbContent');
    const lbCaption = document.getElementById('lbCaption');
    const btnPrev = document.getElementById('lbPrev');
    const btnNext = document.getElementById('lbNext');
    const btnClose = document.getElementById('lbClose');

    if (!lightbox || !lbContent || !lbCaption || !btnPrev || !btnNext || !btnClose) {
      // Page has no lightbox root; nothing to do
      return;
    }

    const media = [];

    // Collect all figure elements inside .gallery
    galleries.forEach(g => {
      const galleryId = g.dataset.gallery || '';
      const tiles = Array.from(g.querySelectorAll('figure'));

      tiles.forEach(t => {
        const type = t.dataset.type || (t.querySelector('video') ? 'video' : 'image');

        // data-src can be CSV of sources; fallback to element src
        let src = [];
        if (t.dataset.src) {
          src = t.dataset.src
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);
        } else {
          const el = t.querySelector('img,video');
          if (el && el.getAttribute('src')) {
            src = [el.getAttribute('src')];
          }
        }

        const poster = t.dataset.poster || (t.querySelector('video')?.getAttribute('poster')) || '';
        const caption =
          t.dataset.caption || t.querySelector('img')?.getAttribute('alt') || '';

        media.push({
          el: t,
          gallery: galleryId,
          type,
          src,
          poster,
          caption
        });
      });
    });

    if (!media.length) return;

    let currentIndex = -1;

    function stopActiveVideo() {
      const v = lbContent.querySelector('video');
      if (!v) return;
      try {
        v.pause();
      } catch (e) {
        // ignore
      }
      v.removeAttribute('src');
      v.querySelectorAll('source').forEach(s => s.remove());
      v.load();
    }

    function renderMedia(item) {
      stopActiveVideo();
      lbContent.innerHTML = '';

      if (item.type === 'video') {
        const v = document.createElement('video');
        v.controls = true;
        v.playsInline = true;
        v.preload = 'metadata';
        if (item.poster) v.poster = item.poster;
        v.style.maxHeight = '92vh';

        const sources = Array.isArray(item.src) ? item.src : [item.src];
        sources.forEach(src => {
          const s = document.createElement('source');
          s.src = src;
          s.type = src.endsWith('.webm') ? 'video/webm' : 'video/mp4';
          v.appendChild(s);
        });

        lbContent.appendChild(v);
        v.muted = true;
        v.play().catch(() => {
          // user can tap play
        });
      } else {
        const img = document.createElement('img');
        const srcList = Array.isArray(item.src) ? item.src : [item.src];
        img.src = srcList[0];
        img.alt = item.caption || 'Expanded image';
        img.style.maxHeight = '92vh';
        lbContent.appendChild(img);
      }

      lbCaption.textContent = item.caption || '';
    }

    function openAt(index) {
      if (index < 0 || index >= media.length) return;
      currentIndex = index;
      renderMedia(media[currentIndex]);
      // FIXED: Changed 'open' to 'is-open' to match main.css
      lightbox.classList.add('is-open');
      document.body.style.overflow = 'hidden';
      lbContent.focus();
    }

    function close() {
      // FIXED: Changed 'open' to 'is-open'
      lightbox.classList.remove('is-open');
      document.body.style.overflow = '';
      stopActiveVideo();
      lbContent.innerHTML = '';
      lbCaption.textContent = '';
    }

    function prev() {
      if (!media.length) return;
      const nextIndex = (currentIndex - 1 + media.length) % media.length;
      openAt(nextIndex);
    }

    function next() {
      if (!media.length) return;
      const nextIndex = (currentIndex + 1) % media.length;
      openAt(nextIndex);
    }

    // Click handlers + keyboard activation on tiles
    media.forEach((m, idx) => {
      m.el.addEventListener('click', () => openAt(idx));
      m.el.setAttribute('tabindex', '0');
      m.el.setAttribute('role', 'button');
      m.el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openAt(idx);
        }
      });
    });

    // Controls
    btnClose.addEventListener('click', close);
    btnPrev.addEventListener('click', prev);
    btnNext.addEventListener('click', next);

    // Close when clicking the overlay background
    lightbox.addEventListener('click', e => {
      if (e.target === lightbox) {
        close();
      }
    });

    // Keyboard controls when lightbox is open
    document.addEventListener('keydown', e => {
      // FIXED: Changed 'open' to 'is-open'
      if (!lightbox.classList.contains('is-open')) return;
      if (e.key === 'Escape') {
        close();
      } else if (e.key === 'ArrowLeft') {
        prev();
      } else if (e.key === 'ArrowRight') {
        next();
      }
    });

    // Basic swipe support on mobile
    let touchStartX = null;
    lightbox.addEventListener(
      'touchstart',
      e => {
        // FIXED: Changed 'open' to 'is-open'
        if (!lightbox.classList.contains('is-open')) return;
        touchStartX = e.changedTouches[0].clientX;
      },
      { passive: true }
    );

    lightbox.addEventListener(
      'touchend',
      e => {
        // FIXED: Changed 'open' to 'is-open'
        if (!lightbox.classList.contains('is-open') || touchStartX == null) return;
        const dx = e.changedTouches[0].clientX - touchStartX;
        if (Math.abs(dx) > 50) {
          dx > 0 ? prev() : next();
        }
        touchStartX = null;
      },
      { passive: true }
    );
  });
})();