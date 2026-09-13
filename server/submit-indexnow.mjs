// Run after publishing changed canonical pages: node server/submit-indexnow.mjs
import { readFileSync } from 'node:fs';

const origin = 'https://blueskyvillagerentals.com';
const key = readFileSync(new URL('../indexnow-key.txt', import.meta.url), 'utf8').trim();
const xml = readFileSync(new URL('../sitemap.xml', import.meta.url), 'utf8');
const urlList = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
if (!urlList.length || urlList.some(url => new URL(url).origin !== origin)) throw new Error('Invalid sitemap URLs');
const keyLocation = origin + '/indexnow-key.txt';
const proof = await fetch(keyLocation, { signal: AbortSignal.timeout(20000) });
if (!proof.ok || (await proof.text()).trim() !== key) throw new Error('Publish the matching IndexNow proof first');
const response = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: new URL(origin).host, key, keyLocation, urlList }),
  signal: AbortSignal.timeout(30000)
});
if (![200, 202].includes(response.status)) throw new Error('IndexNow response: ' + response.status);
console.log(JSON.stringify({ submittedAt: new Date().toISOString(), urls: urlList, status: response.status,
  meaning: response.status === 202 ? 'Received; ownership validation pending. Indexing is not confirmed.' : 'Received by IndexNow. Indexing is not confirmed.' }, null, 2));
