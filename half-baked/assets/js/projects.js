// Sparse map: vertex index -> project. Valid keys are 0-41 (see
// sphere.js createGeometry: 0-11 are the base icosahedron vertices,
// 12-41 the subdivision midpoints; indices are deterministic across
// loads). Any index absent here renders as a dormant empty ring --
// hovering/clicking it does nothing.
//
// To add a project: pick a free index (avoid 0 -- the camera boots
// aimed straight at it, so a project there would be given away
// instantly), add { slug, title, url }, and create
// half-baked/<slug>/index.html linking half-baked/assets/css/newday.css.
// Nothing else needs to change. An optional `logo` field (image path)
// is reserved for engraving artwork instead of title text -- not
// implemented yet; title text is what gets engraved today.
export const PROJECTS = {
  3: { slug: 'pods', title: 'PODS', url: '/half-baked/pods/' },
};
