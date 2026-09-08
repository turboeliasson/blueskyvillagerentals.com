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

## Homeowner website experiment

The live domain uses `experiment.js` before rendering to split eligible browsers
50/50 between A (the current homepage) and B (the approved `/village/` redesign).
The assignment and a random UUID persist in localStorage for 90 days. Returning
browsers retain their version. Clearing storage or using another device creates a
new assignment. Known crawler user agents and browsers without writable storage
see A and are excluded. Local previews never send experiment events.

Review without joining the experiment:

- A: `https://blueskyvillagerentals.com/?bsv_variant=A`
- B: `https://blueskyvillagerentals.com/?bsv_variant=B`

These links neither change saved assignments nor report events. Normal visits
without the override return to the browser's assigned version. Both versions use
the same lead endpoint, organization, Lead stage and configured email recipients.
A/B attribution adds `experimentId` and `experimentVariant` to Proptonomy's
`additionalData`, and a Website test line to the existing notification. It does
not send the browser UUID to Proptonomy or email. Review enquiries remain normal
unattributed enquiries, so do not submit test leads to production.

`POST /bsv-lead?event=experiment` accepts only `view` and `start` events from allowed
website origins. The service records `lead` only after Proptonomy confirms the save.
Events use a separate rate allowance from enquiries. A start implies a view;
a saved enquiry implies a view and start if a browser event was blocked.
A visitor counts once per event and version, including after a service restart.
The primary metric is converted browsers / exposed browsers, not button clicks or
total submissions. Phone calls, guest bookings, JavaScript-disabled visitors and
review links are outside this measurement. Ad blockers and storage clearing may
affect measurement. This compares the complete versions, including their forms.

Records contain only experiment ID, version, random browser UUID, event and time.
They are stored in `/var/lib/bsv-lead/experiments.jsonl`, mode 0600, outside the
public website. The systemd drop-in `/etc/systemd/system/bsv-lead.service.d/experiment.conf`
contains:

```ini
[Service]
StateDirectory=bsv-lead
StateDirectoryMode=0700
```

This grants the existing service a writable state directory under its filesystem
protection. No changes to Caddy, DNS, credentials or email recipients are needed.

Read results over the existing SSH connection:

```sh
ssh root@94.130.75.45 'node /opt/bsv-lead/report.mjs'
ssh root@94.130.75.45 'node /opt/bsv-lead/report.mjs --json'
```

Do not declare a winner from a handful of leads. Compare conversion rates alongside
lead quality in Growth, checking sample balance and allowing complete business
weeks before deciding. No automatic winner or traffic reallocation is configured.

Run `node --test server/*.test.mjs` to verify attribution, event isolation,
persistence, deduplication and failure handling with mocked upstream requests.

Deploy `server.mjs`, `experiments.mjs` and `report.mjs` together after backing up
the existing gateway. Install the state-directory drop-in, run `systemctl daemon-reload`
and restart only `bsv-lead`. Deploy this backwards-compatible gateway before merging
the website PR. Keep the existing `.env` in place.

To stop the test, set `ENABLED = false` in `experiment.js` via a feature branch and
PR. All visitors then see A, including direct `/village/` visits. The explicit
review links remain available. To undo the release, revert the website PR through
another PR, restore the backed-up gateway source and drop-in state, daemon-reload
and restart `bsv-lead`. Retain the experiment log for analysis.
