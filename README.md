# Blue Sky Village homeowner redesign

A responsive redesign of the existing Blue Sky Village website, built in the existing HTML/CSS/JavaScript stack with no application dependencies.

Run `npm run dev` to open the preview at http://127.0.0.1:4179. Run `npm run build` to package a self-contained Cloudflare-compatible worker. Run `npm test` for the enquiry handler checks.

## Design and conversion changes

- A Southern lakeside guestbook identity: painted scenery, Young Serif headlines, Caveat handwritten details, buttery paper, sky blue, and sun-yellow accents. The existing heron provides continuity.
- The opening “See how much you can earn” button leads straight to the letter's address field. As the owner starts typing, the letter unfolds to collect their name, email, and phone with a country code defaulting to +1.
- Real home photos appear as postcards. Property-care copy, a plain-English fee note, owner-use reassurance, and six FAQs support the homeowner invitation.
- Direct booking and phone links, accessible form labels and errors, privacy information, and reduced-motion support.
- No fabricated ratings, earnings results, owner quotes, or revenue guarantees.

## Source and claims

The existing website at https://blueskyvillagerentals.com/ supplied the property photos, contact details, service area, founding year, fee, and terms. These were observed on 8 September 2026; independent verification of the business claims was outside this build. The old testimonial and changing portfolio count were omitted. `assets/village-panorama.png` and `assets/village-social.png` are AI-generated brand illustrations, not photographs of managed properties. They were created with the subscription-backed built-in image tool. See `assets/ART-DIRECTION.md` for the asset brief and palette.

## Enquiry delivery

The production static page continues to use `https://photo.proptonomy.ai/bsv-lead`. Its current server implementation was inspected read-only at `/opt/bsv-lead/server.mjs` on the existing Hetzner server. It already accepts separate email and phone fields, saves enquiries through the Blue Sky Village Growth lead form, and then sends a Mailgun notification. No keys were read or changed and no infrastructure was changed.

The fields and progressive expansion match the live homeowner form at https://heimby.no, inspected on 8 September 2026. Blue Sky defaults to +1 for its US audience. Entering an address only reveals the remaining fields; submission requires the owner's final action. The address stays visible and editable throughout.

The new preview uses a same-origin `/api/enquiry` route to forward validated enquiries to that service, avoiding the production service's browser origin restriction. The preview runs locally with `preview.mjs` and on a compatible Worker host using `worker.mjs` and the built entrypoint. No form data is kept in browser storage.

Client success requires a successful HTTP response and `{ "ok": true }`. On failure, the form preserves the owner's details and offers retry and phone contact. Identical retries reuse a request ID so the existing lead service can avoid duplicate leads and notifications. The upstream service controls delivery and rate limiting. No real test enquiry was sent; recipient delivery is not verified by this redesign.

## Validation

- Six Node tests cover incomplete or invalid enquiries, cross-origin requests, body limits, spam trap, forwarded fields, and upstream errors. External delivery is mocked.
- Isolated browser checks passed at 360, 390, 768, 1024, and 1440 px, with no horizontal overflow.
- Browser checks cover the opening CTA, automatic expansion without focus loss or partial submission, required fields, email and phone validation, country codes, preserved details after a failed send, stable retry IDs, and confirmed success. Existing links, FAQs, and the privacy dialog were checked with the previous design revision.
- A local integration check used the current lead service source with all external requests mocked. Both contact fields reached the expected Growth form and notification; two identical requests produced one lead and one notification.
- Desktop, mobile, and the expanded mobile form were visually inspected. No browser JavaScript errors occurred.

## Hosting state

The original live domain is unchanged. The local preview stays available at http://127.0.0.1:4179 while its development server is running.

A private Sites project was created and its ID recorded in `.openai/hosting.json`. No version was saved or deployed: the Sites source repository is configured on `main`, while this machine's user rules prohibit pushing to `main` or `master`. Continue on `feat/homeowner-brand-redesign`; do not bypass that rule. Before a public launch, review business terms with Blue Sky Village, remove preview-only noindex/privacy copy, set production social URLs, and verify a separately authorized real enquiry reaches the intended recipient.
