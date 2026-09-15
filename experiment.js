(function () {
  const EXPERIMENT = 'bsv-homeowners-2026-09';
  const ENABLED = true;
  const KEY = 'bsv-homeowner-test';
  const ENDPOINT = 'https://photo.proptonomy.ai/bsv-lead?event=experiment';
  /* The server only accepts a strict v4 id, so a looser check here would 409 every event this browser sends. */
  const VISITOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const pageVariant = document.documentElement.dataset.bsvVariant;
  const url = new URL(location.href);
  const forced = url.searchParams.get('bsv_variant');
  const preview = forced === 'A' || forced === 'B';
  const bot = /bot|crawler|spider|slurp|facebookexternalhit|twitterbot/i.test(navigator.userAgent);
  const live = ['blueskyvillagerentals.com', 'www.blueskyvillagerentals.com', 'turboeliasson.github.io'].includes(location.hostname);
  /* An ad click already landed on the page it paid for, usually in a slow in-app browser: sending it
     through a second navigation before any form paints, and splitting the ad's clicks across two
     pages, costs more than the test is worth. Paid visitors stay on A. */
  const paid = url.searchParams.get('utm_medium') === 'paid_social';
  const splitting = ENABLED && !paid;
  let assignment;

  function show(variant) {
    if (pageVariant === variant) return false;
    url.pathname = variant === 'B' ? '/village/' : '/';
    location.replace(url.href);
    return true;
  }

  window.BSVExperiment = { leadData: () => ({}) };
  if (preview) { show(forced); return; }
  if (bot) { show('A'); return; }
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    const valid = saved?.experiment === EXPERIMENT && ['A', 'B'].includes(saved.variant) &&
      VISITOR_ID.test(saved.visitorId) && Number.isFinite(saved.assignedAt) &&
      saved.assignedAt > Date.now() - 90 * 86400000;
    assignment = valid ? saved : {
      experiment: EXPERIMENT,
      variant: splitting && crypto.getRandomValues(new Uint32Array(1))[0] >= 2147483648 ? 'B' : 'A',
      visitorId: crypto.randomUUID(),
      assignedAt: Date.now()
    };
    /* One visitorId belongs to one variant for good: the log pins it the first time it is seen and
       refuses every later row that disagrees - view, start, progress and the conversion alike. A
       paid click is always served A, so a browser holding B has to become a different browser:
       a fresh id under A, written back, so this visit and every later one agree with the log. The
       old id keeps its B rows and is simply never used again. */
    if (!splitting && assignment.variant !== 'A') {
      assignment = { experiment: EXPERIMENT, variant: 'A', visitorId: crypto.randomUUID(), assignedAt: Date.now() };
    }
    localStorage.setItem(KEY, JSON.stringify(assignment));
  } catch {
    // Keep the original page usable when browser storage is unavailable.
    show('A');
    return;
  }
  // The stored assignment is now what is served, so page, storage and log all say the same thing.
  const variant = assignment.variant;
  if (!paid && show(variant)) return;
  if (!live) return;
  const experiment = { id: EXPERIMENT, variant, visitorId: assignment.visitorId };
  window.BSVExperiment = { leadData: () => ({ experiment }) };
  const sent = new Set();
  const tries = new Map();
  /* A rejection is permanent: the same payload gets the same 4xx every time, and 'start' fires on
     every keystroke, so re-arming on one would POST per character and spend the shared per-IP
     allowance. Only a dropped connection or a server fault is worth another go, and not forever. */
  const MAX_TRIES = 3;
  /* attribution.js is deferred and this file is not, so the ad tags only exist once the page is
     ready. Read them when a beacon leaves, never at load. */
  function adSource() {
    const source = window.BSVAttribution?.sourceData?.() || {};
    return Object.keys(source).length ? { source } : {};
  }
  function track(event) {
    if (sent.has(event)) return;
    sent.add(event);
    const attempt = (tries.get(event) || 0) + 1;
    tries.set(event, attempt);
    const again = () => { if (attempt < MAX_TRIES) sent.delete(event); };
    fetch(ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ experiment, event, ...adSource() }), keepalive: true
    }).then(response => { if (!response.ok && response.status >= 500) again(); }).catch(again);
  }
  const FORMS = ['early-estimate-form', 'estimate-form', 'hero-estimate-form'];
  /* How much someone typed, never what they typed. */
  function bucket(length) {
    if (!length) return '0';
    if (length <= 3) return '1-3';
    if (length <= 10) return '4-10';
    if (length <= 30) return '11-30';
    return '31+';
  }
  function send(payload) {
    const body = JSON.stringify(payload);
    // text/plain keeps the beacon free of a preflight it could never complete.
    try {
      if (navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: 'text/plain;charset=UTF-8' }))) return;
    } catch {}
    fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  }

  document.addEventListener('DOMContentLoaded', () => {
    track('view');
    document.querySelectorAll('[data-estimate-form], .enquiry-form').forEach(form => {
      const formId = FORMS.includes(form.id) ? form.id : null;
      const typed = new Map();
      /* A phone that switches apps mid-form is not a finished session, so the beacon latch lifts
         again the moment there is something new to report, and a confirmed submit always gets a
         row of its own. The server keeps the last beacon per visitor and form, so a later row
         replaces the earlier one. Capped anyway: flicking between apps must not spend the
         per-IP event allowance. */
      const MAX_BEACONS = 4;
      let lastField = null, startedAt = 0, submitted = false;
      let pending = false, submitFlushed = false, beacons = 0;
      form.addEventListener('input', event => {
        const field = event.target;
        if (field.name === 'website' || !field.name) return;
        const length = String(field.value ?? '').trim().length;
        if (length) {
          if (!startedAt) startedAt = Date.now();
          track('start');
        }
        typed.set(field.name, Math.max(typed.get(field.name) || 0, length));
        lastField = field.name;
        pending = true; // the last beacon, if any, is now out of date
      });
      form.addEventListener('submit', () => { submitted = true; });
      /* The submit handlers dispatch this once the save is confirmed: an in-app browser often
         closes without ever firing visibilitychange, and the row would be lost. It reports even
         when a beacon already left, because that one was written before the answer arrived. */
      form.addEventListener('bsv-submitted', () => { submitted = true; flush(true); });
      form.addEventListener('bsv-progress-flush', () => flush()); // tests drive this directly
      // A control inside a disabled fieldset still answers field.disabled with false; ask the selector.
      function unusable(field) {
        return field.disabled === true || field.matches?.(':disabled') === true;
      }
      /* A radio answers field.value with its own value attribute whether or not it is checked, and
         form.elements answers with the whole group, whose value is whatever is checked - including
         a default the visitor never touched. So a group counts only once it has been interacted
         with, which is exactly what the typed Map records. An unchecked group still reports "0". */
      function currentLength(field) {
        const group = form.elements?.[field.name];
        const grouped = group && group !== field && typeof group.value === 'string';
        if (grouped) return typed.has(field.name) ? String(group.value ?? '').trim().length : 0;
        return String(field.value ?? '').trim().length;
      }
      function flush(force) {
        if (!formId || !startedAt) return;
        // The confirmed submit is the one row worth more than the cap, and it leaves only once.
        if (force) { if (submitFlushed) return; submitFlushed = true; }
        else if (!pending || beacons >= MAX_BEACONS) return;
        pending = false;
        beacons++;
        const fields = {};
        let filledCount = 0, requiredRemaining = 0;
        form.querySelectorAll('input[name], select[name], textarea[name]').forEach(field => {
          if (field.name === 'website' || Object.prototype.hasOwnProperty.call(fields, field.name)) return;
          const length = Math.max(typed.get(field.name) || 0, currentLength(field));
          fields[field.name] = bucket(length);
          if (length) filledCount++;
          // The form disables whichever of email and phone is unused, and a control nobody can
          // reach can never be filled: counting it would report every visitor one field short.
          else if (field.required && !unusable(field)) requiredRemaining++;
        });
        send({
          experiment, event: 'progress', ...adSource(),
          progress: {
            formId, lastField, filledCount, requiredRemaining, submitted,
            secondsSinceStart: Math.min(3600, Math.max(0, Math.round((Date.now() - startedAt) / 1000))),
            fields,
          },
        });
      }
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
      window.addEventListener('pagehide', () => flush()); // the event object must not read as force
    });
  }, { once: true });
})();
