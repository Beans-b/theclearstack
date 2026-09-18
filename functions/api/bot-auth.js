// functions/api/bot-auth.js
// Cloudflare Pages Function: POST /api/bot-auth
// Checks the shared viewer password for /lab/bells and returns a 12 hour
// signed session token (audience "bells"). Separate from the admin password
// on purpose: this one is given to friends and family.
//
// Required bindings (Cloudflare Pages -> Settings):
//   BOT_VIEW_PASSWORD   secret, the password you give viewers (NEW)
//   BOT_SESSION_SECRET  secret, long random string; MUST match bot-status.js (NEW)
// Optional:
//   RL                  KV namespace (already bound for other Lab tools); limits
//                       failed attempts to 10 per IP per hour.

const MAX_FAILS = 10;

export async function onRequestPost({ request, env }) {
  const miss = [];
  for (const n of ['BOT_VIEW_PASSWORD', 'BOT_SESSION_SECRET']) {
    if (env[n] === undefined || env[n] === null) miss.push(n + ' (not found)');
    else if (typeof env[n] === 'string' && env[n].length === 0) miss.push(n + ' (empty)');
  }
  if (miss.length) {
    // Names only (public in this repo), never values.
    return json({ error: 'Server not configured.', missing: miss }, 500);
  }
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const hour = new Date().toISOString().slice(0, 13);
  const failKey = 'bells-fail:' + ip + ':' + hour;
  let fails = 0;
  if (env.RL) {
    try { fails = parseInt((await env.RL.get(failKey)) || '0', 10) || 0; } catch { fails = 0; }
    if (fails >= MAX_FAILS) return json({ error: 'Too many attempts. Try again later.' }, 429);
  }

  let body = {};
  try { body = await request.json(); } catch (_) {}
  const password = (body && typeof body.password === 'string') ? body.password : '';

  if (!(await timingSafeEqualStr(password, env.BOT_VIEW_PASSWORD))) {
    if (env.RL) {
      try { await env.RL.put(failKey, String(fails + 1), { expirationTtl: 3700 }); } catch { /* non-fatal */ }
    }
    return json({ error: 'Incorrect password' }, 401);
  }
  const token = await signToken(
    { aud: 'bells', exp: Date.now() + 12 * 60 * 60 * 1000 },
    env.BOT_SESSION_SECRET
  );
  return json({ ok: true, token });
}

// ── helpers ──────────────────────────────────────────────────────────
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
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
  const sig = await hmac(body, secret);
  return `${body}.${sig}`;
}

async function timingSafeEqualStr(a, b) {
  const ha = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(a)));
  const hb = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(b)));
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha[i] ^ hb[i];
  return diff === 0;
}
