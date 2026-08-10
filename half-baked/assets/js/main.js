import * as THREE from './vendor/three.module.min.js';
import { PROJECTS } from './projects.js';
import { createGeometry, buildSphereGroup } from './sphere.js';
import { createDustField } from './dust.js';
import { buildMedallions } from './medallions.js';
import { createHologram } from './hologram.js';
import { createTrackball } from './trackball.js';
import { createAutopilot } from './autopilot.js';
import { createDeparture } from './departure.js';
import { buildHitTestMeshes, createNodeSystem } from './nodes.js';

const canvas = document.getElementById('nd-canvas');

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);

const { vertices, edges, faces } = createGeometry(THREE);

// Aim the camera through vertex 0 -- (0, 1, PHI) normalized -- so it's the
// unique nearest vertex and its antipode (index 3, PODS) starts on the
// far, hidden side of the sphere. See projects.js for the index mapping.
const CAMERA_DISTANCE = 6;
camera.position.copy(vertices[0]).normalize().multiplyScalar(CAMERA_DISTANCE);
camera.lookAt(0, 0, 0);

// Transparent clear: the page's dot-grid + vignette background (see
// newday.css) shows through behind the scene.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0);

// Socket vertices (occupied by a project disk) get clipped lattice
// edges and no bokeh dot -- see buildSphereGroup.
const sockets = new Set(Object.keys(PROJECTS).map(Number));
const sphere = buildSphereGroup(THREE, vertices, edges, faces, sockets);
const group = sphere.group;
scene.add(group);
const dust = createDustField({ THREE, camera });
scene.add(dust.field);

const medallions = buildMedallions({ THREE, group, vertices, projects: PROJECTS });
const hologram = createHologram({ THREE, scene, camera, group, vertices });
const hitMeshes = buildHitTestMeshes(THREE, group, vertices, PROJECTS);
const nodeSystem = createNodeSystem({
  THREE, camera, group, vertices, hitMeshes, canvas, hologram,
  onSelect: chooseProject,
});
const trackball = createTrackball({ THREE, canvas, camera, group, onTap: nodeSystem.handleTap });
const autopilot = createAutopilot({ THREE, group, camera, vertices });
const departure = createDeparture({ camera, canvas });

// Every way of choosing a project funnels through here: center the
// coin via the autopilot, then zoom-depart into it. Navigation happens
// inside the departure, during its background-only beat.
function chooseProject(index, project) {
  trackball.stopMomentum();
  autopilot.flyTo(index, () => {
    hologram.hide();
    dust.field.visible = false; // the dolly would fly straight through it
    departure.begin(project.url);
  });
}

// A real grab always outranks the autopilot -- including a pending
// click-flight's navigation. (Once departure begins, pointer events on
// the canvas are dead entirely -- the zoom is committed.)
canvas.addEventListener('pointerdown', () => autopilot.cancel());

// Coin index (hover-reveal list, right edge): generated from the same
// data that places the disks, so a new project shows up here for free.
// Hovering only reveals the list; clicking an entry chooses the project.
const coinsNav = document.querySelector('.nd-coins');
Object.keys(PROJECTS)
  .map(Number)
  .sort((a, b) => a - b)
  .forEach((i) => {
    const link = document.createElement('a');
    link.href = PROJECTS[i].url;
    link.textContent = PROJECTS[i].title;
    link.addEventListener('click', (e) => {
      e.preventDefault();
      chooseProject(i, PROJECTS[i]);
    });
    coinsNav.appendChild(link);
  });

// Sanity-check that PODS really sits on the vertex furthest from the
// initial camera direction -- catches drift if the geometry ever changes,
// rather than trusting the hardcoded index comment in projects.js.
const camForwardAtBoot = camera.getWorldDirection(new THREE.Vector3());
let furthestIndex = 0;
let best = -Infinity;
vertices.forEach((v, i) => {
  const d = v.clone().normalize().dot(camForwardAtBoot);
  if (d > best) {
    best = d;
    furthestIndex = i;
  }
});
console.assert(furthestIndex === 3, 'PODS vertex index drifted from geometry -- update projects.js');

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h);
}
window.addEventListener('resize', resize);
resize();

// Manual delta timing rather than THREE.Clock, which r185 deprecates in
// favor of THREE.Timer (an addons-only class we'd otherwise have to vendor).
let lastFrameTime = performance.now();
function animate() {
  const now = performance.now();
  const dt = Math.min((now - lastFrameTime) / 1000, 0.1);
  lastFrameTime = now;
  if (departure.isActive()) {
    // Mid-zoom: the dolly owns the camera; user input and hover stay
    // parked so nothing can re-show the hologram or move the sphere.
    departure.update(dt);
  } else {
    trackball.update(dt);
    autopilot.update(dt);
  }
  sphere.update(camera);
  dust.update(dt);
  medallions.update(dt);
  hologram.update(dt);
  if (!departure.isActive()) nodeSystem.refreshHover();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
// The canvas starts transparent (see newday.css) so the page paints as
// bare backdrop first; flipping .nd-live fades the scene in over it --
// which makes arriving here from a project page (or fresh) read as the
// sphere materializing out of the same background.
canvas.classList.add('nd-live');
animate();
