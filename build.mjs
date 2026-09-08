import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf' };
const assets = {};
async function add(file) {
  assets['/' + file] = { type: mime[path.extname(file)], body: (await readFile(file)).toString('base64') };
}
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) await walk(file); else if (mime[path.extname(file)]) await add(file);
  }
}
await Promise.all(['index.html', 'styles.css', 'site.js'].map(add));
await walk('assets');
const source = await readFile('worker.mjs', 'utf8');
await mkdir('dist/server', { recursive: true });
await writeFile('dist/server/index.js', source + '\nconst assets = ' + JSON.stringify(assets) + `;
export default { async fetch(request) {
  const url = new URL(request.url);
  if (url.pathname === '/api/enquiry') return enquiry(request);
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', {status:405});
  const asset = assets[url.pathname === '/' ? '/index.html' : url.pathname];
  if (!asset) return new Response('Not found', {status:404});
  const headers = {'Content-Type':asset.type,'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Cache-Control':asset.type.startsWith('text/')?'no-cache':'public, max-age=3600'};
  const body = request.method === 'HEAD' ? null : Uint8Array.from(atob(asset.body), c => c.charCodeAt(0));
  return new Response(body, {headers});
}};
`);
console.log(`Built ${Object.keys(assets).length} files into the preview worker.`);
