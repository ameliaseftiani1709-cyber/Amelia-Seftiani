'use strict';
// Server lokal: menyajikan folder public/ dan meneruskan /api/* ke handler yang sama dengan Vercel.
// Jalankan: npm run dev   (buka http://localhost:3000)
const http = require('http');
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8',
};

function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (p === '/') p = '/index.html';
  const file = path.join(PUBLIC, path.normalize(p));
  if (!file.startsWith(PUBLIC + path.sep)) { res.statusCode = 403; return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  });
}

function buildServer(apiHandler) {
  return http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/api' || pathname.startsWith('/api/')) return apiHandler(req, res);
    return serveStatic(req, res);
  });
}

module.exports = { buildServer };

if (require.main === module) {
  try { if (process.loadEnvFile) process.loadEnvFile('.env'); } catch (e) { /* .env opsional */ }
  const { createApp } = require('./lib/app');
  const port = Number(process.env.PORT) || 3000;
  buildServer(createApp()).listen(port, () => console.log(`LabInventory berjalan di http://localhost:${port}`));
}
