/**
 * Cloudflare Pages Function — Inbound Lead Handler
 * File: functions/api/submit.js
 * Route: POST /api/submit
 *
 * Receives contact form submissions from contact.html,
 * validates input, and fires the Make.com inbound lead webhook.
 * Make.com handles all downstream actions: Supabase, HubSpot, Brian notification, T2 Research trigger.
 *
 * REQUIRED environment variable (set in Cloudflare Pages dashboard → Settings → Environment Variables):
 *   MAKECOM_INBOUND_WEBHOOK_URL — your Make.com webhook URL (treat as a secret)
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

  // --- Required field validation ---
  const required = ["first_name", "last_name", "email", "company_name", "company_size"];
  for (const field of required) {
    if (!data[field] || data[field].trim() === "") {
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
    source: "inbound_form",
    submitted_at: new Date().toISOString(),
    first_name: data.first_name.trim(),
    last_name: data.last_name.trim(),
    email: data.email.trim().toLowerCase(),
    company_name: data.company_name.trim(),
    company_size: data.company_size,
    industry: data.industry || null,
    monthly_ai_spend: data.monthly_ai_spend || null,
    pain_point: data.pain_point ? data.pain_point.trim() : null,
    prospect_domain,
  };

  // --- Fire Make.com webhook ---
  const webhookUrl = env.MAKECOM_INBOUND_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error("MAKECOM_INBOUND_WEBHOOK_URL is not set.");
    return new Response(
      JSON.stringify({ success: false, error: "Server configuration error." }),
      { status: 500, headers }
    );
  }

  try {
    const makeResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
