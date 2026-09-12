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
  window.BSVAttribution = {
    leadData() {
      const params = new URLSearchParams(window.location.search);
      const attribution = {};
      for (const [parameter, [key, pattern]] of Object.entries(fields)) {
        const value = params.get(parameter);
        if (value && value === value.trim() && pattern.test(value)) attribution[key] = value;
      }
      return Object.keys(attribution).length ? { attribution } : {};
    }
  };
})();
