# CLAUDE.md

Guidance for Claude Code sessions working in this repo. This is a static
personal website (connorbutton.ca) — there is no build step at deploy
time, no linter, and no CI that builds or tests the site. These rules
exist to keep the deployed output correct and the repo lean; follow them
by hand, because nothing here is enforced automatically.

## What this repo is

- Plain static HTML/CSS/JS. No framework, no SSG, no bundler in the
  deploy path. GitHub Pages serves the raw repo directly (see `CNAME` →
  www.connorbutton.ca). Whatever is committed is what ships, byte for byte.
- Root `package.json` has zero dependencies; `npm test` only runs the
  local preview server (`serve.js`).
- Two local-only Node tool projects exist purely to prepare files
  *before* you commit them — neither runs in CI or at request time:
  - `asset-pipeline/` — minifies CSS, bundles dashboard JS, subsets Font
    Awesome. See its README for the source→generated map.
  - `scripts/` — recompresses oversized images/videos in place.
- 10 pages, no templating engine: `index.html`, `contact/index.html`,
  `dashboard/index.html`, `documents/index.html`, `hyrox/index.html`,
  `pines/index.html`, `portfolios/index.html`, `search/index.html`,
  `wallstreetprep/index.html`, `website/index.html`.
- No `.eslintrc`/`.prettierrc`/`.stylelintrc`/`.editorconfig` exists, and
  that's intentional for now — don't add linting/formatting config as a
  side effect of an unrelated change; this file is the enforcement
  mechanism until/unless the user decides otherwise.
- The dashboard's Questrade data (`assets/data/portfolio.json`,
  `assets/data/history.json`) is maintained via the `fund-holdings` and
  `refresh-portfolio` Claude Code skills, not by editing those files
  directly — this doc doesn't cover that workflow.

## Rebuild generated assets before committing (asset-pipeline)

All 10 pages load the *generated* files, not the hand-edited sources — an
uncommitted rebuild means your change is invisible on the live site even
though the source diff looks right.

| You edited... | Run this before committing |
|---|---|
| `assets/css/main.css` | `cd asset-pipeline && npm run build:css` |
| any file in `assets/js/dashboard/**` | `cd asset-pipeline && npm run build:js` |
| used a **new** Font Awesome icon anywhere | add its name to `SOLID_ICONS`/`BRAND_ICONS` in `asset-pipeline/scripts/build-icons.js`, then `npm run build:icons` |
| not sure / touched more than one | `cd asset-pipeline && npm run build` (runs all three) |

- First time in `asset-pipeline/` on a fresh clone: `npm install` first
  (devDependencies aren't committed; `node_modules/` is gitignored).
- Generated files (`main.min.css`, `dashboard.bundle.min.js`,
  `fontawesome.min.css`, the two `fa-*.woff2` subsets) **are** committed
  to git. Always commit them in the *same* commit as the source change
  that produced them.
- Never hand-edit a generated file directly — `main.min.css`,
  `dashboard.bundle.min.js`, and `fontawesome.min.css` get silently
  overwritten by the next rebuild, so a direct edit will look fine
  locally and then vanish.
- Forgetting an icon rebuild doesn't error — the new icon just renders as
  a missing-glyph box, because only currently-used glyphs are
  self-hosted.
- Dashboard JS load order is load-bearing (see JS rules below) — if you
  add a new dashboard source file, decide where in
  `asset-pipeline/scripts/build-js.js`'s source list it belongs; don't
  just append it.

## Image & video optimization

- **Threshold:** any `.jpg`/`.jpeg`/`.png` added to or edited under
  `assets/images/` that ends up over 500KB should go through
  `cd scripts && npm install` (first time) `&& node optimize-media.js`
  before committing. It resizes to a 2200px long edge and recompresses
  (mozjpeg q80 for JPEG, compressionLevel 9 for PNG) in place — same
  filename/path, no HTML changes needed.
- **Video:** `scripts/optimize-video.js` re-encodes a *hardcoded* list of
  specific files (H.264 CRF 26, capped 1920px, faststart) — it does
  **not** scan the tree. If you add a new large video, add its path to
  the `FILES` array in that script before running it; treat that edit as
  routine maintenance, not a change requiring separate sign-off.
- **Known, intentional exceptions:** `assets/images/avatar.png` (~2.5MB)
  and `assets/images/internalytics/logo.png` (~1.3MB) are large but were
  deliberately left as-is — re-encoding them produced a *larger* file,
  not smaller. `optimize-media.js` already guards against this (skips
  the write if the output would be bigger) and will print
  `(skipped, re-encode was larger)` for these two. That's expected —
  don't treat it as a bug to fix.
- **New-media format:** keep using JPEG/PNG through the existing
  `optimize-media.js` pipeline rather than introducing `.webp`/`.avif` —
  that's what the pipeline and `serve.js`'s MIME table are actually built
  around.

## Head boilerplate — hand-synced across 10 pages, no templating

The exact literal marker `<!-- Shared head boilerplate — kept in sync by
hand across all pages... -->` appears in each of these 10 files, and
there is no include/templating mechanism — it is genuinely copy-pasted:

`index.html`, `contact/index.html`, `dashboard/index.html`,
`documents/index.html`, `hyrox/index.html`, `pines/index.html`,
`portfolios/index.html`, `search/index.html`, `wallstreetprep/index.html`,
`website/index.html`

- If you change the *structural* shared part (charset, viewport meta,
  favicon link, the OG/Twitter Card block shape, the `main.min.css` /
  `fontawesome.min.css` links), replicate that exact structural change to
  all 9 other files by hand.
- Do **not** copy the *per-page* fields verbatim — `<title>`, meta
  description, canonical URL, and OG title/description/url are
  legitimately different per page.
- Only `index.html` carries `application/ld+json` Person structured
  data. Don't copy it to the other 9 pages; don't strip it from
  `index.html` during an otherwise-uniform sync.
- Before committing any head change, diff the `<head>` block across all
  10 files to confirm they're structurally identical apart from the
  per-page fields. Commit `aa5ac58` fixed exactly this class of bug — a
  stray leftover back-button `<div>` that drifted into
  `contact/index.html`'s `<head>` during a manual sync. That's the
  mistake this check exists to catch.
- Adding an 11th page: copy the block from an existing page rather than
  typing a new one from memory — it minimizes the chance of drift on day
  one.

## CSS rules

- `assets/css/main.css` is the only hand-edited CSS source. Always edit
  it. Never edit `assets/css/main.min.css` — it's generated and gets
  clobbered on every `build:css` run.
- All 10 pages load `main.min.css`, not `main.css` — a `main.css` edit
  has zero visible effect (live or in `serve.js` preview) until you
  rebuild.
- Do **not** minify or otherwise compact `main.css` in place.
  `website/index.html` links to it directly as a "view source" portfolio
  showcase piece — staying human-readable there is the point, not an
  oversight to clean up.
- Use the existing design tokens instead of hardcoded values: color
  custom properties (`--color-teal-500`, `--color-slate-900`, etc., plus
  `-rgb` variants like `--color-teal-500-rgb` for `rgba()`/opacity use)
  and spacing tokens (`--space-24` etc.), defined in the `:root` block
  near the top of `main.css`. Check there (and the `:root` overrides
  inside the responsive media queries) before adding a new hardcoded
  color or magic-number spacing value.
- Responsive work should follow the existing pattern: `:root` token
  overrides inside media queries, plus the established utility classes
  (`.mobile-only`, `.tablet-only`, `.tablet-2-col`) — don't invent a
  parallel responsive system.

## JS rules

- Vanilla JS, IIFE-style, no framework. Don't introduce React/Vue/a
  bundler as a runtime dependency for page behavior — the deploy target
  (raw GitHub Pages, no build step) can't run one at request time, and
  the whole site's client JS model is hand-written scripts.
- Dashboard JS load order is load-bearing:
  `assets/js/dashboard/{data,metrics,history,charts,table}.js`, then
  `sections/{performance,allocation,holdings,distributions}.js`, then
  `main.js` — each file reads `window.DASH` properties an earlier file
  set at IIFE-parse time. Don't reorder script tags or the source list in
  `asset-pipeline/scripts/build-js.js` without tracing the dependency
  chain.
- `assets/js/nav.js` is intentionally excluded from the bundle and
  loaded raw, unminified, on every page — it's the sole source of the
  site nav (`navMount.outerHTML = NAV_HTML`) and `/search/`'s
  `ticker.js` has a documented synchronous dependency on it running
  first. Don't fold it into the bundle or change its loading order
  without checking that dependency.
- No committed test/assertion suite exists (Playwright under
  `scripts/node_modules` is for ad hoc manual QA only). Don't assume a
  test run will catch a JS regression — verify by hand via `serve.js`.
- Prefer adding new dashboard behavior as another bundled source file
  over a new unbundled `<script>` tag on `dashboard/index.html` — the
  bundle exists specifically to keep that page at 2 blocking script tags
  instead of the 11 it used to have.

## Git & commit hygiene

- This repo's `.git` history was rewritten with BFG Repo-Cleaner
  (`--strip-blobs-bigger-than 1M`), shrinking it from 6.8GB to 75MB. That
  only holds if large blobs don't come back — committing an oversized raw
  image/video and "fixing" it in a later commit does **not** remove the
  original blob from history. Optimize/compress media *before* the first
  commit that includes it, not after.
- Do commit: the generated build output that ships (`main.min.css`,
  `dashboard.bundle.min.js`, `fontawesome.min.css`, the `fa-*.woff2`
  subsets) — checked in on purpose since there's no deploy-time build.
- Do not commit: anything under `asset-pipeline/node_modules` or
  `scripts/node_modules` (already gitignored — don't override it), or
  any image over 500KB that hasn't been through `optimize-media.js`
  first.
- `optimize-media.js`/`optimize-video.js` only cover images/videos —
  PDFs and PPTX files under `assets/documents/` or `assets/images/` are
  never touched by existing tooling. Use manual judgment on those
  (compress externally, or reconsider whether it belongs in git at all)
  before staging a large office document.
- Don't touch/remove `CNAME` casually — it's what binds GitHub Pages to
  www.connorbutton.ca.

## Verifying changes locally

- Run `npm test` (or `node serve.js [port]`) from repo root. It
  replicates GitHub Pages/Fastly's extensionless-URL and trailing-slash
  `index.html` resolution, so it's a truer preview than opening HTML
  files directly.
- `serve.js` prints a startup reminder to rebuild via `asset-pipeline` if
  you touched `main.css`, a dashboard JS source, or icons — it serves the
  generated files exactly as committed, not a live-recompiled version, so
  a forgotten rebuild will look "fine" in preview and still be stale.
  Rebuild first, then preview.
- There is no CI that builds or tests the static site (the existing
  GitHub Actions workflows cover Claude Code review/mentions and the
  Questrade dashboard data pipeline — none touch this). Treat "previewed
  via `serve.js` after rebuilding" as the de facto pre-commit gate for
  any CSS/JS/icon change.

## Pre-commit checklist

- [ ] If `main.css` / dashboard JS / icons changed: ran the matching
      `asset-pipeline` build and committed its output alongside the
      source.
- [ ] If any new/edited image is over 500KB: ran `optimize-media.js` (or
      confirmed it's an intentional exception like `avatar.png`).
- [ ] If a `<head>` structural edit touched one of the 10 pages:
      replicated it across all 10, per-page fields untouched.
- [ ] Previewed via `npm test` / `serve.js`.
- [ ] No file over ~1MB is being added without a deliberate reason.
