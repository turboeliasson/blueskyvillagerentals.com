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
  const fields = ['place', 'name', 'email', 'phone'];
  if (fields.some(key => typeof data[key] !== 'string' || !data[key].trim() || data[key].length > 300)) return Response.json({ ok: false }, { status: 400 });
  const payload = Object.fromEntries(fields.map(key => [key, data[key].trim()]));
  const digits = payload.phone.replace(/\D/g, '');
  if (payload.name.length > 120 || payload.email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(payload.email) ||
      payload.phone.length > 30 || !/^\+?[\d\s().-]+$/.test(payload.phone) || digits.length < 8 || digits.length > 15) return Response.json({ ok: false }, { status: 400 });
  if (data.website) return Response.json({ ok: true });
  if (typeof data.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.requestId)) return Response.json({ ok: false }, { status: 400 });
  payload.requestId = data.requestId;
  payload.form = 'homeowner-letter';
  try {
    const upstream = await fetch('https://photo.proptonomy.ai/bsv-lead', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(35000)
    });
    const result = await upstream.json();
    return Response.json({ ok: upstream.ok && result.ok === true }, { status: upstream.status, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ ok: false }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
