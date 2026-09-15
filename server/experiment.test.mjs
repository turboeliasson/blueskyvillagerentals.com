import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../experiment.js', import.meta.url), 'utf8');
const VISITOR = '12345678-1234-4234-8234-123456789012';
/* The second id a browser is handed when a paid visit moves it off variant B. */
const REASSIGNED = 'abcdef01-2345-4678-9abc-def012345678';
const PAID = 'https://blueskyvillagerentals.com/?utm_medium=paid_social&utm_source=facebook';

function field({ name, required = false, tag = 'input', value = '', disabled = false, group = false, checked = false }) {
  return { name, value, required, tag, disabled, group, checked };
}
/* A settled microtask queue: track() decides about a retry inside fetch's .then. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

/* Runs experiment.js against a fake browser, so the beacon is tested without a DOM library. */
function loadExperiment({
  variant = 'A', pageVariant = variant, href = 'https://blueskyvillagerentals.com/',
  formId = 'early-estimate-form', fields, stored, respond,
} = {}) {
  const inputs = fields ?? [
    field({ name: 'place', required: true }), field({ name: 'name', required: true }),
    field({ name: 'phone' }), field({ name: 'email', required: true }),
    field({ name: 'bedrooms', required: true, tag: 'select' }), field({ name: 'website' }),
  ];
  const formListeners = {};
  /* form.elements answers with the control itself for a lone field and with the group - a
     RadioNodeList, a separate object - when several controls share a name. */
  const elements = {};
  for (const input of inputs) {
    if (Object.hasOwn(elements, input.name)) continue;
    const members = inputs.filter(other => other.name === input.name);
    if (input.group) {
      Object.defineProperty(elements, input.name, {
        enumerable: true,
        get: () => ({ value: members.find(member => member.checked)?.value ?? '' }),
      });
    } else elements[input.name] = input;
  }
  const form = {
    id: formId,
    elements,
    addEventListener: (name, listener) => { (formListeners[name] ??= []).push(listener); },
    querySelectorAll: () => inputs,
  };
  const documentListeners = {}, windowListeners = {};
  const beacons = [], posts = [], replaced = [];
  /* Blob bodies read back asynchronously, so the fake keeps the payload inspectable. */
  class FakeBlob { constructor(parts, options) { this.parts = parts; this.type = options?.type; } }
  const store = new Map([['bsv-homeowner-test', JSON.stringify(stored ?? {
    experiment: 'bsv-homeowners-2026-09', variant, visitorId: VISITOR, assignedAt: Date.now(),
  })]]);
  const document = {
    documentElement: { dataset: { bsvVariant: pageVariant } },
    visibilityState: 'visible',
    querySelectorAll: () => [form],
    addEventListener: (name, listener) => { (documentListeners[name] ??= []).push(listener); },
  };
  let issued = 0; // each new id is distinct, and never the stored one
  const win = {
    document, URL, Set, Map, Math, Date, JSON, String, Object, Number, Blob: FakeBlob,
    location: { href, hostname: 'blueskyvillagerentals.com', replace: target => replaced.push(target) },
    navigator: { userAgent: 'Mozilla/5.0', sendBeacon: (url, body) => { beacons.push({ url, body }); return true; } },
    localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) },
    crypto: {
      randomUUID: () => `abcdef0${++issued}-2345-4678-9abc-def012345678`,
      getRandomValues: array => { array[0] = 0; return array; },
    },
    fetch: (url, options) => {
      posts.push({ url, body: JSON.parse(options.body) });
      return respond ? respond(posts.length) : Promise.resolve({ ok: true, status: 200 });
    },
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
    /* Picking a radio: the group moves and the control itself raises the event. */
    choose(name, value) {
      const members = inputs.filter(input => input.name === name);
      members.forEach(member => { member.checked = member.value === value; });
      const target = members.find(member => member.value === value);
      formListeners.input?.forEach(listener => listener({ target }));
    },
    submit() { formListeners.submit?.forEach(listener => listener()); },
    // What the enquiry form dispatches once the server has confirmed the save.
    confirm() { formListeners['bsv-submitted']?.forEach(listener => listener({ type: 'bsv-submitted' })); },
    hide() {
      document.visibilityState = 'hidden';
      documentListeners.visibilitychange?.forEach(listener => listener({ type: 'visibilitychange' }));
    },
    show() {
      document.visibilityState = 'visible';
      documentListeners.visibilitychange?.forEach(listener => listener({ type: 'visibilitychange' }));
    },
    pagehide() { windowListeners.pagehide?.forEach(listener => listener({ type: 'pagehide' })); },
    replaced: () => replaced,
    assignment: () => JSON.parse(store.get('bsv-homeowner-test')),
    /* The page runs in its own realm, so copy each beacon into plain host values. */
    beacons: () => beacons,
    posts: () => posts,
    events: name => posts.filter(post => post.body.event === name),
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

/* One visitorId belongs to one variant for good, and the log enforces it by refusing any row
   that disagrees. A paid click is always served A, so a browser holding B has to be re-issued. */
test('a paid click from a browser assigned B is re-issued under A, not silently mismatched', () => {
  const page = loadExperiment({ variant: 'B', pageVariant: 'A', href: PAID });
  page.type('place', 'Savannah');
  page.hide();
  const view = page.events('view')[0];
  assert.equal(view.body.experiment.variant, 'A');
  assert.notEqual(view.body.experiment.visitorId, VISITOR); // the B id would be rejected by the log
  assert.equal(view.body.experiment.visitorId, REASSIGNED);
  const [beacon] = page.progress();
  assert.equal(beacon.experiment.variant, 'A');
  assert.equal(beacon.experiment.visitorId, REASSIGNED);
  assert.deepEqual(page.replaced(), []); // a paid click is never sent through a second navigation
});

test('the re-issued assignment is stored, so the next visit stays on the same id', () => {
  const first = loadExperiment({ variant: 'B', pageVariant: 'A', href: PAID });
  const saved = first.assignment();
  assert.equal(saved.variant, 'A');
  assert.equal(saved.visitorId, REASSIGNED);
  const second = loadExperiment({ stored: saved, pageVariant: 'A', href: PAID });
  assert.equal(second.events('view')[0].body.experiment.visitorId, REASSIGNED);
  assert.equal(second.assignment().visitorId, REASSIGNED);
});

test('an organic visit keeps a stored B assignment and its id', () => {
  const page = loadExperiment({ variant: 'B', formId: 'hero-estimate-form' });
  assert.equal(page.events('view')[0].body.experiment.variant, 'B');
  assert.equal(page.events('view')[0].body.experiment.visitorId, VISITOR);
  assert.equal(page.assignment().visitorId, VISITOR);
});

test('a rejected event is final, so a keystroke cannot loop the endpoint', async () => {
  const page = loadExperiment({ respond: () => Promise.resolve({ ok: false, status: 409 }) });
  for (const value of ['S', 'Sa', 'Sav', 'Sava', 'Savan']) {
    page.type('place', value);
    await settle();
  }
  assert.equal(page.events('start').length, 1);
});

test('a server fault is retried, but only up to the ceiling', async () => {
  const page = loadExperiment({ respond: () => Promise.resolve({ ok: false, status: 503 }) });
  for (const value of ['S', 'Sa', 'Sav', 'Sava', 'Savan', 'Savann']) {
    page.type('place', value);
    await settle();
  }
  assert.equal(page.events('start').length, 3);
});

test('a dropped connection is retried, but only up to the ceiling', async () => {
  const page = loadExperiment({ respond: () => Promise.reject(new Error('offline')) });
  for (const value of ['S', 'Sa', 'Sav', 'Sava', 'Savan', 'Savann']) {
    page.type('place', value);
    await settle();
  }
  assert.equal(page.events('start').length, 3);
});

/* An in-app browser hides the page every time the visitor switches app. That must not end
   measurement for the session: the server keeps the last beacon per visitor and form. */
test('a visitor who app-switches and comes back still reports what they type afterwards', () => {
  const page = loadExperiment();
  page.type('place', 'Savannah');
  page.hide();
  page.show();
  page.type('name', 'Ryan');
  page.type('email', 'ryan@example.com');
  page.hide();
  const rows = page.progress();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].progress.fields.name, '0');
  assert.equal(rows[1].progress.fields.name, '4-10');
  assert.equal(rows[1].progress.filledCount, 3);
});

test('a confirmed submit reports even when the page was already hidden once', () => {
  const page = loadExperiment();
  page.type('place', 'Savannah');
  page.hide();
  page.show();
  page.type('name', 'Ryan');
  page.confirm();
  const rows = page.progress();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].progress.submitted, false);
  assert.equal(rows[1].progress.submitted, true); // the conversion row is never latched out
  assert.equal(rows[1].progress.fields.name, '4-10');
});

test('the confirmed submit sends one row, however often it is dispatched', () => {
  const page = loadExperiment();
  page.type('place', 'Savannah');
  page.confirm();
  page.confirm();
  page.pagehide();
  assert.equal(page.progress().length, 1);
});

test('flicking between apps cannot spend the per-IP allowance', () => {
  const page = loadExperiment();
  for (let round = 0; round < 8; round++) {
    page.type('place', 'x'.repeat(round + 1));
    page.hide();
    page.show();
  }
  assert.equal(page.progress().length, 4);
});

test('the conversion row survives a visit that already spent the beacon cap', () => {
  const page = loadExperiment();
  for (let round = 0; round < 8; round++) {
    page.type('place', 'x'.repeat(round + 1));
    page.hide();
    page.show();
  }
  page.type('name', 'Ryan');
  page.confirm();
  const rows = page.progress();
  assert.equal(rows.length, 5); // four capped beacons plus the conversion
  assert.equal(rows.at(-1).progress.submitted, true);
  assert.equal(rows.at(-1).progress.fields.name, '4-10');
});

/* index.html ships contactBy pre-checked on email. A default nobody chose is not an answer. */
test('a pre-checked radio nobody touched is not reported as filled', () => {
  const page = loadExperiment({
    fields: [
      field({ name: 'name', required: true }),
      field({ name: 'contactBy', value: 'email', group: true, checked: true }),
      field({ name: 'contactBy', value: 'phone', group: true }),
      field({ name: 'email', required: true }), field({ name: 'website' }),
    ],
  });
  page.type('name', 'Ryan');
  page.hide();
  const [payload] = page.progress();
  assert.equal(payload.progress.fields.contactBy, '0');
  assert.equal(payload.progress.filledCount, 1); // name only
});

test('a radio the visitor actually chose is reported as filled', () => {
  const page = loadExperiment({
    fields: [
      field({ name: 'name', required: true }),
      field({ name: 'contactBy', value: 'email', group: true, checked: true }),
      field({ name: 'contactBy', value: 'phone', group: true }),
      field({ name: 'email', required: true }), field({ name: 'website' }),
    ],
  });
  page.type('name', 'Ryan');
  page.choose('contactBy', 'phone');
  page.hide();
  const [payload] = page.progress();
  assert.equal(payload.progress.fields.contactBy, '4-10');
  assert.equal(payload.progress.filledCount, 2);
  assert.equal(payload.progress.lastField, 'contactBy');
});

test('a disabled required field is not counted as still to fill', () => {
  const page = loadExperiment({
    fields: [
      field({ name: 'name', required: true }),
      field({ name: 'email', required: true }),
      field({ name: 'phone', required: true, disabled: true }), // the unused half of the pair
      field({ name: 'website' }),
    ],
  });
  page.type('name', 'Ryan');
  page.hide();
  const [payload] = page.progress();
  assert.equal(payload.progress.requiredRemaining, 1); // email only
  assert.equal(payload.progress.fields.phone, '0');
});
