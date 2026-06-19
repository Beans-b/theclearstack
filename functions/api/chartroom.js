// functions/api/chartroom.js  —  Cloudflare Pages Function
// Endpoint becomes:  POST /api/chartroom   (same origin as your site)
//
// SECRETS — set these in Cloudflare Pages > your project > Settings > Variables and secrets
//   ANTHROPIC_API_KEY     (Secret)  your Anthropic key. NEVER goes in the HTML.
//   TURNSTILE_SECRET_KEY  (Secret)  Cloudflare Turnstile secret key.
//
// OPTIONAL — for in-code rate limiting, create a KV namespace and bind it as "RL"
//   Settings > Functions > KV namespace bindings  ->  Variable name: RL
//   (If RL is not bound, the limiter is simply skipped. You can also use the
//    dashboard's WAF rate-limiting rules instead — see SETUP.md.)
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

// Rate limit (only enforced if a KV namespace is bound as RL)
const RL_LIMIT = 20;       // max generations
const RL_WINDOW = 3600;    // per this many seconds (3600 = 1 hour) per IP

// Per-mode depth. Lives server-side so the method isn't copyable from the page.
const MODE_CONFIG = {
  simple:  { max_tokens: 600,
    guidance: "Depth = SIMPLE. Keep it lean: a one-line OBJECTIVE, 2-3 GOALS, a short GROUNDING RULE, a compact SUCCESS CONDITION, and a compressed LOOP. Keep the last three sections to one line each." },
  average: { max_tokens: 1100,
    guidance: "Depth = AVERAGE. Balanced detail: all eight sections present, a few goals, a clear verify step. No padding." },
  expert:  { max_tokens: 2000,
    guidance: "Depth = EXPERT. Full rigor: precise OBJECTIVE, numbered GOALS, a strict GROUNDING RULE, a checkable SUCCESS CONDITION as bullets, and a complete THE LOOP with an explicit skeptical VERIFY checklist (a/b/c/d). Make ON CAP, ON SUCCESS, and CORRECTION CAPTURE concrete." }
};

// The engine. Server-side only — this is the IP you didn't want copied.
const SYSTEM_PROMPT =
`You are Chartroom, a meta-prompt generator. The user describes a task. You output ONE copy-paste-ready task-prompt that instructs a separate AI to perform that task. Write it in this exact 8-section, self-verifying format, using these plain headers in this order:

OBJECTIVE
GOALS
GROUNDING RULE
SUCCESS CONDITION
THE LOOP
ON CAP REACHED
ON SUCCESS
CORRECTION CAPTURE

Section meanings:
- OBJECTIVE: one sentence naming the single deliverable.
- GOALS: numbered concrete sub-goals that define the work.
- GROUNDING RULE: what every claim/output must be backed by (sources, tests, given materials) so nothing is invented.
- SUCCESS CONDITION: a checkable list defining "done".
- THE LOOP: a. DRAFT  b. VERIFY as a skeptical checker who did not write it  c. REVISE  d. repeat b-c until SUCCESS CONDITION holds or a stated cap of passes is reached.
- ON CAP REACHED: stop, present the solid parts, list exactly what failed verification and why, ask the specific question(s) needed, then wait.
- ON SUCCESS: present the result plus a one-line verification log, then ask "Confirmed, or send back with corrections?".
- CORRECTION CAPTURE: restate any correction as a single reusable rule that can be pasted back into the prompt.

Rules: Output ONLY the prompt itself. No preamble, no commentary, no markdown code fences, no surrounding quotes. Tailor every section to the user's specific task.`;

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

  const task = String(body.task || "").trim();
  const mode = String(body.mode || "average");
  const token = String(body.token || "");
  const email = String(body.email || "").trim().toLowerCase();

  if (!task) return json({ error: "Add a task description first." }, 400);
  if (task.length > 4000) return json({ error: "Task is too long (max 4000 characters)." }, 400);
  const cfg = MODE_CONFIG[mode] || MODE_CONFIG.average;

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
    // Remember this user for a year. Not HttpOnly so the page can hide the email
    // field on return visits; it carries no sensitive data (just "cs_lead=1").
    setCookie = "cs_lead=1; Max-Age=31536000; Path=/; Secure; SameSite=Lax";
  }

  // 4) Optional per-IP rate limit (only if KV namespace RL is bound)
  if (env.RL) {
    const key = "rl:" + ip;
    let cur = 0;
    try { cur = parseInt((await env.RL.get(key)) || "0", 10) || 0; } catch { cur = 0; }
    if (cur >= RL_LIMIT) {
      return json({ error: "You've hit the limit for now. Try again later." }, 429);
    }
    try { await env.RL.put(key, String(cur + 1), { expirationTtl: RL_WINDOW }); } catch { /* non-fatal */ }
  }

  // 5) Key present?
  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: "Server is not configured yet." }, 500);
  }

  // 6) Call Claude (key + version live here, server-side)
  const userMsg =
    "TASK TO BUILD A PROMPT FOR:\n" + task +
    "\n\n" + cfg.guidance +
    "\nGenerate the task-prompt now in the 8-section format.";

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
        system: SYSTEM_PROMPT,
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
  const headers = setCookie ? { "Set-Cookie": setCookie } : {};
  return json({ prompt: text, captured: !known }, 200, headers);
}
