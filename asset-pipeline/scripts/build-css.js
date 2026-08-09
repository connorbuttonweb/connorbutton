const fs = require('fs');
const path = require('path');
const CleanCSS = require('clean-css');

const repoRoot = path.resolve(__dirname, '..', '..');
const srcPath = path.join(repoRoot, 'assets', 'css', 'main.css');
const outPath = path.join(repoRoot, 'assets', 'css', 'main.min.css');

const source = fs.readFileSync(srcPath, 'utf8');
const output = new CleanCSS({}).minify(source);

if (output.errors.length) {
  console.error('clean-css errors:', output.errors);
  process.exit(1);
}

const banner = '/* AUTO-GENERATED from assets/css/main.css — do not hand-edit. ' +
  'Regenerate: cd asset-pipeline && npm run build:css */\n';

fs.writeFileSync(outPath, banner + output.styles);

console.log(
  `main.css ${source.length} bytes -> main.min.css ${output.styles.length + banner.length} bytes`
);
