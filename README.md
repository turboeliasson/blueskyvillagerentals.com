# Blue Sky Village homeowner redesign

A responsive redesign of the existing Blue Sky Village website, built in the existing HTML/CSS/JavaScript stack with no application dependencies.

Run `npm run dev` to open the preview at http://127.0.0.1:4179. Run `npm run build` to package a self-contained Cloudflare-compatible worker. Run `npm test` for the enquiry handler checks.

## Design and conversion changes

- A Southern lakeside guestbook identity: painted scenery, Young Serif headlines, Caveat handwritten details, buttery paper, sky blue, and sun-yellow accents. The existing heron provides continuity.
- A subtle address field sits directly in the hero beneath “See how much you can earn.” Typing reveals name, email, and phone in place, with +1 selected. The entire request can be completed in the hero without a jump to another section. The letter further down offers the same enquiry flow.
- Contact details unfold through a gradual height and opacity transition. Reduced-motion mode opens immediately. The painted scene keeps its scale and never repeats as the hero grows; country-code and phone controls share the same height, including WebKit.
- Real home photos appear as postcards. Property-care copy, a plain-English fee note, owner-use reassurance, and six FAQs support the homeowner invitation.
- Direct booking and phone links, accessible form labels and errors, privacy information, and reduced-motion support.
- No fabricated ratings, earnings results, owner quotes, or revenue guarantees.

## Source and claims

The existing website at https://blueskyvillagerentals.com/ supplied the property photos, contact details, service area, founding year, fee, and terms. These were observed on 8 September 2026; independent verification of the business claims was outside this build. The old testimonial and changing portfolio count were omitted. `assets/village-panorama.png` and `assets/village-social.png` are AI-generated brand illustrations, not photographs of managed properties. They were created with the subscription-backed built-in image tool. See `assets/ART-DIRECTION.md` for the asset brief and palette.

## Enquiry delivery

The production static page continues to use `https://photo.proptonomy.ai/bsv-lead`. Its current server implementation was inspected read-only at `/opt/bsv-lead/server.mjs` on the existing Hetzner server. It accepts separate email and phone fields, creates a lead through `https://api.proptonomy.ai/api/leads` for Blue Sky Village's organization with source `blueskyvillagerentals.com`, and then sends a Mailgun notification to the existing `LEAD_TO` setting. The notification includes both contact fields and uses the owner's email for Reply-To. No keys were read or changed and no infrastructure was changed.

The fields and progressive expansion match the live homeowner form at https://heimby.no, inspected on 8 September 2026. Blue Sky defaults to +1 for its US audience. Entering an address only reveals the remaining fields; submission requires the owner's final action. The address stays visible and editable throughout.

The new preview uses a same-origin `/api/enquiry` route to forward validated enquiries to that service, avoiding the production service's browser origin restriction. The preview runs locally with `preview.mjs` and on a compatible Worker host using `worker.mjs` and the built entrypoint. No form data is kept in browser storage.

Client success requires a successful HTTP response and `{ "ok": true }`. On failure, the form preserves the owner's details and offers retry and phone contact. Identical retries reuse a request ID so the existing lead service can avoid duplicate leads and notifications. The upstream service controls delivery and rate limiting. No real test enquiry was sent; recipient delivery is not verified by this redesign.

## Validation

- Six Node tests cover incomplete or invalid enquiries, cross-origin requests, body limits, spam trap, forwarded fields, and upstream errors. External delivery is mocked.
- Isolated browser checks passed at 360, 390, 768, 1024, and 1440 px, with no horizontal overflow.
- Browser checks cover a visible hero address field and stable address/scroll positions at all five widths, keyboard flow, automatic expansion without partial submission, independent hero and letter forms, required fields, email and phone validation, preserved details after a failed send, stable retry IDs, and confirmed success. International country codes, existing links, FAQs, and the privacy dialog were also checked with the previous design revision.
- A local integration check exercised both browser forms through the preview proxy and the production-domain direct route against the current lead service source. All external requests were mocked. Correct organization, source, address, name, email and phone reached Proptonomy; notifications used the configured recipient and Reply-To. Identical retries produced no extra lead or notification.
- Desktop, mobile, and the expanded mobile form were visually inspected. No browser JavaScript errors occurred.
- The latest accessibility pass found zero automated WCAG A/AA violations at 320, 390, 768, 1024 and 1440 px in the collapsed and expanded states, and in the confirmed success state. Checked keyboard order, visible focus, skip navigation, privacy-dialog Escape/focus return, reduced motion, and text/field contrast. Double-size text and WCAG text-spacing overrides fit without horizontal scrolling at 320, 768 and 1440 px. These are targeted checks, not a comprehensive assistive-technology certification. Reference: https://www.w3.org/WAI/WCAG22/quickref/.

## Hosting state

The original live domain is unchanged. The local preview stays available at http://127.0.0.1:4179 while its development server is running.

A private Sites project was created and its ID recorded in `.openai/hosting.json`. No version was saved or deployed: the Sites source repository is configured on `main`, while this machine's user rules prohibit pushing to `main` or `master`. Continue on `feat/homeowner-brand-redesign`; do not bypass that rule. Before a public launch, review business terms with Blue Sky Village, remove preview-only noindex/privacy copy, set production social URLs, and verify a separately authorized real enquiry reaches the intended recipient.
