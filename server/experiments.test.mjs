import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createLeadServer } from "./server.mjs";
import { EXPERIMENT_ID, createExperimentStore, readEvents, summarizeEvents } from "./experiments.mjs";

const env = { MAILGUN_DOMAIN: "example.invalid", MAILGUN_API_KEY: "test", LEAD_TO: "owner@example.invalid" };
const data = { place: "Mooresville, NC", name: "Website test", email: "test@example.invalid", phone: "+17045550123", form: "hero-enquiry-form" };
const assignment = variant => ({ id: EXPERIMENT_ID, variant, visitorId: randomUUID() });
function storeFixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "bsv-experiment-"));
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

test("deduplicates exposure, starts and conversions across service restarts and keeps versions separate", t => {
  const { file, store } = storeFixture(t);
  const a = assignment("A"), b = assignment("B");
  store.record(a, "view"); store.record(a, "start"); store.record(a, "lead"); store.record(b, "start");
  const restarted = createExperimentStore(file);
  restarted.record(a, "lead"); restarted.record(b, "view");
  assert.equal(restarted.record({ ...a, variant: "B" }, "lead"), false);
  assert.equal(restarted.record({ ...b, visitorId: "email@example.com" }, "view"), false);
  assert.equal(readEvents(file).length, 5);
  assert.deepEqual(summarizeEvents(readEvents(file)).variants, [
    { variant: "A", visitors: 1, started: 1, converted: 1, conversionPercent: 100 },
    { variant: "B", visitors: 1, started: 1, converted: 0, conversionPercent: 0 },
  ]);
});

test("measurement events never call upstream or consume the lead allowance; clients cannot report conversions", async t => {
  const { file, store } = storeFixture(t);
  let calls = 0;
  const send = await serverFixture(t, store, async () => { calls++; return Response.json({ id: randomUUID() }); });
  const experiment = assignment("B");
  for (let i = 0; i < 8; i++) assert.equal((await send({ experiment, event: "view" }, true)).status, 204);
  assert.equal((await send({ experiment, event: "lead" }, true)).status, 400);
  assert.equal((await send({ experiment, event: "view" }, true, "https://unrelated.example")).status, 403);
  assert.equal(calls, 0);
  assert.equal(readEvents(file).length, 1);
  assert.equal((await send({ ...data, experiment })).status, 200);
  assert.equal(calls, 2);
});

test("only a saved lead counts, retries count once, and notification keeps existing recipients and reply-to", async t => {
  const { file, store } = storeFixture(t);
  const calls = [];
  const send = await serverFixture(t, store, async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? new Response(null, { status: 503 }) : Response.json({ id: randomUUID() });
  });
  const experiment = assignment("B");
  const body = { ...data, experiment, requestId: randomUUID() };
  assert.equal((await send(body)).status, 502);
  assert.equal(readEvents(file).length, 0);
  assert.equal((await send(body)).status, 200);
  assert.equal((await send(body)).status, 200);
  assert.equal(calls.length, 3);
  const lead = JSON.parse(calls[1].options.body);
  assert.equal(lead.additionalData.experimentId, EXPERIMENT_ID);
  assert.equal(lead.additionalData.experimentVariant, "B");
  assert.ok(!calls[1].options.body.includes(experiment.visitorId));
  const mail = calls[2].options.body;
  assert.equal(mail.get("to"), env.LEAD_TO);
  assert.equal(mail.get("h:Reply-To"), data.email);
  assert.match(mail.get("text"), /B \(village redesign\)/);
  assert.ok(!mail.get("text").includes(experiment.visitorId));
  assert.equal(summarizeEvents(readEvents(file)).variants[1].converted, 1);
  const log = readFileSync(file, "utf8");
  for (const value of Object.values(data)) assert.ok(!log.includes(value));
});

test("measurement write failures never lose saved enquiries or prevent notifications", async t => {
  const store = { record() { throw new Error("disk unavailable"); } };
  let calls = 0;
  const send = await serverFixture(t, store, async () => { calls++; return Response.json({ id: randomUUID() }); });
  const experiment = assignment("A");
  assert.equal((await send({ experiment, event: "view" }, true)).status, 503);
  assert.equal((await send({ ...data, experiment })).status, 200);
  assert.equal(calls, 2);
});

test("honeypots and invalid forms never count as conversions", async t => {
  const { file, store } = storeFixture(t);
  const send = await serverFixture(t, store, async () => { throw new Error("unexpected upstream call"); });
  const experiment = assignment("B");
  assert.equal((await send({ ...data, experiment, website: "spam" })).status, 200);
  assert.equal((await send({ ...data, experiment, email: "wrong" })).status, 400);
  assert.equal(readEvents(file).length, 0);
});

// ---- form progress: how far someone got, never what they typed ----

const progress = {
  formId: "early-estimate-form", lastField: "email", filledCount: 3, requiredRemaining: 1,
  secondsSinceStart: 37, submitted: false, fields: { bedrooms: "1-3", area: "4-10", name: "4-10", email: "0" },
};

test("a beacon records depth and volume, and never a field value or the honeypot", async t => {
  const { file, store } = storeFixture(t);
  const send = await serverFixture(t, store, async () => { throw new Error("unexpected upstream call"); });
  const experiment = assignment("A");
  assert.equal((await send({ experiment, event: "progress", progress }, true)).status, 204);
  const rows = readEvents(file).filter(row => row.event === "progress");
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].progress, progress);
  const log = readFileSync(file, "utf8");
  assert.ok(!log.includes("website"));
  for (const value of Object.values(data)) assert.ok(!log.includes(value));
});

test("a beacon is accepted as text/plain, which is all sendBeacon can send without a preflight", async t => {
  const { file, store } = storeFixture(t);
  const server = createLeadServer(env, async () => { throw new Error("unexpected upstream call"); }, store);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/bsv-lead?event=experiment`, {
    method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8", Origin: "https://blueskyvillagerentals.com" },
    body: JSON.stringify({ experiment: assignment("B"), event: "progress", progress }),
  });
  assert.equal(response.status, 204);
  assert.equal(readEvents(file).length, 1);
});

test("every malformed beacon is refused whole and writes nothing", async t => {
  const { file, store } = storeFixture(t);
  const send = await serverFixture(t, store, async () => { throw new Error("unexpected upstream call"); });
  const experiment = assignment("A");
  const rejected = [
    { ...progress, formId: "made-up-form" },
    { ...progress, fields: { ...progress.fields, website: "4-10" } },
    { ...progress, lastField: "website" },
    { ...progress, fields: { ...progress.fields, place: "7" } },
    { ...progress, fields: { ...progress.fields, place: "Mooresville, NC" } },
    { ...progress, fields: { ...progress.fields, "bad name": "4-10" } },
    { ...progress, fields: Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`f${i}`, "1-3"])) },
    { ...progress, fields: "place=11-30" },
    { ...progress, filledCount: 13 },
    { ...progress, filledCount: -1 },
    { ...progress, requiredRemaining: 1.5 },
    { ...progress, secondsSinceStart: 3601 },
    { ...progress, submitted: "yes" },
    undefined,
  ];
  for (const payload of rejected) {
    assert.equal((await send({ experiment, event: "progress", progress: payload }, true)).status, 400, JSON.stringify(payload));
  }
  assert.equal(readEvents(file).length, 0);
});

test("a beacon establishes no exposure and leaves the existing summary untouched", async t => {
  const { file, store } = storeFixture(t);
  const send = await serverFixture(t, store, async () => { throw new Error("unexpected upstream call"); });
  assert.equal((await send({ experiment: assignment("A"), event: "progress", progress }, true)).status, 204);
  assert.equal(readEvents(file).filter(row => ["view", "start", "lead"].includes(row.event)).length, 0);
  const summary = summarizeEvents(readEvents(file));
  assert.deepEqual(Object.keys(summary), ["experiment", "firstEvent", "variants", "progress", "bySource"]);
  assert.deepEqual(summary.bySource, []);
  assert.deepEqual(summary.variants, [
    { variant: "A", visitors: 0, started: 0, converted: 0, conversionPercent: 0 },
    { variant: "B", visitors: 0, started: 0, converted: 0, conversionPercent: 0 },
  ]);
});

test("progress rows do not disturb the exposure summary the reporting job reads", async t => {
  const { file, store } = storeFixture(t);
  const send = await serverFixture(t, store, async () => { throw new Error("unexpected upstream call"); });
  const experiment = assignment("A");
  assert.equal((await send({ experiment, event: "start" }, true)).status, 204);
  assert.equal((await send({ experiment, event: "progress", progress }, true)).status, 204);
  const events = readEvents(file);
  const summary = summarizeEvents(events);
  assert.equal(summary.firstEvent, events.find(row => row.event === "view").at);
  assert.deepEqual(summary.variants[0], { variant: "A", visitors: 1, started: 1, converted: 0, conversionPercent: 0 });
  const [a] = summary.progress;
  assert.equal(a.beacons, 1);
  assert.equal(a.abandoned, 1);
  assert.equal(a.medianAbandonedSeconds, 37);
  assert.deepEqual(a.depthHistogram, { 3: 1 });
  assert.deepEqual(a.forms[0].fields.bedrooms, { filled: 1, abandonedHere: 0 });
  assert.deepEqual(a.forms[0].fields.email, { filled: 0, abandonedHere: 1 });
});

test("a reload replaces the earlier beacon for that form rather than counting a second attempt", async t => {
  const { file, store } = storeFixture(t);
  const send = await serverFixture(t, store, async () => { throw new Error("unexpected upstream call"); });
  const experiment = assignment("B");
  assert.equal((await send({ experiment, event: "progress", progress }, true)).status, 204);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await send({ experiment, event: "progress", progress: { ...progress, filledCount: 4, submitted: true } }, true)).status, 204);
  const [, b] = summarizeEvents(readEvents(file)).progress;
  assert.equal(b.beacons, 1);
  assert.equal(b.submitted, 1);
  assert.equal(b.abandoned, 0);
});

test("a beacon claiming the other version for a known browser is refused", async t => {
  const { file, store } = storeFixture(t);
  const send = await serverFixture(t, store, async () => { throw new Error("unexpected upstream call"); });
  const experiment = assignment("A");
  assert.equal((await send({ experiment, event: "view" }, true)).status, 204);
  assert.equal((await send({ experiment: { ...experiment, variant: "B" }, event: "progress", progress }, true)).status, 409);
  assert.equal(readEvents(file).filter(row => row.event === "progress").length, 0);
});

test("a corrupted progress line is skipped on read instead of poisoning the report", t => {
  const { file, store } = storeFixture(t);
  const experiment = assignment("A");
  assert.equal(store.recordProgress(experiment, progress), true);
  appendFileSync(file, JSON.stringify({
    experiment: EXPERIMENT_ID, variant: "A", visitorId: experiment.visitorId, event: "progress",
    at: new Date().toISOString(), progress: { ...progress, fields: { place: "not-a-bucket" } },
  }) + "\n");
  assert.equal(readEvents(file).filter(row => row.event === "progress").length, 1);
});
