/* Keep the ad identifiers with a submitted enquiry, without cookies or extra requests. */
(function () {
  'use strict';
  const fields = {
    utm_source: ['utmSource', /^[a-zA-Z0-9_.-]{1,64}$/],
    utm_medium: ['utmMedium', /^[a-zA-Z0-9_.-]{1,64}$/],
    utm_campaign: ['metaCampaignId', /^\d{5,30}$/],
    utm_term: ['metaAdsetId', /^\d{5,30}$/],
    utm_content: ['metaAdId', /^\d{5,30}$/]
  };
  function readAttribution() {
    const params = new URLSearchParams(window.location.search);
    const attribution = {};
    for (const [parameter, [key, pattern]] of Object.entries(fields)) {
      const value = params.get(parameter);
      if (value && value === value.trim() && pattern.test(value)) attribution[key] = value;
    }
    return attribution;
  }
  window.BSVAttribution = {
    leadData() {
      const attribution = readAttribution();
      return Object.keys(attribution).length ? { attribution } : {};
    }
  };
  // Preserve validated source tags across owner guides without storing browsing history.
  function tagInternalLinks() {
    const attribution = readAttribution();
    document.querySelectorAll('a[href]').forEach(link => {
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || link.getAttribute('href').startsWith('#')) return;
      for (const [parameter, [key]] of Object.entries(fields)) {
        if (attribution[key] && !url.searchParams.has(parameter)) url.searchParams.set(parameter, attribution[key]);
      }
      if (Object.keys(attribution).length) link.href = url.href;
    });
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tagInternalLinks);
    else tagInternalLinks();
  }
})();
