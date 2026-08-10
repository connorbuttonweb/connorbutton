// Pointer-driven arcball rotation + momentum for the sphere group.
// Single input path (Pointer Events) unifies mouse/touch/pen.

const CLICK_THRESHOLD_PX = 6;
const SAMPLE_WINDOW_MS = 100;
const MIN_ANGULAR_VELOCITY = 0.001;
const DAMPING = 1.6;

// Screen-space drag delta (dx, dy) -> a world-space rotation axis+angle.
// Axis is perpendicular to the drag vector in camera space, then rotated
// into world space by the camera's own orientation. Positive angle makes
// the near face of the sphere follow the drag direction (grab-and-spin).
function axisAngleFromScreenDelta(THREE, dx, dy, rotateSpeed, camera) {
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return null;
  const angle = dist * rotateSpeed;
  const axis = new THREE.Vector3(dy, dx, 0)
    .normalize()
    .applyQuaternion(camera.quaternion)
    .normalize();
  return { axis, angle };
}

export function createTrackball({ THREE, canvas, camera, group, onTap }) {
  let dragging = false;
  let pointerId = null;
  let lastX = 0;
  let lastY = 0;
  let dragDistance = 0;
  let samples = [];
  let angularVelocity = 0;
  const momentumAxis = new THREE.Vector3(0, 1, 0);
  const tmpQuat = new THREE.Quaternion();

  function rotateSpeed() {
    return Math.PI / Math.min(canvas.clientWidth, canvas.clientHeight);
  }

  function onPointerDown(e) {
    dragging = true;
    pointerId = e.pointerId;
    try {
      canvas.setPointerCapture(pointerId);
    } catch {
      // Capture is an enhancement (keeps the drag alive outside the
      // canvas), not a requirement -- and it can throw for pointers the
      // browser doesn't consider active. Never abort drag setup over it.
    }
    lastX = e.clientX;
    lastY = e.clientY;
    dragDistance = 0;
    samples = [{ dx: 0, dy: 0, t: performance.now() }];
    angularVelocity = 0;
  }

  function onPointerMove(e) {
    if (!dragging || e.pointerId !== pointerId) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    dragDistance += Math.hypot(dx, dy);

    const result = axisAngleFromScreenDelta(THREE, dx, dy, rotateSpeed(), camera);
    if (result) {
      tmpQuat.setFromAxisAngle(result.axis, result.angle);
      group.quaternion.premultiply(tmpQuat);
    }

    const now = performance.now();
    samples.push({ dx, dy, t: now });
    while (samples.length > 1 && now - samples[0].t > SAMPLE_WINDOW_MS) samples.shift();
  }

  function endDrag(e) {
    if (!dragging || e.pointerId !== pointerId) return;
    dragging = false;
    try {
      canvas.releasePointerCapture(pointerId);
    } catch {
      // Capture may already be gone (e.g. pointercancel fired first) --
      // harmless, nothing left to release.
    }

    const now = performance.now();
    while (samples.length > 1 && now - samples[0].t > SAMPLE_WINDOW_MS) samples.shift();

    let sumDx = 0;
    let sumDy = 0;
    samples.slice(1).forEach((s) => {
      sumDx += s.dx;
      sumDy += s.dy;
    });
    const dt = (now - samples[0].t) / 1000;

    if (dt > 0) {
      const result = axisAngleFromScreenDelta(THREE, sumDx, sumDy, rotateSpeed(), camera);
      if (result) {
        momentumAxis.copy(result.axis);
        angularVelocity = result.angle / dt;
      } else {
        angularVelocity = 0;
      }
    } else {
      angularVelocity = 0;
    }

    if (dragDistance < CLICK_THRESHOLD_PX) {
      onTap(e.clientX, e.clientY);
    }
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  function update(dt) {
    if (dragging || angularVelocity <= MIN_ANGULAR_VELOCITY) return;
    tmpQuat.setFromAxisAngle(momentumAxis, angularVelocity * dt);
    group.quaternion.premultiply(tmpQuat);
    angularVelocity *= Math.exp(-DAMPING * dt);
    if (angularVelocity <= MIN_ANGULAR_VELOCITY) angularVelocity = 0;
  }

  return {
    update,
    isDragging: () => dragging,
    // Lets the autopilot kill residual spin when it takes the wheel --
    // otherwise stale momentum resumes the moment it disengages.
    stopMomentum: () => {
      angularVelocity = 0;
    },
  };
}
