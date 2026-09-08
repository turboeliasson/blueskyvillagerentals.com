# Blue Sky Village homeowner redesign

A responsive redesign of the existing Blue Sky Village website, built in the existing HTML/CSS/JavaScript stack with no application dependencies.

Run `npm run dev` to open the preview at http://127.0.0.1:4179. Run `npm run build` to package a self-contained Cloudflare-compatible worker. Run `npm test` for the enquiry handler checks.

## Design and conversion changes

- Refreshed identity using lake blue, pale neutral surfaces, Manrope, DM Sans, and the existing heron mark.
- Homeowner-led opening and a two-step enquiry form: property location first, then bedrooms, name, and email or phone.
- Property-care details, a clear 25% fee explanation, owner-use reassurance, a three-step process, and six FAQs.
- Direct booking and phone links, accessible form labels and errors, privacy information, and reduced-motion support.
- No fabricated ratings, earnings results, owner quotes, or revenue guarantees.

## Source and claims

The existing website at https://blueskyvillagerentals.com/ supplied the property photos, contact details, service area, founding year, fee, and terms. These were observed on 8 September 2026; independent verification of the business claims was outside this build. The old testimonial and changing portfolio count were omitted. `assets/og.png` is an AI-generated brand illustration for social previews, not a photograph of a managed property.

## Enquiry delivery

The production static page continues to use `https://photo.proptonomy.ai/bsv-lead`. Its existing server implementation was inspected read-only at `/opt/bsv-lead/server.mjs` on the existing Hetzner server. It relays enquiries through Mailgun. No keys were read or changed and no infrastructure was changed.

The new preview uses a same-origin `/api/enquiry` route to forward validated enquiries to that service, avoiding the production service's browser origin restriction. The preview runs locally with `preview.mjs` and on a compatible Worker host using `worker.mjs` and the built entrypoint. No form data is kept in browser storage.

Client success requires a successful HTTP response and `{ "ok": true }`. On failure, the form preserves the owner's details and offers retry and phone contact. The existing upstream service controls delivery and rate limiting. No real test enquiry was sent; recipient delivery is not verified by this redesign.

## Validation

- Six Node tests cover incomplete or invalid enquiries, cross-origin requests, body limits, spam trap, forwarded fields, and upstream errors. External delivery is mocked.
- Isolated browser checks passed at 360, 390, 768, 1024, and 1440 px, with no horizontal overflow.
- Browser checks covered internal links, required fields, contact validation, returning to step one, failed send and retry, confirmed success, FAQs, and the privacy dialog.
- Desktop, mobile, and the expanded mobile form were visually inspected. No browser JavaScript errors occurred.

## Hosting state

The original live domain is unchanged. The local preview stays available at http://127.0.0.1:4179 while its development server is running.

A private Sites project was created and its ID recorded in `.openai/hosting.json`. No version was saved or deployed: the Sites source repository is configured on `main`, while this machine's user rules prohibit pushing to `main` or `master`. Continue on `feat/homeowner-brand-redesign`; do not bypass that rule. Before a public launch, review business terms with Blue Sky Village, remove preview-only noindex/privacy copy, set production social URLs, and verify a separately authorized real enquiry reaches the intended recipient.
