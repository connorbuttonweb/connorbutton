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

## Open

### 4. No build/bundling pipeline at all
There's no `package.json`, bundler, or minifier anywhere. Consequences:
- `assets/css/main.css` is a single unminified 3,952-line/88 KB file loaded on *every* page, including ones that don't touch dashboard/chart styles.
- [dashboard/index.html](dashboard/index.html#L54-L64) loads 10 separate, non-deferred, global-scope `<script>` tags in sequence (`data.js`, `metrics.js`, `history.js`, `charts.js`, `table.js`, 4 section files, `main.js`) — 10 blocking round trips instead of one bundle.

### 5. Full Font Awesome library loaded for ~12 icons
Every page pulls `font-awesome/6.4.0/css/all.min.css` (100 KB CSS + associated webfonts) from cdnjs. Actual usage across the whole site (`grep -rhoE "fa-[a-z0-9-]+"`) is only about a dozen distinct icons (chevron, search, linkedin, instagram, file variants, spinner, trophy, flask). Self-hosting a subsetted icon set or swapping to inline SVGs would cut a render-blocking third-party request and most of that payload on every page load.

### 6. Duplicated, drifted `<head>` boilerplate across 10 pages
Nav is already de-duplicated well (injected once from [nav.js](assets/js/nav.js) — good pattern, keep it). But `<head>` itself is hand-copied into every page with no shared template, and it's already drifted:
- Only `index.html` has a `meta description` and JSON-LD structured data; the other 9 pages have neither — real SEO/social-preview cost.
- No Open Graph or Twitter Card tags anywhere, so shared links (LinkedIn, Slack, iMessage) render with no preview.
- Viewport meta tags are inconsistent between pages (some `maximum-scale=5.0, user-scalable=yes`, others plain `initial-scale=1`).
- **Bug from the drift**: [contact/index.html:6-8](contact/index.html#L6-L8) has a stray `<div class="back-btn"><a href="/">← Back to Home</a></div>` sitting *inside* `<head>`, before `<title>` — invalid markup, almost certainly a copy-paste artifact.

### 7. Worker source is a documented reconstruction, not the real thing
[worker/README.md](worker/README.md#L40-L42) states plainly that `market-proxy.js` "was reconstructed from the deployed worker's observable behaviour" and the live Cloudflare Worker's actual source "exists nowhere else." That's a single point of failure for `/search/`'s ticker and any future use of `/history` — not a perf issue, but a structural gap worth closing (pull the real source into the repo once, so it's not lost).

---

**Suggested next:** #6 (duplicated/drifted `<head>` boilerplate) is the cheapest fix left and has an actual bug in it (`contact/index.html`'s malformed head). #4 (bundling) and #5 (Font Awesome) are the next real load-time levers now that media is off the table.
