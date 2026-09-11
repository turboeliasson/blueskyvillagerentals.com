import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const PIXEL_SOURCE = readFileSync(new URL('../pixel.js', import.meta.url), 'utf8');
const INDEX_SOURCE = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const SITE_SOURCE = readFileSync(new URL('../village/site.js', import.meta.url), 'utf8');

/* Runs pixel.js against a fake browser, so the guard is tested without a DOM library. */
function loadPixel({ pixelId, variant }) {
  const inserted = [];
  const existingScript = { parentNode: { insertBefore(node) { inserted.push(node); } } };
  const document = {
    documentElement: { dataset: { bsvVariant: variant } },
    createElement: tag => ({ tag }),
    getElementsByTagName: () => [existingScript]
  };
  const win = { document, BSV_META_PIXEL_ID: pixelId };
  win.window = win;
  vm.runInNewContext(PIXEL_SOURCE, win);
  /* The pixel runs in its own realm, so copy its calls into plain host values. */
  const calls = () => (win.fbq ? JSON.parse(JSON.stringify(win.fbq.queue.map(args => [...args]))) : []);
  return { win, inserted, calls };
}

const leads = calls => calls.filter(([kind, event]) => kind === 'track' && event === 'Lead');

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
  assert.deepEqual(calls(), [['init', '123456789012345'], ['track', 'PageView']]);
});

test('a saved enquiry reports exactly one Lead naming its form and version', () => {
  const a = loadPixel({ pixelId: '123456789012345', variant: 'A' });
  assert.equal(a.win.BSVPixel.trackLead('early-estimate-form'), true);
  assert.deepEqual(leads(a.calls()), [['track', 'Lead', { content_name: 'early-estimate', variant: 'A' }]]);

  const b = loadPixel({ pixelId: '123456789012345', variant: 'B' });
  assert.equal(b.win.BSVPixel.trackLead('hero-estimate-form'), true);
  assert.equal(b.win.BSVPixel.trackLead('estimate-form'), true);
  assert.deepEqual(leads(b.calls()), [
    ['track', 'Lead', { content_name: 'hero', variant: 'B' }],
    ['track', 'Lead', { content_name: 'letter', variant: 'B' }]
  ]);
});

test('the same form id means the lower estimate form on A and the letter form on B', () => {
  const a = loadPixel({ pixelId: '123456789012345', variant: 'A' });
  a.win.BSVPixel.trackLead('estimate-form');
  assert.equal(leads(a.calls())[0][2].content_name, 'estimate');

  const b = loadPixel({ pixelId: '123456789012345', variant: 'B' });
  b.win.BSVPixel.trackLead('estimate-form');
  assert.equal(leads(b.calls())[0][2].content_name, 'letter');
});

test('a blocked or failing fbq never breaks an enquiry', () => {
  const blocked = loadPixel({ pixelId: '123456789012345', variant: 'B' });
  delete blocked.win.fbq;
  assert.equal(blocked.win.BSVPixel.trackLead('hero-estimate-form'), false);

  const failing = loadPixel({ pixelId: '123456789012345', variant: 'A' });
  failing.win.fbq = () => { throw new Error('blocked'); };
  assert.equal(failing.win.BSVPixel.trackLead('estimate-form'), false);
});

test('both versions report the Lead only where the gateway confirmed the save', () => {
  assert.match(INDEX_SOURCE, /if\(!r\.ok \|\| !result\.ok\) throw new Error\('send failed'\);\n\s*sent=true;\n\s*window\.BSVPixel\?\.trackLead\(form\.id\);/);
  assert.match(SITE_SOURCE, /throw new Error\(response\.status === 429 \? 'rate' : 'send'\);\n\s*complete = true;\n\s*window\.BSVPixel\?\.trackLead\(form\.id\);/);
  for (const source of [INDEX_SOURCE, SITE_SOURCE]) {
    assert.equal(source.match(/trackLead\(/g).length, 1);
  }
});

test('both pages carry an empty constant and load the shared pixel file', () => {
  for (const source of [INDEX_SOURCE, readFileSync(new URL('../village/index.html', import.meta.url), 'utf8')]) {
    assert.match(source, /\/\/ Set to the Blue Sky Village Meta dataset \(pixel\) ID\nwindow\.BSV_META_PIXEL_ID = "";/);
    assert.match(source, /<script src="\/pixel\.js\?v=\d{8}" defer><\/script>/);
    assert.ok(!source.includes('connect.facebook.net'));
  }
});
