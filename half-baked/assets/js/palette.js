// Single source of truth for the scene's color temperature. Everything
// luminous -- lattice, body fill, medallions, hologram, dust -- draws
// from this ice-blue family so the whole scene reads as one material.
// newday.css's back-link glow is kept in sync with these by hand.

export const PALETTE = {
  edge: 0xe4eefa,   // lattice lines
  facet: 0xd8e0ea,  // milky polygon-fill base tone (shaded per face)
  bloom: 0x8cc6ff,  // central core bloom
  dust: 0xbfdcff,   // ambient background points
  diskFace: 0x232a31, // opaque project disk body (smoked graphite)
  diskSide: 0x1c232a, // project disk rim/underside
};

// rgb component strings for canvas-texture painting:
// use as `rgba(${ICE}, 0.4)`.
export const ICE = '190, 216, 255';
export const ICE_BRIGHT = '228, 241, 255';
