// Ambient background dust -- a live particle field, added directly to
// the scene (not the rotating group) so it reads as atmosphere rather
// than something the user "grabs" when dragging the sphere.
//
// Behavior, per layer:
//   motes  -- float, part around the cursor, and bundle up into loose
//             knots with whichever neighbors they happen to drift near,
//             holding briefly before breaking apart again.
//   orbs   -- float and part around the cursor only. These are the big
//             out-of-focus bokeh balls; clustering at that size reads
//             as a glitch rather than depth, so cohesion stays off.
//
// Deliberately NOT a boids flock: there is no velocity alignment. Each
// particle wanders on its own and only reacts to whoever is nearby.

import { PALETTE } from './palette.js';
import { RADIUS, createGlowTexture } from './sphere.js';

// Spawn shell, matching the original static scatter.
const SHELL_MIN = RADIUS * 2.2;
const SHELL_MAX = RADIUS * 5.2;

const DAMPING = 1.1;            // exp decay per second, as in trackball.js
const SPEED_CAP = 1.6;

const CURSOR_RADIUS = 0.17;     // NDC, aspect-corrected -- the "can't touch me" bubble
const CURSOR_FORCE = 5.2;

const COHESION_RADIUS = 0.85;
const COHESION_FORCE = 0.55;
const SEPARATION_DIST = 0.3;    // keeps a bundle a loose knot, not a single point
const SEPARATION_FORCE = 2.4;
const DISPERSE_FORCE = 1.5;
const DISPERSE_TIME = 1.5;      // s spent actively breaking apart
const HOLD_MIN = 1.5;           // s bundled before letting go (randomized per particle)
const HOLD_RANGE = 1.5;
const BOND_DECAY = 0.6;         // s of bond credit shed per second when alone

const SHELL_FORCE = 1.4;

// A particle drifting into the lens renders as a huge hard blob (the
// soft map can't save a point that close), so clearance has to be
// maintained every frame -- at spawn it is only an initial condition.
const CLEARANCE_FORCE = 9;

function makeLayer(THREE, { count, clearance, size, opacity, driftSpeed, driftAmount, cohesion }) {
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const freqs = new Float32Array(count * 3);
  const phases = new Float32Array(count * 3);
  const bondTimers = new Float32Array(count);
  const disperseTimers = new Float32Array(count);
  const holdTimes = new Float32Array(count);

  const p = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    // Rejection-sample so nothing spawns inside the clearance sphere.
    do {
      const r = SHELL_MIN + Math.random() * (SHELL_MAX - SHELL_MIN);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      p.setFromSphericalCoords(r, phi, theta);
    } while (p.length() < clearance);
    positions[i * 3 + 0] = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = p.z;
    for (let a = 0; a < 3; a++) {
      // Per-particle frequencies and phases: everything wanders on its
      // own schedule instead of pulsing in unison.
      freqs[i * 3 + a] = driftSpeed * (0.6 + Math.random() * 0.8);
      phases[i * 3 + a] = Math.random() * Math.PI * 2;
    }
    holdTimes[i] = HOLD_MIN + Math.random() * HOLD_RANGE;
  }

  const geometry = new THREE.BufferGeometry();
  const attribute = new THREE.BufferAttribute(positions, 3);
  geometry.setAttribute('position', attribute);
  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      color: PALETTE.dust,
      size,
      map: createGlowTexture(THREE),
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );

  return {
    count, clearance, driftAmount, cohesion,
    positions, velocities, freqs, phases,
    bondTimers, disperseTimers, holdTimes,
    attribute, points,
  };
}

// Uniform spatial hash over one layer, rebuilt each frame: cell size is
// the cohesion radius, so a particle's neighbors can only be in its own
// cell or the 26 around it. Turns the neighbor pass from O(n^2) into
// something proportional to actual local density.
//
// Cell coordinates are packed into one integer key rather than a
// "x,y,z" string: this runs ~10k lookups a frame, and string building
// dominated the frame cost when it was measured. Particles live inside
// the containment shell, so the coordinate range fits the bias easily.
const CELL_BIAS = 512;
const cellKey = (cx, cy, cz) =>
  ((cx + CELL_BIAS) * 1024 + (cy + CELL_BIAS)) * 1024 + (cz + CELL_BIAS);

function buildHash(layer) {
  const cells = new Map();
  const { positions, count } = layer;
  for (let i = 0; i < count; i++) {
    const key = cellKey(
      Math.floor(positions[i * 3 + 0] / COHESION_RADIUS),
      Math.floor(positions[i * 3 + 1] / COHESION_RADIUS),
      Math.floor(positions[i * 3 + 2] / COHESION_RADIUS)
    );
    const bucket = cells.get(key);
    if (bucket) bucket.push(i);
    else cells.set(key, [i]);
  }
  return cells;
}

export function createDustField({ THREE, camera }) {
  const field = new THREE.Group();

  const motes = makeLayer(THREE, {
    count: 400, clearance: 2, size: 0.04, opacity: 0.4,
    driftSpeed: 0.5, driftAmount: 0.5, cohesion: true,
  });
  // Sparse out-of-focus orbs drifting outside the sphere -- the big
  // soft bokeh balls in the reference photo.
  const orbs = makeLayer(THREE, {
    count: 60, clearance: 2.5, size: 0.32, opacity: 0.16,
    driftSpeed: 0.22, driftAmount: 0.28, cohesion: false,
  });
  const layers = [motes, orbs];
  layers.forEach((layer) => field.add(layer.points));

  // Pointer tracked on window, not the canvas: the canvas stops seeing
  // moves while the pointer is over the nav links, and the particles
  // shouldn't freeze mid-parting when that happens.
  let pointerActive = false;
  let pointerNdcX = 0;
  let pointerNdcY = 0;
  window.addEventListener('pointermove', (e) => {
    pointerActive = true;
    pointerNdcX = (e.clientX / window.innerWidth) * 2 - 1;
    pointerNdcY = -((e.clientY / window.innerHeight) * 2 - 1);
  });
  window.addEventListener('pointerleave', () => {
    pointerActive = false;
  });

  const projected = new THREE.Vector3();
  const camRight = new THREE.Vector3();
  const camUp = new THREE.Vector3();
  const camBack = new THREE.Vector3(); // unused; extractBasis needs all three
  let time = 0;

  function updateLayer(layer, dt, aspect, decay) {
    const {
      count, clearance, driftAmount, cohesion,
      positions, velocities, freqs, phases,
      bondTimers, disperseTimers, holdTimes,
    } = layer;
    const cells = cohesion ? buildHash(layer) : null;

    for (let i = 0; i < count; i++) {
      const ix = i * 3;
      const px = positions[ix];
      const py = positions[ix + 1];
      const pz = positions[ix + 2];
      let ax = 0;
      let ay = 0;
      let az = 0;

      // 1. Float: smooth independent wander.
      ax += Math.sin(time * freqs[ix] + phases[ix]) * driftAmount;
      ay += Math.sin(time * freqs[ix + 1] + phases[ix + 1]) * driftAmount;
      az += Math.sin(time * freqs[ix + 2] + phases[ix + 2]) * driftAmount;

      // 2. Bundling: gather toward nearby neighbors, hold, then break.
      if (cohesion) {
        let sumX = 0;
        let sumY = 0;
        let sumZ = 0;
        let neighbors = 0;
        const cx = Math.floor(px / COHESION_RADIUS);
        const cy = Math.floor(py / COHESION_RADIUS);
        const cz = Math.floor(pz / COHESION_RADIUS);
        for (let ox = -1; ox <= 1; ox++) {
          for (let oy = -1; oy <= 1; oy++) {
            for (let oz = -1; oz <= 1; oz++) {
              const bucket = cells.get(cellKey(cx + ox, cy + oy, cz + oz));
              if (!bucket) continue;
              for (let b = 0; b < bucket.length; b++) {
                const j = bucket[b];
                if (j === i) continue;
                const jx = j * 3;
                const dx = positions[jx] - px;
                const dy = positions[jx + 1] - py;
                const dz = positions[jx + 2] - pz;
                const distSq = dx * dx + dy * dy + dz * dz;
                if (distSq > COHESION_RADIUS * COHESION_RADIUS || distSq < 1e-9) continue;
                neighbors++;
                sumX += dx;
                sumY += dy;
                sumZ += dz;
                // Short-range separation: a bundle should read as a
                // loose knot, never collapse into one bright point.
                if (distSq < SEPARATION_DIST * SEPARATION_DIST) {
                  const dist = Math.sqrt(distSq);
                  const push = (SEPARATION_FORCE * (1 - dist / SEPARATION_DIST)) / dist;
                  ax -= dx * push;
                  ay -= dy * push;
                  az -= dz * push;
                }
              }
            }
          }
        }

        if (disperseTimers[i] > 0) {
          // Actively breaking apart: shove away from the group and
          // refuse to re-bond until the timer runs out.
          disperseTimers[i] -= dt;
          if (neighbors > 0) {
            const inv = 1 / neighbors;
            ax -= sumX * inv * DISPERSE_FORCE;
            ay -= sumY * inv * DISPERSE_FORCE;
            az -= sumZ * inv * DISPERSE_FORCE;
          }
        } else if (neighbors > 0) {
          const inv = 1 / neighbors;
          ax += sumX * inv * COHESION_FORCE;
          ay += sumY * inv * COHESION_FORCE;
          az += sumZ * inv * COHESION_FORCE;
          bondTimers[i] += dt;
          if (bondTimers[i] > holdTimes[i]) {
            bondTimers[i] = 0;
            disperseTimers[i] = DISPERSE_TIME;
            // Re-roll so bundles don't fall into a shared rhythm.
            holdTimes[i] = HOLD_MIN + Math.random() * HOLD_RANGE;
          }
        } else if (bondTimers[i] > 0) {
          bondTimers[i] = Math.max(0, bondTimers[i] - BOND_DECAY * dt);
        }
      }

      // 3. Cursor parting: compared in screen space so the bubble stays
      // a consistent circle no matter how deep the particle sits.
      if (pointerActive) {
        projected.set(px, py, pz).project(camera);
        if (projected.z < 1) {
          const dx = (projected.x - pointerNdcX) * aspect;
          const dy = projected.y - pointerNdcY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < CURSOR_RADIUS) {
            // Falloff toward the rim; nudge dead-on hits sideways
            // rather than letting them sit at a zero-length direction.
            const strength = CURSOR_FORCE * (1 - dist / CURSOR_RADIUS);
            const nx = dist > 1e-4 ? dx / dist : 1;
            const ny = dist > 1e-4 ? dy / dist : 0;
            ax += (camRight.x * nx + camUp.x * ny) * strength;
            ay += (camRight.y * nx + camUp.y * ny) * strength;
            az += (camRight.z * nx + camUp.z * ny) * strength;
          }
        }
      }

      // 4. Containment: hold the shell band, and never let anything
      // wander into the lens.
      const r = Math.sqrt(px * px + py * py + pz * pz);
      if (r > 1e-4) {
        if (r > SHELL_MAX || r < SHELL_MIN) {
          const target = r > SHELL_MAX ? SHELL_MAX : SHELL_MIN;
          const pull = ((target - r) * SHELL_FORCE) / r;
          ax += px * pull;
          ay += py * pull;
          az += pz * pull;
        }
      }
      const cdx = px - camera.position.x;
      const cdy = py - camera.position.y;
      const cdz = pz - camera.position.z;
      const camDist = Math.sqrt(cdx * cdx + cdy * cdy + cdz * cdz);
      if (camDist < clearance && camDist > 1e-4) {
        const push = (CLEARANCE_FORCE * (1 - camDist / clearance)) / camDist;
        ax += cdx * push;
        ay += cdy * push;
        az += cdz * push;
      }

      // Integrate. `decay` is the frame's damping factor, computed once
      // per frame rather than per component.
      let vx = (velocities[ix] + ax * dt) * decay;
      let vy = (velocities[ix + 1] + ay * dt) * decay;
      let vz = (velocities[ix + 2] + az * dt) * decay;
      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (speed > SPEED_CAP) {
        const scale = SPEED_CAP / speed;
        vx *= scale;
        vy *= scale;
        vz *= scale;
      }
      velocities[ix] = vx;
      velocities[ix + 1] = vy;
      velocities[ix + 2] = vz;
      positions[ix] = px + vx * dt;
      positions[ix + 1] = py + vy * dt;
      positions[ix + 2] = pz + vz * dt;
    }

    layer.attribute.needsUpdate = true;
  }

  function update(dt) {
    if (!field.visible) return; // hidden for the departure zoom
    time += dt;
    // Screen-plane basis for cursor pushes, and the aspect correction
    // that keeps the bubble round in NDC.
    camera.matrixWorld.extractBasis(camRight, camUp, camBack);
    const aspect = window.innerWidth / window.innerHeight;
    const decay = Math.exp(-DAMPING * dt);
    layers.forEach((layer) => updateLayer(layer, dt, aspect, decay));
  }

  return { field, update };
}
