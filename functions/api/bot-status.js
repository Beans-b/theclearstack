// functions/api/bot-status.js
// Cloudflare Pages Function: /api/bot-status?app=agent|park
//
//   POST  from Brian's PC. Authorization: Bearer <BOT_PUSH_TOKEN>.
//         Body is the bot's page-safe snapshot (built by pmbot/share.py).
//         Stored in KV under status:<app>. Nothing else is written.
//   GET   from the /lab/bells page. Authorization: Bearer <session token>
//         issued by /api/bot-auth. Returns { agent: {...}|null, park: {...}|null }.
//
// Required bindings (Cloudflare Pages -> Settings):
//   BOT_STATUS          KV namespace (NEW)
//   BOT_PUSH_TOKEN      secret, long random string; same value as PMBOT_SHARE_TOKEN on the PC (NEW)
//   BOT_SESSION_SECRET  secret, long random string; MUST match bot-auth.js (NEW)
//
// Read only for viewers: there is no route here that can reach the bot.

const APPS = ['agent', 'park'];
const MAX_BYTES = 64000;

export async function onRequestPost({ request, env }) {
  const missingPost = missing(env, ['BOT_STATUS', 'BOT_PUSH_TOKEN']);
  if (missingPost.length) {
    return json({ error: 'Server not configured.', missing: missingPost }, 500);
  }
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || !(await timingSafeEqualStr(token, env.BOT_PUSH_TOKEN))) {
    return json({ error: 'Unauthorized' }, 401);
  }
  const app = new URL(request.url).searchParams.get('app') || '';
  if (!APPS.includes(app)) return json({ error: 'Unknown app' }, 400);

  const text = await request.text();
  if (text.length > MAX_BYTES) return json({ error: 'Too large' }, 413);
  let body;
  try { body = JSON.parse(text); } catch (_) { return json({ error: 'Bad JSON' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.schema_version !== 1) {
    return json({ error: 'Unexpected snapshot shape' }, 400);
  }
  body.received_at = new Date().toISOString();
  await env.BOT_STATUS.put('status:' + app, JSON.stringify(body));
  return new Response(null, { status: 204 });
}

export async function onRequestGet({ request, env }) {
  const missingGet = missing(env, ['BOT_STATUS', 'BOT_SESSION_SECRET']);
  if (missingGet.length) {
    return json({ error: 'Server not configured.', missing: missingGet }, 500);
  }
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!(await verifyToken(token, env.BOT_SESSION_SECRET))) {
    return json({ error: 'Unauthorized' }, 401);
  }
  const out = {};
  for (const app of APPS) {
    const raw = await env.BOT_STATUS.get('status:' + app);
    try { out[app] = raw ? JSON.parse(raw) : null; } catch (_) { out[app] = null; }
  }
  return json(out);
}

// ── helpers ──────────────────────────────────────────────────────────
// Names only (they are public in this repo), never values. "empty" means the
// binding exists but holds an empty string.
function missing(env, names) {
  const out = [];
  for (const n of names) {
    if (env[n] === undefined || env[n] === null) out.push(n + ' (not found)');
    else if (typeof env[n] === 'string' && env[n].length === 0) out.push(n + ' (empty)');
  }
  return out;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}

function b64url(bytes) {
  let bin = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return atob(s);
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
  if (!token || token.indexOf('.') < 0) return false;
  const [body, sig] = token.split('.');
  const expect = await hmac(body, secret);
  if (!(await timingSafeEqualStr(sig, expect))) return false;
  try {
    const payload = JSON.parse(b64urlDecode(body));
    return payload.aud === 'bells' && typeof payload.exp === 'number' && payload.exp > Date.now();
  } catch (_) {
    return false;
  }
}

async function timingSafeEqualStr(a, b) {
  const ha = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(a)));
  const hb = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(b)));
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha[i] ^ hb[i];
  return diff === 0;
}
