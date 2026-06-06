// Cloudflare Pages Function — /api/auth
// Verifies CC_ADMIN_PASSWORD env var, returns a session token
// Token is HMAC-based, valid for current + previous 5-min window (10 min max drift)

export async function onRequestPost(context) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  try {
    const body = await context.request.json();
    const { password } = body;

    if (!password) {
      return new Response(JSON.stringify({ error: 'No password provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const adminPassword = context.env.CC_ADMIN_PASSWORD;
    if (!adminPassword) {
      return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    if (password !== adminPassword) {
      // Small delay to slow brute force
      await new Promise(r => setTimeout(r, 400));
      return new Response(JSON.stringify({ error: 'Incorrect password' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // Generate HMAC token: sign current 5-min bucket with the password as key
    const bucket = Math.floor(Date.now() / 300000); // changes every 5 min
    const token  = await hmacSign(adminPassword, String(bucket));

    // Also include service_role key for admin Supabase access
    const serviceKey = context.env.SUPABASE_SERVICE_KEY;

    return new Response(JSON.stringify({ token, serviceKey }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: 'Server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

async function hmacSign(secret, message) {
  const enc  = new TextEncoder();
  const key  = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig  = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2,'0')).join('');
}
