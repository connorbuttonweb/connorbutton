// Autopilot: smoothly rotates the sphere so a chosen vertex faces the
// camera WITH its engraving upright. Fires only when a project is
// actually chosen (coin tap or coin-index click) -- it flies the coin to
// dead-center, then hands off to the departure zoom via the arrival
// callback. A real pointer grab cancels the flight and its pending
// navigation: the user's hand outranks the autopilot.
//
// The flight targets a full orientation, not just a direction: aiming
// the vertex alone leaves the roll to chance, and a shortest-arc turn
// lands most coins with their title sideways or upside down. For PODS
// from boot (the antipode) the two constraints pin the same 180-degree
// somersault the old direction-only flight produced, so that trip is
// unchanged.

import { orientOutward } from './medallions.js';

export function createAutopilot({ THREE, group, camera, vertices }) {
  // Where a vertex's world direction must point to be dead-center, and
  // which way is "up" on screen. Captured at boot: the camera only moves
  // during departure, after flights end.
  const camDir = camera.position.clone().normalize();
  const screenUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const screenRight = new THREE.Vector3().crossVectors(screenUp, camDir).normalize();
  const targetBasis = new THREE.Matrix4().makeBasis(screenRight, screenUp, camDir);

  const ARRIVE_ANGLE = 0.03;      // rad -- "fully rotated to it"
  const APPROACH_RATE = 4;        // fraction of remaining angle per second
  const MIN_SPEED = 0.8;          // rad/s floor so long flights don't tail off

  // Group rotation that puts vertex `index` at camDir with its disk's
  // engraving upright. The engraving reads upright when the disk's local
  // -Y points screen-up (medallions.js bakes the cap texture that way),
  // so the source frame is [right, disk -Y, outward normal] and the
  // target frame is [screen right, screen up, camDir].
  const probe = new THREE.Object3D();
  function targetQuaternionFor(index) {
    const normal = vertices[index].clone().normalize();
    orientOutward(THREE, probe, normal);
    const up = new THREE.Vector3(0, -1, 0).applyQuaternion(probe.quaternion);
    const right = new THREE.Vector3().crossVectors(up, normal).normalize();
    const sourceBasis = new THREE.Matrix4().makeBasis(right, up, normal);
    // target = T * S^-1 (S is orthonormal, so its inverse is its transpose).
    const rotation = new THREE.Matrix4().multiplyMatrices(targetBasis, sourceBasis.clone().transpose());
    return new THREE.Quaternion().setFromRotationMatrix(rotation);
  }

  let target = null;
  let onArrive = null;

  // Fly to the coin and fire the callback only on arrival.
  function flyTo(index, callback) {
    target = targetQuaternionFor(index);
    onArrive = callback;
  }

  // Pointer grab: cancel the flight, including its pending navigation.
  function cancel() {
    target = null;
    onArrive = null;
  }

  function update(dt) {
    if (target === null) return;
    const angle = group.quaternion.angleTo(target);
    if (angle < ARRIVE_ANGLE) {
      group.quaternion.copy(target);
      const callback = onArrive;
      onArrive = null;
      target = null;
      if (callback) callback();
      return;
    }
    // Proportional approach (ease-out) with a floor; rotateTowards caps
    // the step at the remaining angle so arrival never overshoots.
    const turn = Math.max(angle * APPROACH_RATE, MIN_SPEED) * dt;
    group.quaternion.rotateTowards(target, turn);
  }

  return { flyTo, cancel, update };
}
