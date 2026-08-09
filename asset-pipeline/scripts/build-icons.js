const fs = require('fs');
const path = require('path');
const CleanCSS = require('clean-css');
const { fontawesomeSubset } = require('fontawesome-subset');

const repoRoot = path.resolve(__dirname, '..', '..');
const faCssDir = path.join(
  __dirname,
  '..',
  'node_modules',
  '@fortawesome',
  'fontawesome-free',
  'css'
);
const fontsOutDir = path.join(repoRoot, 'assets', 'fonts');
const cssOutPath = path.join(repoRoot, 'assets', 'css', 'fontawesome.min.css');

// Exact glyphs used anywhere in the site (HTML, JS template strings, and the
// CSS sort-arrow rule at assets/css/main.css:3653,3661,3662). No `regular`
// style is used anywhere.
const SOLID_ICONS = [
  'search',
  'chevron-down',
  'chevron-right',
  'circle-notch',
  'flask',
  'circle-exclamation',
  'triangle-exclamation',
  'file-excel',
  'trophy',
  'sort',
  'sort-up',
  'sort-down',
];
const BRAND_ICONS = ['linkedin-in', 'instagram'];

// Codepoints assets/css/main.css already hardcodes for its own sort-arrow
// rule — the generated CSS must resolve these icons to the exact same values
// or the dashboard table's sort arrows silently render as missing-glyph boxes.
const EXPECTED_CODEPOINTS = {
  sort: 'f0dc',
  'sort-up': 'f0de',
  'sort-down': 'f0dd',
};

// Matches a full FA rule for one icon, allowing for comma-joined alias
// selectors (e.g. ".fa-sort:before,.fa-unsorted:before{content:"\f0dc"}").
function extractContentRule(css, iconName) {
  const re = new RegExp(
    `\\.fa-${iconName}:before(?:,\\.fa-[\\w-]+:before)*\\{content:"([^"]*)"\\}`
  );
  const match = css.match(re);
  if (!match) {
    throw new Error(`Could not find content rule for icon "${iconName}"`);
  }
  return match[1]; // e.g. "\f002"
}

// Strips every `.fa-name:before[,...]{content:"..."}` rule (the full
// per-icon codepoint table, ~1389 rules in fontawesome.min.css alone),
// leaving only shared base plumbing (.fa, sizing utilities, animations,
// fa-border/fa-stack/etc, CSS custom properties).
function stripIconContentRules(css) {
  const re = /\.fa-[\w-]+:before(?:,\.fa-[\w-]+:before)*\{content:"[^"]*"\}/g;
  return css.replace(re, '');
}

// Keeps only the @font-face + weight-selector header of solid.min.css /
// brands.min.css (both are just header + optional icon-content rules) and
// rewrites the font src to point at our locally-generated subset, woff2-only
// (no legacy ttf fallback needed for this site).
function extractHeaderWithLocalFont(css, localFileName) {
  const withoutIcons = stripIconContentRules(css);
  return withoutIcons.replace(
    /src:url\([^)]*\.woff2\)[^};]*(?=[};])/,
    `src:url(/assets/fonts/${localFileName}) format("woff2")`
  );
}

async function main() {
  fs.mkdirSync(fontsOutDir, { recursive: true });

  await fontawesomeSubset(
    { solid: SOLID_ICONS, brands: BRAND_ICONS },
    fontsOutDir,
    { targetFormats: ['woff2'] }
  );

  const fontawesomeCss = fs.readFileSync(
    path.join(faCssDir, 'fontawesome.min.css'),
    'utf8'
  );
  const solidCss = fs.readFileSync(path.join(faCssDir, 'solid.min.css'), 'utf8');
  const brandsCss = fs.readFileSync(path.join(faCssDir, 'brands.min.css'), 'utf8');

  const basePlumbing = stripIconContentRules(fontawesomeCss);
  const solidHeader = extractHeaderWithLocalFont(solidCss, 'fa-solid-900.woff2');
  const brandsHeader = extractHeaderWithLocalFont(brandsCss, 'fa-brands-400.woff2');

  const solidRules = SOLID_ICONS.map((name) => {
    const codepoint = extractContentRule(fontawesomeCss, name);
    return `.fa-${name}:before{content:"${codepoint}"}`;
  }).join('');

  const brandRules = BRAND_ICONS.map((name) => {
    const codepoint = extractContentRule(brandsCss, name);
    return `.fa-${name}:before{content:"${codepoint}"}`;
  }).join('');

  // Self-check: fail loudly at build time rather than let the dashboard
  // table's sort arrows silently render as missing-glyph boxes in prod.
  for (const [name, expected] of Object.entries(EXPECTED_CODEPOINTS)) {
    const codepoint = extractContentRule(fontawesomeCss, name);
    const actual = codepoint.replace(/^\\/, '');
    if (actual !== expected) {
      throw new Error(
        `Codepoint mismatch for fa-${name}: expected \\${expected} (hardcoded in ` +
          `assets/css/main.css), got \\${actual} from the installed FA package`
      );
    }
  }

  const combined =
    basePlumbing + solidHeader + brandsHeader + solidRules + brandRules;

  const minified = new CleanCSS({}).minify(combined);
  if (minified.errors.length) {
    console.error('clean-css errors:', minified.errors);
    process.exit(1);
  }

  const banner =
    '/* AUTO-GENERATED — subsetted Font Awesome 6.4.0 (solid + brands only, ' +
    `${SOLID_ICONS.length + BRAND_ICONS.length} glyphs) for the icons actually used on this site. ` +
    'Do not hand-edit. Regenerate: cd asset-pipeline && npm run build:icons */\n';

  fs.writeFileSync(cssOutPath, banner + minified.styles);

  console.log(
    `Full FA all.min.css (100 KB) -> fontawesome.min.css ` +
      `(${minified.styles.length + banner.length} bytes) + ` +
      `2 subsetted woff2 files (${SOLID_ICONS.length} solid + ${BRAND_ICONS.length} brand glyphs)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
