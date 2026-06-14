// functions/api/auth.js
// Cloudflare Pages Function — POST /api/auth
// Verifies the admin password and returns a short-lived signed session token.
// The Supabase service_role key NEVER appears here or anywhere client-side.
//
// Required env vars (Cloudflare Pages → Settings → Variables & Secrets):
//   CC_ADMIN_PASSWORD  – the password you type into the login modal (you already have this)
//   CC_SESSION_SECRET  – a long random string (NEW — add this; MUST match the one in projects.js)

export async function onRequestPost({ request, env }) {
  if (!env.CC_ADMIN_PASSWORD || !env.CC_SESSION_SECRET) {
    return json({ error: 'Server not configured (missing env vars).' }, 500);
  }

  let body = {};
  try { body = await request.json(); } catch (_) {}
  const password = (body && body.password) || '';

  // Constant-time compare so we don't leak length/contents via timing.
  if (!(await timingSafeEqualStr(password, env.CC_ADMIN_PASSWORD))) {
    return json({ error: 'Incorrect password' }, 401);
  }

  const token = await signToken({ exp: Date.now() + 8 * 60 * 60 * 1000 }, env.CC_SESSION_SECRET);
  return json({ ok: true, token });
}

// ── helpers ──────────────────────────────────────────────────────────
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

async function signToken(payload, secret) {
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig  = await hmac(body, secret);
  return `${body}.${sig}`;
}

async function timingSafeEqualStr(a, b) {
  // Hash both sides so the compare is fixed-length and content-independent.
  const ha = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(a)));
  const hb = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(b)));
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha[i] ^ hb[i];
  return diff === 0;
}
