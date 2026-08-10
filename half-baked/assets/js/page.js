// Project-page exit: fade the content back into the bare backdrop
// before following the back link -- the mirror of the hub's departure
// fade, so the return trip reads as one continuous scene with the
// shared background as the through-line.
(function () {
  const content = document.querySelector('.nd-page-content');
  const back = document.querySelector('.nd-back');
  if (!content || !back) return;
  let leaving = false;
  back.addEventListener('click', (e) => {
    e.preventDefault();
    if (leaving) return;
    leaving = true;
    content.classList.add('nd-content-out');
    // Reuse the hub's departure class: fades the (always-visible) back
    // link out with the content so the beat before navigating is bare.
    document.body.classList.add('nd-departing');
    // Matches the 0.3s .nd-page-content transition, plus a short
    // background-only beat before the hub fades its scene back in.
    setTimeout(() => {
      window.location.href = back.href;
    }, 420);
  });
})();
