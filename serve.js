// Zero-dependency local preview server — serves this repo exactly the way
// GitHub Pages does (raw static files, no build step), so what you see here
// is what ships. Run: npm test  (or: node serve.js [port])
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const root = __dirname;
const startPort = Number(process.argv[2]) || 8080;
const MAX_PORT_ATTEMPTS = 10;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.pptx':
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx':
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

// Mirrors GitHub Pages/Fastly's extensionless-URL resolution: exact file,
// then <path>index.html for a trailing slash, then <path>/index.html for an
// extension-less path with no trailing slash (so /dashboard and /dashboard/
// both resolve, matching what nav.js's active-link logic expects).
function resolveFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const candidates = [];

  if (decoded.endsWith('/')) {
    candidates.push(decoded + 'index.html');
  } else if (!path.extname(decoded)) {
    candidates.push(decoded);
    candidates.push(decoded + '/index.html');
  } else {
    candidates.push(decoded);
  }

  for (const candidate of candidates) {
    const full = path.normalize(path.join(root, candidate));
    if (!full.startsWith(root)) continue; // block path traversal
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
  }
  return null;
}

const server = http.createServer((req, res) => {
  const file = resolveFile(req.url);
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end(`404 Not Found: ${req.url}`);
    return;
  }
  const ext = path.extname(file);
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
  });
  fs.createReadStream(file).pipe(res);
});

function openBrowser(url) {
  const cmd =
    process.platform === 'win32'
      ? `start "" "${url}"`
      : process.platform === 'darwin'
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, () => {}); // best-effort, non-fatal
}

function startServer(port, attemptsLeft) {
  // A retry re-attaches fresh once-listeners below; without clearing the
  // previous attempt's first, a successful bind on a later port would also
  // re-fire the earlier failed attempt's stale 'listening' handler (with
  // the wrong port baked into its closure).
  server.removeAllListeners('error');
  server.removeAllListeners('listening');

  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.log(`Port ${port} in use, trying ${port + 1}...`);
      startServer(port + 1, attemptsLeft - 1);
    } else {
      console.error(err);
      process.exit(1);
    }
  });

  server.once('listening', () => {
    const url = `http://localhost:${port}/`;
    console.log(`Serving ${root}`);
    console.log(`  ${url}`);
    console.log(
      '\nEdited assets/css/main.css, a dashboard JS source, or added an icon?'
    );
    console.log('  Rebuild first: cd asset-pipeline && npm run build');
    console.log('\nPress Ctrl+C to stop.');
    openBrowser(url);
  });

  server.listen(port);
}

process.on('SIGINT', () => {
  console.log('\nStopping server.');
  process.exit(0);
});

startServer(startPort, MAX_PORT_ATTEMPTS);
