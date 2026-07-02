// functions/api/detect.js
// Cloudflare Pages Function — POST /api/detect
// Server-side proxy for the Stack Detector. Verifies the admin session token
// (same scheme as auth.js / projects.js) and proxies to the Make engine,
// keeping the Make webhook key off the client.
//
// Required env vars (Cloudflare Pages → Settings → Variables & Secrets):
//   CC_SESSION_SECRET        – same value as auth.js / projects.js
//   MAKE_DETECT_WEBHOOK_URL  – https://hook.us2.make.com/isyrnf961c1ag3yuvclbpewwok5iegtr
//   MAKE_DETECT_WEBHOOK_KEY  – the makecom-enricher-webhook-key value (sent as x-make-apikey)

export async function onRequestPost({ request, env }) {
  if (!env.CC_SESSION_SECRET || !env.MAKE_DETECT_WEBHOOK_URL || !env.MAKE_DETECT_WEBHOOK_KEY) {
    return json({ error: 'Detector not configured (missing env vars).' }, 500);
  }

  // ── admin gate: verify the signed bearer token from /api/auth ──
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!(await verifyToken(token, env.CC_SESSION_SECRET))) {
    return json({ error: 'Unauthorized' }, 401);
  }

  // ── parse + normalize the domain ──
  let body = {};
  try { body = await request.json(); } catch (_) {}
  let domain = (body.domain || '').toString().trim().toLowerCase();
  if (!domain) return json({ error: 'Provide a domain.' }, 400);

  domain = domain
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split('?')[0]
    .trim();

  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
    return json({ error: 'That does not look like a valid domain.' }, 400);
  }

  // ── proxy to the Make engine (key stays server-side) ──
  try {
    const upstream = await fetch(env.MAKE_DETECT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-make-apikey': env.MAKE_DETECT_WEBHOOK_KEY },
      body: JSON.stringify({ domain }),
    });
    const text = await upstream.text();
    if (!upstream.ok) {
      return json({ error: 'Detection engine error.', status: upstream.status, detail: text.slice(0, 500) }, 502);
    }
    let data;
    try { data = JSON.parse(text); } catch (_) {
      return json({ error: 'Engine returned a non-JSON response.', detail: text.slice(0, 500) }, 502);
    }
    return json(data, 200);
  } catch (e) {
    return json({ error: 'Could not reach the detection engine.', detail: String(e) }, 502);
  }
}

// ── helpers (token scheme identical to auth.js / projects.js) ──
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

function b64url(bytes) {
  let bin = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(message, secret) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return b64url(sig);
}

async function verifyToken(token, secret) {
  if (!token || token.indexOf('.') === -1) return false;
  const [body, sig] = token.split('.');
  const expected = await hmac(body, secret);
  if (sig !== expected) return false;
  try {
    const payload = JSON.parse(new TextDecoder().decode(
      Uint8Array.from(atob(body.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
    ));
    if (!payload.exp || Date.now() > payload.exp) return false;
  } catch (_) { return false; }
  return true;
}
