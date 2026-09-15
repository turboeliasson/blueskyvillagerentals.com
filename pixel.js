/* Meta Pixel loading and enquiry Lead tracking, shared by both website versions.

   The dataset (pixel) ID is set per page in window.BSV_META_PIXEL_ID, before this
   file is loaded. While that constant is empty nothing is loaded at all: no fbq,
   no request to connect.facebook.net and no tracking image. A valid ID and the
   visitor's advertising-measurement choice are both required.

   There is no <noscript> fallback image on purpose. The ID lives in a script
   constant, so a hardcoded image would both duplicate the ID and send a second
   hit that no form submission can ever be attributed to. Visitors without
   JavaScript cannot submit an enquiry either, so nothing is lost.

   Tracking never affects an enquiry: every call is guarded, and a blocked or
   missing fbq is treated as a no-op. */
(function () {
  'use strict';

  /* Which enquiry form a Lead came from, per website version. */
  const FORM_CONTENT_NAMES = {
    A: { 'early-estimate-form': 'early-estimate', 'estimate-form': 'estimate' },
    B: { 'hero-estimate-form': 'hero', 'estimate-form': 'letter' },
    owners: {
      'savannah-estimate-form': 'savannah', 'folly-beach-estimate-form': 'folly-beach',
      'ellijay-estimate-form': 'ellijay', 'fees-estimate-form': 'management-fees',
      'rental-estimate-form': 'rental-estimate', 'switching-estimate-form': 'switching-managers'
    }
  };

  const PIXEL_SRC = 'https://connect.facebook.net/en_US/fbevents.js';

  /* The ad tags we put on our own links, and the shape each one has to have. */
  const AD_TAGS = {
    utm_source: /^[a-zA-Z0-9_.-]{1,64}$/,
    utm_medium: /^[a-zA-Z0-9_.-]{1,64}$/,
    utm_campaign: /^\d{5,30}$/, utm_term: /^\d{5,30}$/, utm_content: /^\d{5,30}$/,
    fbclid: /^[a-zA-Z0-9_-]{1,500}$/
  };
  /* Keys that mean nothing to us but are not a reason to stop measuring: Facebook,
     Instagram and Messenger append these to a shared or in-app link, and bsv_variant is
     our own review override. Add a key here when a platform starts appending a new one -
     the alternative, ignoring every unknown key, blesses whatever the URL happens to
     carry, because fbq reads window.location itself and sends the whole address. */
  const TOLERATED = ['mibextid', 'igshid', 'igsh', 'fb_source', 'fb_ref', 'bsv_variant'];
  /* Every name our enquiry forms post. A form that submits natively, before its handler
     runs, puts the visitor's own name, email and phone in the query string. These can
     never become a tolerated key, so the check below refuses them explicitly. */
  const FORM_FIELDS = ['place', 'name', 'email', 'phone', 'street', 'area', 'areaOther',
    'bedrooms', 'contactBy', 'countryCode', 'website'];
  /* An opaque identifier: what a tolerated key is allowed to carry, and nothing else. */
  const TOKEN = /^[A-Za-z0-9_.=-]{1,300}$/;
  const PATHS = ['/', '/village/', '/locations/', '/locations/savannah/', '/locations/folly-beach/', '/locations/ellijay/',
    '/homeowners/management-fees/', '/homeowners/rental-estimate/', '/homeowners/switching-managers/'];
  const HASHES = ['', '#contents', '#estimate', '#feature', '#pricing', '#rental-estimate', '#top', '#care', '#main', '#questions', '#village'];

  /* One rule for a query string, used for our own URL and for a same-origin referrer:
     a tag we recognise has to look like what we tagged, a key we tolerate has to look
     like an identifier, and anything else refuses the page. */
  function safeQuery(params) {
    for (const [key, value] of params) {
      if (AD_TAGS[key]) {
        if (value !== value.trim() || !AD_TAGS[key].test(value)) return false;
        continue;
      }
      if (FORM_FIELDS.includes(key) || !TOLERATED.includes(key) || !TOKEN.test(value)) return false;
    }
    return true;
  }

  function loadBaseCode(win, doc) {
    /* Meta Pixel base code, unchanged apart from the injected window and document. */
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0';
      n.queue = []; t = b.createElement(e); t.async = !0;
      t.src = v; s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    }(win, doc, 'script', PIXEL_SRC);
  }

  function createTracker(options) {
    const win = options.window;
    const doc = options.document;
    const pixelId = typeof options.pixelId === 'string' ? options.pixelId.trim() : '';
    const variant = ['B', 'owners'].includes(options.variant) ? options.variant : 'A';
    const names = FORM_CONTENT_NAMES[variant];
    const tracker = { pixelId, variant, active: false, trackLead };
    const sent = new Set();
    let initialized = false;

    /* No dataset configured yet: load nothing. */
    if (!/^\d{5,30}$/.test(pixelId)) return tracker;
    win.addEventListener('bsv-ad-consent', updateConsent);
    updateConsent();
    return tracker;

    function updateConsent() {
      tracker.active = false;
      try {
        if (!win.BSVAdPrivacy?.allowed()) {
          if (initialized && typeof win.fbq === 'function') win.fbq('consent', 'revoke');
          return;
        }
        if (!safeLocation()) {
          if (initialized && typeof win.fbq === 'function') win.fbq('consent', 'revoke');
          return;
        }
        loadBaseCode(win, doc);
        win.fbq('consent', 'grant');
        if (!initialized) {
          win.fbq.disablePushState = true;
          win.fbq('set', 'autoConfig', false, pixelId);
          win.fbq('init', pixelId);
          win.fbq('trackSingle', pixelId, 'PageView');
          initialized = true;
        }
        tracker.active = true;
      } catch (error) {
        tracker.active = false;
      }
    }

    function safeLocation() {
      // Reject unexpected URL values before loading the SDK or reporting an event.
      // The page itself has to be one of ours and its query has to pass safeQuery:
      // fbq reads window.location, so a key we merely ignored would reach Meta anyway.
      try {
        const url = new URL(win.location.href);
        if (!HASHES.includes(url.hash) || !PATHS.includes(url.pathname.replace(/index\.html$/, ''))) return false;
        if (!safeQuery(url.searchParams)) return false;
        /* attribution.js tags our own internal links, so a same-origin referrer carries
           tags we put there - but its query is no safer than any other, so it meets the
           same rule. A cross-origin one we cannot vouch for at all, so any query or
           fragment refuses. A referrer never carries a fragment of its own. */
        if (doc.referrer) {
          const referrer = new URL(doc.referrer);
          if (referrer.origin !== url.origin) { if (referrer.search || referrer.hash) return false; }
          else if (!safeQuery(referrer.searchParams)) return false;
        }
        return true;
      } catch (_) { return false; }
    }

    /* Called once per saved enquiry, where the gateway has confirmed the lead. */
    function trackLead(formId, requestId) {
      if (!tracker.active || !win.BSVAdPrivacy?.allowed() || typeof win.fbq !== 'function') return false;
      if (!names[formId] || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId || '') || sent.has(requestId)) return false;
      try {
        /* A URL we cannot vouch for means we skip this one event. Consent belongs
           to the visitor, so an unexpected address is not a reason to throw it
           away for the rest of the session. */
        if (!safeLocation()) return false;
        win.fbq('trackSingle', pixelId, 'Lead', { content_name: names[formId], variant }, { eventID: requestId });
        sent.add(requestId);
        return true;
      } catch (error) {
        return false;
      }
    }
  }

  if (typeof window === 'undefined' || window.BSVPixel) return;
  window.BSVPixel = createTracker({
    window: window,
    document: document,
    pixelId: window.BSV_META_PIXEL_ID,
    variant: document.documentElement.dataset.bsvVariant
  });
})();
