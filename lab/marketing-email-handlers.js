/**
 * Marketing Dashboard — email capture + send handlers
 * Merge into your existing /api/marketing handler (Cloudflare Worker or Pages Function).
 *
 * ONE-TIME SETUP
 * 1. Sign up at resend.com (free: 3,000 emails/mo, 100/day) and verify theclearstack.com
 *    — add the SPF + DKIM DNS records Resend shows you (your DNS is already on Cloudflare).
 * 2. Store the API key as a secret:
 *      npx wrangler secret put RESEND_API_KEY
 *    (Pages: Settings → Environment variables → add RESEND_API_KEY, encrypted)
 * 3. Create a KV namespace to log every lead:
 *      npx wrangler kv namespace create LEADS
 *    and bind it as LEADS (wrangler.toml, or Pages → Settings → Functions → KV bindings).
 * 4. Optional: set OWNER_EMAIL (plain env var) to get a copy of every captured lead.
 * 5. In your existing /api/marketing request handler, after you parse the JSON body, add:
 *
 *      if (body.action === "export")   return handleExport(body, env);
 *      if (body.action === "waitlist") return handleWaitlist(body, env);
 *
 *    and paste everything below into the same file (or import it).
 *
 * WHAT THE FRONT END SENDS
 *   export:   { action:"export",   email, intake:{name,sell,...}, plan:{positioning, weeks:[[{day,platform,best_time,copy,image_brief}]], seoPages:[{pageName,data:{title,meta_description,h1,faqs:[{q,a}]}}]}, token }
 *   waitlist: { action:"waitlist", email, module }
 *
 * The front end treats {sent:true} or {ok:true} as success; anything else falls back
 * to the print/PDF path, so shipping this half-configured never breaks the page.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}

function escHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Log a lead to KV. Never throws — logging must not break the user flow. */
async function logLead(env, type, email, extra) {
  try {
    if (!env.LEADS) return;
    const key = `${type}:${Date.now()}:${email}`;
    await env.LEADS.put(key, JSON.stringify({
      type, email,
      at: new Date().toISOString(),
      ...(extra || {}),
    }));
  } catch (e) { /* swallow */ }
}

/** Send one email via Resend. Returns true on success. */
async function sendEmail(env, { to, bcc, subject, html }) {
  if (!env.RESEND_API_KEY) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "The Clear Stack <plans@theclearstack.com>",
        to: [to],
        ...(bcc ? { bcc: [bcc] } : {}),
        subject,
        html,
      }),
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

/** Build the plan email body (email-safe inline styles only). */
function buildPlanHtml(intake, plan) {
  const i = intake || {};
  const p = plan || {};
  const navy = "#0B1F4A", orange = "#E07B2A", gray = "#5A6478";
  let h = `<div style="font-family:Georgia,serif;max-width:640px;margin:0 auto;color:#1A1A1A">
  <p style="font-family:monospace;font-size:11px;letter-spacing:2px;color:${orange};text-transform:uppercase">The Clear Stack · Marketing Dashboard</p>
  <h1 style="color:${navy};font-size:26px;margin:0 0 4px">${escHtml(i.name || "Your business")} — marketing plan</h1>
  <p style="color:${gray};font-size:14px;margin:0 0 20px">${escHtml(i.sell || "")}</p>`;

  if (p.positioning) {
    h += `<h2 style="color:${navy};font-size:18px;border-top:1px solid #ddd;padding-top:14px">Positioning</h2>
    <p style="font-size:17px;color:${navy};font-style:italic;line-height:1.5">"${escHtml(p.positioning)}"</p>`;
  }
  (p.weeks || []).forEach((week, wi) => {
    h += `<h2 style="color:${navy};font-size:18px;border-top:1px solid #ddd;padding-top:14px">Social posts — week ${wi + 1}</h2>`;
    (week || []).forEach((post) => {
      h += `<p style="font-family:monospace;font-size:11px;color:${gray};margin:14px 0 2px">${escHtml(post.day)} · ${escHtml(post.platform)} · ${escHtml(post.best_time)}</p>
      <p style="font-size:14px;line-height:1.55;margin:0 0 4px;white-space:pre-wrap">${escHtml(post.copy)}</p>
      <p style="font-size:12px;color:${gray};font-style:italic;margin:0">Image brief: ${escHtml(post.image_brief)}</p>`;
    });
  });
  (p.seoPages || []).forEach((pg) => {
    const d = pg.data || {};
    h += `<h2 style="color:${navy};font-size:18px;border-top:1px solid #ddd;padding-top:14px">SEO &amp; AEO — ${escHtml(pg.pageName)}</h2>
    <p style="font-size:14px"><b>Title:</b> ${escHtml(d.title || "")}</p>
    <p style="font-size:14px"><b>Meta description:</b> ${escHtml(d.meta_description || "")}</p>
    <p style="font-size:14px"><b>H1:</b> ${escHtml(d.h1 || "")}</p>`;
    (d.faqs || []).forEach((f) => {
      h += `<p style="font-size:13px;margin:8px 0"><b>${escHtml(f.q)}</b><br>${escHtml(f.a)}</p>`;
    });
  });

  h += `<div style="background:${navy};border-radius:10px;padding:18px 20px;margin-top:26px">
    <p style="color:#F7F4EF;font-size:14px;line-height:1.55;margin:0 0 10px"><b>Like what it wrote?</b> This is a fraction of what a stack audit finds. We map your tools, cut the waste, and wire the rest together — typical result: $94K–$220K a year in identified savings.</p>
    <a href="https://theclearstack.com/contact.html?utm_source=plan_email&utm_medium=email&utm_campaign=md-export" style="background:${orange};color:${navy};font-weight:bold;font-size:14px;padding:10px 20px;border-radius:8px;text-decoration:none;display:inline-block">Book the free 30-min audit</a>
  </div>
  <p style="color:${gray};font-size:11px;margin-top:18px">You received this because you exported your plan from the free Marketing Dashboard at theclearstack.com. We won't email you again unless you ask us to.</p>
  </div>`;
  return h;
}

/** action: "export" — log the lead and email the plan. */
async function handleExport(body, env) {
  const email = String(body.email || "").trim();
  if (!EMAIL_RE.test(email)) return json({ error: "Please enter a valid email." }, 400);

  const intake = body.intake || {};
  await logLead(env, "export", email, {
    business: intake.name || "",
    sell: intake.sell || "",
    industry: intake.industry || "",
    location: intake.location || "",
  });

  const sent = await sendEmail(env, {
    to: email,
    bcc: env.OWNER_EMAIL || undefined, // you get a copy of every plan = every lead
    subject: `Your marketing plan — ${intake.name || "your business"}`,
    html: buildPlanHtml(intake, body.plan),
  });

  // sent:false → front end falls back to the print/PDF path; the lead is still logged.
  return json({ ok: true, sent });
}

/** action: "waitlist" — log which "coming soon" module they want; notify you. */
async function handleWaitlist(body, env) {
  const email = String(body.email || "").trim();
  const module_ = String(body.module || "").slice(0, 80);
  if (!EMAIL_RE.test(email)) return json({ error: "Please enter a valid email." }, 400);

  await logLead(env, "waitlist", email, { module: module_ });

  if (env.OWNER_EMAIL) {
    await sendEmail(env, {
      to: env.OWNER_EMAIL,
      subject: `Waitlist signup: ${module_}`,
      html: `<p><b>${escHtml(email)}</b> wants the <b>${escHtml(module_)}</b> module.</p>`,
    });
  }
  return json({ ok: true });
}

/*
 * READING YOUR LEADS
 * Dashboard: Cloudflare → Workers & Pages → KV → LEADS → "View" (keys are export:<ts>:<email> / waitlist:<ts>:<email>)
 * CLI:       npx wrangler kv key list --namespace-id <id>
 * If OWNER_EMAIL is set you also get every lead in your inbox — zero dashboards needed.
 */

// If your /api/marketing is a Cloudflare Pages Function and you prefer a separate module:
// export { handleExport, handleWaitlist };
