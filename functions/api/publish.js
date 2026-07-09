// functions/api/publish.js
// Cloudflare Pages Function — POST /api/publish
// The Social Engine's server-side publisher. Called by the Supabase publish
// trigger (pg_net) the moment a post is approved. It verifies the shared
// secret, reads the row, posts to Facebook, and writes the result back to
// social_queue (published + platform_post_id, or failed + error_detail).
//
// Why server-side (not the Make "Helmsman"): Make custom variables do not
// resolve in this account, so the Helmsman's {{SUPABASE_SERVICE_KEY}} /
// {{APPROVAL_SECRET}} / {{FB_PAGE_ID}} would be empty. Running it here keeps
// every key in Cloudflare env — nothing in Make, nothing in Drive backups.
//
// Trigger payload (from social_queue_notify_publisher): { "id": <uuid>, "secret": <approval_secret> }
//
// Env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY   – already set (reused)
//   APPROVAL_SECRET                      – must equal engine_config.approval_secret
//   FB_PAGE_ID                           – numeric Facebook Page id
//   FB_PAGE_TOKEN                        – long-lived Page access token (pages_manage_posts)
//   FB_GRAPH_VERSION                     – optional, defaults below
//
// FB-first: only Facebook text posts publish here. Instagram and video are
// skipped cleanly (row stays 'approved') until those paths are wired.

const DEFAULT_GRAPH = 'v23.0';

export async function onRequestPost({ request, env }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return json({ error: 'Server not configured (missing Supabase env vars).' }, 500);
  }

  let body = {};
  try { body = await request.json(); } catch (_) {}

  // Secret gate — only the DB trigger (which knows the approval secret) may call this.
  if (!env.APPROVAL_SECRET || body.secret !== env.APPROVAL_SECRET) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const id = body.id;
  if (!isUuid(id)) return json({ error: 'Missing or invalid id' }, 400);

  const base = `${env.SUPABASE_URL}/rest/v1/social_queue`;
  const sb = {
    'apikey': env.SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json'
  };

  try {
    // 1) Read the row
    const rowRes = await fetch(`${base}?id=eq.${encodeURIComponent(id)}&select=*`, { headers: sb });
    if (!rowRes.ok) return json({ error: 'Row read failed', detail: (await rowRes.text()).slice(0, 300) }, 502);
    const rows = await rowRes.json();
    const row = Array.isArray(rows) && rows[0];
    if (!row) return json({ error: 'Row not found' }, 404);

    // 2) Idempotency — only act on rows still marked approved
    if (row.status !== 'approved') return json({ ok: true, skipped: `status is ${row.status}` });

    // 3) FB-first — other platforms not wired for auto-publish yet
    if (row.platform !== 'facebook') {
      return json({ ok: true, skipped: `platform '${row.platform}' not configured for auto-publish yet` });
    }
    if (!env.FB_PAGE_ID || !env.FB_PAGE_TOKEN) {
      await patchRow(base, sb, id, { error_detail: 'Facebook not configured (missing FB_PAGE_ID / FB_PAGE_TOKEN).', updated_at: nowIso() });
      return json({ error: 'Facebook not configured' }, 500);
    }

    // 4) Post to the Facebook Page feed
    const message = (row.approved_text && row.approved_text.trim()) || row.post_text || '';
    if (!message) {
      await patchRow(base, sb, id, { status: 'failed', error_detail: 'No text to publish.', updated_at: nowIso() });
      return json({ error: 'No text to publish' }, 400);
    }
    const gv = env.FB_GRAPH_VERSION || DEFAULT_GRAPH;
    const fbRes = await fetch(`https://graph.facebook.com/${gv}/${encodeURIComponent(env.FB_PAGE_ID)}/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, access_token: env.FB_PAGE_TOKEN })
    });
    const fb = await fbRes.json().catch(() => ({}));

    if (!fbRes.ok || !fb.id) {
      const detail = (fb && fb.error && fb.error.message) ? fb.error.message : ('HTTP ' + fbRes.status);
      await patchRow(base, sb, id, { status: 'failed', error_detail: 'Facebook publish failed: ' + String(detail).slice(0, 280), updated_at: nowIso() });
      return json({ ok: false, error: detail }, 502);
    }

    // 5) Mark published with the live post id
    await patchRow(base, sb, id, { status: 'published', platform_post_id: fb.id, published_at: nowIso(), updated_at: nowIso() });
    return json({ ok: true, platform_post_id: fb.id });
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
}

// ── helpers ──────────────────────────────────────────────────────────────
function patchRow(base, headers, id, patchObj) {
  return fetch(`${base}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...headers, 'Prefer': 'return=minimal' },
    body: JSON.stringify(patchObj)
  });
}
function isUuid(v) {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
function nowIso() { return new Date().toISOString(); }
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
