import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { enquiry } from './worker.mjs';
const root = process.cwd();
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:4179');
  if (url.pathname === '/api/enquiry') {
    const chunks = [];
    for await (const chunk of req) { chunks.push(chunk); if (chunks.reduce((n, c) => n + c.length, 0) > 10000) { res.writeHead(413); res.end(); return; } }
    const response = await enquiry(new Request(url, { method: req.method, headers: req.headers, ...(!['GET', 'HEAD'].includes(req.method) && { body: Buffer.concat(chunks) }) }));
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); return;
  }
  const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  try { const body = await readFile(file); res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(body); }
  catch { res.writeHead(404); res.end('Not found'); }
}).listen(4179, '127.0.0.1', () => console.log('Local: http://127.0.0.1:4179'));
