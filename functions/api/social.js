// functions/api/social.js
// Cloudflare Pages Function — POST /api/social
// Proxy for the Social Engine dashboard (/lab/social). Holds the service_role
// key server-side and forwards to Supabase. Every request must carry a valid
// token (Authorization: Bearer <token>) issued by /api/auth.
//
// READ ops:  queue, performance
// WRITE ops: approve, edit, reject, retry   (all auth-gated, service-key only)
//
// The browser never sends SQL or column names — each write op builds its own
// patch server-side, so a tampered request cannot set arbitrary fields. The
// only client-supplied values are `id` (uuid) and `text` (approved_text).
//
// Required env vars (already set for /api/projects — reused, nothing new):
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
  const op   = body.op;
  const base = `${env.SUPABASE_URL}/rest/v1/social_queue`;
  const headers = {
    'apikey': env.SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json'
  };

  try {
    // ── READS ────────────────────────────────────────────────────────
    if (op === 'queue') {
      const cols = 'id,platform,content_type,source_topic,post_text,approved_text,media_url,video_url,status,created_at,published_at,scheduled_for,updated_at,variant,style_tag,batch_id,client_id,error_detail';
      const r = await fetch(`${base}?select=${cols}&order=created_at.desc&limit=200`, { headers });
      return passthrough(r);
    }
    if (op === 'performance') {
      const cols = 'platform,source_topic,variant,style_tag,post_text,published_at,snapshot_date,reach,likes,comments,saved,shares,reactions,interactions,client_id';
      const r = await fetch(`${env.SUPABASE_URL}/rest/v1/social_performance?select=${cols}&order=snapshot_date.desc&limit=300`, { headers });
      return passthrough(r);
    }

    // ── WRITES ───────────────────────────────────────────────────────
    // All writes require a valid uuid id.
    if (op === 'approve' || op === 'edit' || op === 'reject' || op === 'retry') {
      const id = body.id;
      if (!isUuid(id)) return json({ error: 'Missing or invalid id' }, 400);
      const idFilter = `id=eq.${encodeURIComponent(id)}`;

      if (op === 'reject') {
        const r = await patch(base, idFilter, { status: 'rejected', updated_at: nowIso() }, headers);
        return r.ok ? json({ ok: true }) : json({ error: await r.text() }, r.status);
      }

      if (op === 'edit') {
        // Save edited copy without changing status. approved_text only.
        const text = typeof body.text === 'string' ? body.text : '';
        const r = await patch(base, idFilter, { approved_text: text, updated_at: nowIso() }, headers);
        return r.ok ? json({ ok: true }) : json({ error: await r.text() }, r.status);
      }

      if (op === 'retry') {
        // Only re-queues rows currently in `failed`. Clears the error.
        const r = await patch(
          base,
          `${idFilter}&status=eq.failed`,
          { status: 'approved', error_detail: null, updated_at: nowIso() },
          headers
        );
        if (!r.ok) return json({ error: await r.text() }, r.status);
        const rows = await r.json().catch(() => []);
        if (!rows.length) return json({ error: 'Row is not in a failed state' }, 409);
        return json({ ok: true });
      }

      // op === 'approve'
      // Setting status='approved' fires the pg_net publisher trigger.
      // Optionally save the edited text in the same update.
      const patchObj = { status: 'approved', updated_at: nowIso() };
      if (typeof body.text === 'string' && body.text.length) patchObj.approved_text = body.text;

      const upd = await patch(base, idFilter, patchObj, headers);
      if (!upd.ok) return json({ error: await upd.text() }, upd.status);
      const updated = await upd.json().catch(() => []);
      if (!updated.length) return json({ error: 'Post not found' }, 404);
      const row = updated[0];

      // A/B rule: retire sibling variants of the same draft still awaiting
      // approval. Keys come from the row we just read, never from the client.
      let retired = 0;
      if (row.batch_id && row.source_topic && row.platform && row.content_type) {
        const sibFilter =
          `batch_id=eq.${encodeURIComponent(row.batch_id)}` +
          `&platform=eq.${encodeURIComponent(row.platform)}` +
          `&source_topic=eq.${encodeURIComponent(row.source_topic)}` +
          `&content_type=eq.${encodeURIComponent(row.content_type)}` +
          `&status=eq.pending_approval` +
          `&id=neq.${encodeURIComponent(row.id)}`;
        const sib = await patch(base, sibFilter, { status: 'rejected', updated_at: nowIso() }, headers);
        if (sib.ok) { const sr = await sib.json().catch(() => []); retired = sr.length || 0; }
      }
      return json({ ok: true, retired });
    }

    return json({ error: 'Unknown op' }, 400);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
}

// PATCH social_queue with a PostgREST filter, returning the changed rows.
function patch(base, filter, patchObj, headers) {
  return fetch(`${base}?${filter}`, {
    method: 'PATCH',
    headers: { ...headers, 'Prefer': 'return=representation' },
    body: JSON.stringify(patchObj)
  });
}

async function passthrough(r) {
  const text = await r.text();
  return new Response(text || '[]', { status: r.status, headers: { 'Content-Type': 'application/json' } });
}

function isUuid(v) {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
function nowIso() { return new Date().toISOString(); }

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
