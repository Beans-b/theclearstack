// functions/api/digest.js
// Cloudflare Pages Function — POST /api/digest
// Returns the Social Engine items awaiting approval, plus a ready-to-email HTML
// table. Lets a scheduled Make scenario send the morning "awaiting approval"
// digest with ONE call and no database key in Make — same pattern as
// /api/generate. All keys stay server-side in Cloudflare env.
//
// Auth (either one):
//   1. Authorization: Bearer <token>  (token from /api/auth)
//   2. JSON body { "password": "<CC_ADMIN_PASSWORD>" }  (simplest for a cron)
//
// Env vars (already set in Cloudflare Pages — reused, nothing new):
//   SUPABASE_URL, SUPABASE_SERVICE_KEY, CC_SESSION_SECRET, CC_ADMIN_PASSWORD

const PLABEL = { facebook: 'Facebook', instagram: 'Instagram', x: 'X', tiktok: 'TikTok', linkedin: 'LinkedIn' };

export async function onRequestPost({ request, env }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return json({ error: 'Server not configured (missing env vars).' }, 500);
  }

  // 1) Auth — Bearer token OR admin password
  let body = {};
  try { body = await request.json(); } catch (_) {}
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const okToken = env.CC_SESSION_SECRET && await verifyToken(token, env.CC_SESSION_SECRET);
  const okPass  = env.CC_ADMIN_PASSWORD && typeof body.password === 'string' && body.password === env.CC_ADMIN_PASSWORD;
  if (!okToken && !okPass) return json({ error: 'Unauthorized' }, 401);

  try {
    // 2) Read pending_approval rows (service key, server-side)
    const url = `${env.SUPABASE_URL}/rest/v1/social_queue`
      + `?status=eq.pending_approval&order=created_at.asc`
      + `&select=platform,variant,style_tag,source_topic,post_text,content_type`;
    const r = await fetch(url, {
      headers: {
        'apikey': env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`
      }
    });
    if (!r.ok) return json({ error: 'Supabase read failed', detail: (await r.text()).slice(0, 300) }, 502);
    const rows = await r.json();
    const list = Array.isArray(rows) ? rows : [];

    return json({ ok: true, count: list.length, html: renderHtml(list), rows: list });
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
}

// ── email body ─────────────────────────────────────────────────────────
function renderHtml(rows) {
  if (!rows.length) {
    return `<h2>Nothing awaiting approval</h2><p>The Social Engine queue is clear.</p>`;
  }
  const body = rows.map(r => {
    const plat = esc(PLABEL[r.platform] || r.platform || '');
    const variant = r.variant ? ` (${esc(r.variant)})` : '';
    const style = esc(r.style_tag || '');
    const topic = esc(r.source_topic || '');
    const preview = esc(String(r.post_text || '').slice(0, 200));
    return `<tr>`
      + `<td style="padding:6px;border:1px solid #ddd">${plat}${variant}</td>`
      + `<td style="padding:6px;border:1px solid #ddd">${style}</td>`
      + `<td style="padding:6px;border:1px solid #ddd">${topic}</td>`
      + `<td style="padding:6px;border:1px solid #ddd">${preview}</td>`
      + `</tr>`;
  }).join('');
  return `<h2>${rows.length} item${rows.length === 1 ? '' : 's'} awaiting approval</h2>`
    + `<p>Review and approve in the <a href="https://theclearstack.com/lab/social">Social Engine dashboard</a>. `
    + `Approving Facebook, Instagram, or video items publishes instantly. `
    + `A/B pairs: approving one variant retires its sibling automatically.</p>`
    + `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px">`
    + `<tr>`
    + `<th style="padding:6px;border:1px solid #ddd;text-align:left">Platform</th>`
    + `<th style="padding:6px;border:1px solid #ddd;text-align:left">Hook style</th>`
    + `<th style="padding:6px;border:1px solid #ddd;text-align:left">Topic</th>`
    + `<th style="padding:6px;border:1px solid #ddd;text-align:left">Preview</th>`
    + `</tr>${body}</table>`;
}

// ── helpers ──────────────────────────────────────────────────────────────
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

async function hmac(message, secret) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  let bin = '';
  const arr = new Uint8Array(sig);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function verifyToken(token, secret) {
  if (!token || token.indexOf('.') === -1) return false;
  const [b, sig] = token.split('.');
  if (!b || !sig) return false;
  if (sig !== await hmac(b, secret)) return false;
  try { const p = JSON.parse(atob(b.replace(/-/g, '+').replace(/_/g, '/'))); if (!p.exp || Date.now() > p.exp) return false; } catch (_) { return false; }
  return true;
}
