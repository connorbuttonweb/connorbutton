const fs = require('fs');
const path = require('path');
const { minify } = require('terser');

const repoRoot = path.resolve(__dirname, '..', '..');
const dashJsDir = path.join(repoRoot, 'assets', 'js', 'dashboard');
const outPath = path.join(repoRoot, 'assets', 'js', 'dashboard.bundle.min.js');

// Order is load-bearing: each later file dereferences window.DASH properties
// set by earlier ones at IIFE-parse time (see TBD.md #4).
const sourceFiles = [
  'data.js',
  'metrics.js',
  'history.js',
  'charts.js',
  'table.js',
  path.join('sections', 'performance.js'),
  path.join('sections', 'allocation.js'),
  path.join('sections', 'holdings.js'),
  path.join('sections', 'distributions.js'),
  'main.js',
];

async function main() {
  const chunks = sourceFiles.map((relPath) => {
    const fullPath = path.join(dashJsDir, relPath);
    return fs.readFileSync(fullPath, 'utf8');
  });

  const concatenated = chunks.join('\n;\n');

  const result = await minify(concatenated, {
    compress: true,
    mangle: true,
  });

  if (!result.code) {
    throw new Error('terser produced no output');
  }

  const fileList = sourceFiles.map((p) => p.replace(/\\/g, '/')).join(', ');
  const banner =
    `/* AUTO-GENERATED from assets/js/dashboard/{${fileList}} — do not hand-edit. ` +
    'Regenerate: cd asset-pipeline && npm run build:js */\n';

  fs.writeFileSync(outPath, banner + result.code);

  console.log(
    `${sourceFiles.length} dashboard files (${concatenated.length} bytes) -> ` +
      `dashboard.bundle.min.js (${result.code.length + banner.length} bytes)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
