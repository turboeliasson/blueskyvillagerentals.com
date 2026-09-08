import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createLeadServer } from "./server.mjs";

const env = { MAILGUN_DOMAIN: "example.invalid", MAILGUN_API_KEY: "test", LEAD_TO: "owner@example.invalid" };
const leadId = "15bf17e1-f6e9-442c-b95d-ad60f9d045d9";
const data = { place: "Mooresville, NC", bedrooms: "2", name: "Website test", email: "test@example.com", phone: "+1 (704) 555-0123", form: "early-estimate-form" };

async function fixture(t, upstream) {
  const server = createLeadServer(env, upstream);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return async (body, origin = "https://blueskyvillagerentals.com") => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.text(), cors: res.headers.get("Access-Control-Allow-Origin") };
  };
}

test("saves into BSV's Lead stage with property and contact details before emailing", async t => {
  const calls = [];
  const send = await fixture(t, async (url, options) => {
    calls.push({ url, options });
    return Response.json(calls.length === 1 ? { id: leadId, status: "Started" } : { id: "mail" });
  });
  const result = await send(data);
  assert.equal(result.status, 200);
  assert.equal(result.cors, "https://blueskyvillagerentals.com");
  assert.deepEqual(JSON.parse(result.body), { ok: true, leadId });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://api.proptonomy.ai/api/leads");
  const lead = JSON.parse(calls[0].options.body);
  assert.equal(lead.organizationId, "3c2d7060-f7c8-47c4-8102-27010603592b");
  assert.equal(lead.source, "blueskyvillagerentals.com");
  assert.equal(lead.address, data.place);
  assert.equal(lead.name, data.name);
  assert.equal(lead.email, data.email);
  assert.equal(lead.phone, data.phone);
  assert.equal(lead.additionalData.bedrooms, "2");
  assert.equal(lead.additionalData.form, "early-estimate-form");
  const mail = calls[1].options.body;
  assert.equal(mail.get("to"), env.LEAD_TO);
  assert.equal(mail.get("h:Reply-To"), data.email);
  assert.match(mail.get("text"), /blue-sky-village\/leads/);
});

test("a Proptonomy failure returns failure without sending an email", async t => {
  let calls = 0;
  const send = await fixture(t, async () => { calls++; return new Response(null, { status: 503 }); });
  const result = await send(data);
  assert.equal(result.status, 502);
  assert.equal(JSON.parse(result.body).ok, false);
  assert.equal(calls, 1);
});

test("an email failure still acknowledges the saved lead", async t => {
  let calls = 0;
  const send = await fixture(t, async () => ++calls === 1
    ? Response.json({ id: leadId }) : new Response(null, { status: 503 }));
  const result = await send(data);
  assert.equal(result.status, 200);
  assert.equal(JSON.parse(result.body).leadId, leadId);
});

test("retries reuse the saved lead and send only one email", async t => {
  let calls = 0;
  const send = await fixture(t, async () => {
    calls++;
    return Response.json({ id: leadId });
  });
  const body = { ...data, requestId: randomUUID() };
  const results = await Promise.all([send(body), send(body)]);
  assert.equal(results[0].status, 200);
  assert.equal(results[1].status, 200);
  assert.equal(calls, 2);
});

test("a failed save can be retried with the same request ID", async t => {
  let calls = 0;
  const send = await fixture(t, async () => ++calls === 1
    ? new Response(null, { status: 503 }) : Response.json({ id: leadId }));
  const body = { ...data, requestId: randomUUID() };
  assert.equal((await send(body)).status, 502);
  assert.equal((await send(body)).status, 200);
  assert.equal(calls, 3);
});

test("cached email-or-phone forms retain contact details in Growth", async t => {
  const calls = [];
  const send = await fixture(t, async (url, options) => {
    calls.push({ url, options });
    return Response.json({ id: leadId });
  });
  const { email, phone, ...oldForm } = data;
  assert.equal((await send({ ...oldForm, contact: email })).status, 200);
  assert.equal(JSON.parse(calls[0].options.body).email, email);
  assert.equal((await send({ ...oldForm, contact: phone })).status, 200);
  assert.equal(calls[2].url, "https://api.proptonomy.ai/api/leads");
  const lead = JSON.parse(calls[2].options.body);
  assert.equal(lead.organizationId, "3c2d7060-f7c8-47c4-8102-27010603592b");
  assert.equal(lead.phone, phone);
});

test("honeypots, missing details, invalid email and disallowed origins create no leads", async t => {
  let calls = 0;
  const send = await fixture(t, async () => { calls++; throw new Error("Must not reach upstream"); });
  assert.equal((await send({ ...data, website: "spam.example" })).status, 200);
  assert.equal((await send({ ...data, place: "" })).status, 400);
  assert.equal((await send({ ...data, email: "wrong" })).status, 400);
  assert.equal((await send(null)).status, 400);
  assert.equal((await send(data, "https://unrelated.example")).status, 403);
  assert.equal(calls, 0);
});
