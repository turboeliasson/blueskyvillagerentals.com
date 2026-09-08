import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enquiry } from '../worker.mjs';
const payload = { place: 'Mooresville, NC', name: 'Preview Test', email: 'preview@example.test', phone: '+1 704 555 0123', requestId: '00000000-0000-4000-8000-000000000001', form: 'homeowner-letter' };
function request(data, headers = {}) { return new Request('https://preview.example/api/enquiry', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) }); }

test('rejects incomplete enquiries without contacting the lead service', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Unexpected outbound request'); };
  try {
    for (const data of [null, {}, { ...payload, name: ' ' }, { ...payload, email: 'not-an-email' }, { ...payload, email: '' }, { ...payload, phone: '' }, { ...payload, phone: '555' }, { ...payload, requestId: '' }]) assert.equal((await enquiry(request(data))).status, 400);
  } finally { globalThis.fetch = original; }
});

test('rejects cross-origin submissions', async () => { assert.equal((await enquiry(request(payload, { Origin: 'https://other.example' }))).status, 403); });

test('rejects oversized submissions', async () => { assert.equal((await enquiry(request({ ...payload, place: 'x'.repeat(11000) }))).status, 413); });

test('honeypot never sends an enquiry', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Unexpected outbound request'); };
  try { assert.deepEqual(await (await enquiry(request({ ...payload, website: 'spam' }))).json(), { ok: true }); }
  finally { globalThis.fetch = original; }
});

test('forwards separate email, phone, and retry ID with the homeowner form source', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, options) => { calls++; assert.equal(url, 'https://photo.proptonomy.ai/bsv-lead'); assert.deepEqual(JSON.parse(options.body), payload); return Response.json({ ok: true }); };
  try { assert.deepEqual(await (await enquiry(request({ ...payload, unexpected: 'ignore' }))).json(), { ok: true }); assert.equal(calls, 1); }
  finally { globalThis.fetch = original; }
});

test('upstream errors cannot turn into success messages', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ ok: false }, { status: 429 });
    let response = await enquiry(request(payload));
    assert.equal(response.status, 429); assert.deepEqual(await response.json(), { ok: false });
    globalThis.fetch = async () => { throw new Error('offline'); };
    response = await enquiry(request(payload));
    assert.equal(response.status, 502); assert.deepEqual(await response.json(), { ok: false });
  } finally { globalThis.fetch = original; }
});
