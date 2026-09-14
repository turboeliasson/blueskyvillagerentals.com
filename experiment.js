(function () {
  const EXPERIMENT = 'bsv-homeowners-2026-09';
  const ENABLED = true;
  const KEY = 'bsv-homeowner-test';
  const ENDPOINT = 'https://photo.proptonomy.ai/bsv-lead?event=experiment';
  const pageVariant = document.documentElement.dataset.bsvVariant;
  const url = new URL(location.href);
  const forced = url.searchParams.get('bsv_variant');
  const preview = forced === 'A' || forced === 'B';
  const bot = /bot|crawler|spider|slurp|facebookexternalhit|twitterbot/i.test(navigator.userAgent);
  const live = ['blueskyvillagerentals.com', 'www.blueskyvillagerentals.com', 'turboeliasson.github.io'].includes(location.hostname);
  let assignment;

  function show(variant) {
    if (pageVariant === variant) return false;
    url.pathname = variant === 'B' ? '/village/' : '/';
    location.replace(url.href);
    return true;
  }

  window.BSVExperiment = { leadData: () => ({}) };
  if (preview) { show(forced); return; }
  if (!ENABLED || bot) { show('A'); return; }
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    const valid = saved?.experiment === EXPERIMENT && ['A', 'B'].includes(saved.variant) &&
      /^[0-9a-f-]{36}$/i.test(saved.visitorId) && Number.isFinite(saved.assignedAt) &&
      saved.assignedAt > Date.now() - 90 * 86400000;
    assignment = valid ? saved : {
      experiment: EXPERIMENT,
      variant: crypto.getRandomValues(new Uint32Array(1))[0] < 2147483648 ? 'A' : 'B',
      visitorId: crypto.randomUUID(),
      assignedAt: Date.now()
    };
    localStorage.setItem(KEY, JSON.stringify(assignment));
  } catch {
    // Keep the original page usable when browser storage is unavailable.
    show('A');
    return;
  }
  if (show(assignment.variant) || !live) return;
  const experiment = { id: EXPERIMENT, variant: assignment.variant, visitorId: assignment.visitorId };
  window.BSVExperiment = { leadData: () => ({ experiment }) };
  const sent = new Set();
  function track(event) {
    if (sent.has(event)) return;
    sent.add(event);
    fetch(ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ experiment, event }), keepalive: true
    }).then(response => { if (!response.ok) sent.delete(event); }).catch(() => sent.delete(event));
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
      let lastField = null, startedAt = 0, submitted = false, beaconSent = false;
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
      });
      form.addEventListener('submit', () => { submitted = true; });
      form.addEventListener('bsv-progress-flush', flush); // tests drive this directly
      function flush() {
        if (beaconSent || !formId || !startedAt) return;
        beaconSent = true;
        const fields = {};
        let filledCount = 0, requiredRemaining = 0;
        form.querySelectorAll('input[name], select[name], textarea[name]').forEach(field => {
          if (field.name === 'website' || Object.prototype.hasOwnProperty.call(fields, field.name)) return;
          const length = Math.max(typed.get(field.name) || 0, String(field.value ?? '').trim().length);
          fields[field.name] = bucket(length);
          if (length) filledCount++;
          else if (field.required) requiredRemaining++;
        });
        send({
          experiment, event: 'progress',
          progress: {
            formId, lastField, filledCount, requiredRemaining, submitted,
            secondsSinceStart: Math.min(3600, Math.max(0, Math.round((Date.now() - startedAt) / 1000))),
            fields,
          },
        });
      }
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
      window.addEventListener('pagehide', flush);
    });
  }, { once: true });
})();
