// ============================================================
// Cloudflare Pages Function — GET /lab/engine-room/burn
// Deploy path in your repo: functions/lab/engine-room/burn.js
//
// Purpose: the browser NEVER holds a Supabase key. This function
// runs server-side at Cloudflare's edge, reads the SERVICE key from
// an environment variable, calls the locked-down engine_room_burn
// RPC, and returns the aggregated JSON.
//
// Fails CLOSED: it requires a Cloudflare Access identity header.
// If this route is not yet behind Access, there is no header, so it
// returns 403 and leaks nothing. Set up Access before real numbers
// mean anything (steps in the chat).
//
// Required Cloudflare env vars (Pages → Settings → Environment vars):
//   SUPABASE_URL          e.g. https://aicnfrbafeydlrkvsprd.supabase.co
//   SUPABASE_SERVICE_KEY  the service_role key (mark as a Secret)
// Optional:
//   ALLOWED_EMAILS        comma-separated allowlist, e.g. brianburge@gmail.com
// ============================================================

const RANGE_MS = {
  '24h': 24 * 60 * 60 * 1000,
  '7d':  7  * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  'all': 100 * 365 * 24 * 60 * 60 * 1000,
};

export async function onRequestGet(context) {
  const { request, env } = context;

  // --- auth: fail closed ---
  const email = request.headers.get('Cf-Access-Authenticated-User-Email');
  if (!email) {
    return json({ error: 'Not authenticated. This route must sit behind Cloudflare Access.' }, 403);
  }
  const allow = (env.ALLOWED_EMAILS || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (allow.length && !allow.includes(email.toLowerCase())) {
    return json({ error: 'Not authorized.' }, 403);
  }

  // --- config guard ---
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return json({ error: 'Server not configured (missing SUPABASE_URL or SUPABASE_SERVICE_KEY).' }, 500);
  }

  // --- window ---
  const range = new URL(request.url).searchParams.get('range') || '7d';
  const ms = RANGE_MS[range] ?? RANGE_MS['7d'];
  const since = new Date(Date.now() - ms).toISOString();

  // --- call the locked-down RPC with the service key (server-side only) ---
  try {
    const upstream = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/engine_room_burn`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ since }),
    });
    if (!upstream.ok) {
      return json({ error: 'Upstream error', status: upstream.status, detail: await upstream.text() }, 502);
    }
    const data = await upstream.json(); // the jsonb bundle from the RPC
    return new Response(JSON.stringify(data), {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  } catch (e) {
    return json({ error: 'Fetch failed', detail: String(e) }, 502);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
