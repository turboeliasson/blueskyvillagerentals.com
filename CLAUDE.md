# Blue Sky Village website: notes for Claude

This is the public website for blueskyvillagerentals.com. It is plain HTML, CSS and
JavaScript with no build step. GitHub Pages publishes the `main` branch about a minute
after every merge, so anything merged to `main` is live straight away.

## How to make a change

1. Start a new branch. Never commit straight to `main`.
2. Make the edit.
3. Preview it: run `python3 -m http.server 8766 --bind 127.0.0.1` from this folder and
   open http://127.0.0.1:8766/. Check a phone-sized window as well as desktop.
4. Run the tests: `node --test server/*.test.mjs`. All of them must pass.
5. Push the branch, open a pull request, check the result, then merge it.
6. About a minute after the merge, open the live page and confirm the change is there.

## The homepage exists twice

Visitors are split 50/50 between two homepage designs:

- `index.html`: version A, with its styles and enquiry form code inside the file.
- `village/index.html`: version B, the lakeside design, using `village/styles.css`
  and `village/site.js`.

Any homepage change (text, prices, phone, email, photos, links) has to be made in both
files. Preview each one with `/?bsv_variant=A` and `/?bsv_variant=B`.

## Other pages

- `locations/` (hub), `locations/savannah/`, `locations/folly-beach/`, `locations/ellijay/`
- `homeowners/management-fees/`, `homeowners/rental-estimate/`, `homeowners/switching-managers/`
- `privacy.html`

The location and homeowner pages share `owner-pages.css` and `owner-enquiry.js`.
Images live in `assets/` and `village/assets/`. When you add a page, add it to
`sitemap.xml` and link to it from an existing page.

## Cache versions

CSS and JS files are linked with a version, for example `styles.css?v=20261015`. When
you edit one of those files, change the version to today's date on every page that
links it, so returning visitors get the new file.

## Ask Njål (Proptonomy) before changing these

- `CNAME`: keeps blueskyvillagerentals.com connected to this site.
- The enquiry forms and the address they post to, `https://photo.proptonomy.ai/bsv-lead`
  (in `index.html`, `village/site.js` and `owner-enquiry.js`), including form field
  names. Enquiries are saved in Proptonomy and emailed to the team through it.
- `pixel.js`, `ad-privacy.js`, `attribution.js`, `experiment.js` and the
  "Advertising and measurement" section of `privacy.html`. Together they handle Meta
  measurement, visitor consent and the homepage split.
- The `google-site-verification` tag in `index.html` and `indexnow-key.txt`.
- `server/`: the enquiry service that runs on Proptonomy's server. Editing it here
  does not change what is running.

## Facts to keep consistent

- Public email: admin@blueskyvillagerentals.com. It appears on every page, in mailto
  links, form fallback text, the privacy page and the Organization structured data.
- Booking links go to https://book.blueskyvillagerentals.com/ (the Guesty booking site).
- Only state fees, results, reviews or locations that Ryan has confirmed. No invented
  income figures or guarantees.
