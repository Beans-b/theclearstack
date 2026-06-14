// functions/api/projects.js
// Cloudflare Pages Function — POST /api/projects
// The ONLY path that can write to the projects table. Holds the service_role
// key server-side and forwards CRUD to Supabase. Every request must carry a
// valid token (Authorization: Bearer <token>) issued by /api/auth.
//
// Required env vars:
//   SUPABASE_URL          – your project URL, https://...supabase.co (NEW — add this)
//   SUPABASE_SERVICE_KEY  – service_role key (you already have this; SERVER ONLY — never ship to browser)
//   CC_SESSION_SECRET     – NEW — add this; MUST match the value in auth.js

export async function onRequestPost({ request, env }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY || !env.CC_SESSION_SECRET) {
    return json({ error: 'Server not configured (missing env vars).' }, 500);
  }

  // 1) Auth gate
  const auth  = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!(await verifyToken(token, env.CC_SESSION_SECRET))) {
    return json({ error: 'Unauthorized' }, 401);
  }

  // 2) Parse op
  let body = {};
  try { body = await request.json(); } catch (_) {}
  const op   = body.op;
  const base = `${env.SUPABASE_URL}/rest/v1/projects`;
  const headers = {
    'apikey': env.SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json'
  };

  try {
    if (op === 'list') {
      const r = await fetch(`${base}?select=*&order=created_at.asc`, { headers });
      return passthrough(r);
    }
    if (op === 'insert') {
      const r = await fetch(base, {
        method: 'POST',
        headers: { ...headers, 'Prefer': 'return=representation' },
        body: JSON.stringify(sanitize(body.row || {}))
      });
      return passthrough(r);
    }
    if (op === 'update') {
      if (!body.id) return json({ error: 'Missing id' }, 400);
      const r = await fetch(`${base}?id=eq.${encodeURIComponent(body.id)}`, {
        method: 'PATCH',
        headers: { ...headers, 'Prefer': 'return=representation' },
        body: JSON.stringify(sanitize(body.patch || {}))
      });
      return passthrough(r);
    }
    if (op === 'delete') {
      if (!body.id) return json({ error: 'Missing id' }, 400);
      const r = await fetch(`${base}?id=eq.${encodeURIComponent(body.id)}`, {
        method: 'DELETE',
        headers: { ...headers, 'Prefer': 'return=minimal' }
      });
      return r.ok ? json({ ok: true }) : json({ error: await r.text() }, r.status);
    }
    return json({ error: 'Unknown op' }, 400);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
}

// Whitelist writable columns — a tampered request can't set arbitrary fields.
function sanitize(obj) {
  const allowed = ['name','category','status','notes','revenue','completion','effort','is_public','updated_at','created_at'];
  const out = {};
  for (const k of allowed) if (k in obj) out[k] = obj[k];
  return out;
}

async function passthrough(r) {
  const text = await r.text();
  return new Response(text || '[]', { status: r.status, headers: { 'Content-Type': 'application/json' } });
}

// ── helpers (same token scheme as auth.js) ───────────────────────────
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
  if (!body || !sig) return false;
  const expected = await hmac(body, secret);
  if (sig !== expected) return false;            // signature mismatch
  try {
    const payload = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')));
    if (!payload.exp || Date.now() > payload.exp) return false;  // expired
  } catch (_) { return false; }
  return true;
}
