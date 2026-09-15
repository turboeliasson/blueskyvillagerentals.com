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

Run `node --test server/*.test.mjs` from the repository root. Tests replace
upstream requests and send no emails or production leads.

Preview the site with `python3 -m http.server 8766 --bind 127.0.0.1`.

## Meta Pixel

Blue Sky Village dataset `1113214541040969` is configured on both homepage versions and the owner pages. Consenting PageView receipt was verified on September 13, 2026. First real Lead receipt remains to be checked.

With an ID set, the visitor must explicitly allow advertising measurement before
the SDK loads or PageView is sent. Both answers are one tap on the first notice:
`Allow measurement` and `Keep it off` sit side by side, neither preselected.
Advertising privacy in either footer allows withdrawal. Choices expire after 180
days; Global Privacy Control and Do Not Track keep tracking off and are recorded
as a refusal, so an earlier yes cannot revive when the signal is switched off.
Closing settings is not consent. The enquiry works either way.

`MEASUREMENT_DEFAULT` in `ad-privacy.js` is the posture, shipped as `'off'`
(prior opt-in, unchanged). Setting it to `'on'` makes an undecided visitor
allowed, which is the ordinary US opt-out pattern for this audience and is a
deliberate decision for the site owner, not a code cleanup. GPC/DNT stay an
absolute veto in either mode. The comment beside the constant lists the
visitor-facing text that must change with it.

After consent, each page reports one PageView and each confirmed saved enquiry
reports one Lead with its request UUID as eventID. Retries and repeat consent do
not duplicate events. Earlier enquiries are never replayed after consent.

`safeLocation()` accepts only known page paths and section anchors. Its query rule
has three outcomes, because `fbq` reads `window.location` itself and an ignored
parameter still reaches Meta inside the URL: the recognised ad tags in `AD_TAGS`
are validated; a short `TOLERATED` list of third-party parameters Meta, Instagram
and Facebook actually append (plus the site's own review override) is ignored but
still shape-checked; anything else disables tracking for that page view. Every
name the site's own forms post is refused explicitly, so a native GET submission
can never hand Meta a visitor's address, name, email or phone. A same-origin
referrer's query is held to the same rule, which is what lets a tagged ad visitor
keep measurement across internal links; a cross-origin referrer carrying any query
or fragment still disables tracking. An unsafe URL at submit time skips that one
event and does not revoke consent for the session.

Adding a query parameter the site reads, or a new form field, means updating
`TOLERATED` / `FORM_FIELDS` in `pixel.js` in the same change - otherwise the pixel
silently refuses that page. Tagging ads with `utm_id`, or landing traffic with
`gclid`, would switch measurement off today. Never add a posted field name to
`TOLERATED`. Automatic configuration and history-based PageViews are disabled. Each Lead carries the
allowlisted form name and website version, with no form contact details:

| Version | Form | `content_name` |
| --- | --- | --- |
| A | `early-estimate-form` | `early-estimate` |
| A | `estimate-form` | `estimate` |
| B | `hero-estimate-form` | `hero` |
| B | `estimate-form` | `letter` |

Tracking never affects an enquiry. A blocked, missing or failing `fbq` is a no-op,
so ad blockers change measurement only, never lead delivery. The lead payload,
request IDs, experiment attribution and recipients are retained.

## Ad attribution

Both pages load `attribution.js` and include its allowlisted fields only with a
submitted enquiry. The gateway independently validates them and saves `utmSource`,
`utmMedium`, `metaCampaignId`, `metaAdsetId`, `metaAdId` and `fbclid` in the
existing lead's `additionalData`, alongside `requestId`.

`fbclid` is Meta's per-click identifier. It stays on the lead, where it is what
lets one CRM record be traced back to one ad click, and it never enters a funnel
event - `validSource` admits only the five utm-derived keys. `requestId` is the
same UUID `pixel.js` sends to Meta as the Lead `eventID`, so it is the join key
between "Meta reports N Leads" and "the CRM holds M records". Meta IDs must be 5-30 digits; source and medium are limited to
64 letters, digits, dots, underscores or hyphens. Raw URLs, referrers, click IDs,
unexpanded macros and extra query fields are not retained by this code.

This adds no cookies, browser storage, network calls or Meta events. Validated source tags are carried through internal links, including ChatGPT
`utm_source=chatgpt.com`. They are not stored between visits.
Organic and old cached forms continue to work without attribution. Website A/B
redirects already preserve query parameters. The website and gateway change must
both be deployed before live lead attribution can be marked connected.

Use this ad URL parameter template:

```text
utm_source={{site_source_name}}&utm_medium=paid_social&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}
```

Run `node --test server/pixel.test.mjs` to verify the empty-ID guard, the single
`Lead` per saved enquiry and the form mapping, with a fake browser and no network.

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

`POST /bsv-lead?event=experiment` accepts `view`, `start` and `progress` events from
allowed website origins, each with an optional validated `source` naming the ad that
sent the visitor. The service records `lead` only after Proptonomy confirms the save.
Events use a separate rate allowance from enquiries. A start implies a view;
a saved enquiry implies a view and start if a browser event was blocked.
A visitor counts once per event and version, including after a service restart.
The primary metric is converted browsers / exposed browsers, not button clicks or
total submissions. Phone calls, guest bookings, JavaScript-disabled visitors and
review links are outside this measurement. Ad blockers and storage clearing may
affect measurement. This compares the complete versions, including their forms.

Records contain experiment ID, version, random browser UUID, event and time, plus
an optional `source` (the validated utm/Meta ad identifiers, never `fbclid` and
never a personal field) and, on a `lead` row, the form id it came from. Rows written
before this - the whole existing log - carry no source and no form, load unchanged,
and are reported in the `(none)` bucket. They are stored in
`/var/lib/bsv-lead/experiments.jsonl`, mode 0600, outside the public website.

A visitor still counts once per event and version in the A/B table, but a browser
whose first rows were unlabelled may gain one labelled twin of a milestone when it
later arrives from an ad - otherwise its ad click would have no row to carry the
label and would vanish from the per-ad funnel. Both summaries count unique browser
UUIDs, so the extra row inflates nothing. The systemd drop-in `/etc/systemd/system/bsv-lead.service.d/experiment.conf`
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

## Funnel by ad source

`report.mjs` ends with a `Funnel by ad source` table: one row per distinct
source/campaign/ad set/ad, with unique browsers at view, start and enquiry, and the
rates between them. Unattributed browsers group into `(none)`, sorted last. A
browser belongs to exactly one bucket, fixed by the first row that carried a label,
so a visitor who later clicks a second ad is not double counted and is not moved.

This is the number to compare against Meta's own delivery figures, and it will not
match them. It counts browsers that ran our JavaScript and could write to storage;
Meta counts clicks. Ad blockers, private windows and blocked storage under-count
here and not there, and the gap is widest in exactly the in-app browsers this
traffic arrives in. Treat a shortfall against Meta's link clicks as measurement
loss, not as bot traffic, and do not decide anything on a handful of rows.

Paid traffic (`utm_medium=paid_social`) is served `/` with no redirect and is
recorded under version A, so the ad test is not split across two pages and an ad
click does not pay for a second navigation inside a slow in-app browser. A browser
that already held a B assignment is re-issued a fresh browser UUID under A on its
first paid visit, because the log keeps one UUID to one version for life. That
browser therefore appears as a new browser in the ad funnel; its earlier B rows are
left untouched.

Do not declare a winner from a handful of leads. Compare conversion rates alongside
lead quality in Growth, checking sample balance and allowing complete business
weeks before deciding. No automatic winner or traffic reallocation is configured.

Run `node --test server/*.test.mjs` to verify attribution, event isolation,
persistence, deduplication and failure handling with mocked upstream requests.

Deploy `server.mjs`, `experiments.mjs` and `report.mjs` together after backing up
the existing gateway - `server.mjs` imports `validSource` and `validForm` from
`experiments.mjs`, so a partial upload stops the service from booting at link time.
Deploy the gateway BEFORE merging the website PR: the old gateway ignores the new
`source` field rather than rejecting it, so nothing breaks either way, but every
funnel row written in between loses its ad label permanently. Install the state-directory drop-in, run `systemctl daemon-reload`
and restart only `bsv-lead`. Deploy this backwards-compatible gateway before merging
the website PR. Keep the existing `.env` in place.

To stop the test, set `ENABLED = false` in `experiment.js` via a feature branch and
PR. All visitors then see A, including direct `/village/` visits. The explicit
review links remain available. To undo the release, revert the website PR through
another PR, restore the backed-up gateway source and drop-in state, daemon-reload
and restart `bsv-lead`. Retain the experiment log for analysis.

## Regional owner pages

`locations/` and `homeowners/` are static, self-canonical pages outside the homepage
experiment. `owner-enquiry.js` uses the existing gateway and stable form IDs, which
are saved in `additionalData.form` for page-level lead analysis. No gateway change
is required. Owner pages use pixel variant `owners`, with allowlisted form names
and paths. Consent, URL guards and successful-save deduplication still apply.

The homepage variant at `/village/` canonicals to `/`, without noindex, following
Google website-testing guidance. Only canonical URLs are listed in `sitemap.xml`.

Keep regional coverage explicit. Do not turn an expansion enquiry into a claimed
local office, licence or established service without verification. Public municipal
links were checked September 13, 2026; recheck before changing regulatory statements.

`indexnow-key.txt` is a deliberately public website ownership challenge, not a model
API credential. After publishing, run `node server/submit-indexnow.mjs` to notify
participating search engines of the canonical sitemap URLs. A 200/202 response
confirms receipt, not indexing. Google receives `sitemap.xml` through Search Console.
The public Google verification tag is present on both homepage variants.
