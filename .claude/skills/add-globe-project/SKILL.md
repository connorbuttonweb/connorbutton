---
name: add-globe-project
description: This skill should be used when the user asks to "add a project to the globe", "add a chip to the globe selector", "add a new half-baked project", "add a coin to the sphere", "add <name> to half-baked", or otherwise wants a new entry on the /half-baked/ hub's spinning globe with its own project page. Covers picking a vertex index, registering it in projects.js, creating the page from the notepad-board template, and verifying the fly-in.
version: 1.0.0
---

# Adding a project to the half-baked globe

`/half-baked/` is a WebGL hub: a geodesic sphere with a recessed coin ("chip")
per project, plus a coin-index list on the right edge. Hovering a chip raises
a hologram title; clicking a chip or its list entry flies the sphere so the
chip is centred and upright, then zoom-departs into the project page. Every
project page is a blank zoomable/pannable notepad board until notes are added.

The hub is entirely data-driven from `half-baked/assets/js/projects.js`.
Adding a project is **two edits and no code**:

1. One line in `PROJECTS`.
2. One new folder `half-baked/<slug>/index.html`, copied from an existing page.

Everything else — socket, coin engraving, hit-testing, hologram, autopilot,
coin index, departure — picks the new entry up automatically. Nothing under
the main site's `assets/` changes, so **no `asset-pipeline` rebuild, no head
boilerplate sync, no icon rebuild** (CLAUDE.md's rules for those don't apply
to `half-baked/`, which loads `newday.css` raw).

## Step 1 — pick a vertex index

`PROJECTS` keys are vertex indices `0-41` of the sphere (`sphere.js
createGeometry`). Indices `0-11` are the twelve icosahedron corners; `12-41`
are edge midpoints. Any index already in `PROJECTS` is taken; any absent
index is a dormant ring.

The camera boots looking straight at vertex 0, so where a chip sits at boot
is decided by its index. Corner vertices, with their position when the page
loads:

| Index | Position at boot | Notes |
|---|---|---|
| 0 | dead centre, facing camera | **never use** — given away instantly |
| 2, 4, 6, 8, 10 | visible, ring around centre | 2 below, 4 upper-right, 6 upper-left, 8 right, 10 left |
| 3 | exact antipode, hidden | PODS lives here; only revealed by spinning |
| 1, 5, 7, 9, 11 | hidden, ring around the antipode | one lattice edge from 3 |

Midpoints `12-41` sit between two corners; `12 + k` is the midpoint of the
k-th edge in `baseEdges()` order (sorted `[lo, hi]` pairs). Compute it if a
corner spot isn't what's wanted rather than guessing — e.g. `33` is the
midpoint of corners 5 and 7, straight down and hidden at boot.

Ask the user whether the chip should be **visible at boot** or **hidden
until spun** if they haven't said; it's the one real design choice here.

Current assignments (check the file — this table can go stale):

- `3` — PODS (hidden at boot)
- `8` — PORTDUEL (visible, front-right)

## Step 2 — register it

In `half-baked/assets/js/projects.js` add:

```js
<index>: { slug: '<slug>', title: '<TITLE>', url: '/half-baked/<slug>/' },
```

- `title` is what gets engraved on the coin and shown in the coin index and
  hologram. Uppercase, short. Long titles are auto-shrunk to fit the coin
  rim (`medallions.js`), but past ~10 characters they get hard to read.
- Update the "Placement at boot" comment above `PROJECTS` with the new
  index and whether it's visible.
- Do **not** touch the boot-time assertion in `main.js` (`furthestIndex ===
  3`) — it guards PODS's antipode placement and is unrelated to new entries.

## Step 3 — create the page

Copy `half-baked/pods/index.html` (the blank board) to
`half-baked/<slug>/index.html` and change only the `<title>`. That gives:

- the back link (`.nd-back-hotspot`) with `page.js`'s fade-out on exit
- the zoom control (`.nd-zoom` slider + readout, 25–200%, opens at 60%)
- a 3200×2000 notepad sheet (`.nd-board` inside `.nd-board-viewport`)
  driven by the shared `half-baked/assets/js/board.js`: drag / wheel /
  shift+wheel to pan, slider / ctrl+wheel / pinch / ctrl+`+` `-` `0` to
  zoom (the browser's page-zoom keys are intercepted), opens centred on
  the first note (or the sheet centre if empty). Behaviour changes go in
  that one file and reach every page.

Notes are hand-authored on the sheet. To add one:

```html
<section class="nd-note" style="--x: 160px; --y: 160px;">
  <h1>Heading</h1>
  <p>Body text.</p>
  <div class="nd-note-actions">
    <button type="button" class="nd-chip">label</button>
  </div>
  <p class="nd-note-hint">Small muted footnote.</p>
</section>
```

`--x`/`--y` are the note's top-left corner in sheet pixels. `.nd-chip`
buttons are inert by design (no handler) until a page needs them to do
something. See `half-baked/portduel/index.html` for a populated example.

All styling lives in `half-baked/assets/css/newday.css` — the `.nd-board*`,
`.nd-note`, `.nd-chip`, `.nd-zoom*` block. Reuse those classes; don't add
per-page CSS.

## Step 4 — verify

`npm test` from repo root, open `http://localhost:<port>/half-baked/`:

- the new chip is on the sphere where expected (spin to find it if hidden)
  and its engraving sits inside the coin rim
- its entry is in the coin index on the right
- hovering the chip raises the hologram title
- clicking the chip **and** clicking the list entry both fly it to centre,
  reading upright, then zoom into `/half-baked/<slug>/`
- the console shows no `console.assert` failures
- on the project page: content fades in, zoom slider and drag-pan work,
  Back fades out and returns to the hub

Playwright is available under `scripts/node_modules` for headless checks
(launch Chromium with `--use-gl=swiftshader --enable-unsafe-swiftshader`
so WebGL renders); otherwise check by hand in a browser.

## Do not

- Reorder or renumber existing `PROJECTS` entries — indices are positions.
- Hand-edit `sphere.js` vertex order; `projects.js` and the `main.js`
  assertion both depend on it.
- Change `texture.rotation` in `medallions.js` or the up-vector convention
  in `autopilot.js` independently — they're paired (engraving reads upright
  when the disk's local −Y points screen-up).
- Add a page without the `board.js`/`page.js` script tags — the exit fade
  and zoom won't work.
