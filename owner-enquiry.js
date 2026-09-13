/* Owner guides use the existing lead gateway, outside the homepage experiment. */
(function () {
  'use strict';
  document.querySelectorAll('.owner-form').forEach(form => {
    const feedback = form.querySelector('.feedback');
    const button = form.querySelector('button[type="submit"]');
    const fields = [...form.querySelectorAll('input, select')];
    let sending = false;
    let complete = false;
    let requestId;
    let lastDetails;
    form.addEventListener('input', event => event.target.setCustomValidity?.(''));
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (sending || complete) return;
      const value = key => form.elements[key].value.trim();
      for (const key of ['place', 'name', 'email']) {
        form.elements[key].setCustomValidity(value(key) ? '' : 'Please fill out this field.');
      }
      form.elements.phone.setCustomValidity(!value('phone') || /^\+?[\d\s().-]{7,30}$/.test(value('phone')) ? '' : 'Please enter a valid phone number, or leave this blank.');
      if (!form.reportValidity()) return;
      const payload = { place: value('place'), name: value('name'), email: value('email'), phone: value('phone'),
        bedrooms: value('bedrooms'), website: value('website'), form: form.id,
        ...(window.BSVAttribution?.leadData() || {}) };
      const details = JSON.stringify(payload);
      if (details !== lastDetails) { requestId = crypto.randomUUID(); lastDetails = details; }
      sending = true;
      form.setAttribute('aria-busy', 'true');
      fields.forEach(field => { field.disabled = true; });
      button.disabled = true;
      button.textContent = 'Sending your request…';
      feedback.textContent = '';
      const endpoint = ['blueskyvillagerentals.com', 'www.blueskyvillagerentals.com', 'turboeliasson.github.io'].includes(location.hostname)
        ? 'https://photo.proptonomy.ai/bsv-lead' : '/api/enquiry';
      try {
        const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, requestId }), signal: AbortSignal.timeout(40000) });
        const result = await response.json();
        if (!response.ok || result.ok !== true) throw new Error(response.status === 429 ? 'rate' : 'save');
        complete = true;
        window.BSVPixel?.trackLead(form.id, requestId);
        form.querySelectorAll('.field, button[type="submit"], .form-privacy').forEach(node => { node.hidden = true; });
        const success = form.querySelector('.success');
        success.hidden = false;
        success.querySelector('p').textContent = `Thank you, ${payload.name}. We have your request for ${payload.place} and will follow up at ${payload.email}.`;
        success.focus();
      } catch (error) {
        feedback.textContent = error.message === 'rate'
          ? 'Too many attempts. Please try again later, or call 704-902-5644.'
          : 'We could not confirm your request was saved. Please try again, or call 704-902-5644.';
      } finally {
        sending = false;
        form.removeAttribute('aria-busy');
        fields.forEach(field => { field.disabled = complete; });
        button.disabled = complete;
        button.textContent = 'Request my free rental estimate';
      }
    });
  });
})();
