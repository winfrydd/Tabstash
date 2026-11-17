// UI test server: serves src/ with a mock WebExtension API injected, bound to 127.0.0.1 only.
// Usage: node test/server.js <src dir> <port>
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(process.argv[2]);
const port = Number(process.argv[3] || 47841);
const testDir = __dirname;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = p.startsWith('/__test/') ? path.join(testDir, p.slice(8)) : path.join(root, p === '/' ? 'lists.html' : p);
  if (!file.startsWith(root + path.sep) && !file.startsWith(testDir + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (e, d) => {
    if (e) { res.writeHead(404); return res.end('not found'); }
    let body = d;
    const headers = { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' };
    if (file.endsWith('.html')) {
      body = d.toString().replace('<script', '<script src="/__test/mock.js"></script>\n<script');
      // Enforce the extension's real CSP so tests catch anything it would block.
      try { headers['Content-Security-Policy'] = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).content_security_policy.extension_pages; } catch {}
    }
    res.writeHead(200, headers);
    res.end(body);
  });
}).listen(port, '127.0.0.1', () => console.log('test server on http://127.0.0.1:' + port));
