/* Advertising measurement is optional and separate from an enquiry. */
(function () {
  'use strict';
  const key = 'bsv_ad_measurement_v1';
  const duration = 180 * 24 * 60 * 60 * 1000;
  const configured = /^\d{5,30}$/.test(window.BSV_META_PIXEL_ID || '');
  const restricted = () => navigator.globalPrivacyControl === true || navigator.doNotTrack === '1';
  let choice = null;
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (saved && typeof saved.allowed === 'boolean' && saved.expires > Date.now()) choice = saved.allowed;
  } catch (_) {}

  const dialog = document.createElement('dialog');
  dialog.className = 'bsv-ad-privacy';
  dialog.setAttribute('aria-labelledby', 'bsv-ad-privacy-title');
  dialog.innerHTML = '<h2 id="bsv-ad-privacy-title">Advertising measurement</h2>' +
    '<p data-status></p><p>Your enquiry works either way. You can change this choice using Advertising privacy in the footer.</p>' +
    '<p><a href="/privacy.html">Read our privacy information</a></p>' +
    '<div class="bsv-ad-privacy-actions"><button type="button" data-choice="no">Keep it off</button><button type="button" data-choice="yes">Allow measurement</button><button type="button" data-close>Close</button></div>';
  document.body.appendChild(dialog);

  function refresh() {
    dialog.querySelector('[data-status]').textContent = !configured ? 'Advertising measurement is currently off on this website.' : restricted() ? 'Your browser asks us not to use advertising tracking. We respect that signal and keep Meta measurement off.' : 'With your permission, Meta Pixel measures visits and completed estimate requests to help us understand our Facebook and Instagram ads. Meta can receive your page URL, browser and device information, IP address and cookie identifiers.';
    dialog.querySelector('[data-choice="yes"]').hidden = !configured || restricted();
    dialog.querySelector('[data-choice="no"]').hidden = !configured;
  }
  function choose(allowed) {
    choice = allowed && !restricted();
    try { localStorage.setItem(key, JSON.stringify({ allowed: choice, expires: Date.now() + duration })); } catch (_) {}
    window.dispatchEvent(new Event('bsv-ad-consent'));
    dialog.close();
    document.querySelector('.bsv-ad-notice')?.remove();
  }
  window.BSVAdPrivacy = {
    allowed: () => configured && choice === true && !restricted(),
    open() { refresh(); dialog.showModal(); }
  };
  dialog.querySelector('[data-choice="yes"]').addEventListener('click', () => choose(true));
  dialog.querySelector('[data-choice="no"]').addEventListener('click', () => choose(false));
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  document.querySelectorAll('[data-bsv-ad-privacy]').forEach(button => button.addEventListener('click', () => window.BSVAdPrivacy.open()));
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    choice = null;
    try {
      const saved = JSON.parse(localStorage.getItem(key));
      if (saved && typeof saved.allowed === 'boolean' && saved.expires > Date.now()) choice = saved.allowed;
    } catch (_) {}
    window.dispatchEvent(new Event('bsv-ad-consent'));
  });
  if (configured && choice === null && !restricted()) {
    const notice = document.createElement('section');
    notice.className = 'bsv-ad-notice';
    notice.setAttribute('aria-label', 'Advertising privacy choice');
    notice.innerHTML = '<p>May we use Meta Pixel to measure our ads? Your enquiry works either way. <a href="/privacy.html">Privacy information</a></p><div class="bsv-ad-privacy-actions"><button type="button" data-choice="no">Keep it off</button><button type="button" data-details>Choose settings</button></div>';
    notice.querySelector('[data-choice="no"]').addEventListener('click', () => choose(false));
    notice.querySelector('[data-details]').addEventListener('click', () => window.BSVAdPrivacy.open());
    document.body.appendChild(notice);
  }
})();
