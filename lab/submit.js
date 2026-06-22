/**
 * Cloudflare Pages Function — Inbound Lead Handler
 * File: functions/api/submit.js
 * Route: POST /api/submit
 *
 * Receives lead submissions from contact.html AND the Stack Analyzer gate
 * (lab/stack-analyzer.html), validates input, and fires the Make.com inbound
 * lead webhook. Make.com handles downstream: Supabase, HubSpot, Brian
 * notification, T2 Research trigger.
 *
 * Two lead shapes are accepted, distinguished by `source`:
 *   - "inbound_form"     (contact.html) — requires company_size.
 *   - "stack_analyzer"   (analyzer gate) — name + email + company only;
 *                         carries provenance + the entered tools/overlaps.
 *
 * No secrets ever reach the browser. The Make webhook URL + key live only
 * in env vars here.
 *
 * REQUIRED environment variables (Cloudflare Pages → Settings → Environment Variables):
 *   MAKECOM_INBOUND_WEBHOOK_URL — your Make.com webhook URL (treat as a secret)
 *   MAKECOM_WEBHOOK_API_KEY     — API key sent as x-make-apikey header to authenticate with Make.com
 */

export async function onRequestPost(context) {
  const { request, env } = context;

  // --- CORS headers (same-origin only) ---
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "https://theclearstack.com",
  };

  // --- Parse form data ---
  let data;
  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      data = await request.json();
    } else {
      const formData = await request.formData();
      data = Object.fromEntries(formData.entries());
    }
  } catch {
    return new Response(
      JSON.stringify({ success: false, error: "Invalid request body." }),
      { status: 400, headers }
    );
  }

  // --- Honeypot check (bots fill hidden fields, humans don't) ---
  if (data._hp && data._hp.trim() !== "") {
    // Silently accept so bots don't know they were caught
    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
  }

  // --- Which lead shape is this? ---
  const source = (data.source || "inbound_form").toString().trim() || "inbound_form";
  const isAnalyzer = source === "stack_analyzer";

  // --- Required field validation (analyzer asks fewer fields) ---
  const required = isAnalyzer
    ? ["first_name", "email", "company_name"]
    : ["first_name", "last_name", "email", "company_name", "company_size"];
  for (const field of required) {
    if (!data[field] || data[field].toString().trim() === "") {
      return new Response(
        JSON.stringify({ success: false, error: `Missing required field: ${field}` }),
        { status: 422, headers }
      );
    }
  }

  // --- Basic email format check ---
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(data.email)) {
    return new Response(
      JSON.stringify({ success: false, error: "Invalid email address." }),
      { status: 422, headers }
    );
  }

  // --- Extract domain from work email (used by T2 Research for stack scan) ---
  const prospect_domain = data.email.split("@")[1].toLowerCase();

  // --- Build payload for Make.com ---
  const payload = {
    source,
    submitted_at: new Date().toISOString(),
    first_name: (data.first_name || "").trim(),
    last_name: (data.last_name || "").trim(),
    email: data.email.trim().toLowerCase(),
    company_name: data.company_name.trim(),
    company_size: data.company_size || null,
    industry: data.industry || null,
    monthly_ai_spend: data.monthly_ai_spend || null,
    pain_point: data.pain_point ? data.pain_point.trim() : null,
    prospect_domain,

    // --- Provenance: where the lead came from (page + form + campaign) ---
    source_page: data.source_page || null,
    source_url: data.source_url || null,
    source_form: data.source_form || null,
    referrer: data.referrer || null,
    utm: data.utm || null,

    // --- Stack Analyzer extras (null for the contact form) ---
    tools: Array.isArray(data.tools) ? data.tools : null,
    redundancies: Array.isArray(data.redundancies) ? data.redundancies : null,
  };

  // --- Fire Make.com webhook ---
  const webhookUrl = env.MAKECOM_INBOUND_WEBHOOK_URL;
  const webhookApiKey = env.MAKECOM_WEBHOOK_API_KEY;
  if (!webhookUrl || !webhookApiKey) {
    console.error("Missing MAKECOM_INBOUND_WEBHOOK_URL or MAKECOM_WEBHOOK_API_KEY env var.");
    return new Response(
      JSON.stringify({ success: false, error: "Server configuration error." }),
      { status: 500, headers }
    );
  }

  try {
    const makeResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-make-apikey": webhookApiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!makeResponse.ok) {
      console.error(`Make.com webhook returned ${makeResponse.status}`);
      return new Response(
        JSON.stringify({ success: false, error: "Upstream error. Please try again." }),
        { status: 502, headers }
      );
    }
  } catch (err) {
    console.error("Webhook fetch failed:", err);
    return new Response(
      JSON.stringify({ success: false, error: "Network error. Please try again." }),
      { status: 502, headers }
    );
  }

  return new Response(JSON.stringify({ success: true }), { status: 200, headers });
}

// Handle preflight OPTIONS requests
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "https://theclearstack.com",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
