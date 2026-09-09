function setupEnquiry(form) {
  const card = form.closest('.estimate-card, .hero-estimate');
  const steps = [...form.querySelectorAll('.enquiry-step')];
  const isStepper = steps.length > 0;
  const back = form.querySelector('.step-back');
  let stepIndex = 0;
  let stepAnimation;
  const propertyStep = form.querySelector('.property-step');
  const propertyContinue = form.querySelector('.property-continue');
  const contactStep = isStepper ? form : form.querySelector('.contact-step');
  const contactReveal = form.querySelector('.contact-reveal');
  const feedback = form.querySelector('.form-feedback');
  const contactFields = contactStep.querySelectorAll('input:not(.honeypot):not([name=place]), select');
  let expanded = isStepper;
  let sending = false;
  let complete = false;
  let requestId;
  let submittedDetails;

  contactReveal?.addEventListener('transitionend', event => {
    if (event.target === contactReveal && event.propertyName === 'grid-template-rows') contactReveal.classList.add('is-open');
  });

  function showStep(index, focus = true) {
    stepIndex = index;
    stepAnimation?.cancel();
    steps.forEach((step, i) => {
      step.hidden = i !== index;
      step.querySelectorAll('input, select, button').forEach(control => { control.disabled = i !== index; });
    });
    back.disabled = index === 0;
    form.querySelector('.step-progress').textContent = `${index + 1} of ${steps.length} · ${steps[index].dataset.stepLabel}`;
    if (focus) {
      steps[index].querySelector('input').focus({ preventScroll: true });
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
        stepAnimation = steps[index].animate([
          { opacity: 0, transform: 'translateX(8px)' },
          { opacity: 1, transform: 'translateX(0)' }
        ], { duration: 220, easing: 'cubic-bezier(.22,1,.36,1)' });
      }
    }
  }

  back?.addEventListener('click', () => {
    if (sending || complete || stepIndex === 0) return;
    feedback.textContent = '';
    feedback.className = 'form-feedback';
    showStep(stepIndex - 1);
  });

  if (isStepper) form.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.isComposing || !event.target.matches('input:not(.honeypot)')) return;
    event.preventDefault();
    form.requestSubmit(steps[stepIndex].querySelector('button[type="submit"]'));
  });

  function showError(message, field) {
    if (isStepper && field) showStep(steps.indexOf(field.closest('.enquiry-step')), false);
    feedback.textContent = message;
    feedback.className = 'form-feedback error';
    if (field) {
      field.setAttribute('aria-invalid', 'true');
      field.focus({ preventScroll: isStepper });
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
    feedback.className = 'form-feedback';
    if (!isStepper && form.elements.place.value.trim()) expandLetter();
  });
  form.addEventListener('change', (event) => {
    event.target.removeAttribute('aria-invalid');
    if (!isStepper && form.elements.place.value.trim()) expandLetter();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (sending || complete) return;
    const place = form.elements.place.value.trim();
    if (!place) return showError('Please add your property address.', form.elements.place);
    if (isStepper && stepIndex === 0) return showStep(1);
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
    if (isStepper && stepIndex === 1) return showStep(2);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return showError('Please enter a valid email address.', form.elements.email);
    if (isStepper && stepIndex === 2) return showStep(3);
    const digits = phone.replace(/\D/g, '');
    if (!number || phone.length > 30 || !/^\+?[\d\s().-]+$/.test(phone) || digits.length < 8 || digits.length > 15) return showError('Please enter a valid phone number.', form.elements.phone);
    const payload = { place, name, email, phone, website: form.elements.website.value, form: form.id, ...(window.BSVExperiment?.leadData() || {}) };
    const details = JSON.stringify(payload);
    if (details !== submittedDetails) {
      requestId = crypto.randomUUID();
      submittedDetails = details;
    }
    sending = true;
    form.setAttribute('aria-busy', 'true');
    const button = (isStepper ? steps[steps.length - 1] : contactStep).querySelector('button[type="submit"]');
    const originalLabel = button.innerHTML;
    const fields = [form.elements.place, ...contactFields];
    fields.forEach(field => { field.disabled = true; });
    button.disabled = true;
    if (back) back.disabled = true;
    button.textContent = isStepper ? 'Sending…' : 'Sending your enquiry…';
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
      if (isStepper) form.querySelector('.hero-flow').hidden = true;
      else { propertyStep.hidden = true; contactStep.hidden = true; }
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
      if (isStepper && !complete) showStep(stepIndex, false);
      button.disabled = complete;
      button.innerHTML = originalLabel;
    }
  });

  if (isStepper) showStep(0, false);
  else {
    if (form.elements.place.value.trim()) expandLetter();
    window.addEventListener('pageshow', () => { if (form.elements.place.value.trim()) expandLetter(); });
  }

}

document.querySelectorAll('.enquiry-form').forEach(setupEnquiry);

const privacy = document.getElementById('privacy-dialog');
document.getElementById('privacy-open').addEventListener('click', () => privacy.showModal());
privacy.querySelector('.dialog-close').addEventListener('click', () => privacy.close());
privacy.addEventListener('click', event => { if (event.target === privacy) { const bounds = privacy.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) privacy.close(); } });
