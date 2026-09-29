// Blue Sky Village owner-enquiry endpoint.
// Save estimates to Blue Sky Village's Growth panel, then notify LEAD_TO.
import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createExperimentStore, validExperiment, validProgress, validSource } from "./experiments.mjs";

const PORT = 3950;
const ORGANIZATION_ID = "3c2d7060-f7c8-47c4-8102-27010603592b";
const ALLOWED = new Set([
  "https://blueskyvillagerentals.com",
  "https://www.blueskyvillagerentals.com",
  "https://turboeliasson.github.io",
]);
function cors(req, res) {
  const o = req.headers.origin;
  if (o && ALLOWED.has(o)) {
    res.setHeader("Access-Control-Allow-Origin", o);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
}

export function createLeadServer(env, request = fetch, experiments = null) {
  const hits = new Map(); // per-IP lead rate limit
  const eventHits = new Map(); // analytics must not consume the lead allowance
  const submissions = new Map(); // keep retries from creating a second lead or email
  return http.createServer(async (req, res) => {
    cors(req, res);
    if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
    if (req.method !== "POST") { res.writeHead(405); return res.end(); }
    if (req.headers.origin && !ALLOWED.has(req.headers.origin)) { res.writeHead(403); return res.end(); }

    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress;
    const now = Date.now();
    const isEvent = new URL(req.url, "http://localhost").searchParams.get("event") === "experiment";
    if (isEvent && !ALLOWED.has(req.headers.origin)) { res.writeHead(403); return res.end(); }
    const limits = isEvent ? eventHits : hits;
    const rec = (limits.get(ip) || []).filter(t => now - t < 3600_000);
    if (rec.length >= (isEvent ? 240 : 6)) { res.writeHead(429, {"Content-Type":"application/json"}); return res.end('{"ok":false,"error":"rate"}'); }
    rec.push(now); limits.set(ip, rec);

    let body = "";
    req.on("data", c => { body += c; if (body.length > 10_000) req.destroy(); });
    req.on("end", async () => {
      let d = {};
      try {
        // sendBeacon cannot set a JSON content type without a preflight it is unable to make,
        // so the shape of the body decides, not the header.
        d = req.headers["content-type"]?.includes("json") || body.trimStart().startsWith("{")
          ? JSON.parse(body)
          : Object.fromEntries(new URLSearchParams(body));
      } catch {}
      if (!d || typeof d !== "object") d = {};
      if (isEvent) {
        if (!validExperiment(d.experiment) || !["view", "start", "progress"].includes(d.event)) {
          res.writeHead(400); return res.end();
        }
        // A malformed beacon is dropped whole; nothing is written from a partial payload.
        if (d.event === "progress" && !validProgress(d.progress)) { res.writeHead(400); return res.end(); }
        // The source is only a label. A bad one costs the event its label, never the event.
        const source = validSource(d.source);
        try {
          const saved = d.event === "progress"
            ? experiments?.recordProgress(d.experiment, d.progress, source)
            : experiments?.record(d.experiment, d.event, source);
          if (!saved) { res.writeHead(409); return res.end(); }
          res.writeHead(204); return res.end();
        } catch (error) {
          console.error("experiment event failed:", error.message);
          res.writeHead(503); return res.end();
        }
      }
      const experiment = validExperiment(d.experiment) ? d.experiment : null;
      const attribution = {};
      for (const [key, pattern] of Object.entries({
        utmSource: /^[a-zA-Z0-9_.-]{1,64}$/, utmMedium: /^[a-zA-Z0-9_.-]{1,64}$/,
        metaCampaignId: /^\d{5,30}$/, metaAdsetId: /^\d{5,30}$/, metaAdId: /^\d{5,30}$/,
        // Meta's own click id: kept on the lead so a CRM record can be traced back to one ad click.
        fbclid: /^[A-Za-z0-9_-]{1,255}$/,
      })) {
        const value = d.attribution?.[key];
        if (typeof value === "string" && value === value.trim() && pattern.test(value)) attribution[key] = value;
      }
      // An ad visitor whose view beacon never arrived still labels their own funnel row here.
      // fbclid identifies one click, so it stays on the lead and never enters the funnel log.
      const { fbclid, ...leadSource } = attribution;
      const clean = s => String(s ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 300);
      const place = clean(d.place), beds = clean(d.bedrooms), name = clean(d.name), contact = clean(d.contact);
      // Older cached pages use a single email-or-phone field.
      const isEmail = s => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
      const email = clean(d.email) || (isEmail(contact) ? contact : "");
      const phone = clean(d.phone) || (contact && !isEmail(contact) ? contact : "");
      // Honeypot. Nearly always a bot, but a password manager fills the off-screen input too,
      // so say what was dropped and how complete it looked - never a single entered value.
      if (d.website) {
        console.log(new Date().toISOString(), "honeypot dropped enquiry; form:", clean(d.form) || "estimate-form",
          "complete:", Boolean(place && name && (email || phone)));
        res.writeHead(200, {"Content-Type":"application/json"}); return res.end('{"ok":true}');
      }
      if (!place || !name || (!email && !phone) || name.length > 200 || email.length > 254 ||
          (email && !isEmail(email)) || (phone && !/^\+?[\d\s().-]{7,30}$/.test(phone))) {
        res.writeHead(400, {"Content-Type":"application/json"}); return res.end('{"ok":false,"error":"missing"}');
      }
      const requestId = clean(d.requestId);
      if (requestId && !/^[0-9a-f-]{36}$/i.test(requestId)) {
        res.writeHead(400, {"Content-Type":"application/json"}); return res.end('{"ok":false,"error":"request"}');
      }
      for (const [key, value] of submissions) {
        if (now - value.createdAt > 24 * 3600_000) submissions.delete(key);
      }
      async function submit() {
        const leadData = {
          address: place, name, email: email || undefined, phone: phone || undefined,
          note: `Free rental estimate requested. Bedrooms: ${beds || "not provided"}.`,
          additionalData: {
            bedrooms: beds, website: "https://blueskyvillagerentals.com/", form: clean(d.form) || "estimate-form",
            ...(experiment ? { experimentId: experiment.id, experimentVariant: experiment.variant } : {}),
            ...attribution,
            // pixel.js sends this same id to Meta as the Lead eventID, so keeping it here is
            // the only way to match Meta's reported Leads against the records in Growth.
            ...(requestId ? { requestId } : {}),
          },
        };
        // The create endpoint's Started status is the Lead stage in Growth.
        const leadResponse = await request("https://api.proptonomy.ai/api/leads", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...leadData, organizationId: ORGANIZATION_ID, source: "blueskyvillagerentals.com" }),
          signal: AbortSignal.timeout(20000),
        });
        if (!leadResponse.ok) throw new Error("proptonomy " + leadResponse.status);
        const lead = await leadResponse.json();
        const leadId = lead.id;
        if (!leadId) throw new Error("proptonomy invalid response");
        console.log(new Date().toISOString(), "lead saved:", leadId, "form:", clean(d.form) || "estimate-form");
        if (experiment) {
          // The form rides along so the beacon this enquiry ends stops counting as abandoned.
          try { experiments?.record(experiment, "lead", validSource(leadSource), clean(d.form) || "estimate-form"); }
          catch (error) { console.error("experiment conversion failed:", error.message); }
        }
        const text = [
          "New owner enquiry from blueskyvillagerentals.com",
          "",
          `Home:      ${place}`,
          `Bedrooms:  ${beds || "-"}`,
          `Name:      ${name}`,
          `Email:     ${email || "Not provided"}`,
          `Phone:     ${phone || "Not provided"}`,
          ...(experiment ? [`Website test: ${experiment.id} / ${experiment.variant === "A" ? "A (original)" : "B (village redesign)"}`] : []),
          "",
          "View in Proptonomy: https://app.proptonomy.ai/blue-sky-village/leads",
          "",
          `Received ${new Date().toISOString()} · IP ${ip}`,
        ].join("\n");
        const form = new URLSearchParams({
          from: "Blue Sky Village website <leads@connect.proptonomy.ai>",
          to: env.LEAD_TO,
          subject: `New owner enquiry: ${place} (${beds || "?"} bd) - ${name}`,
          text,
        });
        if (email) form.set("h:Reply-To", email);
        try {
          const r = await request(`https://api.mailgun.net/v3/${env.MAILGUN_DOMAIN}/messages`, {
            method: "POST",
            headers: { Authorization: "Basic " + Buffer.from("api:" + env.MAILGUN_API_KEY).toString("base64") },
            body: form,
            signal: AbortSignal.timeout(10000),
          });
          if (!r.ok) throw new Error("mailgun " + r.status);
        } catch (e) {
          // The lead is saved. An email failure must not invite a duplicate submission.
          console.error(new Date().toISOString(), "notification failed for lead:", leadId, e.message);
        }
        return { ok: true, leadId };
      }
      try {
        let pending = requestId && submissions.get(requestId)?.promise;
        if (!pending) {
          pending = submit();
          if (requestId) submissions.set(requestId, { promise: pending, createdAt: now });
        }
        const result = await pending;
        res.writeHead(200, {"Content-Type":"application/json"}); res.end(JSON.stringify(result));
      } catch (e) {
        if (requestId) submissions.delete(requestId);
        console.error(new Date().toISOString(), "lead save failed:", e.message);
        res.writeHead(502, {"Content-Type":"application/json"}); res.end('{"ok":false,"error":"save"}');
      }
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const env = Object.fromEntries(
    readFileSync("/opt/bsv-lead/.env", "utf8").split("\n").filter(Boolean).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
  );
  createLeadServer(env, fetch, createExperimentStore()).listen(PORT, "127.0.0.1", () => console.log("bsv-lead listening on", PORT));
}
