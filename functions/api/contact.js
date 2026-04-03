/**
 * Cloudflare Pages Function: /api/contact
 *
 * Ortam değişkenleri (Cloudflare Pages → Settings → Environment Variables):
 *   TURNSTILE_SECRET  — Turnstile secret key
 *   TO_EMAIL          — Mesajların gideceği adres (örn. info@kunduzenerji.com)
 */

const ALLOWED_ORIGINS = [
  'https://kunduzenerji.com',
  'https://www.kunduzenerji.com',
];

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

// OPTIONS preflight
export async function onRequestOptions({ request }) {
  const origin = request.headers.get('Origin') || '';
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

// POST handler
export async function onRequestPost({ request, env }) {
  const origin = request.headers.get('Origin') || '';

  // CORS kontrolü
  if (!ALLOWED_ORIGINS.includes(origin)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  }

  const headers = {
    ...corsHeaders(origin),
    'Content-Type': 'application/json',
  };

  // JSON parse
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Geçersiz istek.' }), { status: 400, headers });
  }

  const {
    name,
    email,
    company,
    phone,
    message,
    'cf-turnstile-response': turnstileToken,
  } = body;

  // --- Server-side validasyon ---
  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return new Response(JSON.stringify({ error: 'Ad Soyad zorunludur.' }), { status: 400, headers });
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return new Response(JSON.stringify({ error: 'Geçerli bir e-posta giriniz.' }), { status: 400, headers });
  }
  if (!message || typeof message !== 'string' || message.trim().length < 10) {
    return new Response(JSON.stringify({ error: 'Mesaj en az 10 karakter olmalıdır.' }), { status: 400, headers });
  }
  // Uzunluk sınırı — aşırı büyük input engelle
  if (name.length > 100 || email.length > 200 || (company && company.length > 200) || message.length > 5000) {
    return new Response(JSON.stringify({ error: 'Girdi çok uzun.' }), { status: 400, headers });
  }

  // --- Turnstile doğrulama ---
  if (!turnstileToken) {
    return new Response(JSON.stringify({ error: 'Bot doğrulaması eksik.' }), { status: 400, headers });
  }
  const tsRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret: env.TURNSTILE_SECRET,
      response: turnstileToken,
      remoteip: request.headers.get('CF-Connecting-IP'),
    }),
  });
  const tsData = await tsRes.json();
  if (!tsData.success) {
    return new Response(JSON.stringify({ error: 'Bot doğrulaması başarısız. Lütfen tekrar deneyin.' }), { status: 400, headers });
  }

  // --- E-posta gönder (MailChannels) ---
  const toEmail = env.TO_EMAIL || 'info@kunduzenerji.com';
  const textBody = [
    `Ad Soyad : ${name.trim()}`,
    `E-posta  : ${email.trim()}`,
    `Şirket   : ${company ? company.trim() : '-'}`,
    `Telefon  : ${phone ? phone.trim() : '-'}`,
    '',
    'Mesaj:',
    message.trim(),
  ].join('\n');

  const mailRes = await fetch('https://api.mailchannels.net/tx/v1/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: toEmail }] }],
      from: { email: 'form@kunduzenerji.com', name: 'Kunduz Enerji Form' },
      reply_to: { email: email.trim(), name: name.trim() },
      subject: `Yeni İletişim Formu: ${name.trim()}`,
      content: [{ type: 'text/plain', value: textBody }],
    }),
  });

  if (!mailRes.ok) {
    const errText = await mailRes.text();
    console.error('MailChannels error:', mailRes.status, errText);
    return new Response(JSON.stringify({ error: 'E-posta gönderilemedi. Lütfen daha sonra tekrar deneyin.' }), { status: 500, headers });
  }

  return new Response(JSON.stringify({ success: true }), { status: 200, headers });
}
