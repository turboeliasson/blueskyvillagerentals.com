const form = document.getElementById('estimate-form');
const card = document.querySelector('.estimate-card');
const propertyStep = document.getElementById('property-step');
const contactStep = document.getElementById('contact-step');
const feedback = document.getElementById('form-feedback');
const contactFields = contactStep.querySelectorAll('input:not(.honeypot), select');
let step = 'property';
let sending = false;

function showError(message, field) {
  feedback.textContent = message;
  feedback.className = 'form-feedback error';
  if (field) {
    field.setAttribute('aria-invalid', 'true');
    field.focus();
  }
}

form.addEventListener('input', (event) => {
  event.target.removeAttribute('aria-invalid');
  feedback.textContent = '';
});

document.getElementById('form-back').addEventListener('click', () => {
  if (sending) return;
  step = 'property';
  propertyStep.hidden = false;
  contactStep.hidden = true;
  contactFields.forEach(field => { field.disabled = true; });
  card.classList.remove('is-expanded');
  feedback.textContent = '';
  form.elements.place.focus();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (sending || step === 'success') return;
  const place = form.elements.place.value.trim();
  if (!place) return showError('Please add your town or property address.', form.elements.place);
  if (step === 'property') {
    step = 'contact';
    propertyStep.hidden = true;
    contactStep.hidden = false;
    contactFields.forEach(field => { field.disabled = false; });
    document.getElementById('property-summary').textContent = place;
    card.classList.add('is-expanded');
    feedback.textContent = '';
    form.elements.bedrooms.focus();
    return;
  }
  const bedrooms = form.elements.bedrooms.value;
  const name = form.elements.name.value.trim();
  const contact = form.elements.contact.value.trim();
  if (!bedrooms) return showError('Please choose the number of bedrooms.', form.elements.bedrooms);
  if (!name) return showError('Please add your name.', form.elements.name);
  const isEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact);
  const isPhone = /^[+()\d\s.-]+$/.test(contact) && contact.replace(/\D/g, '').length >= 10 && contact.replace(/\D/g, '').length <= 15;
  if (!isEmail && !isPhone) return showError('Please enter a valid email address or phone number.', form.elements.contact);
  sending = true;
  const button = contactStep.querySelector('button[type="submit"]');
  const originalLabel = button.innerHTML;
  button.disabled = true;
  document.getElementById('form-back').disabled = true;
  button.textContent = 'Sending your enquiry…';
  feedback.className = 'form-feedback';
  feedback.textContent = '';
  const endpoint = ['blueskyvillagerentals.com', 'www.blueskyvillagerentals.com', 'turboeliasson.github.io'].includes(location.hostname)
    ? 'https://photo.proptonomy.ai/bsv-lead' : '/api/enquiry';
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ place, bedrooms, name, contact, website: form.elements.website.value }),
      signal: AbortSignal.timeout(20000)
    });
    const result = await response.json();
    if (!response.ok || result.ok !== true) throw new Error(response.status === 429 ? 'rate' : 'send');
    step = 'success';
    contactStep.hidden = true;
    document.querySelector('.form-intro').hidden = true;
    const success = document.getElementById('success-step');
    success.hidden = false;
    document.getElementById('success-message').textContent = `Thank you, ${name}. We will follow up using ${contact}.`;
    success.focus();
  } catch (error) {
    feedback.className = 'form-feedback error';
    feedback.textContent = error.message === 'rate' ? 'Too many attempts. Please try again later, or call us at 704-902-5644.' : 'We could not confirm your enquiry was sent. Please try again, or call 704-902-5644.';
  } finally {
    sending = false;
    button.disabled = false;
    document.getElementById('form-back').disabled = false;
    button.innerHTML = originalLabel;
  }
});

const privacy = document.getElementById('privacy-dialog');
document.getElementById('privacy-open').addEventListener('click', () => privacy.showModal());
privacy.querySelector('.dialog-close').addEventListener('click', () => privacy.close());
privacy.addEventListener('click', event => { if (event.target === privacy) { const bounds = privacy.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) privacy.close(); } });
