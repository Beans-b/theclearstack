/**
 * Cloudflare Pages Function — SeaStateZero Proxy
 * File: functions/api/seastatezero.js
 * Route: POST /api/seastatezero
 *
 * Receives a stack-analysis request from lab/seastatezero.html, validates it,
 * and forwards it server-side to the Make.com SeaStateZero engine webhook
 * (scenario 5387699). Unlike /api/submit (fire-and-forget), this proxy WAITS
 * for the engine's full 4C JSON response (~30s) and pipes it back to the page.
 *
 * Why a proxy: a direct browser fetch to hook.us2.make.com fails CORS preflight,
 * and the Anthropic API key must never touch the browser. The key lives only
 * inside the Make HTTP module; this proxy only ever talks to the Make webhook.
 *
 * REQUIRED environment variables (Cloudflare Pages → Settings → Variables and Secrets):
 *   SEASTATEZERO_WEBHOOK_URL      — the Make.com SeaStateZero engine hook URL (type: Secret)
 *   MAKECOM_INBOUND_WEBHOOK_URL   — your existing inbound-lead hook (reused for capture)
 *   MAKECOM_WEBHOOK_API_KEY       — Make-native API key, sent as x-make-apikey header
 *                                   (same key/pattern as /api/submit; reused here)
 *
 * TWO ACTIONS (hybrid funnel):
 *   action:"analyze" — runs the engine, returns the 4C report (no PII required).
 *   action:"capture" — fires the captured lead (name + email + company size + stack
 *                      context) into the EXISTING inbound pipeline with source tag
 *                      "seastatezero", so it lands in the same Supabase/HubSpot/SeaLegs
 *                      flow as the contact form. Returns quickly (fire-and-forget).
 *
 * AUTH SEQUENCING (build approach "a"): the x-make-apikey header is wired in now
 * but HARMLESS until you enable API Key Authentication on the seastatezero-trigger
 * webhook in Make. Enable that as the final pre-launch step. Until then, Make
 * ignores the header and the proxy works without it — lets you test the page now.
 */

const ALLOWED_ORIGIN = "https://theclearstack.com";

// Engine is ~30s; allow generous headroom but well under Make's 180s response ceiling.
const ENGINE_TIMEOUT_MS = 60000;

export async function onRequestPost(context) {
  const { request, env } = context;

  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  };

  // --- Parse request body (JSON only; the page always sends JSON) ---
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ success: false, error: "Invalid request body." }, 400, headers);
  }

  // --- Route on action: "capture" (lead) vs "analyze" (engine, default) ---
  if (data.action === "capture") {
    return handleCapture(data, env, headers);
  }

  // --- Honeypot check (bots fill hidden fields, humans don't) ---
  // Silently accept so bots don't learn they were caught — never calls the engine.
  if (data._hp && String(data._hp).trim() !== "") {
    return json({ success: true, bot: true }, 200, headers);
  }

  // --- Validation: tool_data is the only truly required field for the manual path ---
  // The page enforces manual-only for v1 (paste box required), but we re-check
  // server-side so the engine never fires on an empty / trivial submission.
  const toolData = (data.tool_data || "").trim();
  if (toolData.length < 15) {
    return json(
      {
        success: false,
        error:
          "Please paste your tool list so we have something real to analyze.",
      },
      422,
      headers
    );
  }

  // --- Build the 7-field engine contract (source-agnostic webhook) ---
  // v1 is manual-only: input_type is forced to "manual". Domain (if given) is
  // light context only — it is NOT used to trigger an unfulfillable scan.
  const payload = {
    input_type: "manual",
    domain: clean(data.domain),
    company: clean(data.company),
    employees: clean(data.employees),
    industry: clean(data.industry),
    notes: clean(data.notes),
    tool_data: toolData,
  };

  // --- Resolve env config ---
  const webhookUrl = env.SEASTATEZERO_WEBHOOK_URL;
  const webhookApiKey = env.MAKECOM_WEBHOOK_API_KEY;
  if (!webhookUrl) {
    console.error("Missing SEASTATEZERO_WEBHOOK_URL env var.");
    return json({ success: false, error: "Server configuration error." }, 500, headers);
  }

  // --- Forward to the Make engine and WAIT for the full 4C JSON body ---
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ENGINE_TIMEOUT_MS);

  let engineText;
  try {
    const outboundHeaders = { "Content-Type": "application/json" };
    // Wired now, enforced by Make only after you enable webhook auth (step "enable last").
    if (webhookApiKey) outboundHeaders["x-make-apikey"] = webhookApiKey;

    const makeResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: outboundHeaders,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!makeResponse.ok) {
      console.error(`SeaStateZero engine returned ${makeResponse.status}`);
      return json(
        { success: false, error: "The analysis engine is busy. Please try again." },
        502,
        headers
      );
    }

    engineText = await makeResponse.text();
  } catch (err) {
    if (err.name === "AbortError") {
      console.error("SeaStateZero engine timed out.");
      return json(
        { success: false, error: "The analysis took too long. Please try again." },
        504,
        headers
      );
    }
    console.error("SeaStateZero engine fetch failed:", err);
    return json(
      { success: false, error: "Network error reaching the engine. Please try again." },
      502,
      headers
    );
  } finally {
    clearTimeout(timeout);
  }

  // --- Validate the engine returned real 4C JSON, not a bare ack ("Accepted") ---
  // The Make Webhook Response module returns the parsed report as the body. If we
  // get something that isn't JSON (e.g. an async ack), surface a clean error so the
  // page shows the retry + booking fallback instead of trying to render garbage.
  let report;
  try {
    report = JSON.parse(engineText);
  } catch {
    console.error("Engine returned non-JSON body:", engineText.slice(0, 200));
    return json(
      { success: false, error: "The engine returned an unexpected response. Please try again." },
      502,
      headers
    );
  }

  // Minimal shape guard — confirm it's actually a SeaStateZero report.
  if (!report || typeof report !== "object" || !("summary" in report) || !("catalog" in report)) {
    console.error("Engine JSON missing expected SeaStateZero fields.");
    return json(
      { success: false, error: "The engine returned an incomplete report. Please try again." },
      502,
      headers
    );
  }

  // --- Success: pipe the 4C report straight through to the page ---
  return json({ success: true, report }, 200, headers);
}

// Handle preflight OPTIONS requests
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

// --- Lead capture: fire into the EXISTING inbound pipeline with source tag ---
async function handleCapture(data, env, headers) {
  const firstName = clean(data.first_name);
  const email = clean(data.email).toLowerCase();
  const companySize = clean(data.company_size);

  // Validate the 3 gate fields.
  if (!firstName) {
    return json({ success: false, error: "Please add your first name." }, 422, headers);
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return json({ success: false, error: "Please enter a valid work email." }, 422, headers);
  }
  if (!companySize) {
    return json({ success: false, error: "Please select your company size." }, 422, headers);
  }

  const inboundUrl = env.MAKECOM_INBOUND_WEBHOOK_URL;
  const webhookApiKey = env.MAKECOM_WEBHOOK_API_KEY;
  if (!inboundUrl) {
    console.error("Missing MAKECOM_INBOUND_WEBHOOK_URL env var.");
    return json({ success: false, error: "Server configuration error." }, 500, headers);
  }

  // Domain from the work email — same enrichment key /api/submit uses.
  const prospect_domain = email.split("@")[1] ? email.split("@")[1].toLowerCase() : "";

  // Payload shaped to slot into the existing inbound flow. source tag lets Make
  // branch SeaStateZero leads (e.g. different nurture) without a new scenario.
  const payload = {
    source: "seastatezero",
    submitted_at: new Date().toISOString(),
    first_name: firstName,
    last_name: "",
    email,
    company_name: clean(data.company),
    company_size: companySize,
    industry: clean(data.industry) || null,
    prospect_domain,
    // the stack context the visitor pasted — high-value qualifying signal
    tool_data: clean(data.tool_data) || null,
    notes: clean(data.notes) || null,
  };

  try {
    const outboundHeaders = { "Content-Type": "application/json" };
    if (webhookApiKey) outboundHeaders["x-make-apikey"] = webhookApiKey;

    const res = await fetch(inboundUrl, {
      method: "POST",
      headers: outboundHeaders,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.error(`Inbound capture webhook returned ${res.status}`);
      // Don't block the unlock — the report still shows. Log and report soft failure.
      return json({ success: true, captured: false }, 200, headers);
    }
  } catch (err) {
    console.error("Inbound capture fetch failed:", err);
    return json({ success: true, captured: false }, 200, headers);
  }

  return json({ success: true, captured: true }, 200, headers);
}

// --- helpers ---
function clean(v) {
  return v == null ? "" : String(v).trim();
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers });
}
