/* One-off: re-encode the oversized site videos in place with ffmpeg.
   Same filename/path in, same out — no HTML changes needed. */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const FILES = [
  'pines/TwinPeaksVideo.mp4',
  'pines/LandryVideo.mp4',
  'experience/Sunshine3.mp4',
  'experience/beaver1.mp4',
  'experience/beaver2.mp4'
].map(p => path.join(__dirname, '..', 'assets', 'images', p));

function encode(file) {
  const before = fs.statSync(file).size;
  const tmp = path.join(os.tmpdir(), `opt-${Date.now()}-${path.basename(file)}`);

  const args = [
    '-y', '-i', file,
    '-vf', "scale='min(1920,iw)':'min(1920,ih)':force_original_aspect_ratio=decrease",
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '26',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    tmp
  ];

  const res = spawnSync(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  if (res.status !== 0) {
    console.error(`FAILED: ${file}`);
    console.error(res.stderr.toString().slice(-2000));
    fs.rmSync(tmp, { force: true });
    return { file, before, after: before, failed: true };
  }

  const after = fs.statSync(tmp).size;
  if (after >= before) {
    fs.rmSync(tmp, { force: true });
    return { file, before, after: before, skipped: true };
  }

  fs.copyFileSync(tmp, file);
  fs.rmSync(tmp, { force: true });
  return { file, before, after };
}

const results = FILES.map(encode);

let totalBefore = 0;
let totalAfter = 0;
for (const r of results) {
  totalBefore += r.before;
  totalAfter += r.after;
  const rel = path.relative(path.join(__dirname, '..', 'assets', 'images'), r.file);
  const tag = r.failed ? '(FAILED, left untouched)' : r.skipped ? '(skipped, re-encode was larger)' : '';
  console.log(
    `${rel.padEnd(30)} ${(r.before / 1024 / 1024).toFixed(1).padStart(7)} MB -> ${(r.after / 1024 / 1024).toFixed(1).padStart(7)} MB ${tag}`
  );
}

console.log('---');
console.log(`Total: ${(totalBefore / 1024 / 1024).toFixed(1)} MB -> ${(totalAfter / 1024 / 1024).toFixed(1)} MB`);
