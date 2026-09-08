function setupEnquiry(form) {
  const card = form.closest('.estimate-card, .hero-estimate');
  const propertyStep = form.querySelector('.property-step');
  const propertyContinue = form.querySelector('.property-continue');
  const contactStep = form.querySelector('.contact-step');
  const contactReveal = form.querySelector('.contact-reveal');
  const feedback = form.querySelector('.form-feedback');
  const contactFields = contactStep.querySelectorAll('input:not(.honeypot), select');
  let expanded = false;
  let sending = false;
  let complete = false;
  let requestId;
  let submittedDetails;

  contactReveal.addEventListener('transitionend', event => {
    if (event.target === contactReveal && event.propertyName === 'grid-template-rows') contactReveal.classList.add('is-open');
  });

  function showError(message, field) {
    feedback.textContent = message;
    feedback.className = 'form-feedback error';
    if (field) {
      field.setAttribute('aria-invalid', 'true');
      field.focus();
    }
  }

  function expandLetter() {
    if (expanded || complete) return;
    expanded = true;
    contactStep.hidden = false;
    contactFields.forEach(field => { field.disabled = false; });
    propertyContinue.hidden = true;
    propertyContinue.querySelector('button').setAttribute('aria-expanded', 'true');
    contactReveal.getBoundingClientRect();
    card.classList.add('is-expanded');
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) contactReveal.classList.add('is-open');
  }

  form.addEventListener('input', (event) => {
    event.target.removeAttribute('aria-invalid');
    feedback.textContent = '';
    if (form.elements.place.value.trim()) expandLetter();
  });
  form.addEventListener('change', (event) => {
    event.target.removeAttribute('aria-invalid');
    if (form.elements.place.value.trim()) expandLetter();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (sending || complete) return;
    const place = form.elements.place.value.trim();
    if (!place) return showError('Please add your property address.', form.elements.place);
    if (!expanded) {
      expandLetter();
      form.elements.name.focus();
      return;
    }
    const name = form.elements.name.value.trim();
    const email = form.elements.email.value.trim();
    const number = form.elements.phone.value.trim();
    const phone = number.startsWith('+') ? number : `${form.elements.countryCode.value} ${number}`;
    if (!name) return showError('Please add your name.', form.elements.name);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return showError('Please enter a valid email address.', form.elements.email);
    const digits = phone.replace(/\D/g, '');
    if (!number || phone.length > 30 || !/^\+?[\d\s().-]+$/.test(phone) || digits.length < 8 || digits.length > 15) return showError('Please enter a valid phone number.', form.elements.phone);
    const payload = { place, name, email, phone, website: form.elements.website.value, form: 'homeowner-letter' };
    const details = JSON.stringify(payload);
    if (details !== submittedDetails) {
      requestId = crypto.randomUUID();
      submittedDetails = details;
    }
    sending = true;
    form.setAttribute('aria-busy', 'true');
    const button = contactStep.querySelector('button[type="submit"]');
    const originalLabel = button.innerHTML;
    const fields = [form.elements.place, ...contactFields];
    fields.forEach(field => { field.disabled = true; });
    button.disabled = true;
    button.textContent = 'Sending your enquiry…';
    feedback.className = 'form-feedback';
    feedback.textContent = '';
    const endpoint = ['blueskyvillagerentals.com', 'www.blueskyvillagerentals.com', 'turboeliasson.github.io'].includes(location.hostname)
      ? 'https://photo.proptonomy.ai/bsv-lead' : '/api/enquiry';
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, requestId }),
        signal: AbortSignal.timeout(40000)
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true) throw new Error(response.status === 429 ? 'rate' : 'send');
      complete = true;
      propertyStep.hidden = true;
      contactStep.hidden = true;
      const intro = card.querySelector('.form-intro');
      if (intro) intro.hidden = true;
      const success = form.querySelector('.success-step');
      success.hidden = false;
      form.querySelector('.success-message').textContent = `Thank you, ${name}. We have your request for ${place} and will follow up at ${email} or ${phone}.`;
      success.focus();
    } catch (error) {
      feedback.className = 'form-feedback error';
      feedback.textContent = error.message === 'rate' ? 'Too many attempts. Please try again later, or call us at 704-902-5644.' : 'We could not confirm your enquiry was sent. Please try again, or call 704-902-5644.';
    } finally {
      sending = false;
      form.removeAttribute('aria-busy');
      fields.forEach(field => { field.disabled = complete; });
      button.disabled = complete;
      button.innerHTML = originalLabel;
    }
  });

  if (form.elements.place.value.trim()) expandLetter();
  window.addEventListener('pageshow', () => { if (form.elements.place.value.trim()) expandLetter(); });

}

document.querySelectorAll('.enquiry-form').forEach(setupEnquiry);

const privacy = document.getElementById('privacy-dialog');
document.getElementById('privacy-open').addEventListener('click', () => privacy.showModal());
privacy.querySelector('.dialog-close').addEventListener('click', () => privacy.close());
privacy.addEventListener('click', event => { if (event.target === privacy) { const bounds = privacy.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) privacy.close(); } });
