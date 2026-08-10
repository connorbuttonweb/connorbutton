// Hover hologram: the project's title rises out of its engraved
// medallion on a column of light, with a scanline texture and a subtle
// shimmer. Replaces the old cursor-side DOM label entirely.
//
// Lives at scene level (NOT inside the rotating group) and re-anchors
// to the vertex's world position every frame: the rise direction is
// screen-up, because rising along the surface normal fails exactly when
// it matters most -- a front-facing medallion's normal points straight
// at the camera, which would leave the title sitting on top of the
// engraving instead of floating above it.

import { ICE, ICE_BRIGHT } from './palette.js';

const RISE_HEIGHT = 0.62;   // world units above the medallion at full rise
const BASE_LIFT = 0.12;     // where the title starts, just off the disc
const RISE_TIME = 0.28;     // seconds for the rise/fade (reverses on unhover)
const BEAM_WIDTH = 0.3;

// Vertical bright-to-transparent gradient, faded at the horizontal
// edges: the column of light the title rides up on.
function makeBeamTexture(THREE) {
  const w = 128;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const vertical = ctx.createLinearGradient(0, h, 0, 0);
  vertical.addColorStop(0, `rgba(${ICE_BRIGHT}, 0.5)`);
  vertical.addColorStop(0.55, `rgba(${ICE}, 0.16)`);
  vertical.addColorStop(1, `rgba(${ICE}, 0)`);
  ctx.fillStyle = vertical;
  ctx.fillRect(0, 0, w, h);
  const horizontal = ctx.createLinearGradient(0, 0, w, 0);
  horizontal.addColorStop(0, 'rgba(0,0,0,0)');
  horizontal.addColorStop(0.5, 'rgba(0,0,0,1)');
  horizontal.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = horizontal;
  ctx.fillRect(0, 0, w, h);
  return new THREE.CanvasTexture(canvas);
}

// Glowing thin-weight title with scanlines punched through it.
function makeTitleTexture(THREE, title) {
  const w = 512;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.font = '200 58px "Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '14px';
  ctx.shadowColor = `rgba(${ICE_BRIGHT}, 0.9)`;
  ctx.shadowBlur = 18;
  ctx.fillStyle = `rgba(${ICE_BRIGHT}, 0.95)`;
  ctx.fillText(title, w / 2, h / 2);
  ctx.shadowBlur = 0;
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
  return new THREE.CanvasTexture(canvas);
}

function makeSpriteMaterial(THREE, map) {
  return new THREE.SpriteMaterial({
    map,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

export function createHologram({ THREE, scene, camera, group, vertices }) {
  const built = new Map(); // vertex index -> { beam, text }
  let active = null;
  let progress = 0; // 0 = fully hidden, 1 = fully risen
  let target = 0;
  let time = 0;

  // Camera is fixed in this scene, so screen-up in world space is
  // constant; computed from the camera anyway so this survives any
  // future reframing.
  const screenUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const worldPos = new THREE.Vector3();

  function build(index, title) {
    const beam = new THREE.Sprite(makeSpriteMaterial(THREE, makeBeamTexture(THREE)));
    const text = new THREE.Sprite(makeSpriteMaterial(THREE, makeTitleTexture(THREE, title)));
    text.scale.set(1.1, 0.275, 1);
    beam.visible = false;
    text.visible = false;
    scene.add(beam);
    scene.add(text);
    const entry = { beam, text };
    built.set(index, entry);
    return entry;
  }

  function show(index, project) {
    if (active && active.index !== index) {
      active.entry.beam.visible = false; // snap the old one off
      active.entry.text.visible = false;
      progress = 0;
    }
    const entry = built.get(index) || build(index, project.title);
    active = { index, entry };
    target = 1;
  }

  function hide() {
    target = 0;
  }

  function update(dt) {
    time += dt;
    if (!active) return;
    progress += ((target === 1 ? 1 : -1) * dt) / RISE_TIME;
    progress = Math.min(1, Math.max(0, progress));
    const { entry, index } = active;
    if (progress === 0 && target === 0) {
      entry.beam.visible = false;
      entry.text.visible = false;
      active = null;
      return;
    }

    // Re-anchor to the vertex's current world position so the hologram
    // stays planted on its medallion even mid-momentum-spin.
    worldPos.copy(vertices[index]).applyQuaternion(group.quaternion).multiplyScalar(1.02);
    const ease = easeOutCubic(progress);
    const lift = BASE_LIFT + RISE_HEIGHT * ease;
    const shimmer = 0.9 + 0.1 * Math.sin(time * 13);

    entry.text.visible = true;
    entry.text.position.copy(worldPos).addScaledVector(screenUp, lift);
    entry.text.material.opacity = ease * 0.95 * shimmer;

    // Beam powers on slightly ahead of the text, as if the engraving
    // lights up first and the title condenses out of it. It stretches
    // from the disc up to wherever the title currently is.
    entry.beam.visible = true;
    entry.beam.scale.set(BEAM_WIDTH, lift, 1);
    entry.beam.position.copy(worldPos).addScaledVector(screenUp, lift / 2);
    entry.beam.material.opacity = Math.min(1, progress * 1.6) * 0.55 * shimmer;
  }

  return { show, hide, update };
}
