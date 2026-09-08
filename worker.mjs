export async function enquiry(request) {
  if (request.method !== 'POST') return Response.json({ ok: false }, { status: 405, headers: { Allow: 'POST' } });
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return Response.json({ ok: false }, { status: 403 });
  let data;
  try {
    const body = await request.text();
    if (body.length > 10000) return Response.json({ ok: false }, { status: 413 });
    data = JSON.parse(body);
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  if (!data || typeof data !== 'object') return Response.json({ ok: false }, { status: 400 });
  const fields = ['place', 'bedrooms', 'name', 'contact'];
  if (fields.some(key => typeof data[key] !== 'string' || !data[key].trim() || data[key].length > 300)) return Response.json({ ok: false }, { status: 400 });
  const contact = data.contact.trim();
  const isEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact);
  const digits = contact.replace(/\D/g, '');
  const isPhone = /^[+()\d\s.-]+$/.test(contact) && digits.length >= 10 && digits.length <= 15;
  if (!isEmail && !isPhone) return Response.json({ ok: false }, { status: 400 });
  if (data.website) return Response.json({ ok: true });
  const payload = Object.fromEntries(fields.map(key => [key, data[key].trim()]));
  try {
    const upstream = await fetch('https://photo.proptonomy.ai/bsv-lead', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(15000)
    });
    const result = await upstream.json();
    return Response.json({ ok: upstream.ok && result.ok === true }, { status: upstream.status, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ ok: false }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
