import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../ad-privacy.js', import.meta.url), 'utf8');
const PRIVACY = readFileSync(new URL('../privacy.html', import.meta.url), 'utf8');
const KEY = 'bsv_ad_measurement_v1';

function memoryStorage(data = new Map()) {
  return { data, getItem: k => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k) };
}
const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };

/* A fake page just rich enough for ad-privacy.js: elements hand back one stub per
   selector, so a test can click the notice and dialog buttons by their data attribute. */
function element() {
  const parts = {};
  const el = {
    innerHTML: '', hidden: false, textContent: '', listeners: {},
    setAttribute() {}, addEventListener(name, fn) { el.listeners[name] = fn; },
    querySelector(sel) { return parts[sel] ||= element(); },
    click() { el.listeners.click?.(); },
    remove() { el.removed = true; }, showModal() {}, close() {}
  };
  return el;
}
function loadPrivacy({ pixelId = '1113214541040969', local = memoryStorage(), session = memoryStorage(), gpc = false } = {}) {
  const body = [];
  const events = [];
  const document = {
    createElement: () => element(),
    body: { appendChild: node => body.push(node) },
    querySelector: sel => (sel === '.bsv-ad-notice' ? body.find(n => n.className === 'bsv-ad-notice' && !n.removed) : null),
    querySelectorAll: () => []
  };
  const win = { document, BSV_META_PIXEL_ID: pixelId, localStorage: local, sessionStorage: session, JSON, Date,
    navigator: { globalPrivacyControl: gpc, doNotTrack: null },
    Event: class { constructor(type) { this.type = type; } },
    addEventListener() {}, dispatchEvent: event => events.push(event.type) };
  win.window = win;
  vm.runInNewContext(SOURCE, win);
  const notice = body.find(n => n.className === 'bsv-ad-notice');
  return { win, notice, events, allowed: () => win.BSVAdPrivacy.allowed() };
}

test('an undecided visitor is measured and told how to turn it off', () => {
  const { allowed, notice } = loadPrivacy();
  assert.equal(allowed(), true);
  assert.match(notice.innerHTML, /you can turn that off/);
  assert.match(notice.innerHTML, />OK</);
  assert.match(notice.innerHTML, />Turn it off</);
});

test('turning it off stops measurement and is remembered on the next page', () => {
  const local = memoryStorage();
  const first = loadPrivacy({ local });
  first.notice.querySelector('[data-choice="no"]').click();
  assert.equal(first.allowed(), false);
  assert.deepEqual(first.events, ['bsv-ad-consent']);
  assert.equal(JSON.parse(local.getItem(KEY)).allowed, false);
  const next = loadPrivacy({ local });
  assert.equal(next.allowed(), false);
  assert.equal(next.notice, undefined);
});

test('a refusal survives in sessionStorage when localStorage is blocked', () => {
  const session = memoryStorage();
  const first = loadPrivacy({ local: blocked, session });
  assert.equal(first.allowed(), true);
  first.notice.querySelector('[data-choice="no"]').click();
  assert.equal(JSON.parse(session.getItem(KEY)).allowed, false);
  assert.equal(loadPrivacy({ local: blocked, session }).allowed(), false);
});

test('a browser that can store nothing falls back to asking first', () => {
  const page = loadPrivacy({ local: blocked, session: blocked });
  assert.equal(page.allowed(), false);
  assert.match(page.notice.innerHTML, /May we use Meta Pixel/);
  page.notice.querySelector('[data-choice="yes"]').click();
  assert.equal(page.allowed(), true);
});

test('Global Privacy Control overrides the default and a stored yes', () => {
  const local = memoryStorage();
  local.setItem(KEY, JSON.stringify({ allowed: true, expires: Date.now() + 1e9 }));
  const page = loadPrivacy({ local, gpc: true });
  assert.equal(page.allowed(), false);
  assert.equal(page.notice, undefined);
  assert.equal(JSON.parse(local.getItem(KEY)).allowed, false);
});

test('an expired answer is treated as undecided', () => {
  const local = memoryStorage();
  local.setItem(KEY, JSON.stringify({ allowed: false, expires: Date.now() - 1 }));
  assert.equal(loadPrivacy({ local }).allowed(), true);
});

test('no dataset means no measurement and no notice', () => {
  const page = loadPrivacy({ pixelId: '' });
  assert.equal(page.allowed(), false);
  assert.equal(page.notice, undefined);
});

test('the privacy page describes the opt-out posture the script ships', () => {
  assert.doesNotMatch(PRIVACY, /stays off until you allow it/);
  assert.match(PRIVACY, /Measurement is on unless you turn it off/);
  assert.match(PRIVACY, /cannot store your answer at all, measurement stays off/);
});
