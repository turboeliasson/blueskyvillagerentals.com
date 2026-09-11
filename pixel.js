/* Meta Pixel loading and enquiry Lead tracking, shared by both website versions.

   The dataset (pixel) ID is set per page in window.BSV_META_PIXEL_ID, before this
   file is loaded. While that constant is empty nothing is loaded at all: no fbq,
   no request to connect.facebook.net and no tracking image. Filling in the ID on
   both pages is the only change needed to turn measurement on.

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

    /* No dataset configured yet: load nothing. */
    if (!pixelId) return tracker;
    try {
      loadBaseCode(win, doc);
      win.fbq('init', pixelId);
      win.fbq('track', 'PageView');
      tracker.active = true;
    } catch (error) {
      tracker.active = false;
    }
    return tracker;

    /* Called once per saved enquiry, where the gateway has confirmed the lead. */
    function trackLead(formId) {
      if (!tracker.active || typeof win.fbq !== 'function') return false;
      try {
        win.fbq('track', 'Lead', { content_name: names[formId] || formId, variant });
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
