# asset-pipeline

Local tooling to minify `main.css`, bundle the dashboard JS, and self-host a
subsetted Font Awesome icon set. This site has no CI — GitHub Pages serves
the raw repo — so there's no build step at deploy time. Generated files are
committed directly and must be **manually regenerated** after editing any of
their sources.

```
cd asset-pipeline
npm install   # first time only
npm run build       # regenerate everything
npm run build:css   # just main.min.css
npm run build:js    # just dashboard.bundle.min.js
npm run build:icons # just fontawesome.min.css + the two subset woff2 files
```

## Source → generated file map

| Source (hand-edited) | Generated (committed, don't hand-edit) |
|---|---|
| `assets/css/main.css` | `assets/css/main.min.css` |
| `assets/js/dashboard/**/*.js` (10 files) | `assets/js/dashboard.bundle.min.js` |
| `@fortawesome/fontawesome-free` (npm dep, pinned `6.4.0`) | `assets/css/fontawesome.min.css`, `assets/fonts/fa-solid-900.woff2`, `assets/fonts/fa-brands-400.woff2` |

`assets/js/nav.js` is intentionally **not** bundled — it's the one dashboard
script that isn't IIFE-wrapped and has a documented synchronous side effect
(`ticker.js` on `/search/` depends on it), and it's already a single small
file, not part of the "many blocking scripts" problem this pipeline exists
to fix.

`main.css` also stays unminified in place (not overwritten) because
`website/index.html` links visitors directly to it as a "View source"
portfolio showcase — minifying in place would break that.

## Font Awesome subset

Only the glyphs actually used anywhere on the site are subsetted (see
`scripts/build-icons.js` for the exact list) — no `regular` style is used
anywhere. The build script extracts each icon's `content:` codepoint
verbatim from the installed `@fortawesome/fontawesome-free` package rather
than hand-transcribing hex values, and asserts the `fa-sort`/`fa-sort-up`/
`fa-sort-down` codepoints match what `assets/css/main.css`'s table
sort-arrow rule already hardcodes — it fails the build loudly on a mismatch
instead of letting the dashboard silently render a missing-glyph box.

If you add a new icon anywhere on the site, add its name to the
`SOLID_ICONS`/`BRAND_ICONS` list in `scripts/build-icons.js` and rerun
`npm run build:icons`, or it won't render (only the current icon set is
subsetted into the local webfonts).
