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
    B: { 'hero-estimate-form': 'hero', 'estimate-form': 'letter' }
  };

  const PIXEL_SRC = 'https://connect.facebook.net/en_US/fbevents.js';

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
    const variant = options.variant === 'B' ? 'B' : 'A';
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
      try {
        const url = new URL(win.location.href);
        const fields = {
          utm_source: /^[a-zA-Z0-9_.-]{1,64}$/,
          utm_medium: /^[a-zA-Z0-9_.-]{1,64}$/,
          utm_campaign: /^\d{5,30}$/, utm_term: /^\d{5,30}$/, utm_content: /^\d{5,30}$/,
          fbclid: /^[a-zA-Z0-9_-]{1,500}$/
        };
        if (!['', '#contents', '#estimate', '#feature', '#pricing', '#rental-estimate', '#top', '#care', '#main', '#questions', '#village'].includes(url.hash) || !['/', '/village/', '/village/index.html', '/index.html'].includes(url.pathname)) return false;
        for (const [key, value] of url.searchParams) {
          if (!fields[key] || value !== value.trim() || !fields[key].test(value)) return false;
        }
        if (doc.referrer && (new URL(doc.referrer).search || new URL(doc.referrer).hash)) return false;
        return true;
      } catch (_) { return false; }
    }

    /* Called once per saved enquiry, where the gateway has confirmed the lead. */
    function trackLead(formId, requestId) {
      if (!tracker.active || !win.BSVAdPrivacy?.allowed() || typeof win.fbq !== 'function') return false;
      if (!names[formId] || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId || '') || sent.has(requestId)) return false;
      try {
        if (!safeLocation()) {
          tracker.active = false;
          win.fbq('consent', 'revoke');
          return false;
        }
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
