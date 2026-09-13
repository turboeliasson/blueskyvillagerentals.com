import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../owner-enquiry.js', import.meta.url), 'utf8');
function fixture(responses) {
  const calls = [], events = [], handlers = {};
  const fields = Object.fromEntries(Object.entries({ place: 'Savannah, GA', name: 'Test Owner', email: 'owner@example.com', phone: '', bedrooms: '3', website: '' }).map(([key, value]) => [key, { value, disabled: false, setCustomValidity(message) { this.error = message; } }]));
  const button = {}, feedback = {}, message = {}, success = { hidden: true, querySelector: () => message, focus() { this.focused = true; } };
  const form = { id: 'savannah-estimate-form', elements: fields, setAttribute() {}, removeAttribute() {},
    addEventListener: (name, fn) => { handlers[name] = fn; },
    reportValidity: () => Object.values(fields).every(f => !f.error),
    querySelector: selector => ({ '.feedback': feedback, 'button[type="submit"]': button, '.success': success })[selector],
    querySelectorAll: selector => selector === 'input, select' ? Object.values(fields) : [] };
  let sequence = 0;
  const window = { BSVAttribution: { leadData: () => ({ attribution: { utmSource: 'chatgpt.com' } }) }, BSVPixel: { trackLead: (...args) => events.push(args) } };
  vm.runInNewContext(source, { window, document: { querySelectorAll: () => [form] }, crypto: { randomUUID: () => `12345678-1234-4234-8234-${String(++sequence).padStart(12, '0')}` },
    location: { hostname: 'localhost' }, AbortSignal, fetch: async (url, options) => { calls.push({ url, ...JSON.parse(options.body) }); return responses.shift(); } });
  return { calls, events, fields, button, feedback, success, message, submit: () => handlers.submit({ preventDefault() {} }) };
}
const response = (ok, body) => ({ ok, status: ok ? 200 : 502, json: async () => body });

test('a guide enquiry preserves source and page, succeeds without phone, and reports one saved lead', async () => {
  const f = fixture([response(true, { ok: true, leadId: 'saved' })]);
  await f.submit(); await f.submit();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, '/api/enquiry');
  assert.equal(f.calls[0].form, 'savannah-estimate-form');
  assert.equal(f.calls[0].attribution.utmSource, 'chatgpt.com');
  assert.equal(f.calls[0].experiment, undefined);
  assert.equal(f.events.length, 1);
  assert.equal(f.success.hidden, false);
  assert.equal(f.success.focused, true);
});

test('an unconfirmed save reports no Lead, retains details, and reuses its request ID on retry', async () => {
  const f = fixture([response(false, { ok: false }), response(true, { ok: true })]);
  await f.submit();
  assert.equal(f.events.length, 0);
  assert.equal(f.success.hidden, true);
  assert.equal(f.fields.email.disabled, false);
  assert.match(f.feedback.textContent, /could not confirm/);
  await f.submit();
  assert.equal(f.calls[0].requestId, f.calls[1].requestId);
  assert.equal(f.events.length, 1);
});

test('editing a failed request gets a new ID; blank names and invalid phones never submit', async () => {
  const f = fixture([response(false, { ok: false }), response(true, { ok: true })]);
  f.fields.name.value = '   '; await f.submit();
  assert.equal(f.calls.length, 0);
  f.fields.name.value = 'Owner'; f.fields.phone.value = 'not a phone'; await f.submit();
  assert.equal(f.calls.length, 0);
  f.fields.phone.value = ''; await f.submit();
  f.fields.place.value = 'Folly Beach, SC'; await f.submit();
  assert.notEqual(f.calls[0].requestId, f.calls[1].requestId);
});
