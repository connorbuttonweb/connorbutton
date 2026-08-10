// Project markers: a thin OPAQUE disk recessed into a socket in the
// ball's surface at each assigned vertex, engraved with the project's
// title. Unassigned vertices get nothing at all. All children of the
// rotating group. sphere.js imports DISK_RADIUS to stop the lattice
// edges at the socket rim (nothing may poke across the inlay).

import { PALETTE, ICE, ICE_BRIGHT } from './palette.js';

export const DISK_RADIUS = 0.22;
const DISK_THICKNESS = 0.045;
// Sink the disk visibly below the surrounding facet planes -- recessed
// under the translucent glass, not surface-mounted.
const SINK = 0.955;

// Orients an object so its +Z faces outward along the vertex normal,
// with roll chosen so the object's "up" tracks the group's +Y (text
// stays upright relative to the ball). Falls back near the Y poles
// where that reference is degenerate.
export function orientOutward(THREE, object, normal) {
  const zAxis = normal.clone().normalize();
  const upRef =
    Math.abs(zAxis.y) > 0.99 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const xAxis = new THREE.Vector3().crossVectors(upRef, zAxis).normalize();
  const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis);
  object.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
}

// Cap face built like a struck coin, with one coherent implied light
// from the top-left (all shading baked -- the scene is unlit):
// dimensional outer edge with an arc highlight/shadow pair, a raised
// rim band separated from the field by an incuse line, denticle ticks,
// faint concentric lathe lines on the field, and the title engraved
// with shading tight to the letterforms -- no detached shadow ghosts.
function makeCapTexture(THREE, title) {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c = size / 2;

  const ring = (r, width, style) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.stroke();
  };

  // Field base with a near-flat diagonal luminance ramp -- one light,
  // top-left, no off-center hotspot.
  ctx.fillStyle = '#21272e';
  ctx.fillRect(0, 0, size, size);
  const ramp = ctx.createLinearGradient(c - 180, c - 180, c + 180, c + 180);
  ramp.addColorStop(0, 'rgba(255, 255, 255, 0.12)');
  ramp.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
  ramp.addColorStop(1, 'rgba(0, 0, 0, 0.18)');
  ctx.fillStyle = ramp;
  ctx.fillRect(0, 0, size, size);

  // Concentric lathe lines, like a proof coin's field.
  for (let r = 34; r <= 194; r += 14) {
    ring(r, 1, r % 28 === 6 ? 'rgba(255,255,255,0.028)' : 'rgba(0,0,0,0.035)');
  }

  // Raised rim band: slightly lighter annulus, incuse line at its
  // inner edge with a fine catch-light just inside.
  ctx.beginPath();
  ctx.arc(c, c, 240, 0, Math.PI * 2);
  ctx.arc(c, c, 202, 0, Math.PI * 2, true);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.fill();
  ring(202, 2, 'rgba(0, 0, 0, 0.45)');
  ring(198, 1, 'rgba(255, 255, 255, 0.14)');

  // Denticle ticks just inside the rim band.
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.055)';
    ctx.beginPath();
    ctx.moveTo(c + cos * 208, c + sin * 208);
    ctx.lineTo(c + cos * 218, c + sin * 218);
    ctx.stroke();
  }

  // Dimensional outer edge: dark falloff all around, then a bright arc
  // where the top-left light grazes the rim and a soft shadow arc
  // opposite. (Canvas y points down: top-left is angle 5pi/4.)
  ring(248, 7, 'rgba(0, 0, 0, 0.55)');
  const edgeArc = (center, spread, style, width) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(c, c, 245, center - spread, center + spread);
    ctx.stroke();
  };
  edgeArc((5 * Math.PI) / 4, 1.05, `rgba(${ICE_BRIGHT}, 0.8)`, 4);
  edgeArc((5 * Math.PI) / 4, 0.5, 'rgba(255, 255, 255, 0.55)', 2);
  edgeArc(Math.PI / 4, 1.05, 'rgba(0, 0, 0, 0.5)', 4);
  // Faint answering glint on the rim band itself.
  ctx.strokeStyle = `rgba(${ICE_BRIGHT}, 0.22)`;
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(c, c, 220, (5 * Math.PI) / 4 - 0.8, (5 * Math.PI) / 4 + 0.8);
  ctx.stroke();

  // Engraved title.
  const fontSize = title.length > 6 ? 92 : 116;
  const font = `700 ${fontSize}px "Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, sans-serif`;
  const applyType = (context) => {
    context.font = font;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    if ('letterSpacing' in context) context.letterSpacing = '8px';
  };

  // Recess floor: darker than the field, lightening toward the bottom
  // where the floor meets the lit lower wall. Masked to the glyphs on
  // an offscreen layer (canvas has no direct text clip).
  const layer = document.createElement('canvas');
  layer.width = size;
  layer.height = size;
  const lctx = layer.getContext('2d');
  const recess = lctx.createLinearGradient(0, c - fontSize * 0.55, 0, c + fontSize * 0.55);
  recess.addColorStop(0, '#0d1115');
  recess.addColorStop(0.65, '#1a2026');
  recess.addColorStop(1, '#2e363e');
  lctx.fillStyle = recess;
  lctx.fillRect(0, 0, size, size);
  lctx.globalCompositeOperation = 'destination-in';
  applyType(lctx);
  lctx.fillText(title, c, c);
  applyType(ctx);
  ctx.drawImage(layer, 0, 0);

  // Wall shading hugging the letterforms: shadow along the top edges,
  // catch-light along the bottom lips. Small offsets only.
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.lineWidth = 2;
  ctx.strokeText(title, c, c - 1.5);
  ctx.strokeStyle = `rgba(${ICE_BRIGHT}, 0.42)`;
  ctx.lineWidth = 1.5;
  ctx.strokeText(title, c, c + 2);

  const texture = new THREE.CanvasTexture(canvas);
  // After the disk geometry's rotateX (cylinder axis -> +Z), the cap's
  // UV axes land 90 degrees off: canvas-horizontal runs down the screen.
  // Counter-rotate the texture -- by -PI/2 rather than +PI/2, so the
  // engraving reads upright at the end of the autopilot flight (the
  // canonical approach: the boot -> antipode flight somersaults the
  // sphere top-over-bottom, which lands a +PI/2 engraving upside down).
  texture.center.set(0.5, 0.5);
  texture.rotation = -Math.PI / 2;
  return texture;
}

export function buildMedallions({ THREE, group, vertices, projects }) {
  // Cylinder axis is +Y; bake a rotation so it runs along +Z, which is
  // what orientOutward points away from the sphere's center.
  const diskGeometry = new THREE.CylinderGeometry(DISK_RADIUS, DISK_RADIUS, DISK_THICKNESS, 48);
  diskGeometry.rotateX(Math.PI / 2);
  const sideMaterial = new THREE.MeshBasicMaterial({ color: PALETTE.diskSide });
  // The inward face is what shows through the glass from the far side;
  // mid-grey keeps that tease a soft silhouette instead of a black hole.
  const backMaterial = new THREE.MeshBasicMaterial({ color: 0x2b333c });

  vertices.forEach((v, i) => {
    const project = projects[i] || null;
    if (!project) return;

    // Group order after rotateX: [side, +Z cap (top), -Z cap (bottom)].
    const disk = new THREE.Mesh(diskGeometry, [
      sideMaterial,
      new THREE.MeshBasicMaterial({ map: makeCapTexture(THREE, project.title) }),
      backMaterial,
    ]);
    disk.position.copy(v).multiplyScalar(SINK);
    orientOutward(THREE, disk, v);
    group.add(disk);
  });

  // The disk is deliberately still: a solid inlay in a living surface.
  // Hover feedback comes from the hologram; nothing to animate here,
  // but keep the update contract main.js's frame loop expects.
  function update() {}

  return { update };
}
