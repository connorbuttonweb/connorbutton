// Node hit-testing: invisible tap targets at each vertex, raycasting,
// front-facing gate, hologram hover. Tapping a project coin reports it
// via onSelect -- navigation itself is main.js's job (fly + depart).

const HIT_RADIUS = 0.28; // bigger than the visual marker -- forgiving mobile tap target
const FRONT_FACING_THRESHOLD = 0.15;

export function buildHitTestMeshes(THREE, group, vertices, projects) {
  const geometry = new THREE.SphereGeometry(HIT_RADIUS, 12, 12);
  // transparent+opacity:0, NOT visible:false -- Three's raycaster skips
  // objects with visible === false entirely. depthWrite must be off or
  // these invisible spheres punch holes in the additive glow behind
  // them and z-cull the medallions drawn at the same vertices.
  const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  return vertices.map((v, i) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(v);
    mesh.userData.vertexIndex = i;
    mesh.userData.project = projects[i] || null;
    group.add(mesh);
    return mesh;
  });
}

// A vertex's local position is its own outward normal on a sphere
// centered at the origin. Rotating that by the group's current
// orientation gives its current world-space facing.
function isFrontFacing(THREE, vertex, group, camera) {
  const worldDir = vertex.clone().applyQuaternion(group.quaternion).normalize();
  const camForward = camera.getWorldDirection(new THREE.Vector3());
  return worldDir.dot(camForward) < -FRONT_FACING_THRESHOLD;
}

export function createNodeSystem({ THREE, camera, group, vertices, hitMeshes, canvas, hologram, onSelect }) {
  const raycaster = new THREE.Raycaster();
  const pointerNDC = new THREE.Vector2();
  let lastClientX = null;
  let lastClientY = null;
  let hoveredMesh = null;

  function toNDC(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    pointerNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointerNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  }

  // Without this gate, a ray toward a back-side node would pass clean
  // through the translucent body and register a geometric hit even
  // while that node is visually hidden on the far side -- breaking the
  // "must rotate to find it" promise.
  function pickVisibleNode(clientX, clientY) {
    toNDC(clientX, clientY);
    raycaster.setFromCamera(pointerNDC, camera);
    const hits = raycaster.intersectObjects(hitMeshes, false);
    for (const hit of hits) {
      const i = hit.object.userData.vertexIndex;
      if (isFrontFacing(THREE, vertices[i], group, camera)) return hit.object;
    }
    return null;
  }

  function setHover(mesh) {
    if (mesh === hoveredMesh) return;
    hoveredMesh = mesh;
    if (mesh) {
      canvas.style.cursor = 'pointer';
      hologram.show(mesh.userData.vertexIndex, mesh.userData.project);
    } else {
      canvas.style.cursor = 'default';
      hologram.hide();
    }
  }

  // Called every animation frame (not just on pointermove) so a node
  // that rotates under a stationary cursor during momentum spin doesn't
  // leave a stale hover/hologram state.
  function refreshHover() {
    if (lastClientX === null) return;
    const mesh = pickVisibleNode(lastClientX, lastClientY);
    setHover(mesh && mesh.userData.project ? mesh : null);
  }

  function onPointerMove(e) {
    lastClientX = e.clientX;
    lastClientY = e.clientY;
  }

  function handleTap(clientX, clientY) {
    const mesh = pickVisibleNode(clientX, clientY);
    if (mesh && mesh.userData.project) {
      onSelect(mesh.userData.vertexIndex, mesh.userData.project);
    }
  }

  canvas.addEventListener('pointermove', onPointerMove);

  return { refreshHover, handleTap };
}
