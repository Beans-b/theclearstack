// functions/api/marketing.js  —  Cloudflare Pages Function
// Endpoint becomes:  POST /api/marketing   (same origin as your site)
//
// Backs lab/marketing-dashboard.html. One call per action:
//   action:"positioning"  -> { statement }
//   action:"calendar"     -> [ {day,platform,best_time,copy,image_brief} x3 ]
//   action:"seo"          -> { title, meta_description, h1, faqs:[{q,a}] }
// Output is chunked on purpose (one positioning line, one week of 3 posts, or
// one page of SEO per request) so responses never truncate.
//
// SECRETS — set these in Cloudflare Pages > your project > Settings > Variables and secrets
//   ANTHROPIC_API_KEY        (Secret)  your Anthropic key. NEVER goes in the HTML.
//   TURNSTILE_SECRET_KEY     (Secret)  Cloudflare Turnstile secret key.
//   MAKE_THANKYOU_WEBHOOK    (Plain or Secret)  the Make custom-webhook URL that
//                            sends the thank-you email. If unset, the thank-you
//                            step is simply skipped (non-fatal).
//   HUBSPOT_TOKEN            (Secret)  private-app token for lead capture. Optional.
//
// OPTIONAL — KV namespace bindings (Settings > Functions > KV namespace bindings):
//   RL      rate-limit counters (per-IP + global, per UTC day). If unbound, limiter is skipped.
//   LEADS   stores captured emails. If unbound, capture is skipped (user still gets results).
//
// Anything in this file runs on Cloudflare's server and is NEVER sent to the browser.

const MODEL = "claude-sonnet-4-6";
const ANTHROPIC_VERSION = "2023-06-01";

// Lock the endpoint to your own sites so other pages can't spend your tokens.
// Add your *.pages.dev preview URL here while testing if you want previews to work.
const ALLOWED_ORIGINS = [
  "https://theclearstack.com",
  "https://www.theclearstack.com",
  "https://theclearstack.ai",
  "https://www.theclearstack.ai"
];

// Rate limits (only enforced if a KV namespace is bound as RL). Counted per UTC calendar day.
// Higher than the single-shot tools because this dashboard generates in chunks: one
// positioning line, then a week of posts and a page of SEO are separate calls.
const USER_LIMIT = 20;      // generations per IP per day
const GLOBAL_LIMIT = 120;   // generations across ALL users per day — your hard daily spend lid
const RL_TTL = 172800;      // KV key lifetime in seconds (2 days), so day-keys auto-clean up

// Per-action depth + the exact JSON shape Claude must return. Server-side only.
const ACTION_CONFIG = {
  positioning: {
    max_tokens: 400,
    schema: '{ "statement": "..." }',
    instruction:
      "Write ONE positioning statement: a single short sentence naming who this business serves and the promise it makes. Plain words, no jargon."
  },
  calendar: {
    max_tokens: 1200,
    schema: '[ { "day": "...", "platform": "...", "best_time": "...", "copy": "...", "image_brief": "..." } ]  (exactly 3 objects)',
    instruction:
      "Write exactly 3 social media posts for one week. Spread them across different days. " +
      "platform is one real platform name (Instagram, Facebook, etc.) that fits this business and audience. " +
      "best_time is a day part and time, for example 'Tuesday 11am'. " +
      "copy is the ready to post caption in plain words. " +
      "image_brief describes the picture to make: subject, style, and any text overlay."
  },
  seo: {
    max_tokens: 1200,
    schema: '{ "title": "...", "meta_description": "...", "h1": "...", "faqs": [ { "q": "...", "a": "..." } ] }',
    instruction:
      "Write the search text for ONE website page. SEO means helping a page show up in search; " +
      "AEO means helping it show up in answers from AI assistants. " +
      "title is under 60 characters. meta_description is under 155 characters. " +
      "Include 3 or 4 FAQs that real customers would ask."
  }
};

// Shared writing rules baked into every system prompt so the tone stays consistent
// and honest no matter which action runs.
const HOUSE_RULES =
  "You write plain marketing for a small business owner who knows nothing about marketing. " +
  "Use plain words and define any term like SEO in the same breath. Use few or no hyphens. " +
  "Do not invent statistics, prices, reviews, or any numbers. " +
  "Return JSON only. No preamble, no commentary, no markdown code fences. ";

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders }
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isEmail(s) { return EMAIL_RE.test(s) && s.length <= 254; }
function hasLeadCookie(request) {
  const c = request.headers.get("Cookie") || "";
  return /(?:^|;\s*)cs_lead=1(?:;|$)/.test(c);
}

// Build the business context block from the saved intake so every generation is
// specific to this business. Missing fields are marked, never guessed.
function businessContext(intake) {
  intake = intake || {};
  const g = (v) => (v && String(v).trim()) ? String(v).trim() : "(not given)";
  return [
    "Here is the business:",
    "Business name: " + g(intake.name),
    "Website: " + g(intake.website),
    "What they sell: " + g(intake.sell),
    "Industry: " + g(intake.industry),
    "Target customer age: " + g(intake.age),
    "Location: " + g(intake.location),
    "Customer gender: " + (intake.gender ? String(intake.gender).trim() : "All / not relevant"),
    "Monthly budget: " + g(intake.budget)
  ].join("\n");
}

// Defensive parse: strip any ``` fences, grab the first {...} or [...] block,
// then JSON.parse inside try/catch. Returns null on any failure.
function parseModelJSON(text) {
  let cleaned = String(text || "").trim();
  cleaned = cleaned.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
  const first = cleaned.search(/[\[{]/);
  if (first > 0) cleaned = cleaned.slice(first);
  try { return JSON.parse(cleaned); }
  catch { return null; }
}

// Create or update a HubSpot contact by email, tagged with where the lead came from.
// Create sets the source; if the contact already exists (409), PATCH updates it by email.
// Fully non-fatal — lead capture must never block on a CRM hiccup.
async function pushToHubSpot(token, email, source) {
  const headers = { "content-type": "application/json", "authorization": "Bearer " + token };
  try {
    const res = await fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
      method: "POST",
      headers,
      body: JSON.stringify({ properties: { email, lead_source: source } })
    });
    if (res.status === 409) {
      await fetch("https://api.hubapi.com/crm/v3/objects/contacts/" + encodeURIComponent(email) + "?idProperty=email", {
        method: "PATCH",
        headers,
        body: JSON.stringify({ properties: { lead_source: source } })
      });
    }
  } catch { /* non-fatal */ }
}

// Fire-and-forget POST to a Make custom webhook so Make sends the thank-you email
// (Gmail, brian@theclearstack.com). Fully non-fatal — the user's result must never
// block or fail because of this background notification. The x-make-apikey header
// matches the API-key guard on the Make webhook so only this Function can trigger
// the scenario. The key is your standard stack guard; it lives server-side only and
// is never sent to the browser.
async function notifyMakeThankYou(url, email) {
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-make-apikey": "12DmiDdYXQyTx4"
      },
      body: JSON.stringify({ email })
    });
  } catch { /* non-fatal */ }
}

// Only POST is handled; any other method gets 405 automatically.
export async function onRequestPost(context) {
  const { request, env } = context;

  // 1) Origin / referer lock
  const origin = request.headers.get("Origin") || "";
  const referer = request.headers.get("Referer") || "";
  const originOk = ALLOWED_ORIGINS.some(o => origin === o || referer.startsWith(o));
  if (ALLOWED_ORIGINS.length && !originOk) {
    return json({ error: "This tool can only be used from theclearstack.com." }, 403);
  }

  // 2) Parse + validate input
  let body;
  try { body = await request.json(); }
  catch { return json({ error: "Bad request." }, 400); }

  const action = String(body.action || "").trim();
  const cfg = ACTION_CONFIG[action];
  if (!cfg) return json({ error: "Unknown action." }, 400);

  const intake = body.intake || {};
  const businessName = String(intake.name || "").trim();
  const sell = String(intake.sell || "").trim();
  if (!businessName || !sell) {
    return json({ error: "Fill in your business name and what you sell first." }, 400);
  }

  const pageName = String(body.pageName || "").trim();
  if (action === "seo" && !pageName) {
    return json({ error: "Add a page name or address first." }, 400);
  }
  const weekNo = Math.max(1, parseInt(body.weekNo, 10) || 1);

  const token = String(body.token || "");
  const email = String(body.email || "").trim().toLowerCase();

  const ip = request.headers.get("CF-Connecting-IP") || "anon";

  // 3) Turnstile human-check (skipped only if no secret is configured)
  if (env.TURNSTILE_SECRET_KEY) {
    const form = new FormData();
    form.append("secret", env.TURNSTILE_SECRET_KEY);
    form.append("response", token);
    if (ip !== "anon") form.append("remoteip", ip);
    let vr;
    try {
      const v = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify",
        { method: "POST", body: form });
      vr = await v.json();
    } catch {
      return json({ error: "Verification service unavailable. Try again." }, 502);
    }
    if (!vr.success) {
      return json({ error: "Human check failed. Refresh the page and try again." }, 403);
    }
  }

  // 3b) Email gate — required once per user, then remembered via cookie.
  const known = hasLeadCookie(request);
  let setCookie = null;
  if (!known) {
    if (!isEmail(email)) {
      return json({ need_email: true, error: "Enter your email to unlock your first result." }, 200);
    }
    // Store the lead. Keyed by email, so the same person never creates a duplicate.
    // Non-fatal if no storage is bound — the user still gets their result.
    if (env.LEADS) {
      try {
        const k = "lead:" + email;
        const prev = await env.LEADS.get(k);
        const now = new Date().toISOString();
        const rec = prev ? JSON.parse(prev) : { email, first_seen: now, count: 0 };
        rec.count = (rec.count || 0) + 1;
        rec.last_seen = now;
        await env.LEADS.put(k, JSON.stringify(rec));
      } catch { /* non-fatal: don't block the user on a storage hiccup */ }
    }
    // Send the new lead to HubSpot, tagged with its source. Runs in the background
    // (waitUntil) so it never slows the user's response; non-fatal on failure.
    if (env.HUBSPOT_TOKEN) {
      context.waitUntil(pushToHubSpot(env.HUBSPOT_TOKEN, email, "Marketing Dashboard — theclearstack.com/lab/marketing-dashboard"));
    }
    // Tell Make to send the thank-you email. Same first-capture gate as the HubSpot
    // push, same background pattern (waitUntil), same non-fatal contract. Only fires
    // when MAKE_THANKYOU_WEBHOOK is configured, so deploys without the env var are safe.
    if (env.MAKE_THANKYOU_WEBHOOK) {
      context.waitUntil(notifyMakeThankYou(env.MAKE_THANKYOU_WEBHOOK, email));
    }
    // Remember this user for a year. Not HttpOnly so the page can hide the email
    // field on return visits; it carries no sensitive data (just "cs_lead=1").
    setCookie = "cs_lead=1; Max-Age=31536000; Path=/; Secure; SameSite=Lax";
  }

  // 4) Rate limits — per-IP and global, per day (only if KV namespace RL is bound)
  if (env.RL) {
    const day = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
    const userKey = "rlu:" + ip + ":" + day;
    const globalKey = "rlg:" + day;

    let uCount = 0, gCount = 0;
    try { uCount = parseInt((await env.RL.get(userKey)) || "0", 10) || 0; } catch { uCount = 0; }
    try { gCount = parseInt((await env.RL.get(globalKey)) || "0", 10) || 0; } catch { gCount = 0; }

    if (uCount >= USER_LIMIT) {
      return json({ error: `You've reached your daily limit of ${USER_LIMIT} generations. Please come back tomorrow.` }, 429);
    }
    if (gCount >= GLOBAL_LIMIT) {
      return json({ error: "The marketing dashboard has reached today's overall limit. Please check back tomorrow." }, 429);
    }

    // Passed both — count this generation against both buckets.
    try { await env.RL.put(userKey, String(uCount + 1), { expirationTtl: RL_TTL }); } catch { /* non-fatal */ }
    try { await env.RL.put(globalKey, String(gCount + 1), { expirationTtl: RL_TTL }); } catch { /* non-fatal */ }
  }

  // 5) Key present?
  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: "Server is not configured yet." }, 500);
  }

  // 6) Build the prompt for this action and call Claude (key + version live here, server-side)
  const systemPrompt =
    HOUSE_RULES +
    "Return exactly this JSON shape and nothing else: " + cfg.schema;

  let userMsg = businessContext(intake) + "\n\n" + cfg.instruction;
  if (action === "calendar") {
    userMsg += "\n\nThis is week " + weekNo + ". Vary the angle from a typical week.";
  } else if (action === "seo") {
    userMsg += '\n\nWrite the sheet for this one page: "' + pageName + '".';
  }
  userMsg += "\n\nReturn the JSON now.";

  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": ANTHROPIC_VERSION
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: cfg.max_tokens,
        system: systemPrompt,
        messages: [{ role: "user", content: userMsg }]
      })
    });
  } catch {
    return json({ error: "Couldn't reach the model. Try again." }, 502);
  }

  if (!res.ok) {
    let detail = "";
    try { detail = (await res.text()).slice(0, 200); } catch { /* ignore */ }
    return json({ error: "Generation failed.", detail }, 502);
  }

  const data = await res.json();
  const text = (data.content || [])
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("\n")
    .trim();

  if (!text) return json({ error: "The model returned an empty response." }, 502);

  // 7) Parse defensively on the server so the page always gets clean structured data.
  const result = parseModelJSON(text);
  if (result === null) {
    return json({ error: "We could not read the result. Please try again." }, 502);
  }

  // Light per-action sanity check so a malformed shape becomes a friendly retry,
  // not a broken render on the page.
  const shapeOk =
    (action === "positioning" && result && typeof result.statement === "string") ||
    (action === "calendar" && (Array.isArray(result) || Array.isArray(result.posts))) ||
    (action === "seo" && result && typeof result.title === "string");
  if (!shapeOk) {
    return json({ error: "We could not read the result. Please try again." }, 502);
  }

  const payload = action === "calendar"
    ? (Array.isArray(result) ? result : result.posts)
    : result;

  const headers = setCookie ? { "Set-Cookie": setCookie } : {};
  return json({ action, result: payload, captured: !known }, 200, headers);
}
