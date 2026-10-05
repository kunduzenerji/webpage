/**
 * Cloudflare Pages Function: /teklif/<token>/...
 *
 * Müşteri tekliflerini yalnızca linki bilenlere, süresi dolana kadar sunar.
 * Teklif dosyaları KV'de durur (depoda DEĞİL); yükleme New Offer Format/publish_offer.py ile yapılır.
 *
 * Gerekli binding (Cloudflare Pages → Settings → Bindings → KV namespace):
 *   OFFERS  — teklifleri tutan KV namespace
 *
 * KV anahtarları:
 *   <token>/_meta           JSON {"teklif_no": "...", "expires_at": "2026-10-07T23:59:59+03:00"}
 *   <token>/<dosya yolu>    dosya içeriği (metadata: {"ct": "<content-type>"})
 */

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

const SECURITY_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net https://static.cloudflareinsights.com; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com data:; " +
    "img-src 'self' data: blob:; " +
    "media-src 'self' data: blob:; " +
    "connect-src 'self' data: blob: https://cdn.jsdelivr.net https://www.gstatic.com https://cloudflareinsights.com; " +
    "worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'",
};

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function messagePage(status, title, text) {
  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${title}</title>
<style>body{font-family:Arial,Helvetica,sans-serif;background:#f6f8f9;color:#47575d;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
.c{max-width:460px;text-align:center}h1{font-size:22px;margin:0 0 12px}p{line-height:1.6;margin:0 0 8px}a{color:#47575d}</style></head>
<body><div class="c"><h1>${title}</h1><p>${text}</p>
<p>Bize <a href="mailto:info@kunduzenerji.com">info@kunduzenerji.com</a> adresinden ulaşabilirsiniz.</p></div></body></html>`;
  return new Response(html, {
    status,
    headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function notFound() {
  return messagePage(404, 'Teklif bulunamadı', 'Bu bağlantı geçersiz ya da süresi dolduğu için kaldırılmış.');
}

export async function onRequestGet({ request, params, env }) {
  if (!env.OFFERS) {
    return messagePage(500, 'Yapılandırma hatası', 'Teklif deposu (KV binding "OFFERS") bağlı değil.');
  }

  const parts = Array.isArray(params.path) ? params.path : params.path ? [params.path] : [];
  const token = parts[0];
  if (!token || !TOKEN_RE.test(token)) return notFound();

  // /teklif/<token>  →  /teklif/<token>/   (göreli linkler — assets/, PDF — için gerekli)
  const url = new URL(request.url);
  if (parts.length === 1 && !url.pathname.endsWith('/')) {
    return Response.redirect(`${url.origin}/teklif/${token}/`, 301);
  }

  const meta = await env.OFFERS.get(`${token}/_meta`, 'json');
  if (!meta) return notFound();

  const expires = Date.parse(meta.expires_at);
  if (!Number.isFinite(expires) || Date.now() > expires) {
    return messagePage(
      410,
      'Teklifin geçerlilik süresi doldu',
      `${meta.teklif_no ? esc(meta.teklif_no) + ' numaralı teklifin' : 'Bu teklifin'} geçerlilik süresi sona erdi. Güncel bir teklif için bizimle iletişime geçebilirsiniz.`
    );
  }

  let rel = parts.slice(1).map(decodeURIComponent).join('/');
  if (!rel) rel = 'index.html';
  if (rel.startsWith('_') || rel.split('/').some((s) => s === '..' || s === '.' || s === '')) return notFound();

  const { value, metadata } = await env.OFFERS.getWithMetadata(`${token}/${rel}`, { type: 'stream' });
  if (value === null) return notFound();

  return new Response(value, {
    headers: {
      ...SECURITY_HEADERS,
      'Content-Type': (metadata && metadata.ct) || 'application/octet-stream',
    },
  });
}
