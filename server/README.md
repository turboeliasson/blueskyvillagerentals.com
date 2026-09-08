# Website estimate intake

Both estimate forms in `index.html` submit to `https://photo.proptonomy.ai/bsv-lead`.
The Node service saves the request in Proptonomy before returning success, then
sends the existing owner-enquiry email. An email failure does not discard the lead.

- Proptonomy organization: Blue Sky Village (`3c2d7060-f7c8-47c4-8102-27010603592b`).
- Intake endpoint: `POST https://api.proptonomy.ai/api/leads` with the fixed
  Blue Sky Village organization ID.
- Form submissions use the API's Started status and appear in Growth's Lead
  stage, including contact details, address, bedrooms and the website form identifier.
- Older cached pages using phone-only contact details use the same intake.
- A request ID prevents repeat saves and emails for retries during the same service
  process, retained for 24 hours. The retry cache is cleared by service restarts.

## Validate

Run `node --test server/server.test.mjs` from the repository root. Tests replace
upstream requests and send no emails or production leads.

Preview the site with `python3 -m http.server 8766 --bind 127.0.0.1`.

## Deploy and roll back

The static site is published by GitHub Pages from `main`. Use a feature branch and
PR. Revert the website commit through a new PR to roll it back.

The gateway is deployed separately on the existing Hetzner host. Its source is
`/opt/bsv-lead/server.mjs`, running as systemd service `bsv-lead` on localhost port
3950. The existing `/opt/bsv-lead/.env` supplies `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`
and `LEAD_TO`. Keep credentials on the server, outside this public repository.

Before replacing the gateway, copy the current source to a timestamped backup.
Upload this source to a temporary path, run `node --check` on it, replace
`/opt/bsv-lead/server.mjs`, and restart only `bsv-lead`. Check service status and
the journal. To roll back, restore that backup to `/opt/bsv-lead/server.mjs` and
run `systemctl restart bsv-lead`.
