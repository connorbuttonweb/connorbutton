// Autopilot: smoothly rotates the sphere so a chosen vertex faces the
// camera. Fires only when a project is actually chosen (coin tap or
// coin-index click) -- it flies the coin to dead-center, then hands off
// to the departure zoom via the arrival callback. A real pointer grab
// cancels the flight and its pending navigation: the user's hand
// outranks the autopilot.

export function createAutopilot({ THREE, group, camera, vertices }) {
  // Unit vector from the origin toward the camera -- where a vertex's
  // world direction must point to be dead-center front-facing. Captured
  // at boot: the camera only moves during departure, after flights end.
  const camDir = camera.position.clone().normalize();

  const ARRIVE_ANGLE = 0.03;      // rad -- "fully rotated to it"
  const APPROACH_RATE = 4;        // fraction of remaining angle per second
  const MIN_SPEED = 0.8;          // rad/s floor so long flights don't tail off

  let targetIndex = null;
  let onArrive = null;

  const current = new THREE.Vector3();
  const axis = new THREE.Vector3();
  const step = new THREE.Quaternion();

  // Fly to the coin and fire the callback only on arrival.
  function flyTo(index, callback) {
    targetIndex = index;
    onArrive = callback;
  }

  // Pointer grab: cancel the flight, including its pending navigation.
  function cancel() {
    targetIndex = null;
    onArrive = null;
  }

  function update(dt) {
    if (targetIndex === null) return;
    current.copy(vertices[targetIndex]).applyQuaternion(group.quaternion).normalize();
    const angle = current.angleTo(camDir);
    if (angle < ARRIVE_ANGLE) {
      const callback = onArrive;
      onArrive = null;
      targetIndex = null;
      if (callback) callback();
      return;
    }
    axis.crossVectors(current, camDir);
    if (axis.lengthSq() < 1e-10) {
      // Antipodal: any axis perpendicular to the view direction works.
      axis.set(0, 1, 0).cross(camDir);
      if (axis.lengthSq() < 1e-10) axis.set(1, 0, 0).cross(camDir);
    }
    axis.normalize();
    // Proportional approach (ease-out) with a floor; capped at the
    // remaining angle so arrival never overshoots.
    const turn = Math.min(angle, Math.max(angle * APPROACH_RATE, MIN_SPEED) * dt);
    step.setFromAxisAngle(axis, turn);
    group.quaternion.premultiply(step);
  }

  return { flyTo, cancel, update };
}
