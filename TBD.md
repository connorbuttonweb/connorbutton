# Structural Optimization Sweep

Findings from a full repo sweep, ranked by impact on load time, maintainability, and repo health.

## Resolved

### 1. Git history was 6.8 GB — fixed
`.git` is now **74 MB** (was 6.8 GB: 2.35 GiB loose + 3.97 GiB packed) — a ~99% reduction. Ruled out Git LFS as the fix: GitHub Pages cannot serve LFS content (pointer files render as text, confirmed against GitHub's own docs), and this repo has no Pages Actions workflow that could resolve pointers before deploy. Instead:
- Recompressed the offending media in place first (see #2), so the *current* commit's blobs were already small.
- Backed up full history to a local bundle (`git bundle create --all`) before touching anything destructive.
- Ran BFG Repo-Cleaner (`--strip-blobs-bigger-than 1M`) against a mirror clone — BFG guarantees it never alters the content of the current tip, only historical/superseded blobs, which sidestepped a real hazard: `assets/images/wsp/FinancialStatementModeling.pdf` (1.3 MB) and `assets/documents/Pines Marketing Slide Deck.pptx` (9.6 MB) are legitimate current files that a naive blanket size-threshold strip would have gutted from HEAD.
- First BFG pass left ~450 MB of residual bloat: a stale, fully-merged branch (`add-claude-github-actions-*`, leftover from an old Actions setup) had a tip commit sitting inside `main`'s own ancestry, and BFG protects every ref-tip commit — so that one historical commit kept its full-size blobs even inside `main`'s line. Fixed by re-running BFG against a clone containing only `main`, which cleaned it properly (73 MB).
- Verified byte-for-byte tree identity between the cleaned history and the working tree via direct git object diff (`git diff --stat`, zero output) before each force-push — not just a file-listing diff, which is noisy from CRLF/LF checkout differences on Windows.
- Force-pushed the cleaned `main` to `origin` (twice — see above). Live site confirmed serving correctly post-rewrite.
- Backup bundle kept at `C:\Website\backups\connorbutton-pre-history-rewrite-*.bundle` as a safety net.
- The stale `add-claude-github-actions-*` branch (fully-merged ancestor of `main`, safe to remove) was deleted from GitHub so it no longer anchors the old blobs server-side.

### 2. Unoptimized media — fixed
`assets/images` dropped from 464 MB to **54 MB**. Recompressed every image over 500 KB (44 files: resize to a 2200px long edge, mozjpeg q80) and re-encoded the 5 largest videos (H.264 CRF 26, capped at 1920px). Same filenames/paths throughout — no HTML/CSS/JS changes needed. Verified visually in a real headless-browser pass (homepage, `/pines/` gallery scrolled through fully, both videos' metadata loaded) — no broken images, no console errors, no visible quality loss even on the most aggressively compressed files (e.g. `Goldie2.jpg` 21 MB → 420 KB). Two files (`avatar.png`, `internalytics/logo.png`) were left untouched because re-encoding made them larger, not smaller. `scripts/optimize-media.js` and `scripts/optimize-video.js` are kept in the repo so this is repeatable for future uploads.

### 3. Homepage hero image — fixed
`background.jpg` went from 8.8 MB to 518 KB as part of the same pass (#2). No longer a meaningful LCP blocker.

### 4. No build/bundling pipeline at all — fixed
Added `asset-pipeline/`, a new self-contained local Node project (same pattern as `scripts/`: gitignored `node_modules`, committed `package.json`/`package-lock.json`, manually rerun via `npm run build`, not CI, not deployed) with three scripts:
- `build-css.js` minifies `assets/css/main.css` (`clean-css`) into a new `assets/css/main.min.css` — 87,938 → 59,493 bytes. `main.css` itself stays hand-edited and unminified in place, deliberately: [website/index.html:156-157](website/index.html#L156-L157) links visitors directly to it as a live "View/Download source" portfolio showcase, and minifying in place would have served unreadable CSS there.
- `build-js.js` concatenates the 10 files under `assets/js/dashboard/**` (`data.js` → `metrics.js` → `history.js` → `charts.js` → `table.js` → the 4 `sections/*.js` files → `main.js`, the same order the old script tags used, which matters — each file dereferences `window.DASH` properties set by an earlier one at IIFE-parse time) and minifies the result with `terser` into `assets/js/dashboard.bundle.min.js` — 98,938 → 50,784 bytes. [dashboard/index.html](dashboard/index.html#L54-L55) now loads that one file plus `nav.js`, cutting 11 blocking script tags to 2. The 10 source files stay as the files a developer edits; `nav.js` was deliberately left out of the bundle and untouched — it's the one script that isn't IIFE-wrapped and has a documented synchronous side effect (`ticker.js` on `/search/` depends on the navbar existing immediately after it runs).
- Both generated files carry an `AUTO-GENERATED — do not hand-edit` banner naming the regenerate command; the source files link back to it. No CI gate enforces regeneration (matching this repo's existing manual-rerun convention for `scripts/`) — `asset-pipeline/README.md` documents the source→generated map.
- Deliberately did *not* split `main.css` by page in this pass. GitHub Pages/Fastly already gzip-compresses CSS heavily (highly repetitive text), so most of the byte-count win was already absorbed before minification; a structural split would need a real selector audit with no test coverage to catch a missed shared class, which is real regression risk for a smaller marginal win. Minification only, kept in one request.
- Verified via a local static server + Playwright (headless, since the dashboard JS explicitly errors on `file://` URLs): all 10 pages load with zero console errors and zero 404s; `/dashboard/` loads exactly 2 script requests and all four sections (Performance/Allocation/Holdings/Distributions) populate correctly, confirmed by clicking through tabs and screenshotting each.

### 5. Full Font Awesome library loaded for ~12 icons — fixed
Self-hosted a subsetted webfont instead of loading the full library from cdnjs. `asset-pipeline/scripts/build-icons.js` uses `fontawesome-subset` (pure JS/WASM via `harfbuzzjs`, no Python/fonttools dependency) against `@fortawesome/fontawesome-free` pinned to the exact `6.4.0` already in use, to generate `assets/fonts/fa-solid-900.woff2` (1,376 bytes) and `assets/fonts/fa-brands-400.woff2` (808 bytes) containing only the glyphs actually used anywhere on the site — a repo-wide search (including dynamically-built classes in JS template strings and the CSS-only sort-arrow codepoints in `assets/css/main.css:3653-3662`, which a naive `grep -rhoE "fa-[a-z0-9-]+"` misses entirely) found exactly 14: 12 solid (`search`, `chevron-down`, `chevron-right`, `circle-notch`, `flask`, `circle-exclamation`, `triangle-exclamation`, `file-excel`, `trophy`, `sort`, `sort-up`, `sort-down`) + 2 brands (`linkedin-in`, `instagram`). No `regular` weight is used anywhere.

The accompanying `assets/css/fontawesome.min.css` (15,230 bytes) is built by stripping all ~1,389 per-icon `content` rules out of the upstream base stylesheet (keeping only the shared `.fa`/`.fas`/`.fab` plumbing, sizing utilities, and animations) and re-adding only the 14 needed icons' `content` rules, extracted *verbatim* from the installed package rather than hand-transcribed — the build script asserts the extracted `fa-sort`/`fa-sort-up`/`fa-sort-down` codepoints match `\f0dc`/`\f0de`/`\f0dd` (what `main.css`'s sort-arrow rule already hardcodes) and fails loudly on a mismatch, so a version drift can't silently turn the dashboard table's sort arrows into missing-glyph boxes.

All 10 pages' `<link>` now points at `/assets/css/fontawesome.min.css` instead of `cdnjs.cloudflare.com`. No `<i class="...">` markup changed anywhere — same `fas`/`fab` classes, just a self-hosted source. Payload for styles+webfonts actually shipped: ~358 KB (100 KB CSS + 258 KB of full solid+brands webfonts) → 17,414 bytes, ~95% smaller, and a render-blocking third-party request eliminated entirely. Verified the same way as #4 (zero cdnjs requests, zero console errors on all 10 pages) plus visually: search/LinkedIn/Instagram icons on the homepage, file/trophy icons on `/wallstreetprep/`, the nav dropdown chevron in both open and closed states on an icon-free page (`/portfolios/`), and the dashboard's sort-arrow, hypothetical-performance warning icon, and spinner all render as real glyphs.

### 6. Duplicated, drifted `<head>` boilerplate across 10 pages
Nav is already de-duplicated well (injected once from [nav.js](assets/js/nav.js) — good pattern, keep it). But `<head>` itself is hand-copied into every page with no shared template, and it's already drifted:
- Only `index.html` has a `meta description` and JSON-LD structured data; the other 9 pages have neither — real SEO/social-preview cost.
- No Open Graph or Twitter Card tags anywhere, so shared links (LinkedIn, Slack, iMessage) render with no preview.
- Viewport meta tags are inconsistent between pages (some `maximum-scale=5.0, user-scalable=yes`, others plain `initial-scale=1`).
- **Bug from the drift**: [contact/index.html:6-8](contact/index.html#L6-L8) has a stray `<div class="back-btn"><a href="/">← Back to Home</a></div>` sitting *inside* `<head>`, before `<title>` — invalid markup, almost certainly a copy-paste artifact.

### 7. Worker source is a documented reconstruction, not the real thing
[worker/README.md](worker/README.md#L40-L42) states plainly that `market-proxy.js` "was reconstructed from the deployed worker's observable behaviour" and the live Cloudflare Worker's actual source "exists nowhere else." That's a single point of failure for `/search/`'s ticker and any future use of `/history` — not a perf issue, but a structural gap worth closing (pull the real source into the repo once, so it's not lost).

---

**Suggested next:** #6 (duplicated/drifted `<head>` boilerplate) is the cheapest fix left and has an actual bug in it (`contact/index.html`'s malformed head). #7 (worker source reconstruction) isn't a perf issue but is a structural gap worth closing — the live Cloudflare Worker's real source exists nowhere in this repo.
