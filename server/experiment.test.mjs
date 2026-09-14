import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../experiment.js', import.meta.url), 'utf8');
const VISITOR = '12345678-1234-4234-8234-123456789012';

function field({ name, required = false, tag = 'input' }) {
  return { name, value: '', required, tag };
}
/* Runs experiment.js against a fake browser, so the beacon is tested without a DOM library. */
function loadExperiment({ variant = 'A', formId = 'early-estimate-form', fields } = {}) {
  const inputs = fields ?? [
    field({ name: 'place', required: true }), field({ name: 'name', required: true }),
    field({ name: 'phone' }), field({ name: 'email', required: true }),
    field({ name: 'bedrooms', required: true, tag: 'select' }), field({ name: 'website' }),
  ];
  const formListeners = {};
  const form = {
    id: formId,
    addEventListener: (name, listener) => { (formListeners[name] ??= []).push(listener); },
    querySelectorAll: () => inputs,
  };
  const documentListeners = {}, windowListeners = {};
  const beacons = [];
  /* Blob bodies read back asynchronously, so the fake keeps the payload inspectable. */
  class FakeBlob { constructor(parts, options) { this.parts = parts; this.type = options?.type; } }
  const store = new Map([['bsv-homeowner-test', JSON.stringify({
    experiment: 'bsv-homeowners-2026-09', variant, visitorId: VISITOR, assignedAt: Date.now(),
  })]]);
  const document = {
    documentElement: { dataset: { bsvVariant: variant } },
    visibilityState: 'visible',
    querySelectorAll: () => [form],
    addEventListener: (name, listener) => { (documentListeners[name] ??= []).push(listener); },
  };
  const win = {
    document, URL, Set, Map, Math, Date, JSON, String, Object, Number, Blob: FakeBlob,
    location: { href: 'https://blueskyvillagerentals.com/', hostname: 'blueskyvillagerentals.com', replace() {} },
    navigator: { userAgent: 'Mozilla/5.0', sendBeacon: (url, body) => { beacons.push({ url, body }); return true; } },
    localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) },
    crypto: { randomUUID: () => VISITOR, getRandomValues: array => { array[0] = 0; return array; } },
    fetch: () => Promise.resolve({ ok: true }),
    addEventListener: (name, listener) => { (windowListeners[name] ??= []).push(listener); },
  };
  win.window = win;
  vm.runInNewContext(SOURCE, win);
  documentListeners.DOMContentLoaded?.forEach(listener => listener());
  return {
    inputs,
    type(name, value) {
      const target = inputs.find(input => input.name === name);
      target.value = value;
      formListeners.input?.forEach(listener => listener({ target }));
    },
    submit() { formListeners.submit?.forEach(listener => listener()); },
    hide() {
      document.visibilityState = 'hidden';
      documentListeners.visibilitychange?.forEach(listener => listener());
    },
    pagehide() { windowListeners.pagehide?.forEach(listener => listener()); },
    /* The page runs in its own realm, so copy each beacon into plain host values. */
    beacons: () => beacons,
    progress: () => beacons
      .map(beacon => JSON.parse(String(beacon.body.parts[0])))
      .filter(payload => payload.event === 'progress'),
  };
}

test('a visitor who types nothing sends no progress beacon', () => {
  const page = loadExperiment();
  page.hide();
  assert.deepEqual(page.progress(), []);
});

test('whitespace alone is not a start and sends nothing', () => {
  const page = loadExperiment();
  page.type('place', '   ');
  page.hide();
  assert.deepEqual(page.progress(), []);
});

test('a beacon reports how much was typed per field, never the text itself', () => {
  const page = loadExperiment();
  page.type('place', 'Folly Beach, South Carolina');
  page.type('name', 'Ryan');
  page.type('email', 'a@b');
  page.hide();
  const [payload] = page.progress();
  assert.equal(payload.progress.formId, 'early-estimate-form');
  assert.deepEqual(payload.progress.fields, {
    place: '11-30', name: '4-10', phone: '0', email: '1-3', bedrooms: '0',
  });
  assert.equal(payload.progress.filledCount, 3);
  assert.equal(payload.progress.requiredRemaining, 1); // bedrooms
  assert.equal(payload.progress.lastField, 'email');
  assert.equal(payload.progress.submitted, false);
  const raw = JSON.stringify(payload);
  assert.ok(!raw.includes('Folly Beach'));
  assert.ok(!raw.includes('Ryan'));
  assert.ok(!raw.includes('a@b'));
});

test('the honeypot is never tracked, never reported and never starts a session', () => {
  const page = loadExperiment();
  page.type('website', 'spam.example');
  page.hide();
  assert.deepEqual(page.progress(), []);
});

test('clearing a field still reports that it was typed into', () => {
  const page = loadExperiment();
  page.type('place', 'Savannah');
  page.type('place', '');
  page.hide();
  const [payload] = page.progress();
  assert.equal(payload.progress.fields.place, '4-10');
});

test('a submitted form is distinguished from an abandoned one', () => {
  const page = loadExperiment();
  page.type('place', 'Savannah');
  page.submit();
  page.hide();
  const [payload] = page.progress();
  assert.equal(payload.progress.submitted, true);
});

test('one beacon per form, however many times the page is hidden or unloaded', () => {
  const page = loadExperiment();
  page.type('place', 'Savannah');
  page.hide();
  page.hide();
  page.pagehide();
  assert.equal(page.progress().length, 1);
});

test('an unrecognised form reports nothing at all', () => {
  const page = loadExperiment({ formId: 'some-other-form' });
  page.type('place', 'Savannah');
  page.hide();
  assert.deepEqual(page.progress(), []);
});

test('the village version reports its own fields and variant', () => {
  const page = loadExperiment({
    variant: 'B', formId: 'hero-estimate-form',
    fields: [
      field({ name: 'place', required: true }), field({ name: 'name', required: true }),
      field({ name: 'email', required: true }), field({ name: 'countryCode', tag: 'select' }),
      field({ name: 'phone', required: true }), field({ name: 'website' }),
    ],
  });
  page.type('place', '1 Harbour Road, Mooresville');
  page.type('name', 'Ryan Burke');
  page.hide();
  const [payload] = page.progress();
  assert.equal(payload.experiment.variant, 'B');
  assert.equal(payload.progress.formId, 'hero-estimate-form');
  assert.deepEqual(payload.progress.fields, {
    place: '11-30', name: '4-10', email: '0', countryCode: '0', phone: '0',
  });
  assert.equal(payload.progress.requiredRemaining, 2); // email and phone
});

test('every bucket boundary is reported as its own band', () => {
  const lengths = { 1: '1-3', 3: '1-3', 4: '4-10', 10: '4-10', 11: '11-30', 30: '11-30', 31: '31+' };
  for (const [length, expected] of Object.entries(lengths)) {
    const page = loadExperiment();
    page.type('place', 'x'.repeat(Number(length)));
    page.hide();
    assert.equal(page.progress()[0].progress.fields.place, expected, `${length} characters`);
  }
});
