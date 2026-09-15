import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createLeadServer } from "./server.mjs";
import { EXPERIMENT_ID, createExperimentStore, readEvents, summarizeEvents, validSource } from "./experiments.mjs";

const env = { MAILGUN_DOMAIN: "example.invalid", MAILGUN_API_KEY: "test", LEAD_TO: "owner@example.invalid" };
const data = { place: "Savannah, GA", bedrooms: "3", name: "Website test", email: "test@example.invalid", phone: "+1 (912) 555-0123", form: "hero-estimate-form" };
// The ids the live homeowner campaign appends to every link it sends.
const CAMPAIGN = "120247056115810068", ADSET = "120247056115820068", AD = "120247056115830068", OTHER_AD = "120247056115840068";
const source = { utmSource: "ig", utmMedium: "paid_social", metaCampaignId: CAMPAIGN, metaAdsetId: ADSET, metaAdId: AD };
const FBCLID = "IwZXh0bgNhZW0BMAABHc9x_Kq3-Yb";
const progress = {
  formId: "hero-estimate-form", lastField: "email", filledCount: 2, requiredRemaining: 2,
  secondsSinceStart: 37, submitted: false, fields: { place: "11-30", name: "4-10", email: "0", phone: "0" },
};
const assignment = variant => ({ id: EXPERIMENT_ID, variant, visitorId: randomUUID() });
function storeFixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "bsv-source-"));
  t.after(() => rmSync(dir, { recursive: true }));
  const file = join(dir, "events.jsonl");
  return { file, store: createExperimentStore(file) };
}
async function serverFixture(t, store, upstream) {
  const server = createLeadServer(env, upstream, store);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return async (body, event = false, origin = "https://blueskyvillagerentals.com") => fetch(
    `http://127.0.0.1:${server.address().port}/bsv-lead${event ? "?event=experiment" : ""}`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body),
    });
}
/* Append a row the way an older service or a damaged write would have left it. */
function appendRow(file, row) {
  appendFileSync(file, JSON.stringify({
    experiment: EXPERIMENT_ID, variant: "A", visitorId: randomUUID(), event: "view",
    at: new Date().toISOString(), ...row,
  }) + "\n");
}

// ---- validSource: the only gate between a query string and the funnel log ----

test("a well-formed source is accepted and comes back cleaned", () => {
  assert.deepEqual(validSource(source), source);
  assert.deepEqual(validSource({ utmSource: "fb", metaCampaignId: CAMPAIGN }), { utmSource: "fb", metaCampaignId: CAMPAIGN });
  // Meta ids vary in length between objects and accounts; both ends of the range are real.
  assert.deepEqual(validSource({ metaAdId: "12345" }), { metaAdId: "12345" });
  assert.deepEqual(validSource({ metaAdsetId: "9".repeat(30) }), { metaAdsetId: "9".repeat(30) });
});

test("a source that is not exactly the five known ad fields is refused whole", () => {
  const refused = [
    null, undefined, "utm_source=ig", 5, true, [], [source],
    { ...source, fbclid: FBCLID },                                   // six keys
    { utmSource: "ig", landingUrl: "https://example.com/private" },  // an unknown key, even below the limit
    { metaCampaignId: "1234" }, { metaCampaignId: "1".repeat(31) }, { metaCampaignId: "120abc456789" },
    { metaCampaignId: Number(CAMPAIGN) },                            // a number was never pattern-checked
    { metaAdsetId: "{{adset.id}}" }, { utmSource: "{{site_source_name}}" },  // an unrendered Meta macro
    { utmSource: "ig kampanje" }, { utmSource: "private@example.com" }, { utmSource: "x".repeat(65) },
    { utmSource: " ig" }, { utmSource: "ig " }, { metaAdId: "\t" + AD }, { metaCampaignId: CAMPAIGN + "\n" },
    JSON.parse('{"__proto__": {"utmSource": "ig"}}'),
  ];
  for (const value of refused) assert.equal(validSource(value), null, JSON.stringify(value));
});

test("fbclid never enters a funnel event, however it arrives", () => {
  // The click id identifies one person. It belongs to the lead payload; funnel rows stay aggregate.
  assert.equal(validSource({ fbclid: FBCLID }), null);
  assert.equal(validSource({ utmSource: "ig", fbclid: FBCLID }), null);
  assert.equal(validSource({ ...source, fbclid: FBCLID }), null);
});

// ---- the row: a label may be missing or spoiled, the event may not ----

test("a recorded source rides along on the row and survives a read", t => {
  const { file, store } = storeFixture(t);
  const a = assignment("A");
  assert.equal(store.record(a, "view", source), true);
  const [row] = readEvents(file);
  assert.equal(row.experiment, EXPERIMENT_ID);
  assert.equal(row.variant, "A");
  assert.equal(row.visitorId, a.visitorId);
  assert.equal(row.event, "view");
  assert.deepEqual(row.source, source);
  // A restarted service reads the log back and must still recognise the visitor.
  const restarted = createExperimentStore(file);
  assert.equal(restarted.record(a, "view", source), true);
  assert.equal(readEvents(file).length, 1);
});

test("a row written before ad attribution existed still counts", t => {
  const { file, store } = storeFixture(t);
  const a = assignment("A"), b = assignment("B");
  assert.equal(store.record(a, "view"), true);
  assert.equal(readEvents(file)[0].source, undefined);
  // Every row in the live log looks like this one; a reader that demanded a source would erase the launch.
  appendRow(file, { variant: "B", visitorId: b.visitorId });
  const events = readEvents(file);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map(row => row.event), ["view", "view"]);
  assert.deepEqual(summarizeEvents(events).variants.map(variant => variant.visitors), [1, 1]);
});

test("a damaged source costs the label, never the view", t => {
  const { file, store } = storeFixture(t);
  const a = assignment("A");
  assert.equal(store.record(a, "view", source), true);
  const damaged = [
    { utmSource: "ig kampanje" },
    { utmSource: "ig", fbclid: FBCLID },
    { metaCampaignId: "{{campaign.id}}" },
    "utm_source=ig",
    ["ig"],
  ];
  for (const bad of damaged) appendRow(file, { source: bad });
  const events = readEvents(file);
  assert.equal(events.length, damaged.length + 1);
  assert.deepEqual(events[0].source, source);
  for (const row of events.slice(1)) assert.ok(!row.source, JSON.stringify(row.source));
});

test("the rows a lead back-fills carry the lead's own source", t => {
  const { file, store } = storeFixture(t);
  const a = assignment("B");
  assert.equal(store.record(a, "lead", source), true);
  const rows = readEvents(file);
  assert.deepEqual(rows.map(row => row.event), ["view", "start", "lead"]);
  for (const row of rows) assert.deepEqual(row.source, source);
  // A view that arrived unattributed stays as written, and the lead adds the labelled view the
  // ad is owed: a landing with no labelled row of its own would be filed under (none) instead.
  const b = assignment("A");
  assert.equal(store.record(b, "view"), true);
  assert.equal(store.record(b, "lead", source), true);
  const later = readEvents(file).filter(row => row.visitorId === b.visitorId);
  assert.deepEqual(later.map(row => row.event), ["view", "view", "start", "lead"]);
  assert.equal(later[0].source, undefined);
  for (const row of later.slice(1)) assert.deepEqual(row.source, source);
});

test("a returning browser's ad click writes the labelled row the per-ad funnel counts", t => {
  const { file, store } = storeFixture(t);
  // Every row the live log opened with looks like this one: a view with no label at all.
  const visitor = assignment("B");
  assert.equal(store.record(visitor, "view"), true);
  // The same browser comes back on an ad link. Lifetime dedupe used to write nothing here.
  assert.equal(store.record(visitor, "view", source), true);
  assert.deepEqual(readEvents(file).map(row => row.source), [undefined, source]);
  // A second click on the same ad, and a later ad, both add nothing: the first label owns the browser.
  assert.equal(store.record(visitor, "view", source), true);
  assert.equal(store.record(visitor, "view", { ...source, metaAdId: OTHER_AD }), true);
  assert.equal(readEvents(file).length, 2);
  // A restarted service reads the labelled row back and does not write a third.
  assert.equal(createExperimentStore(file).record(visitor, "view", source), true);
  assert.equal(readEvents(file).length, 2);
  // Two rows, one browser: both summaries count sets of visitorId, so nothing is inflated.
  const { bySource, variants } = summarizeEvents(readEvents(file));
  assert.equal(bySource.length, 1);
  assert.equal(bySource[0].metaAdId, AD);
  assert.equal(bySource[0].views, 1);
  assert.equal(variants[1].visitors, 1);
});

test("a progress beacon keeps the source that brought the visitor", t => {
  const { file, store } = storeFixture(t);
  assert.equal(store.recordProgress(assignment("A"), progress, source), true);
  const [row] = readEvents(file);
  assert.equal(row.event, "progress");
  assert.deepEqual(row.progress, progress);
  assert.deepEqual(row.source, source);
  assert.equal(store.recordProgress(assignment("B"), progress), true);
  assert.equal(readEvents(file)[1].source, undefined);
});

// ---- reporting: which ad produced the enquiry, and which produced nothing ----

test("the funnel splits by ad, counts browsers once, and keeps the unattributed visible", t => {
  const { file, store } = storeFixture(t);
  const other = { ...source, metaAdId: OTHER_AD };
  const shared = { utmSource: "fb" }; // a share of the post: a source name and no Meta ids at all

  const converted = assignment("A");
  assert.equal(store.record(converted, "lead", source), true);
  const started = assignment("B"); // a different website version still belongs to the same ad
  assert.equal(store.record(started, "start", source), true);
  const viewed = assignment("A"); // a different placement, so a different medium, but the same four ids
  assert.equal(store.record(viewed, "view", { ...source, utmMedium: "paid_social_stories" }), true);
  const labelledLate = assignment("B"); // the first row carried no source, so the second one names the bucket
  assert.equal(store.record(labelledLate, "view"), true);
  assert.equal(store.record(labelledLate, "start", source), true);
  const wandered = assignment("A"); // a second ad later in the session does not claim the visitor
  assert.equal(store.record(wandered, "view", source), true);
  assert.equal(store.record(wandered, "start", other), true);
  // Two browsers that only ever saw the second ad: spend with nothing behind it is the point of the table.
  for (let i = 0; i < 2; i++) assert.equal(store.record(assignment("A"), "view", other), true);
  assert.equal(store.record(assignment("B"), "view", shared), true);

  const unlabelled = assignment("A");
  assert.equal(store.record(unlabelled, "start"), true);
  assert.equal(store.record(assignment("B"), "view"), true);
  assert.equal(store.record(assignment("A"), "view", validSource({})), true); // nothing survived validation
  assert.equal(store.record(assignment("B"), "view", validSource({ fbclid: FBCLID })), true); // a click id alone is not attribution
  // A reload writes a second view for one browser; the table counts browsers, not rows.
  appendRow(file, { visitorId: viewed.visitorId, source });

  const { bySource } = summarizeEvents(readEvents(file));
  assert.deepEqual(bySource.map(row => row.views), [5, 2, 1, 4]);
  assert.deepEqual(bySource[0], {
    key: bySource[0].key, utmSource: "ig", metaCampaignId: CAMPAIGN, metaAdsetId: ADSET, metaAdId: AD,
    views: 5, starts: 4, leads: 1, startPercent: 80, conversionPercent: 20,
  });
  assert.deepEqual(bySource[1], {
    key: bySource[1].key, utmSource: "ig", metaCampaignId: CAMPAIGN, metaAdsetId: ADSET, metaAdId: OTHER_AD,
    views: 2, starts: 0, leads: 0, startPercent: 0, conversionPercent: 0,
  });
  assert.deepEqual(bySource[2], {
    key: bySource[2].key, utmSource: "fb", metaCampaignId: null, metaAdsetId: null, metaAdId: null,
    views: 1, starts: 0, leads: 0, startPercent: 0, conversionPercent: 0,
  });
  assert.deepEqual(bySource[3], {
    key: "(none)", utmSource: null, metaCampaignId: null, metaAdsetId: null, metaAdId: null,
    views: 4, starts: 1, leads: 0, startPercent: 25, conversionPercent: 0,
  });
  assert.ok(bySource.every(row => typeof row.key === "string" && row.key));
  assert.equal(new Set(bySource.map(row => row.key)).size, bySource.length);
  // Twelve browsers, each in exactly one bucket: the table adds up to the funnel, never past it.
  assert.equal(bySource.reduce((total, row) => total + row.views, 0), 12);
});

test("a saved enquiry clears the form it came from and leaves the other one abandoned", t => {
  const { file, store } = storeFixture(t);
  // One browser meets both tracked forms on the page: an enquiry on one says nothing about the other.
  const visitor = assignment("A");
  const other = { ...progress, formId: "estimate-form" };
  assert.equal(store.recordProgress(visitor, progress, source), true);
  // The beacon fires as the page hides, before the save comes back, so it always reads submitted: false.
  assert.equal(store.recordProgress(visitor, other, source), true);
  assert.equal(store.record(visitor, "lead", source, "estimate-form"), true);
  const [a] = summarizeEvents(readEvents(file)).progress;
  assert.equal(a.beacons, 2);
  assert.equal(a.submitted, 1);
  assert.equal(a.abandoned, 1);
  assert.equal(a.medianAbandonedSeconds, 37);
  assert.deepEqual(a.depthHistogram, { 2: 1 });
  const hero = a.forms.find(form => form.formId === "hero-estimate-form");
  assert.equal(hero.abandoned, 1);
  assert.equal(hero.fields.email.abandonedHere, 1);
  const estimate = a.forms.find(form => form.formId === "estimate-form");
  assert.equal(estimate.submitted, 1);
  assert.equal(estimate.abandoned, 0);
  assert.equal(estimate.fields.email.abandonedHere, 0);
  // A form id the page never shipped is untracked, so it clears nothing and never enters the log.
  const spoofed = assignment("A");
  assert.equal(store.record(spoofed, "lead", source, "made-up-form"), true);
  assert.equal(readEvents(file).find(row => row.visitorId === spoofed.visitorId && row.event === "lead").form, undefined);
});

test("a lead row names the form the enquiry was submitted from", async t => {
  const { file, store } = storeFixture(t);
  const send = await serverFixture(t, store, async () => Response.json({ id: randomUUID() }));
  const experiment = assignment("B");
  assert.equal((await send({ experiment, event: "progress", progress, source }, true)).status, 204);
  assert.equal((await send({ ...data, experiment, attribution: { ...source, fbclid: FBCLID } })).status, 200);
  const lead = readEvents(file).find(row => row.event === "lead");
  assert.equal(lead.form, "hero-estimate-form");
  assert.deepEqual(lead.source, source); // the click id still stops at the lead payload
  assert.ok(!readFileSync(file, "utf8").includes(FBCLID));
  // The beacon that ends in this enquiry is no longer reported as someone walking away.
  const [, b] = summarizeEvents(readEvents(file)).progress;
  assert.equal(b.beacons, 1);
  assert.equal(b.submitted, 1);
  assert.equal(b.abandoned, 0);
});

// ---- the wire: what the in-app browsers actually post ----

test("a posted event carries its source, and a spoiled one still counts as a view", async t => {
  const { file, store } = storeFixture(t);
  const send = await serverFixture(t, store, async () => { throw new Error("unexpected upstream call"); });
  const experiment = assignment("A");
  assert.equal((await send({ experiment, event: "view", source }, true)).status, 204);
  assert.deepEqual(readEvents(file)[0].source, source);
  assert.equal((await send({ experiment, event: "progress", progress, source }, true)).status, 204);
  assert.deepEqual(readEvents(file)[1].source, source);

  const spoiled = assignment("B");
  assert.equal((await send({ experiment: spoiled, event: "view", source: { ...source, fbclid: FBCLID } }, true)).status, 204);
  assert.equal((await send({ experiment: spoiled, event: "start", source: "utm_source=ig" }, true)).status, 204);
  const rows = readEvents(file).filter(row => row.visitorId === spoiled.visitorId);
  assert.deepEqual(rows.map(row => row.event), ["view", "start"]);
  for (const row of rows) assert.ok(!row.source, JSON.stringify(row.source));
  assert.ok(!readFileSync(file, "utf8").includes(FBCLID));
});

test("a saved lead keeps the click id and request id its Meta-reported conversion is reconciled against", async t => {
  const calls = [];
  const send = await serverFixture(t, null, async (url, options) => {
    calls.push({ url, options });
    return Response.json({ id: randomUUID() });
  });
  const requestId = randomUUID();
  assert.equal((await send({ ...data, requestId, attribution: { ...source, fbclid: FBCLID } })).status, 200);
  const { additionalData } = JSON.parse(calls[0].options.body);
  assert.equal(additionalData.fbclid, FBCLID);
  assert.equal(additionalData.requestId, requestId);
  assert.equal(additionalData.metaAdId, AD);
  assert.equal(additionalData.utmSource, "ig");
  // A macro that never rendered is not an identifier, and an enquiry without a retry key has none to record.
  assert.equal((await send({ ...data, attribution: { fbclid: "{{fbclid}}" } })).status, 200);
  const second = JSON.parse(calls[2].options.body).additionalData;
  assert.ok(!Object.hasOwn(second, "fbclid"));
  assert.ok(!Object.hasOwn(second, "requestId"));
});
