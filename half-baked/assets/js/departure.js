// Departure: the "zoom into the coin" exit from the hub. Once the
// autopilot has centered the chosen coin, the camera dollies into its
// cap while the canvas cross-fades to the page's shared dot-grid
// backdrop; navigation happens during the background-only beat, so the
// next page appears to grow out of the same background instead of
// reading as a page load.

const DOLLY_TIME = 0.9;    // s -- camera flight into the cap
const END_DISTANCE = 1.15; // world units -- cap plane sits at ~0.98, near plane at 0.1
const FADE_AT = 0.55;      // s -- start the 0.35s canvas fade so it lands with the dolly
const HOLD_MS = 180;       // background-only beat before navigating

const easeInCubic = (t) => t * t * t;

export function createDeparture({ camera, canvas }) {
  const startDistance = camera.position.length();
  const axis = camera.position.clone().normalize();
  let elapsed = -1; // negative -- idle
  let url = null;
  let fading = false;
  let navigating = false;

  function begin(targetUrl) {
    if (elapsed >= 0) return;
    url = targetUrl;
    elapsed = 0;
    // Committed from here: pointer input goes dead (body.nd-departing
    // in newday.css) and the frame loop parks trackball/autopilot/hover.
    document.body.classList.add('nd-departing');
  }

  const isActive = () => elapsed >= 0;

  function update(dt) {
    if (elapsed < 0) return;
    elapsed += dt;
    const t = Math.min(elapsed / DOLLY_TIME, 1);
    camera.position
      .copy(axis)
      .multiplyScalar(startDistance + (END_DISTANCE - startDistance) * easeInCubic(t));
    if (!fading && elapsed >= FADE_AT) {
      fading = true;
      canvas.classList.add('nd-canvas-out');
    }
    if (!navigating && t >= 1) {
      navigating = true;
      setTimeout(() => {
        window.location.href = url;
      }, HOLD_MS);
    }
  }

  return { begin, isActive, update };
}
