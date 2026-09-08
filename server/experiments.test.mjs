import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
