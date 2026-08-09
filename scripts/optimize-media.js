/* One-off: recompress every image over the size threshold, in place.
   Same filename/path/extension in, same out — no HTML/CSS changes needed. */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..', 'assets', 'images');
const THRESHOLD_BYTES = 500 * 1024;
const MAX_EDGE = 2200;
const JPEG_QUALITY = 80;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

async function optimizeOne(file) {
  const before = fs.statSync(file).size;
  if (before <= THRESHOLD_BYTES) return null;

  const ext = path.extname(file).toLowerCase();
  if (!['.jpg', '.jpeg', '.png'].includes(ext)) return null;

  const buf = fs.readFileSync(file);
  let pipeline = sharp(buf).rotate().resize({
    width: MAX_EDGE,
    height: MAX_EDGE,
    fit: 'inside',
    withoutEnlargement: true
  });

  pipeline = ext === '.png'
    ? pipeline.png({ compressionLevel: 9, palette: false })
    : pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true });

  const outBuf = await pipeline.toBuffer();

  // Guard against a rare pathological re-encode that ends up bigger.
  if (outBuf.length >= before) return { file, before, after: before, skipped: true };

  fs.writeFileSync(file, outBuf);
  return { file, before, after: outBuf.length, skipped: false };
}

(async () => {
  const files = walk(ROOT);
  const results = [];
  for (const file of files) {
    const r = await optimizeOne(file);
    if (r) results.push(r);
  }

  results.sort((a, b) => b.before - a.before);

  let totalBefore = 0;
  let totalAfter = 0;
  for (const r of results) {
    totalBefore += r.before;
    totalAfter += r.after;
    const rel = path.relative(ROOT, r.file);
    const tag = r.skipped ? '(skipped, re-encode was larger)' : '';
    console.log(
      `${rel.padEnd(45)} ${(r.before / 1024).toFixed(0).padStart(7)} KB -> ${(r.after / 1024).toFixed(0).padStart(7)} KB ${tag}`
    );
  }

  console.log('---');
  console.log(`${results.length} files processed`);
  console.log(`Total: ${(totalBefore / 1024 / 1024).toFixed(1)} MB -> ${(totalAfter / 1024 / 1024).toFixed(1)} MB`);
})();
