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
  document.addEventListener('DOMContentLoaded', () => {
    track('view');
    document.querySelectorAll('[data-estimate-form], .enquiry-form').forEach(form => {
      form.addEventListener('input', event => {
        if (event.target.name !== 'website' && event.target.value?.trim()) track('start');
      });
    });
  }, { once: true });
})();
