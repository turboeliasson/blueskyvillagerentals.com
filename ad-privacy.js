/* Advertising measurement is optional and separate from an enquiry. */
(function () {
  'use strict';
  /* What happens for a visitor who has not answered yet: 'off' means measurement
     waits for a yes (opt-in, what we ship today), 'on' means it runs until the
     visitor says no and the first notice becomes an opt-out notice (the ordinary
     US standard). Both visitor-facing sentences in this file are derived from it
     (see `question` below), but the word is not the whole change:
       - privacy.html, section "Advertising and measurement", opens with
         "Measurement stays off until you allow it." That sentence, and the one after
         it describing the first-visit notice, have to be rewritten by hand.
       - an unstorable refusal has to be made to survive first. persist() cannot
         write when the browser blocks localStorage, so a no lasts one page view.
         Under 'off' that is harmless, because the default is itself a refusal: the
         visitor is asked again and measurement stays off meanwhile. Under 'on' the
         same visitor would be tracked again on the next page despite having said no,
         so that flip needs the refusal kept somewhere else (a sessionStorage or
         in-memory fallback) before it ships.
     Either way a Global Privacy Control or Do Not Track signal is an absolute veto:
     restricted() overrides this default and a stored yes, and is recorded as a no. */
  const MEASUREMENT_DEFAULT = 'off';
  const key = 'bsv_ad_measurement_v1';
  const duration = 180 * 24 * 60 * 60 * 1000;
  const configured = /^\d{5,30}$/.test(window.BSV_META_PIXEL_ID || '');
  const restricted = () => navigator.globalPrivacyControl === true || navigator.doNotTrack === '1';
  let choice = null;
  function persist() {
    /* A blocked localStorage means the answer lasts this page view only. That is a
       deliberate accepted cost while MEASUREMENT_DEFAULT is 'off'; see the note above. */
    try { localStorage.setItem(key, JSON.stringify({ allowed: choice, expires: Date.now() + duration })); } catch (_) {}
  }
  function readChoice() {
    choice = null;
    try {
      const saved = JSON.parse(localStorage.getItem(key));
      if (saved && typeof saved.allowed === 'boolean' && saved.expires > Date.now()) choice = saved.allowed;
    } catch (_) {}
    /* A browser signal is a refusal, so we record it as one. Leaving an older yes in
       storage would revive measurement the moment the visitor switches the signal off,
       and the choice buttons are hidden while it is on, so there is no way back. */
    if (restricted() && choice !== false) { choice = false; persist(); }
  }
  readChoice();
  const allowed = () => configured && !restricted() && (choice === null ? MEASUREMENT_DEFAULT === 'on' : choice === true);

  const dialog = document.createElement('dialog');
  dialog.className = 'bsv-ad-privacy';
  dialog.setAttribute('aria-labelledby', 'bsv-ad-privacy-title');
  dialog.innerHTML = '<h2 id="bsv-ad-privacy-title">Advertising measurement</h2>' +
    '<p data-status></p><p data-note></p>' +
    '<p><a href="/privacy.html">Read our privacy information</a></p>' +
    '<div class="bsv-ad-privacy-actions"><button type="button" data-choice="yes">Allow measurement</button><button type="button" data-choice="no">Keep it off</button><button type="button" data-close>Close</button></div>';
  document.body.appendChild(dialog);

  /* Both visitor-facing descriptions of the default live here, next to each other. */
  const measurementLead = () => MEASUREMENT_DEFAULT === 'on'
    ? 'Unless you turn it off, Meta Pixel measures'
    : 'With your permission, Meta Pixel measures';
  function refresh() {
    /* A browser signal decides this for us, so that visitor gets a plain
       explanation and no choice controls: pressing one would change nothing. */
    dialog.querySelector('[data-status]').textContent = !configured ? 'Advertising measurement is currently off on this website.' : restricted() ? 'Your browser asks us not to use advertising tracking. We treat that as the final answer: Meta measurement stays off for you, so there is nothing to set here.' : measurementLead() + ' visits and completed estimate requests to help us understand our Facebook and Instagram ads. Meta can receive your page URL, browser and device information, IP address and cookie identifiers. Measurement is currently ' + (allowed() ? 'on' : 'off') + ' in this browser.';
    const note = dialog.querySelector('[data-note]');
    note.hidden = !configured || restricted();
    note.textContent = 'Your enquiry works either way. You can change this choice using Advertising privacy in the footer.';
    dialog.querySelector('[data-choice="yes"]').hidden = !configured || restricted();
    dialog.querySelector('[data-choice="no"]').hidden = !configured || restricted();
  }
  function choose(value) {
    choice = value && !restricted();
    persist();
    /* Remove the notice before announcing the choice: a listener on this event measures
       the page to reclaim the space the notice held, and would otherwise measure a node
       that is about to disappear and reserve room for it for the rest of the visit. */
    document.querySelector('.bsv-ad-notice')?.remove();
    dialog.close();
    window.dispatchEvent(new Event('bsv-ad-consent'));
  }
  window.BSVAdPrivacy = {
    allowed,
    open() { refresh(); dialog.showModal(); }
  };
  dialog.querySelector('[data-choice="yes"]').addEventListener('click', () => choose(true));
  dialog.querySelector('[data-choice="no"]').addEventListener('click', () => choose(false));
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  document.querySelectorAll('[data-bsv-ad-privacy]').forEach(button => button.addEventListener('click', () => window.BSVAdPrivacy.open()));
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    readChoice();
    window.dispatchEvent(new Event('bsv-ad-consent'));
  });
  if (configured && choice === null && !restricted()) {
    /* Both answers are one tap on this surface, styled the same and neither
       preselected, so saying yes is no more work than saying no. */
    const notice = document.createElement('section');
    notice.className = 'bsv-ad-notice';
    notice.setAttribute('aria-label', 'Advertising privacy choice');
    const question = MEASUREMENT_DEFAULT === 'on'
      ? 'We use Meta Pixel to measure our ads, and you can turn that off. Your enquiry works either way.'
      : 'May we use Meta Pixel to measure our ads? Your enquiry works either way.';
    notice.innerHTML = '<p>' + question + ' <a href="/privacy.html">Privacy information</a></p><div class="bsv-ad-privacy-actions"><button type="button" data-choice="yes">Allow measurement</button><button type="button" data-choice="no">Keep it off</button><button type="button" data-details>Choose settings</button></div>';
    notice.querySelector('[data-choice="yes"]').addEventListener('click', () => choose(true));
    notice.querySelector('[data-choice="no"]').addEventListener('click', () => choose(false));
    notice.querySelector('[data-details]').addEventListener('click', () => window.BSVAdPrivacy.open());
    document.body.appendChild(notice);
  }
})();
