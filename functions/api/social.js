// functions/api/social.js
// Cloudflare Pages Function — POST /api/social
// Read-only proxy for the Social Engine dashboard (/lab/social). Holds the
// service_role key server-side and forwards SELECTs to Supabase. Every request
// must carry a valid token (Authorization: Bearer <token>) issued by /api/auth.
// Writes (approve/retry) are intentionally NOT exposed yet — add ops here later.
//
// Required env vars (already set for /api/projects — reused, nothing new to add):
//   SUPABASE_URL          – https://...supabase.co
//   SUPABASE_SERVICE_KEY  – service_role key (SERVER ONLY — never ship to browser)
//   CC_SESSION_SECRET     – must match the value in auth.js / projects.js

export async function onRequestPost({ request, env }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY || !env.CC_SESSION_SECRET) {
    return json({ error: 'Server not configured (missing env vars).' }, 500);
  }

  // 1) Auth gate — same signed-token scheme as /api/projects
  const auth  = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!(await verifyToken(token, env.CC_SESSION_SECRET))) {
    return json({ error: 'Unauthorized' }, 401);
  }

  // 2) Parse op
  let body = {};
  try { body = await request.json(); } catch (_) {}
  const op = body.op;
  const headers = {
    'apikey': env.SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json'
  };

  try {
    if (op === 'queue') {
      const cols = 'id,platform,content_type,source_topic,post_text,approved_text,media_url,video_url,status,created_at,published_at,updated_at,variant,style_tag,batch_id,client_id,error_detail';
      const r = await fetch(`${env.SUPABASE_URL}/rest/v1/social_queue?select=${cols}&order=created_at.desc&limit=200`, { headers });
      return passthrough(r);
    }
    if (op === 'performance') {
      const cols = 'platform,source_topic,variant,style_tag,post_text,published_at,snapshot_date,reach,likes,comments,saved,shares,reactions,interactions,client_id';
      const r = await fetch(`${env.SUPABASE_URL}/rest/v1/social_performance?select=${cols}&order=published_at.desc&limit=100`, { headers });
      return passthrough(r);
    }
    return json({ error: 'Unknown op' }, 400);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
}

async function passthrough(r) {
  const text = await r.text();
  return new Response(text || '[]', { status: r.status, headers: { 'Content-Type': 'application/json' } });
}

// ── helpers (identical token scheme to auth.js / projects.js) ─────────
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
  if (sig !== expected) return false;
  try {
    const payload = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')));
    if (!payload.exp || Date.now() > payload.exp) return false;
  } catch (_) { return false; }
  return true;
}
