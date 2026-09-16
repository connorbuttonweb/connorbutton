// Sparse map: vertex index -> project. Valid keys are 0-41 (see
// sphere.js createGeometry: 0-11 are the base icosahedron vertices,
// 12-41 the subdivision midpoints; indices are deterministic across
// loads). Any index absent here renders as a dormant empty ring --
// hovering/clicking it does nothing.
//
// To add a project: pick a free index (avoid 0 -- the camera boots
// aimed straight at it, so a project there would be given away
// instantly), add { slug, title, url }, and copy an existing project
// page to half-baked/<slug>/index.html. Nothing else needs to change.
// The add-globe-project Claude Code skill (.claude/skills/) walks
// through it, including which indices are visible at boot. An optional
// `logo` field (image path) is reserved for engraving artwork instead
// of title text -- not implemented yet; title text is what gets
// engraved today.
//
// Placement at boot (camera looks through vertex 0): 3 is the antipode,
// hidden until the ball is spun; 8 is (PHI, 0, 1) -- front-right of
// centre, on show immediately. Both are deliberate.
export const PROJECTS = {
  3: { slug: 'pods', title: 'PODS', url: '/half-baked/pods/' },
  8: { slug: 'portduel', title: 'PORTDUEL', url: '/half-baked/portduel/' },
};
