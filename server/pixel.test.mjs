import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const PIXEL_SOURCE = readFileSync(new URL('../pixel.js', import.meta.url), 'utf8');
const INDEX_SOURCE = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const SITE_SOURCE = readFileSync(new URL('../village/site.js', import.meta.url), 'utf8');

/* Runs pixel.js against a fake browser, so the guard is tested without a DOM library. */
function loadPixel({ pixelId, variant, allowed = true, href = 'https://blueskyvillagerentals.com/', referrer = '' }) {
  const inserted = [];
  const existingScript = { parentNode: { insertBefore(node) { inserted.push(node); } } };
  const document = {
    referrer,
    documentElement: { dataset: { bsvVariant: variant } },
    createElement: tag => ({ tag }),
    getElementsByTagName: () => [existingScript]
  };
  const listeners = {};
  const win = { document, BSV_META_PIXEL_ID: pixelId, URL, Set,
    location: { href }, BSVAdPrivacy: { allowed: () => allowed },
    addEventListener: (name, listener) => { listeners[name] = listener; } };
  win.window = win;
  vm.runInNewContext(PIXEL_SOURCE, win);
  /* The pixel runs in its own realm, so copy its calls into plain host values. */
  const calls = () => (win.fbq ? JSON.parse(JSON.stringify(win.fbq.queue.map(args => [...args]))) : []);
  return { win, inserted, calls, consent(value) { allowed = value; listeners['bsv-ad-consent']?.(); } };
}

const leads = calls => calls.filter(([kind, id, event]) => kind === 'trackSingle' && event === 'Lead');
const requestId = '12345678-1234-4234-8234-123456789012';
const secondId = '12345678-1234-4234-8234-123456789013';

test('an empty dataset ID loads no pixel at all', () => {
  const { win, inserted } = loadPixel({ pixelId: '', variant: 'A' });
  assert.equal(win.fbq, undefined);
  assert.equal(win._fbq, undefined);
  assert.deepEqual(inserted, []);
  assert.equal(win.BSVPixel.active, false);
  assert.equal(win.BSVPixel.trackLead('estimate-form'), false);
  assert.equal(win.fbq, undefined);
});

test('whitespace or a missing constant is treated as no dataset', () => {
  for (const pixelId of ['   ', undefined, null, 0]) {
    const { win, inserted } = loadPixel({ pixelId, variant: 'B' });
    assert.equal(win.fbq, undefined, `loaded for ${String(pixelId)}`);
    assert.deepEqual(inserted, []);
    assert.equal(win.BSVPixel.active, false);
  }
});

test('a configured dataset ID reports one PageView from connect.facebook.net', () => {
  const { win, inserted, calls } = loadPixel({ pixelId: '123456789012345', variant: 'A' });
  assert.equal(win.BSVPixel.active, true);
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].src, 'https://connect.facebook.net/en_US/fbevents.js');
  assert.equal(inserted[0].async, true);
  assert.deepEqual(calls(), [['consent', 'grant'], ['set', 'autoConfig', false, '123456789012345'], ['init', '123456789012345'], ['trackSingle', '123456789012345', 'PageView']]);
});

test('a saved enquiry reports exactly one Lead naming its form and version', () => {
  const a = loadPixel({ pixelId: '123456789012345', variant: 'A' });
  assert.equal(a.win.BSVPixel.trackLead('early-estimate-form', requestId), true);
  assert.equal(a.win.BSVPixel.trackLead('early-estimate-form', requestId), false);
  assert.deepEqual(leads(a.calls()), [['trackSingle', '123456789012345', 'Lead', { content_name: 'early-estimate', variant: 'A' }, { eventID: requestId }]]);

  const b = loadPixel({ pixelId: '123456789012345', variant: 'B' });
  assert.equal(b.win.BSVPixel.trackLead('hero-estimate-form', requestId), true);
  assert.equal(b.win.BSVPixel.trackLead('estimate-form', secondId), true);
  assert.deepEqual(leads(b.calls()), [
    ['trackSingle', '123456789012345', 'Lead', { content_name: 'hero', variant: 'B' }, { eventID: requestId }],
    ['trackSingle', '123456789012345', 'Lead', { content_name: 'letter', variant: 'B' }, { eventID: secondId }]
  ]);
});

test('the same form id means the lower estimate form on A and the letter form on B', () => {
  const a = loadPixel({ pixelId: '123456789012345', variant: 'A' });
  a.win.BSVPixel.trackLead('estimate-form', requestId);
  assert.equal(leads(a.calls())[0][3].content_name, 'estimate');

  const b = loadPixel({ pixelId: '123456789012345', variant: 'B' });
  b.win.BSVPixel.trackLead('estimate-form', requestId);
  assert.equal(leads(b.calls())[0][3].content_name, 'letter');
});

test('a blocked or failing fbq never breaks an enquiry', () => {
  const blocked = loadPixel({ pixelId: '123456789012345', variant: 'B' });
  delete blocked.win.fbq;
  assert.equal(blocked.win.BSVPixel.trackLead('hero-estimate-form', requestId), false);

  const failing = loadPixel({ pixelId: '123456789012345', variant: 'A' });
  failing.win.fbq = () => { throw new Error('blocked'); };
  assert.equal(failing.win.BSVPixel.trackLead('estimate-form', requestId), false);
});

test('both versions report the Lead only where the gateway confirmed the save', () => {
  assert.match(INDEX_SOURCE, /if\(!r\.ok \|\| !result\.ok\) throw new Error\('send failed'\);\n\s*sent=true;\n\s*window\.BSVPixel\?\.trackLead\(form\.id, requestId\);/);
  assert.match(SITE_SOURCE, /throw new Error\(response\.status === 429 \? 'rate' : 'send'\);\n\s*complete = true;\n\s*window\.BSVPixel\?\.trackLead\(form\.id, requestId\);/);
  for (const source of [INDEX_SOURCE, SITE_SOURCE]) {
    assert.equal(source.match(/trackLead\(/g).length, 1);
  }
});

test('both pages use the Blue Sky dataset and load the shared pixel file', () => {
  for (const source of [INDEX_SOURCE, readFileSync(new URL('../village/index.html', import.meta.url), 'utf8')]) {
    assert.match(source, /\/\/ Set to the Blue Sky Village Meta dataset \(pixel\) ID\nwindow\.BSV_META_PIXEL_ID = "1113214541040969";/);
    assert.match(source, /<script src="\/pixel\.js\?v=\d{8}" defer><\/script>/);
    assert.ok(!source.includes('connect.facebook.net'));
  }
});


test('no SDK or event before consent, and withdrawal prevents later leads without replay', () => {
  const p = loadPixel({ pixelId: '123456789012345', variant: 'A', allowed: false });
  assert.equal(p.inserted.length, 0);
  assert.equal(p.win.BSVPixel.trackLead('estimate-form', requestId), false);
  p.consent(true);
  assert.equal(p.inserted.length, 1);
  assert.equal(leads(p.calls()).length, 0);
  p.consent(false);
  assert.equal(p.win.BSVPixel.trackLead('estimate-form', secondId), false);
  assert.deepEqual(p.calls().at(-1), ['consent', 'revoke']);
  p.consent(true);
  assert.equal(p.calls().filter(c => c[2] === 'PageView').length, 1);
});

test('unconfigured or unsafe URLs and referrers never load Meta', () => {
  for (const options of [
    { pixelId: 'not-a-pixel' },
    { href: 'https://blueskyvillagerentals.com/?email=private@example.com' },
    { href: 'https://blueskyvillagerentals.com/?utm_content=private@example.com' },
    { href: 'https://blueskyvillagerentals.com/#private@example.com' },
    { referrer: 'https://example.com/?email=private@example.com' },
    { href: 'https://blueskyvillagerentals.com/?bsv_variant=B' }
  ]) {
    const p = loadPixel({ pixelId: '123456789012345', variant: 'A', ...options });
    assert.equal(p.inserted.length, 0);
    assert.equal(p.win.BSVPixel.trackLead('estimate-form', requestId), false);
  }
});

test('unknown form names and non-random event IDs do not enter event payloads', () => {
  const p = loadPixel({ pixelId: '123456789012345', variant: 'A' });
  assert.equal(p.win.BSVPixel.trackLead('private@example.com', requestId), false);
  assert.equal(p.win.BSVPixel.trackLead('estimate-form', 'private@example.com'), false);
  assert.equal(leads(p.calls()).length, 0);
});


test('normal section links work but a changed unsafe URL revokes tracking', () => {
  const p = loadPixel({ pixelId: '123456789012345', variant: 'A', href: 'https://blueskyvillagerentals.com/#estimate' });
  assert.equal(p.win.BSVPixel.active, true);
  assert.equal(p.win.BSVPixel.trackLead('estimate-form', requestId), true);
  p.win.location.href = 'https://blueskyvillagerentals.com/?email=private@example.com';
  assert.equal(p.win.BSVPixel.trackLead('estimate-form', secondId), false);
  assert.equal(leads(p.calls()).length, 1);
  assert.deepEqual(p.calls().at(-1), ['consent', 'revoke']);
});

test('owner guides use their own context and preserve consent and unsafe-path guards', () => {
  const p = loadPixel({ pixelId: '123456789012345', variant: 'owners', allowed: false, href: 'https://blueskyvillagerentals.com/locations/savannah/?utm_source=chatgpt.com#estimate' });
  assert.equal(p.inserted.length, 0);
  p.consent(true);
  assert.equal(p.win.BSVPixel.trackLead('savannah-estimate-form', requestId), true);
  assert.equal(leads(p.calls())[0][3].variant, 'owners');
  assert.equal(p.win.BSVPixel.trackLead('estimate-form', secondId), false);
  for (const href of ['https://blueskyvillagerentals.com/locations/private@example.com/', 'https://blueskyvillagerentals.com/locations/savannah/?email=private@example.com']) {
    assert.equal(loadPixel({ pixelId: '123456789012345', variant: 'owners', href }).inserted.length, 0);
  }
});
