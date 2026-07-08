// functions/api/generate.js
// Cloudflare Pages Function — POST /api/generate
// Server-side weekly content generator for the Social Engine. Replaces the
// Make "Weekly Generator v2" scenario: it calls Claude to write 3 LinkedIn
// drafts + 16 A/B platform variants, then writes them to Supabase. All keys
// stay server-side in Cloudflare env — nothing lives in Make or the browser.
//
// Trigger it from anything that can make one authenticated POST (e.g. a Make
// HTTP module on a weekly schedule). Two accepted auth methods:
//   1. Authorization: Bearer <token>  (token from /api/auth)
//   2. JSON body { "password": "<CC_ADMIN_PASSWORD>" }  (simplest for a cron)
//
// Env vars (already set in Cloudflare Pages — reused, nothing new):
//   ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY,
//   CC_SESSION_SECRET, CC_ADMIN_PASSWORD

const MODEL = 'claude-haiku-4-5';

const SYSTEM_DRAFTS = `You are T2 Content, the weekly content writer for The Clear Stack, an AI operations and SaaS consolidation consultancy for mid-market companies (50 to 500 employees), founded by Brian Burge in Santa Barbara, CA. You write 3 LinkedIn post drafts per week in Brian's voice: direct, first person, practical, specific. No fluff. Max 3 hashtags per post. Never use the word 'literally'. Avoid hyphens where a rephrase reads naturally. FACTS YOU MAY USE ABOUT BRIAN, this is the complete list: 1. He spent 22 years at Teledyne Marine. 2. There, he grew a product line to over $57M. 3. He built a channel of 50+ partners across 30 countries. You may also describe The Clear Stack's 4C Framework (Catalog, Consolidate, Connect, Coach) as a method. Never present it with results, client counts, or outcomes. HARD RULES, violating any of these makes the draft unusable: - NEVER invent clients, engagements, audits, conversations, or outcomes. The Clear Stack has no public case studies. Banned constructions include: 'a client', 'one of our clients', 'a company I worked with', 'I audited a company', 'a founder told me', and anything else implying a real engagement happened. - NEVER invent numbers. If a specific number would strengthen a post, write [CONFIRM: describe exactly what number is needed] in its place and set needs_confirm to true for that post. - Industry statistics are allowed ONLY with the source named inside the post text (publisher and year). If you are not certain of both the figure and its source, use [CONFIRM: stat needed + suggested source] instead. - Every post must be exactly one of: (a) an opinion voiced as opinion, (b) a how-to the reader can apply this week, (c) a sourced industry fact plus your analysis, (d) a lesson drawn only from the three Teledyne facts above. Respond ONLY with valid JSON, no markdown fences, no preamble. Do not use newline characters or double-quote characters inside any field value; use single quotes if you must quote. {"posts":[{"post_topic":"<5 words max>","post_draft":"<full post text>","content_basis":"opinion|howto|sourced_fact|teledyne","needs_confirm":<boolean>}]}`;

const USER_DRAFTS = `Generate 3 LinkedIn post drafts for this week. Each post must cover a DIFFERENT topic. Topic 1: AI tool consolidation and SaaS waste. Topic 2: Make.com automation and workflow efficiency. Topic 3: Mid-market operations and the cost of manual processes. Return the JSON object specified in the system prompt, nothing else.`;

const SYSTEM_VARIANTS = `You convert 3 approved LinkedIn drafts into platform native variants for A/B testing. You inherit every HARD RULE from the drafts: no invented clients, engagements, or numbers; [CONFIRM: x] placeholders wherever a real number is needed; industry stats only with the source named in the text. Do not add any factual claim that is not already in the source draft. STYLE TAGS: every variant carries style_tag, exactly one of: question_hook, stat_hook, story_hook, contrarian_hook, howto_hook. It names the opening device of the post. For EACH of the 3 drafts produce: - One X post (variant 'A'): under 260 characters, no URLs (X charges per post with a link). Set x_contains_link true only if a link is unavoidable. - TWO Instagram variants (variant 'A' and variant 'B') of the SAME draft: caption under 150 words with a hook first line. The two must open with DIFFERENT style_tag devices and read as different posts, not a light rewrite. Each includes media_prompt: one sentence of art direction describing a single conceptual illustration of the post's core idea, as an object, scene, or visual metaphor. No people needed, never any text inside the image. - TWO Facebook variants (variant 'A' and variant 'B'): 40 to 80 words, conversational, no hashtags, again two different style_tag devices. Then ONE TikTok/Reels video script (variant 'A', style_tag of its hook) from the strongest of the 3 topics: 30 to 45 seconds, spoken word count 80 to 110, structure hook / one idea / one takeaway, written to be read to camera. Put it in video_script; post_text carries its caption. Never use the word 'literally'. Do not use newline characters or double-quote characters inside any field value; use single quotes if you must quote. Respond ONLY with valid JSON, no markdown fences: {"variants":[{"source_topic":"...","platform":"x|instagram|facebook|tiktok","content_type":"text|image_caption|video_script","variant":"A|B","style_tag":"...","post_text":"...","media_prompt":"...","video_script":"...","x_contains_link":<boolean>}]} Exactly 16 variants: 3 x, 6 instagram, 6 facebook, 1 tiktok.`;

export async function onRequestPost({ request, env }) {
  if (!env.ANTHROPIC_API_KEY || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
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
    // 2) Draft 3 LinkedIn posts
    const draftsText = await claude(env, 2000, SYSTEM_DRAFTS, USER_DRAFTS);
    const drafts = extractJson(draftsText);
    const posts = Array.isArray(drafts && drafts.posts) ? drafts.posts : [];
    if (!posts.length) return json({ error: 'Draft step returned no posts', raw: draftsText.slice(0, 400) }, 502);

    // 3) Expand into 16 platform A/B variants (feed the raw draft JSON back in)
    const variantsText = await claude(env, 6000, SYSTEM_VARIANTS, draftsText);
    const parsedV = extractJson(variantsText);
    const variants = Array.isArray(parsedV && parsedV.variants) ? parsedV.variants : [];
    if (!variants.length) return json({ error: 'Variant step returned no variants', raw: variantsText.slice(0, 400) }, 502);

    const batchId = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }); // YYYY-MM-DD

    // 4) Write variants to social_queue (bulk insert, service key)
    const rows = variants.map(v => ({
      batch_id: batchId,
      source_topic: str(v.source_topic),
      platform: str(v.platform),
      content_type: str(v.content_type),
      post_text: str(v.post_text),
      media_prompt: v.media_prompt ? str(v.media_prompt) : null,
      video_script: v.video_script ? str(v.video_script) : null,
      variant: v.variant === 'B' ? 'B' : 'A',
      style_tag: v.style_tag ? str(v.style_tag) : null,
      x_contains_link: v.x_contains_link === true,
      client_id: 'clearstack',
      status: 'pending_approval'
    }));
    const sq = await sbInsert(env, 'social_queue', rows);
    if (!sq.ok) return json({ error: 'social_queue insert failed', detail: sq.detail }, 502);

    // 5) Write the LinkedIn drafts to content_queue
    const cqRows = posts.map(p => ({
      post_topic: str(p.post_topic),
      post_draft: str(p.post_draft),
      status: 'pending_approval'
    }));
    const cq = await sbInsert(env, 'content_queue', cqRows);
    // content_queue is secondary — report but don't fail the run if it errors
    return json({
      ok: true,
      batch_id: batchId,
      variants_inserted: rows.length,
      drafts_inserted: cq.ok ? cqRows.length : 0,
      content_queue_error: cq.ok ? null : cq.detail
    });
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
}

// ── Claude call ───────────────────────────────────────────────────────
async function claude(env, maxTokens, system, userContent) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userContent }]
    })
  });
  const data = await r.json();
  if (!r.ok) throw new Error('Anthropic ' + r.status + ': ' + JSON.stringify(data).slice(0, 300));
  const item = Array.isArray(data.content) ? data.content.find(c => c.type === 'text') : null;
  return (item && item.text) || '';
}

// ── Supabase bulk insert via PostgREST (service key) ───────────────────
async function sbInsert(env, table, rows) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(rows)
  });
  if (r.ok) return { ok: true };
  return { ok: false, detail: (await r.text()).slice(0, 400) };
}

// ── helpers ────────────────────────────────────────────────────────────
function str(v) { return v == null ? '' : String(v); }

// Robustly pull a JSON object out of a model response (handles fences / prose).
function extractJson(text) {
  if (!text) return null;
  let t = String(text).trim();
  // strip ```json ... ``` or ``` ... ``` fences
  if (t.indexOf('```') !== -1) {
    t = t.replace(/```json/gi, '```');
    const parts = t.split('```');
    for (const p of parts) { const c = p.trim(); if (c.startsWith('{')) { t = c; break; } }
  }
  try { return JSON.parse(t); } catch (_) {}
  const first = t.indexOf('{'), last = t.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try { return JSON.parse(t.slice(first, last + 1)); } catch (_) {}
  }
  return null;
}

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
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return b64url(sig);
}
async function verifyToken(token, secret) {
  if (!token || token.indexOf('.') === -1) return false;
  const [b, sig] = token.split('.');
  if (!b || !sig) return false;
  if (sig !== await hmac(b, secret)) return false;
  try { const p = JSON.parse(atob(b.replace(/-/g, '+').replace(/_/g, '/'))); if (!p.exp || Date.now() > p.exp) return false; } catch (_) { return false; }
  return true;
}
