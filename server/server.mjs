// Blue Sky Village owner-enquiry endpoint.
// Save estimates to Blue Sky Village's Growth panel, then notify LEAD_TO.
import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

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

export function createLeadServer(env, request = fetch) {
  const hits = new Map(); // per-IP rate limit
  const submissions = new Map(); // keep retries from creating a second lead or email
  return http.createServer(async (req, res) => {
    cors(req, res);
    if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
    if (req.method !== "POST") { res.writeHead(405); return res.end(); }
    if (req.headers.origin && !ALLOWED.has(req.headers.origin)) { res.writeHead(403); return res.end(); }

    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress;
    const now = Date.now();
    const rec = (hits.get(ip) || []).filter(t => now - t < 3600_000);
    if (rec.length >= 6) { res.writeHead(429, {"Content-Type":"application/json"}); return res.end('{"ok":false,"error":"rate"}'); }
    rec.push(now); hits.set(ip, rec);

    let body = "";
    req.on("data", c => { body += c; if (body.length > 10_000) req.destroy(); });
    req.on("end", async () => {
      let d = {};
      try {
        d = req.headers["content-type"]?.includes("json")
          ? JSON.parse(body)
          : Object.fromEntries(new URLSearchParams(body));
      } catch {}
      if (!d || typeof d !== "object") d = {};
      const clean = s => String(s ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 300);
      const place = clean(d.place), beds = clean(d.bedrooms), name = clean(d.name), contact = clean(d.contact);
      // Older cached pages use a single email-or-phone field.
      const isEmail = s => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
      const email = clean(d.email) || (isEmail(contact) ? contact : "");
      const phone = clean(d.phone) || (contact && !isEmail(contact) ? contact : "");
      if (d.website) { res.writeHead(200, {"Content-Type":"application/json"}); return res.end('{"ok":true}'); } // honeypot
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
          additionalData: { bedrooms: beds, website: "https://blueskyvillagerentals.com/", form: clean(d.form) || "estimate-form" },
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
        const text = [
          "New owner enquiry from blueskyvillagerentals.com",
          "",
          `Home:      ${place}`,
          `Bedrooms:  ${beds || "-"}`,
          `Name:      ${name}`,
          `Email:     ${email || "Not provided"}`,
          `Phone:     ${phone || "Not provided"}`,
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
  createLeadServer(env).listen(PORT, "127.0.0.1", () => console.log("bsv-lead listening on", PORT));
}
