// Geodesic sphere geometry for the mind-map ball: a golden-ratio
// icosahedron subdivided once into 42 vertices / 120 edges / 80 faces.
// Vertices are hand-derived (not THREE.IcosahedronGeometry, whose
// non-indexed BufferGeometry duplicates vertices per face and has no
// stable index) because projects.js addresses vertices by fixed index:
// the 12 originals keep indices 0-11, midpoint vertices get
// 12 + (canonical parent-edge index) -- deterministic across loads.
//
// Rendering fakes a depth-of-field photograph with core Three.js only
// (no postprocessing stack is vendored): front-facing lattice is crisp,
// the far side melts into faded lines and enlarged soft bokeh dots, and
// a soft atmosphere ring blurs the limb.

import { PALETTE } from './palette.js';
import { DISK_RADIUS } from './medallions.js';

export const RADIUS = 2;

const PHI = (1 + Math.sqrt(5)) / 2;

// Standard golden-ratio icosahedron construction. Index order matters:
// projects.js and main.js's boot-time assertion both depend on it.
const RAW_VERTICES = [
  [0, 1, PHI], [0, 1, -PHI], [0, -1, PHI], [0, -1, -PHI],
  [1, PHI, 0], [1, -PHI, 0], [-1, PHI, 0], [-1, -PHI, 0],
  [PHI, 0, 1], [PHI, 0, -1], [-PHI, 0, 1], [-PHI, 0, -1],
];

function baseVertices(THREE) {
  return RAW_VERTICES.map(([x, y, z]) => {
    const len = Math.sqrt(x * x + y * y + z * z);
    return new THREE.Vector3(x, y, z).multiplyScalar(RADIUS / len);
  });
}

// Every icosahedron vertex has exactly 5 nearest neighbors (its true
// edges), with a clean numeric gap to the next-nearest ring -- no
// epsilon-tuning risk taking the 5 closest. Returned canonically
// ([lo, hi], sorted) because midpoint vertex indices are assigned from
// this list's order and must never shift between loads.
function baseEdges(vertices) {
  const seen = new Set();
  const edges = [];
  vertices.forEach((v, i) => {
    vertices
      .map((u, j) => ({ j, d: i === j ? Infinity : v.distanceTo(u) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 5)
      .forEach(({ j }) => {
        const lo = Math.min(i, j);
        const hi = Math.max(i, j);
        const key = `${lo}-${hi}`;
        if (!seen.has(key)) {
          seen.add(key);
          edges.push([lo, hi]);
        }
      });
  });
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return edges;
}

// Faces are the mutually-adjacent vertex triples -- derived from the
// edge list rather than hand-typed, same no-epsilon spirit as above.
function facesFromEdges(edges, vertexCount) {
  const adjacent = new Set(edges.map(([a, b]) => `${a}-${b}`));
  const has = (a, b) => adjacent.has(a < b ? `${a}-${b}` : `${b}-${a}`);
  const faces = [];
  for (let a = 0; a < vertexCount; a++) {
    for (let b = a + 1; b < vertexCount; b++) {
      if (!has(a, b)) continue;
      for (let c = b + 1; c < vertexCount; c++) {
        if (has(b, c) && has(a, c)) faces.push([a, b, c]);
      }
    }
  }
  return faces;
}

// One level of Loop-style subdivision: each edge midpoint becomes a new
// vertex (pushed back out to RADIUS), each face splits into 4.
function subdivide(vertices, edges, faces) {
  const midIndexByEdge = new Map();
  const outVertices = vertices.map((v) => v.clone());
  edges.forEach(([a, b], k) => {
    const m = vertices[a].clone().add(vertices[b]).normalize().multiplyScalar(RADIUS);
    midIndexByEdge.set(`${a}-${b}`, vertices.length + k);
    outVertices.push(m);
  });
  const mid = (a, b) => midIndexByEdge.get(a < b ? `${a}-${b}` : `${b}-${a}`);
  const outFaces = [];
  faces.forEach(([a, b, c]) => {
    const ab = mid(a, b);
    const bc = mid(b, c);
    const ca = mid(c, a);
    outFaces.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
  });
  return { vertices: outVertices, faces: outFaces };
}

function edgesFromFaces(faces) {
  const seen = new Set();
  const edges = [];
  faces.forEach(([a, b, c]) => {
    [[a, b], [b, c], [c, a]].forEach(([p, q]) => {
      const lo = Math.min(p, q);
      const hi = Math.max(p, q);
      const key = `${lo}-${hi}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push([lo, hi]);
      }
    });
  });
  return edges;
}

export function createGeometry(THREE) {
  const v0 = baseVertices(THREE);
  const e0 = baseEdges(v0);
  const f0 = facesFromEdges(e0, v0.length);
  const { vertices, faces } = subdivide(v0, e0, f0);
  const edges = edgesFromFaces(faces);
  console.assert(
    vertices.length === 42 && edges.length === 120 && faces.length === 80,
    'geodesic subdivision drifted from expected 42 vertices / 120 edges / 80 faces'
  );
  return { vertices, edges, faces };
}

export function createGlowTexture(THREE) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// Soft ring for the limb "out of focus" atmosphere: transparent center,
// gentle peak near the sphere's silhouette, feathered outward.
function createAtmosphereTexture(THREE) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c = size / 2;
  const gradient = ctx.createRadialGradient(c, c, 0, c, c, c);
  gradient.addColorStop(0, 'rgba(255,255,255,0)');
  gradient.addColorStop(0.68, 'rgba(255,255,255,0)');
  gradient.addColorStop(0.78, 'rgba(255,255,255,0.45)');
  gradient.addColorStop(0.9, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// One solid translucent colour -- the body is a quiet white glass now;
// depth cues come from the DOF treatment, not facet shading.
function buildFillGeometry(THREE, vertices, faces) {
  const positions = new Float32Array(faces.length * 9);
  faces.forEach(([a, b, c], f) => {
    [vertices[a], vertices[b], vertices[c]].forEach((v, k) => {
      const o = f * 9 + k * 3;
      positions[o + 0] = v.x;
      positions[o + 1] = v.y;
      positions[o + 2] = v.z;
    });
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return geometry;
}

function buildFillMaterial(THREE, side, opacity) {
  return new THREE.MeshBasicMaterial({
    color: PALETTE.facet,
    transparent: true,
    opacity,
    depthWrite: false,
    side,
  });
}

// Visual group + per-frame focus update. `sockets` is the set of vertex
// indices occupied by a project disk: their converging edges stop at
// the disk rim instead of the vertex (nothing pokes across the inlay)
// and they get no bokeh dot.
export function buildSphereGroup(THREE, vertices, edges, faces, sockets) {
  const group = new THREE.Group();
  const edgeTint = new THREE.Color(PALETTE.edge);

  // Lattice. Endpoints touching a socket are pulled back along the
  // edge; a small margin keeps a clean gap to the disk rim.
  const clip = DISK_RADIUS * 1.2;
  const positions = new Float32Array(edges.length * 6);
  const endpointVertex = new Array(edges.length * 2);
  const tmp = new THREE.Vector3();
  edges.forEach(([a, b], i) => {
    const pa = vertices[a].clone();
    const pb = vertices[b].clone();
    if (sockets.has(a)) pa.add(tmp.copy(pb).sub(pa).setLength(clip));
    if (sockets.has(b)) pb.add(tmp.copy(pa).sub(pb).setLength(clip));
    positions[i * 6 + 0] = pa.x;
    positions[i * 6 + 1] = pa.y;
    positions[i * 6 + 2] = pa.z;
    positions[i * 6 + 3] = pb.x;
    positions[i * 6 + 4] = pb.y;
    positions[i * 6 + 5] = pb.z;
    endpointVertex[i * 2] = a;
    endpointVertex[i * 2 + 1] = b;
  });
  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const lineColors = new Float32Array(edges.length * 6);
  const lineColorAttr = new THREE.BufferAttribute(lineColors, 3);
  lineGeometry.setAttribute('color', lineColorAttr);
  const lineMaterial = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  group.add(new THREE.LineSegments(lineGeometry, lineMaterial));

  // Solid translucent body.
  const fillGeometry = buildFillGeometry(THREE, vertices, faces);
  group.add(new THREE.Mesh(fillGeometry, buildFillMaterial(THREE, THREE.BackSide, 0.07)));
  group.add(new THREE.Mesh(fillGeometry, buildFillMaterial(THREE, THREE.FrontSide, 0.14)));

  // Bokeh node dots: small and crisp when front-facing, swelling into
  // dim out-of-focus discs as they rotate to the far side -- the
  // photographic depth-of-field illusion.
  const dotTexture = createGlowTexture(THREE);
  const bokehDots = [];
  vertices.forEach((v, i) => {
    if (sockets.has(i)) return;
    const material = new THREE.SpriteMaterial({
      map: dotTexture,
      color: PALETTE.dust,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(v);
    group.add(sprite);
    bokehDots.push({ sprite, vertex: v });
  });

  // Limb atmosphere: a soft billboard ring hugging the silhouette so
  // the sphere's sides melt instead of ending in a hard polygon edge.
  const atmosphere = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: createAtmosphereTexture(THREE),
      color: PALETTE.facet,
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  atmosphere.scale.set(RADIUS * 2.62, RADIUS * 2.62, 1);
  group.add(atmosphere);

  // Per-frame focus pass: facing = how directly a vertex points at the
  // camera (+1 front, -1 far side).
  const camForward = new THREE.Vector3();
  const worldDir = new THREE.Vector3();
  function update(camera) {
    camera.getWorldDirection(camForward);
    for (let e = 0; e < endpointVertex.length; e++) {
      worldDir.copy(vertices[endpointVertex[e]]).applyQuaternion(group.quaternion).normalize();
      const t = (-worldDir.dot(camForward) + 1) / 2; // 1 front, 0 back
      const intensity = 0.17 + 0.83 * t * t;
      lineColors[e * 3 + 0] = edgeTint.r * intensity;
      lineColors[e * 3 + 1] = edgeTint.g * intensity;
      lineColors[e * 3 + 2] = edgeTint.b * intensity;
    }
    lineColorAttr.needsUpdate = true;
    bokehDots.forEach(({ sprite, vertex }) => {
      worldDir.copy(vertex).applyQuaternion(group.quaternion).normalize();
      const t = (-worldDir.dot(camForward) + 1) / 2;
      const s = 0.07 + (1 - t) * 0.27;
      sprite.scale.set(s, s, 1);
      sprite.material.opacity = 0.25 + t * 0.5;
    });
  }

  return { group, update };
}

// The ambient background dust that used to live here is now its own
// simulation -- see dust.js, which imports RADIUS and createGlowTexture
// from this module.
