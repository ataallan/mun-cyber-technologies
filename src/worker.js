var COOKIE_NAME = "mun_session";
var SESSION_IDLE_SEC = 30 * 60;
var SESSION_MAX_AGE_SEC = SESSION_IDLE_SEC;
var PBKDF2_ITERATIONS = 1e5;
var SALT_BYTES = 16;
var SESSION_TOKEN_BYTES = 32;
var MFA_CHALLENGE_TTL_MS = 5 * 60 * 1e3;
var PASSWORD_RESET_TTL_MS = 60 * 60 * 1e3;
var TOTP_PERIOD = 30;
var TOTP_DIGITS = 6;
var TOTP_WINDOW = 1;
var TOTP_SECRET_BYTES = 20;
var FIRST_ADMIN_EMAIL = "info@muncyber.com";
var pendingSessionCookie = null;
function takePendingSessionCookie() {
  const c = pendingSessionCookie;
  pendingSessionCookie = null;
  return c;
}
function withSecurityHeaders(res, { isHttps }) {
  const headers = new Headers(res.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Frame-Options", "SAMEORIGIN");
  if (isHttps) {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Force HTTPS — plain HTTP makes Safari show the "Not Secure" / ! warning
    if (url.protocol === "http:") {
      url.protocol = "https:";
      return Response.redirect(url.toString(), 301);
    }
    const isHttps = url.protocol === "https:";
    if (url.pathname.startsWith("/api/")) {
      try {
        pendingSessionCookie = null;
        const res = await handleApi(request, env, url);
        const refresh = takePendingSessionCookie();
        const headers = new Headers(res.headers);
        if (refresh) headers.append("Set-Cookie", refresh);
        headers.set("X-Content-Type-Options", "nosniff");
        headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
        headers.set("X-Frame-Options", "SAMEORIGIN");
        if (isHttps) {
          headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
        }
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
      } catch (err) {
        pendingSessionCookie = null;
        console.error("API error:", err);
        return withSecurityHeaders(json({ error: "Internal server error" }, 500), { isHttps });
      }
    }
    if (env.ASSETS) {
      // html_handling=none: serve exact files. Map clean URLs to *.html ourselves
      // (avoids 307 loops from auto-trailing-slash).
      const path = url.pathname.replace(/\/+$/, "") || "/";
      const looksLikeFile = /\.[a-zA-Z0-9]{1,12}$/.test(path);
      let assetPath = path;
      if (path === "/") {
        assetPath = "/index.html";
      } else if (!looksLikeFile && !path.startsWith("/api/")) {
        assetPath = path + ".html";
      }
      const assetUrl = new URL(request.url);
      assetUrl.pathname = assetPath;
      // Use GET for asset lookup even on HEAD
      const assetReq = new Request(assetUrl.toString(), {
        method: request.method === "HEAD" ? "HEAD" : "GET",
        headers: request.headers,
        redirect: "manual",
      });
      let assetRes = await env.ASSETS.fetch(assetReq);
      if (assetRes.status === 404 && assetPath !== path && path !== "/") {
        // Unknown clean URL → branded 404 page
        const notFoundUrl = new URL(request.url);
        notFoundUrl.pathname = "/404.html";
        assetRes = await env.ASSETS.fetch(new Request(notFoundUrl.toString(), { method: "GET", redirect: "manual" }));
        if (assetRes.status === 200) {
          return withSecurityHeaders(new Response(assetRes.body, { status: 404, headers: assetRes.headers }), { isHttps });
        }
      }
      return withSecurityHeaders(assetRes, { isHttps });
    }
    return withSecurityHeaders(new Response("Not found", { status: 404 }), { isHttps });
  }
};
async function handleApi(request, env, url) {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();
  if (path === "/api/health" && method === "GET") {
    return json({ ok: true, ts: new Date().toISOString() }, 200);
  }
  if (path === "/api/client-error" && method === "POST") {
    return clientErrorBeacon(request);
  }
  if (path === "/api/signup" && method === "POST") {
    return signup(request, env);
  }
  if (path === "/api/signin" && method === "POST") {
    return signin(request, env);
  }
  if (path === "/api/signout" && method === "POST") {
    return signout(request, env);
  }
  if (path === "/api/me" && method === "GET") {
    return me(request, env);
  }
  if (path === "/api/mfa/setup" && method === "POST") {
    return mfaSetup(request, env);
  }
  if (path === "/api/mfa/enable" && method === "POST") {
    return mfaEnable(request, env);
  }
  if (path === "/api/mfa/verify" && method === "POST") {
    return mfaVerify(request, env);
  }
  if (path === "/api/products" && method === "GET") {
    return listPublicProducts(env);
  }
  if (path === "/api/orders" && method === "POST") {
    return createOrder(request, env);
  }
  if (path === "/api/service-checkout" && method === "POST") {
    return createServiceCheckout(request, env, url);
  }
  if (path === "/api/service-payment-outcome" && method === "POST") {
    return applyServicePaymentOutcome(request, env);
  }
  if (path === "/api/chat" && method === "POST") {
    return chatPost(request, env);
  }
  if (path === "/api/chat" && method === "GET") {
    return chatGetHistory(request, env, url);
  }
  if (path === "/api/forgot-password" && method === "POST") {
    return forgotPassword(request, env, url);
  }
  if (path === "/api/reset-password" && method === "POST") {
    return resetPassword(request, env);
  }
  if (path.startsWith("/api/admin/")) {
    return handleAdminApi(request, env, path, method);
  }
  return json({ error: "Not found" }, 404);
}
async function signup(request, env) {
  const body = await parseJson(request);
  if (!body)
    return json({ error: "Invalid JSON body" }, 400);
  const name = String(body.name || "").trim();
  const password = String(body.password || "");
  const organization = String(body.organization || "").trim() || null;
  const method = String(body.method || "").trim().toLowerCase();
  let email = null;
  let phone = null;
  if (body.email != null && String(body.email).trim() !== "") {
    email = normalizeEmail(body.email);
  }
  if (body.phone != null && String(body.phone).trim() !== "") {
    const phoneResult = normalizePhone(body.phone);
    if (!phoneResult.ok) {
      return json({ error: phoneResult.error }, 400);
    }
    phone = phoneResult.phone;
  }
  if (method === "email")
    phone = null;
  if (method === "phone")
    email = null;
  if (!name || !password) {
    return json({ error: "Name and password are required" }, 400);
  }
  if (!email && !phone) {
    return json({ error: "Provide an email address or a phone number (+country code)" }, 400);
  }
  if (email && !isValidEmail(email)) {
    return json({ error: "Invalid email address" }, 400);
  }
  const passwordError = validatePasswordStrength(password);
  if (passwordError) {
    return json({ error: passwordError }, 400);
  }
  if (email) {
    const existingEmail = await env.DB.prepare(
      "SELECT id FROM users WHERE email = ?"
    ).bind(email).first();
    if (existingEmail) {
      return json({ error: "An account with this email already exists" }, 409);
    }
  }
  if (phone) {
    const existingPhone = await env.DB.prepare(
      "SELECT id FROM users WHERE phone = ?"
    ).bind(phone).first();
    if (existingPhone) {
      return json({ error: "An account with this phone number already exists" }, 409);
    }
  }
  const id = crypto.randomUUID();
  const salt = randomHex(SALT_BYTES);
  const password_hash = await hashPassword(password, salt);
  const created_at = (/* @__PURE__ */ new Date()).toISOString();
  const role = email && email === FIRST_ADMIN_EMAIL ? "admin" : "customer";
  await env.DB.prepare(
    `INSERT INTO users (id, email, phone, password_hash, salt, name, organization, created_at, mfa_enabled, role, disabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0)`
  ).bind(id, email, phone, password_hash, salt, name, organization, created_at, role).run();
  const user = publicUser({
    id,
    name,
    email,
    phone,
    organization,
    mfa_enabled: 0,
    role
  });
  const token = await createSession(env, id, 0);
  return json(
    { user, mfa_setup_required: true },
    201,
    sessionCookieHeader(token, SESSION_MAX_AGE_SEC)
  );
}
async function signin(request, env) {
  const body = await parseJson(request);
  if (!body)
    return json({ error: "Invalid JSON body" }, 400);
  const password = String(body.password || "");
  const identifierRaw = body.identifier != null ? String(body.identifier) : body.email != null ? String(body.email) : body.phone != null ? String(body.phone) : "";
  if (!identifierRaw.trim() || !password) {
    return json({ error: "Email or phone and password are required" }, 400);
  }
  const lookup = resolveLoginIdentifier(identifierRaw);
  if (!lookup.ok) {
    return json({ error: lookup.error }, 400);
  }
  let row;
  if (lookup.kind === "email") {
    row = await env.DB.prepare(
      `SELECT id, email, phone, password_hash, salt, name, organization,
              mfa_enabled, role, disabled, totp_secret
       FROM users WHERE email = ?`
    ).bind(lookup.value).first();
  } else {
    row = await env.DB.prepare(
      `SELECT id, email, phone, password_hash, salt, name, organization,
              mfa_enabled, role, disabled, totp_secret
       FROM users WHERE phone = ?`
    ).bind(lookup.value).first();
  }
  if (!row) {
    return json({ error: "Invalid email/phone or password" }, 401);
  }
  if (row.disabled) {
    return json({ error: "This account has been disabled" }, 403);
  }
  const ok = await verifyPassword(password, row.salt, row.password_hash);
  if (!ok) {
    return json({ error: "Invalid email/phone or password" }, 401);
  }
  await ensureFirstAdmin(env, row);
  const user = publicUser(row);
  if (!row.mfa_enabled) {
    const token = await createSession(env, row.id, 0);
    return json(
      { user, mfa_setup_required: true },
      200,
      sessionCookieHeader(token, SESSION_MAX_AGE_SEC)
    );
  }
  const challengeId = crypto.randomUUID();
  const expires = new Date(Date.now() + MFA_CHALLENGE_TTL_MS).toISOString();
  await env.DB.prepare(
    "INSERT INTO mfa_challenges (id, user_id, expires_at) VALUES (?, ?, ?)"
  ).bind(challengeId, row.id, expires).run();
  return json({ mfa_required: true, challenge_id: challengeId }, 200);
}
async function signout(request, env) {
  const token = getCookie(request, COOKIE_NAME);
  if (token) {
    const sessionId = await hashToken(token);
    await env.DB.prepare("DELETE FROM sessions WHERE session_id = ?").bind(sessionId).run();
  }
  return new Response(null, {
    status: 204,
    headers: {
      "Set-Cookie": clearSessionCookieHeader()
    }
  });
}
async function me(request, env) {
  const session = await sessionFromRequest(request, env);
  if (!session) {
    return json({ error: "Unauthorized" }, 401);
  }
  if (session.user.disabled) {
    return json({ error: "This account has been disabled" }, 403);
  }
  await ensureFirstAdmin(env, session.user);
  const user = publicUser(session.user);
  const mfa_setup_required = session.full_access === 0;
  return json({ user, mfa_setup_required }, 200);
}
async function mfaSetup(request, env) {
  const session = await sessionFromRequest(request, env);
  if (!session) {
    return json({ error: "Unauthorized" }, 401);
  }
  if (session.user.disabled) {
    return json({ error: "This account has been disabled" }, 403);
  }
  if (session.user.mfa_enabled) {
    return json({ error: "MFA is already enabled" }, 400);
  }
  let secret = session.user.totp_secret;
  if (!secret) {
    secret = generateTotpSecret();
    await env.DB.prepare("UPDATE users SET totp_secret = ? WHERE id = ?").bind(secret, session.user.id).run();
  }
  const accountLabel = totpAccountLabel(session.user);
  const otpauth_url = "otpauth://totp/MUN%20Cyber:" + encodeURIComponent(accountLabel) + "?secret=" + secret + "&issuer=MUN%20Cyber&algorithm=SHA1&digits=6&period=30";
  return json({ otpauth_url, secret }, 200);
}
async function mfaEnable(request, env) {
  const session = await sessionFromRequest(request, env);
  if (!session) {
    return json({ error: "Unauthorized" }, 401);
  }
  if (session.user.disabled) {
    return json({ error: "This account has been disabled" }, 403);
  }
  if (session.user.mfa_enabled) {
    return json({ error: "MFA is already enabled" }, 400);
  }
  const body = await parseJson(request);
  if (!body)
    return json({ error: "Invalid JSON body" }, 400);
  const code = String(body.code || "").trim();
  if (!/^\d{6}$/.test(code)) {
    return json({ error: "Enter the 6-digit code from your authenticator app" }, 400);
  }
  let secret = session.user.totp_secret;
  if (!secret) {
    return json({ error: "Call MFA setup first to generate a secret" }, 400);
  }
  const valid = await verifyTotp(secret, code);
  if (!valid) {
    return json({ error: "Invalid authenticator code" }, 401);
  }
  await env.DB.prepare(
    "UPDATE users SET mfa_enabled = 1 WHERE id = ?"
  ).bind(session.user.id).run();
  await env.DB.prepare(
    "UPDATE sessions SET full_access = 1 WHERE session_id = ?"
  ).bind(session.session_id).run();
  session.user.mfa_enabled = 1;
  await ensureFirstAdmin(env, session.user);
  const user = publicUser(session.user);
  return json({ user, mfa_setup_required: false }, 200);
}
async function mfaVerify(request, env) {
  const body = await parseJson(request);
  if (!body)
    return json({ error: "Invalid JSON body" }, 400);
  const challengeId = String(body.challenge_id || "").trim();
  const code = String(body.code || "").trim();
  if (!challengeId || !/^\d{6}$/.test(code)) {
    return json({ error: "challenge_id and a 6-digit code are required" }, 400);
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const challenge = await env.DB.prepare(
    "SELECT id, user_id, expires_at FROM mfa_challenges WHERE id = ?"
  ).bind(challengeId).first();
  if (!challenge) {
    return json({ error: "Invalid or expired MFA challenge" }, 401);
  }
  if (challenge.expires_at < now) {
    await env.DB.prepare("DELETE FROM mfa_challenges WHERE id = ?").bind(challengeId).run();
    return json({ error: "MFA challenge expired. Sign in again." }, 401);
  }
  const row = await env.DB.prepare(
    `SELECT id, email, phone, name, organization, mfa_enabled, role, disabled, totp_secret
     FROM users WHERE id = ?`
  ).bind(challenge.user_id).first();
  if (!row || row.disabled) {
    await env.DB.prepare("DELETE FROM mfa_challenges WHERE id = ?").bind(challengeId).run();
    return json({ error: "This account has been disabled" }, 403);
  }
  if (!row.mfa_enabled || !row.totp_secret) {
    return json({ error: "MFA is not enabled for this account" }, 400);
  }
  const valid = await verifyTotp(row.totp_secret, code);
  if (!valid) {
    return json({ error: "Invalid authenticator code" }, 401);
  }
  await env.DB.prepare("DELETE FROM mfa_challenges WHERE id = ?").bind(challengeId).run();
  await ensureFirstAdmin(env, row);
  const token = await createSession(env, row.id, 1);
  const user = publicUser(row);
  return json(
    { user, mfa_setup_required: false },
    200,
    sessionCookieHeader(token, SESSION_MAX_AGE_SEC)
  );
}
async function forgotPassword(request, env, url) {
  const rate = checkForgotPasswordRateLimit(request);
  if (rate) return rate;
  const body = await parseJson(request);
  if (!body)
    return json({ error: "Invalid JSON body" }, 400);
  const identifierRaw = body.identifier != null ? String(body.identifier) : "";
  if (!identifierRaw.trim()) {
    return json({ error: "Email or phone is required" }, 400);
  }
  const lookup = resolveLoginIdentifier(identifierRaw);
  const generic = {
    ok: true,
    message: "If an account exists, reset instructions were sent."
  };
  if (!lookup.ok) {
    // Invalid format still returns 400; do not invent accounts
    return json({ error: lookup.error }, 400);
  }
  let row;
  if (lookup.kind === "email") {
    row = await env.DB.prepare(
      `SELECT id, email, phone, mfa_enabled, disabled, totp_secret
       FROM users WHERE email = ?`
    ).bind(lookup.value).first();
  } else {
    row = await env.DB.prepare(
      `SELECT id, email, phone, mfa_enabled, disabled, totp_secret
       FROM users WHERE phone = ?`
    ).bind(lookup.value).first();
  }
  if (!row || row.disabled) {
    return json(generic, 200);
  }
  let email_sent = false;
  const hasEmail = !!(row.email && String(row.email).trim());
  const canEmail = hasEmail && !!(env && env.RESEND_API_KEY);
  if (canEmail) {
    const rawToken = randomHex(SESSION_TOKEN_BYTES);
    const tokenHash = await hashToken(rawToken);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const expires = new Date(Date.now() + PASSWORD_RESET_TTL_MS).toISOString();
    const tokenId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, used_at, created_at)
       VALUES (?, ?, ?, ?, NULL, ?)`
    ).bind(tokenId, row.id, tokenHash, expires, now).run();
    const origin = url.origin || "https://www.muncyber.com";
    const resetUrl = origin + "/reset-password.html?token=" + encodeURIComponent(rawToken);
    email_sent = await sendPasswordResetEmail(env, row.email, resetUrl);
  }
  if (row.mfa_enabled && row.totp_secret) {
    const challengeId = crypto.randomUUID();
    const expires = new Date(Date.now() + MFA_CHALLENGE_TTL_MS).toISOString();
    await env.DB.prepare(
      "INSERT INTO mfa_challenges (id, user_id, expires_at) VALUES (?, ?, ?)"
    ).bind(challengeId, row.id, expires).run();
    return json({
      ok: true,
      mfa_required: true,
      challenge_id: challengeId,
      email_sent,
      message: "Enter the code from your authenticator app to choose a new password. This challenge expires in 5 minutes."
    }, 200);
  }
  if (email_sent) {
    return json({
      ok: true,
      email_sent: true,
      message: "If an account exists with email on file, check your inbox for a reset link."
    }, 200);
  }
  if (canEmail && !email_sent) {
    return json({
      ok: true,
      email_sent: false,
      message: "If an account exists, reset instructions were sent. If you do not receive email, contact info@muncyber.com."
    }, 200);
  }
  return json({
    ok: true,
    contact_support: true,
    message: "If this account has MFA or email on file, follow the next step. Otherwise contact info@muncyber.com."
  }, 200);
}
async function resetPassword(request, env) {
  const body = await parseJson(request);
  if (!body)
    return json({ error: "Invalid JSON body" }, 400);
  const password = String(body.password || "");
  const passwordError = validatePasswordStrength(password);
  if (passwordError) {
    return json({ error: passwordError }, 400);
  }
  const challengeId = String(body.challenge_id || "").trim();
  const code = String(body.code || "").trim();
  const rawToken = String(body.token || "").trim();
  let userId = null;
  if (challengeId && code) {
    if (!/^\d{6}$/.test(code)) {
      return json({ error: "Enter the 6-digit code from your authenticator app" }, 400);
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const challenge = await env.DB.prepare(
      "SELECT id, user_id, expires_at FROM mfa_challenges WHERE id = ?"
    ).bind(challengeId).first();
    if (!challenge) {
      return json({ error: "Invalid or expired MFA challenge" }, 401);
    }
    if (challenge.expires_at < now) {
      await env.DB.prepare("DELETE FROM mfa_challenges WHERE id = ?").bind(challengeId).run();
      return json({ error: "MFA challenge expired. Start password reset again." }, 401);
    }
    const row = await env.DB.prepare(
      `SELECT id, mfa_enabled, disabled, totp_secret FROM users WHERE id = ?`
    ).bind(challenge.user_id).first();
    if (!row || row.disabled) {
      await env.DB.prepare("DELETE FROM mfa_challenges WHERE id = ?").bind(challengeId).run();
      return json({ error: "This account has been disabled" }, 403);
    }
    if (!row.mfa_enabled || !row.totp_secret) {
      return json({ error: "MFA is not enabled for this account" }, 400);
    }
    const valid = await verifyTotp(row.totp_secret, code);
    if (!valid) {
      return json({ error: "Invalid authenticator code" }, 401);
    }
    userId = row.id;
    await env.DB.prepare("DELETE FROM mfa_challenges WHERE id = ?").bind(challengeId).run();
  } else if (rawToken) {
    const tokenHash = await hashToken(rawToken);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const tokenRow = await env.DB.prepare(
      `SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = ?`
    ).bind(tokenHash).first();
    if (!tokenRow || tokenRow.used_at) {
      return json({ error: "Invalid or expired reset link" }, 401);
    }
    if (tokenRow.expires_at < now) {
      await env.DB.prepare("DELETE FROM password_reset_tokens WHERE id = ?").bind(tokenRow.id).run();
      return json({ error: "Reset link expired. Request a new one." }, 401);
    }
    const row = await env.DB.prepare(
      "SELECT id, disabled FROM users WHERE id = ?"
    ).bind(tokenRow.user_id).first();
    if (!row || row.disabled) {
      await env.DB.prepare("DELETE FROM password_reset_tokens WHERE id = ?").bind(tokenRow.id).run();
      return json({ error: "This account has been disabled" }, 403);
    }
    userId = row.id;
    await env.DB.prepare(
      "UPDATE password_reset_tokens SET used_at = ? WHERE id = ?"
    ).bind(now, tokenRow.id).run();
    await env.DB.prepare("DELETE FROM password_reset_tokens WHERE id = ?").bind(tokenRow.id).run();
  } else {
    return json({ error: "Provide challenge_id and code, or a reset token" }, 400);
  }
  const salt = randomHex(SALT_BYTES);
  const password_hash = await hashPassword(password, salt);
  await env.DB.prepare(
    "UPDATE users SET password_hash = ?, salt = ? WHERE id = ?"
  ).bind(password_hash, salt, userId).run();
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
  await env.DB.prepare("DELETE FROM mfa_challenges WHERE user_id = ?").bind(userId).run();
  return json({ ok: true, message: "Password updated. You can sign in." }, 200);
}
async function sendPasswordResetEmail(env, toEmail, resetUrl) {
  if (!env || !env.RESEND_API_KEY) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + env.RESEND_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "Mun Cyber Technologies <info@muncyber.com>",
        to: [toEmail],
        subject: "Reset your Mun Cyber password",
        html: "<p>You requested a password reset for your Mun Cyber Technologies account.</p><p><a href=\"" + resetUrl + "\">Reset your password</a></p><p>This link expires in 1 hour. If you did not request this, you can ignore this email.</p>",
        text: "Reset your Mun Cyber password:\n\n" + resetUrl + "\n\nThis link expires in 1 hour. If you did not request this, ignore this email."
      })
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("Resend password-reset email failed:", res.status, errText.slice(0, 300));
      return false;
    }
    return true;
  } catch (err) {
    console.error("sendPasswordResetEmail error:", err);
    return false;
  }
}
async function listPublicProducts(env) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, slug, name, summary, points_json, price_label, price_note, price_cents, active, updated_at, kind
       FROM products WHERE active = 1 ORDER BY name ASC`
    ).all();
    return json({ products: (results || []).map(formatProduct) }, 200);
  } catch (err) {
    console.error("listPublicProducts:", err);
    return json({ products: [] }, 200);
  }
}
async function createOrder(request, env) {
  const body = await parseJson(request);
  if (!body)
    return json({ error: "Invalid JSON body" }, 400);
  const product_slug = String(body.product_slug || body.product_id || "").trim();
  const buyer_name = String(body.buyer_name || body.name || "").trim();
  let buyer_email = body.buyer_email != null || body.email != null ? normalizeEmail(body.buyer_email || body.email) : null;
  if (buyer_email === "")
    buyer_email = null;
  let buyer_phone = null;
  if (body.buyer_phone != null && String(body.buyer_phone).trim() !== "") {
    const pr = normalizePhone(body.buyer_phone);
    if (!pr.ok)
      return json({ error: pr.error }, 400);
    buyer_phone = pr.phone;
  } else if (body.phone != null && String(body.phone).trim() !== "") {
    const pr = normalizePhone(body.phone);
    if (!pr.ok)
      return json({ error: pr.error }, 400);
    buyer_phone = pr.phone;
  }
  const organization = String(body.organization || "").trim() || null;
  const customer_note = String(body.customer_note || body.note || "").trim() || null;
  if (!product_slug)
    return json({ error: "product_slug is required" }, 400);
  if (!buyer_name)
    return json({ error: "Buyer name is required" }, 400);
  if (!buyer_email && !buyer_phone) {
    return json({ error: "Provide buyer email or phone" }, 400);
  }
  if (buyer_email && !isValidEmail(buyer_email)) {
    return json({ error: "Invalid email address" }, 400);
  }
  let product = null;
  try {
    product = await env.DB.prepare(
      "SELECT id, slug, name FROM products WHERE slug = ? OR id = ?"
    ).bind(product_slug, product_slug).first();
  } catch (err) {
    console.error("createOrder product lookup:", err);
  }
  let user_id = null;
  const session = await sessionFromRequest(request, env);
  if (session && session.full_access === 1 && !session.user.disabled) {
    user_id = session.user.id;
  }
  const id = crypto.randomUUID();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const slug = product ? product.slug : product_slug;
  const product_id = product ? product.id : null;
  await env.DB.prepare(
    `INSERT INTO orders (
      id, user_id, product_id, product_slug, buyer_name, buyer_email, buyer_phone,
      organization, status, customer_note, admin_reply, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, NULL, ?, ?)`
  ).bind(
    id,
    user_id,
    product_id,
    slug,
    buyer_name,
    buyer_email,
    buyer_phone,
    organization,
    customer_note,
    now,
    now
  ).run();
  return json(
    {
      order: {
        id,
        product_slug: slug,
        product_name: product ? product.name : slug,
        status: "new",
        created_at: now
      }
    },
    201
  );
}
var SERVICE_ORDER_STATUSES = [
  "new",
  "awaiting_payment",
  "paid",
  "payment_confirmed",
  "payment_failed",
  "cancelled",
  "in_review",
  "replied",
  "closed"
];
var SERVICE_OUTCOME_FROM = /* @__PURE__ */ new Set([
  "new",
  "awaiting_payment",
  "payment_failed",
  "cancelled"
]);
async function updateOrderPaymentFields(env, orderId, fields) {
  const updated_at = (/* @__PURE__ */ new Date()).toISOString();
  const status = fields.status != null ? fields.status : null;
  const stripe_session_id = fields.stripe_session_id !== void 0 ? fields.stripe_session_id : void 0;
  if (status != null && stripe_session_id !== void 0) {
    await env.DB.prepare(
      "UPDATE orders SET status = ?, stripe_session_id = ?, updated_at = ? WHERE id = ?"
    ).bind(status, stripe_session_id, updated_at, orderId).run();
  } else if (status != null) {
    await env.DB.prepare("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?").bind(status, updated_at, orderId).run();
  } else if (stripe_session_id !== void 0) {
    await env.DB.prepare(
      "UPDATE orders SET stripe_session_id = ?, updated_at = ? WHERE id = ?"
    ).bind(stripe_session_id, updated_at, orderId).run();
  } else {
    await env.DB.prepare("UPDATE orders SET updated_at = ? WHERE id = ?").bind(updated_at, orderId).run();
  }
  return updated_at;
}
async function applyServicePaymentOutcome(request, env) {
  const body = await parseJson(request);
  if (!body)
    return json({ error: "Invalid JSON body" }, 400);
  const orderId = String(body.order_id || body.order || "").trim();
  let outcome = String(body.outcome || body.status || "").trim().toLowerCase();
  const sessionIdRaw = body.stripe_session_id != null ? String(body.stripe_session_id).trim() : body.session_id != null ? String(body.session_id).trim() : "";
  const stripe_session_id = sessionIdRaw || null;
  if (!orderId)
    return json({ error: "order_id is required" }, 400);
  const outcomeMap = {
    paid: "paid",
    success: "paid",
    payment_confirmed: "payment_confirmed",
    confirmed: "payment_confirmed",
    cancelled: "cancelled",
    canceled: "cancelled",
    payment_failed: "payment_failed",
    failed: "payment_failed"
  };
  if (!outcomeMap[outcome]) {
    return json(
      {
        error: "outcome must be paid|payment_confirmed|cancelled|payment_failed"
      },
      400
    );
  }
  outcome = outcomeMap[outcome];
  let row;
  try {
    row = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first();
  } catch (err) {
    console.error("applyServicePaymentOutcome lookup:", err);
    return json({ error: "Could not load order" }, 500);
  }
  if (!row)
    return json({ error: "Order not found" }, 404);
  const current = String(row.status || "").toLowerCase();
  if ((outcome === "paid" || outcome === "payment_confirmed") && (current === "paid" || current === "payment_confirmed")) {
    return json(
      {
        order: {
          id: row.id,
          status: current,
          stripe_session_id: row.stripe_session_id || null,
          updated_at: row.updated_at
        },
        message: "Payment already recorded."
      },
      200
    );
  }
  if (["paid", "payment_confirmed", "in_review", "replied", "closed"].includes(current)) {
    if (outcome === "cancelled" || outcome === "payment_failed") {
      return json(
        {
          error: "Order is already " + current + "; not changing to " + outcome,
          order: {
            id: row.id,
            status: current,
            stripe_session_id: row.stripe_session_id || null,
            updated_at: row.updated_at
          }
        },
        409
      );
    }
  }
  if (!SERVICE_OUTCOME_FROM.has(current) && current !== outcome) {
    if (current === "cancelled" && outcome === "cancelled") {
      return json(
        {
          order: {
            id: row.id,
            status: current,
            stripe_session_id: row.stripe_session_id || null,
            updated_at: row.updated_at
          },
          message: "Cancellation already recorded."
        },
        200
      );
    }
  }
  if (outcome === "paid" && stripe_session_id) {
    const stripeKey = env.STRIPE_SECRET_KEY ? String(env.STRIPE_SECRET_KEY).trim() : "";
    if (stripeKey) {
      try {
        const sRes = await fetch(
          "https://api.stripe.com/v1/checkout/sessions/" + encodeURIComponent(stripe_session_id),
          {
            method: "GET",
            headers: { Authorization: "Bearer " + stripeKey }
          }
        );
        const sText = await sRes.text();
        let sJson = null;
        try {
          sJson = sText ? JSON.parse(sText) : null;
        } catch {
          sJson = null;
        }
        if (sRes.ok && sJson) {
          const metaOrder = sJson.metadata && sJson.metadata.order_id || sJson.client_reference_id || "";
          if (metaOrder && metaOrder !== orderId) {
            return json({ error: "Stripe session does not match this order" }, 400);
          }
          const okPay = sJson.payment_status === "paid" || sJson.status === "complete";
          if (!okPay) {
            return json(
              {
                error: "Stripe session is not paid yet",
                stripe_status: sJson.status || null,
                payment_status: sJson.payment_status || null
              },
              400
            );
          }
        }
      } catch (err) {
        console.error("Stripe session verify error:", err);
      }
    }
  }
  const updated_at = await updateOrderPaymentFields(env, orderId, {
    status: outcome,
    stripe_session_id: stripe_session_id != null ? stripe_session_id : row.stripe_session_id || null
  });
  return json(
    {
      order: {
        id: orderId,
        status: outcome,
        stripe_session_id: stripe_session_id != null ? stripe_session_id : row.stripe_session_id || null,
        updated_at
      },
      message: outcome === "paid" || outcome === "payment_confirmed" ? "Payment confirmed." : outcome === "cancelled" ? "Payment was not completed." : "Payment failed."
    },
    200
  );
}
async function createServiceCheckout(request, env, url) {
  const body = await parseJson(request);
  if (!body)
    return json({ error: "Invalid JSON body" }, 400);
  const service_slug = String(body.service_slug || body.product_slug || "").trim();
  const buyer_name = String(body.buyer_name || body.name || "").trim();
  let buyer_email = body.buyer_email != null || body.email != null ? normalizeEmail(body.buyer_email || body.email) : null;
  if (buyer_email === "")
    buyer_email = null;
  let buyer_phone = null;
  if (body.buyer_phone != null && String(body.buyer_phone).trim() !== "") {
    const pr = normalizePhone(body.buyer_phone);
    if (!pr.ok)
      return json({ error: pr.error }, 400);
    buyer_phone = pr.phone;
  } else if (body.phone != null && String(body.phone).trim() !== "") {
    const pr = normalizePhone(body.phone);
    if (!pr.ok)
      return json({ error: pr.error }, 400);
    buyer_phone = pr.phone;
  }
  const organization = String(body.organization || "").trim() || null;
  const timeline = String(body.timeline || body.preferred_timeline || "").trim();
  const details = String(body.details || body.customer_note || body.note || "").trim();
  const confirm_only = !!body.confirm_only;
  if (!service_slug)
    return json({ error: "service_slug is required" }, 400);
  if (!buyer_name)
    return json({ error: "Name is required" }, 400);
  if (!buyer_email)
    return json({ error: "Email is required" }, 400);
  if (!isValidEmail(buyer_email))
    return json({ error: "Invalid email address" }, 400);
  if (!details)
    return json({ error: "Project details are required" }, 400);
  let product = null;
  try {
    product = await env.DB.prepare(
      `SELECT id, slug, name, summary, price_label, price_note, price_cents, kind, active
       FROM products WHERE (slug = ? OR id = ?) AND active = 1`
    ).bind(service_slug, service_slug).first();
  } catch (err) {
    console.error("createServiceCheckout product lookup:", err);
  }
  if (!product)
    return json({ error: "Service not found" }, 404);
  const isService = product.kind && String(product.kind).toLowerCase() === "service" || String(product.slug || "").startsWith("svc-");
  if (!isService) {
    return json({ error: "That catalog item is not a requestable service" }, 400);
  }
  const price_cents = product.price_cents == null ? null : Number(product.price_cents);
  if (price_cents == null || !Number.isFinite(price_cents) || price_cents <= 0) {
    return json({ error: "Service deposit price is not configured" }, 400);
  }
  let user_id = null;
  const session = await sessionFromRequest(request, env);
  if (session && session.full_access === 1 && !session.user.disabled) {
    user_id = session.user.id;
  }
  const noteParts = [];
  if (details)
    noteParts.push(details);
  if (timeline)
    noteParts.push("Preferred timeline: " + timeline);
  noteParts.push("Service request deposit: " + formatUsd(price_cents));
  const customer_note = noteParts.join("\n\n");
  const stripeKey = env.STRIPE_SECRET_KEY ? String(env.STRIPE_SECRET_KEY).trim() : "";
  const stripeEnabled = !!stripeKey && !confirm_only;
  const status = confirm_only ? "payment_confirmed" : "awaiting_payment";
  const id = crypto.randomUUID();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await env.DB.prepare(
    `INSERT INTO orders (
      id, user_id, product_id, product_slug, buyer_name, buyer_email, buyer_phone,
      organization, status, customer_note, admin_reply, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
  ).bind(
    id,
    user_id,
    product.id,
    product.slug,
    buyer_name,
    buyer_email,
    buyer_phone,
    organization,
    status,
    customer_note,
    now,
    now
  ).run();
  const orderPayload = {
    id,
    product_slug: product.slug,
    product_name: product.name,
    price_cents,
    price_label: product.price_label,
    price_note: product.price_note,
    status,
    stripe_session_id: null,
    created_at: now,
    updated_at: now
  };
  if (!stripeEnabled) {
    return json(
      {
        order: orderPayload,
        stripe_enabled: false,
        message: confirm_only ? "Request saved for our team. Card checkout is not configured yet." : "Request saved. Card checkout needs a Stripe secret on this Worker."
      },
      201
    );
  }
  const origin = url.origin;
  const successUrl = origin + "/service-request.html?paid=1&order=" + encodeURIComponent(id) + "&service=" + encodeURIComponent(product.slug) + "&session_id={CHECKOUT_SESSION_ID}";
  const cancelUrl = origin + "/service-request.html?canceled=1&paid=0&service=" + encodeURIComponent(product.slug) + "&order=" + encodeURIComponent(id);
  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("success_url", successUrl);
  form.set("cancel_url", cancelUrl);
  form.set("client_reference_id", id);
  form.set("customer_email", buyer_email);
  form.set("line_items[0][quantity]", "1");
  form.set("line_items[0][price_data][currency]", "usd");
  form.set("line_items[0][price_data][unit_amount]", String(Math.round(price_cents)));
  form.set(
    "line_items[0][price_data][product_data][name]",
    product.name + " \u2014 engagement deposit"
  );
  form.set(
    "line_items[0][price_data][product_data][description]",
    product.price_note || "Starting engagement deposit \u2014 balance invoiced after scope"
  );
  form.set("metadata[order_id]", id);
  form.set("metadata[service_slug]", product.slug);
  form.set("payment_intent_data[metadata][order_id]", id);
  let stripeRes;
  try {
    stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + stripeKey,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: form.toString()
    });
  } catch (err) {
    console.error("Stripe fetch error:", err);
    try {
      const failedAt = await updateOrderPaymentFields(env, id, { status: "payment_failed" });
      orderPayload.status = "payment_failed";
      orderPayload.updated_at = failedAt;
    } catch (e2) {
      console.error("Could not mark payment_failed:", e2);
    }
    return json(
      {
        order: orderPayload,
        stripe_enabled: true,
        error: "Could not reach Stripe. Your request was saved; we will follow up."
      },
      201
    );
  }
  const stripeText = await stripeRes.text();
  let stripeJson = null;
  try {
    stripeJson = stripeText ? JSON.parse(stripeText) : null;
  } catch {
    stripeJson = null;
  }
  if (!stripeRes.ok || !stripeJson || !stripeJson.url) {
    console.error("Stripe session error:", stripeRes.status, stripeText.slice(0, 500));
    try {
      const failedAt = await updateOrderPaymentFields(env, id, { status: "payment_failed" });
      orderPayload.status = "payment_failed";
      orderPayload.updated_at = failedAt;
    } catch (e2) {
      console.error("Could not mark payment_failed:", e2);
    }
    return json(
      {
        order: orderPayload,
        stripe_enabled: true,
        error: stripeJson && stripeJson.error && stripeJson.error.message || "Stripe Checkout could not be created. Your request was saved."
      },
      201
    );
  }
  const sessionId = stripeJson.id || null;
  if (sessionId) {
    try {
      const sessAt = await updateOrderPaymentFields(env, id, {
        stripe_session_id: sessionId
      });
      orderPayload.stripe_session_id = sessionId;
      orderPayload.updated_at = sessAt;
    } catch (e2) {
      console.error("Could not store stripe_session_id:", e2);
    }
  }
  return json(
    {
      order: orderPayload,
      stripe_enabled: true,
      url: stripeJson.url,
      session_id: sessionId
    },
    201
  );
}
function formatUsd(cents) {
  const n = Number(cents) || 0;
  return "$" + (n / 100).toFixed(2);
}
function formatProduct(row) {
  let points = [];
  try {
    points = JSON.parse(row.points_json || "[]");
    if (!Array.isArray(points))
      points = [];
  } catch {
    points = [];
  }
  const kind = row.kind != null && String(row.kind).trim() !== "" ? String(row.kind).trim().toLowerCase() : String(row.slug || "").startsWith("svc-") ? "service" : "product";
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    summary: row.summary,
    points,
    price_label: row.price_label,
    price_note: row.price_note,
    price_cents: row.price_cents == null ? null : Number(row.price_cents),
    kind,
    active: !!Number(row.active),
    updated_at: row.updated_at
  };
}
async function handleAdminApi(request, env, path, method) {
  const gate = await requireAdmin(request, env);
  if (gate.error)
    return gate.error;
  const { session } = gate;
  if (path === "/api/admin/overview" && method === "GET") {
    return adminOverview(env);
  }
  if (path === "/api/admin/users" && method === "GET") {
    return adminListUsers(env);
  }
  if (path === "/api/admin/users" && method === "POST") {
    return adminCreateUser(request, env);
  }
  const userMatch = path.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (userMatch) {
    const userId = decodeURIComponent(userMatch[1]);
    if (method === "PATCH")
      return adminPatchUser(request, env, session, userId);
    if (method === "DELETE")
      return adminDeleteUser(env, session, userId);
  }
  if (path === "/api/admin/products" && method === "GET") {
    return adminListProducts(env);
  }
  if (path === "/api/admin/products" && method === "POST") {
    return adminCreateProduct(request, env);
  }
  const productMatch = path.match(/^\/api\/admin\/products\/([^/]+)$/);
  if (productMatch && method === "PATCH") {
    return adminPatchProduct(request, env, decodeURIComponent(productMatch[1]));
  }
  if (path === "/api/admin/orders" && method === "GET") {
    return adminListOrders(env);
  }
  const orderMatch = path.match(/^\/api\/admin\/orders\/([^/]+)$/);
  if (orderMatch && method === "PATCH") {
    return adminPatchOrder(request, env, decodeURIComponent(orderMatch[1]));
  }
  if (path === "/api/admin/messages" && method === "GET") {
    return adminListMessages(env);
  }
  if (path === "/api/admin/messages" && method === "POST") {
    return adminCreateMessage(request, env, session);
  }
  if (path === "/api/admin/chats" && method === "GET") {
    return adminListChats(env);
  }
  const chatMsgMatch = path.match(/^\/api\/admin\/chats\/([^/]+)\/messages$/);
  if (chatMsgMatch && method === "POST") {
    return adminPostChatMessage(request, env, decodeURIComponent(chatMsgMatch[1]), session);
  }
  const chatMatch = path.match(/^\/api\/admin\/chats\/([^/]+)$/);
  if (chatMatch) {
    const chatId = decodeURIComponent(chatMatch[1]);
    if (method === "GET")
      return adminGetChat(env, chatId);
    if (method === "PATCH")
      return adminPatchChat(request, env, chatId);
  }
  return json({ error: "Not found" }, 404);
}
async function requireAdmin(request, env) {
  const session = await sessionFromRequest(request, env);
  if (!session) {
    return { error: json({ error: "Unauthorized" }, 401) };
  }
  if (session.user.disabled) {
    return { error: json({ error: "This account has been disabled" }, 403) };
  }
  await ensureFirstAdmin(env, session.user);
  if (session.full_access !== 1) {
    return { error: json({ error: "Complete MFA before using admin" }, 403) };
  }
  if ((session.user.role || "customer") !== "admin") {
    return { error: json({ error: "Admin access required" }, 403) };
  }
  return { session };
}
async function adminOverview(env) {
  const users = await env.DB.prepare("SELECT COUNT(*) AS c FROM users").first();
  const admins = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND disabled = 0"
  ).first();
  const products = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM products WHERE active = 1"
  ).first();
  const ordersNew = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM orders WHERE status = 'new'"
  ).first();
  const ordersAll = await env.DB.prepare("SELECT COUNT(*) AS c FROM orders").first();
  const messages = await env.DB.prepare("SELECT COUNT(*) AS c FROM messages").first();
  let chatsOpen = 0;
  let chatsTotal = 0;
  let chatsNeedsHuman = 0;
  try {
    const cOpen = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM chat_threads WHERE status = 'open' OR status = 'needs_human' OR status = 'handoff'"
    ).first();
    const cNeed = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM chat_threads WHERE status = 'needs_human' OR status = 'handoff'"
    ).first();
    const cAll = await env.DB.prepare("SELECT COUNT(*) AS c FROM chat_threads").first();
    chatsOpen = Number(cOpen && cOpen.c) || 0;
    chatsNeedsHuman = Number(cNeed && cNeed.c) || 0;
    chatsTotal = Number(cAll && cAll.c) || 0;
  } catch (e) {
    console.error("chat overview counts:", e);
  }
  return json(
    {
      users: Number(users && users.c) || 0,
      admins: Number(admins && admins.c) || 0,
      products_active: Number(products && products.c) || 0,
      orders_new: Number(ordersNew && ordersNew.c) || 0,
      orders_total: Number(ordersAll && ordersAll.c) || 0,
      messages: Number(messages && messages.c) || 0,
      chats_open: chatsOpen,
      chats_needs_human: chatsNeedsHuman,
      chats_total: chatsTotal
    },
    200
  );
}
function adminPublicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email || null,
    phone: row.phone || null,
    organization: row.organization || null,
    role: row.role || "customer",
    mfa_enabled: !!Number(row.mfa_enabled),
    disabled: !!Number(row.disabled),
    created_at: row.created_at || null
  };
}
async function adminListUsers(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, name, email, phone, organization, role, mfa_enabled, disabled, created_at
     FROM users ORDER BY created_at DESC`
  ).all();
  return json({ users: (results || []).map(adminPublicUser) }, 200);
}
async function adminCreateUser(request, env) {
  const body = await parseJson(request);
  if (!body)
    return json({ error: "Invalid JSON body" }, 400);
  const name = String(body.name || "").trim();
  const password = String(body.password || "");
  const organization = String(body.organization || "").trim() || null;
  let role = String(body.role || "customer").trim().toLowerCase();
  if (role !== "admin" && role !== "customer") {
    return json({ error: "role must be customer or admin" }, 400);
  }
  let email = null;
  let phone = null;
  if (body.email != null && String(body.email).trim() !== "") {
    email = normalizeEmail(body.email);
  }
  if (body.phone != null && String(body.phone).trim() !== "") {
    const pr = normalizePhone(body.phone);
    if (!pr.ok)
      return json({ error: pr.error }, 400);
    phone = pr.phone;
  }
  if (!name || !password) {
    return json({ error: "Name and temporary password are required" }, 400);
  }
  if (!email && !phone) {
    return json({ error: "Provide an email address or a phone number" }, 400);
  }
  if (email && !isValidEmail(email)) {
    return json({ error: "Invalid email address" }, 400);
  }
  const passwordError = validatePasswordStrength(password);
  if (passwordError)
    return json({ error: passwordError }, 400);
  if (email === FIRST_ADMIN_EMAIL)
    role = "admin";
  if (email) {
    const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
    if (existing)
      return json({ error: "An account with this email already exists" }, 409);
  }
  if (phone) {
    const existing = await env.DB.prepare("SELECT id FROM users WHERE phone = ?").bind(phone).first();
    if (existing) {
      return json({ error: "An account with this phone number already exists" }, 409);
    }
  }
  const id = crypto.randomUUID();
  const salt = randomHex(SALT_BYTES);
  const password_hash = await hashPassword(password, salt);
  const created_at = (/* @__PURE__ */ new Date()).toISOString();
  await env.DB.prepare(
    `INSERT INTO users (id, email, phone, password_hash, salt, name, organization, created_at, mfa_enabled, role, disabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0)`
  ).bind(id, email, phone, password_hash, salt, name, organization, created_at, role).run();
  return json(
    {
      user: adminPublicUser({
        id,
        name,
        email,
        phone,
        organization,
        role,
        mfa_enabled: 0,
        disabled: 0,
        created_at
      })
    },
    201
  );
}
async function adminPatchUser(request, env, session, userId) {
  const body = await parseJson(request);
  if (!body)
    return json({ error: "Invalid JSON body" }, 400);
  const row = await env.DB.prepare(
    `SELECT id, name, email, phone, organization, role, mfa_enabled, disabled, created_at
     FROM users WHERE id = ?`
  ).bind(userId).first();
  if (!row)
    return json({ error: "User not found" }, 404);
  let role = row.role;
  let disabled = Number(row.disabled) || 0;
  if (body.role != null) {
    const next = String(body.role).trim().toLowerCase();
    if (next !== "admin" && next !== "customer") {
      return json({ error: "role must be customer or admin" }, 400);
    }
    if (row.id === session.user.id && next !== "admin") {
      return json({ error: "You cannot demote yourself" }, 400);
    }
    if (row.role === "admin" && next === "customer") {
      const admins = await env.DB.prepare(
        "SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND disabled = 0"
      ).first();
      if ((Number(admins && admins.c) || 0) <= 1 && !row.disabled) {
        return json({ error: "Cannot demote the last active admin" }, 400);
      }
    }
    role = next;
  }
  if (body.disabled != null) {
    const nextDisabled = body.disabled ? 1 : 0;
    if (row.id === session.user.id && nextDisabled === 1) {
      return json({ error: "You cannot disable yourself" }, 400);
    }
    if (row.role === "admin" && nextDisabled === 1 && !row.disabled) {
      const admins = await env.DB.prepare(
        "SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND disabled = 0"
      ).first();
      if ((Number(admins && admins.c) || 0) <= 1) {
        return json({ error: "Cannot disable the last active admin" }, 400);
      }
    }
    disabled = nextDisabled;
  }
  if (row.email && normalizeEmail(row.email) === FIRST_ADMIN_EMAIL && !disabled) {
    role = "admin";
  }
  await env.DB.prepare("UPDATE users SET role = ?, disabled = ? WHERE id = ?").bind(role, disabled, userId).run();
  if (disabled === 1) {
    await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
  }
  return json(
    {
      user: adminPublicUser({
        ...row,
        role,
        disabled
      })
    },
    200
  );
}
async function adminDeleteUser(env, session, userId) {
  if (userId === session.user.id) {
    return json({ error: "You cannot delete yourself" }, 400);
  }
  const row = await env.DB.prepare(
    "SELECT id, role, disabled, email FROM users WHERE id = ?"
  ).bind(userId).first();
  if (!row)
    return json({ error: "User not found" }, 404);
  if (row.role === "admin" && !row.disabled) {
    const admins = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND disabled = 0"
    ).first();
    if ((Number(admins && admins.c) || 0) <= 1) {
      return json({ error: "Cannot delete the last active admin" }, 400);
    }
  }
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
  await env.DB.prepare("DELETE FROM mfa_challenges WHERE user_id = ?").bind(userId).run();
  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
  return json({ ok: true }, 200);
}
async function adminListProducts(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, slug, name, summary, points_json, price_label, price_note, price_cents, active, updated_at, kind
     FROM products ORDER BY name ASC`
  ).all();
  return json({ products: (results || []).map(formatProduct) }, 200);
}
async function adminCreateProduct(request, env) {
  const body = await parseJson(request);
  if (!body)
    return json({ error: "Invalid JSON body" }, 400);
  const name = String(body.name || "").trim();
  let slug = String(body.slug || "").trim().toLowerCase();
  const summary = String(body.summary || "").trim();
  const price_label = String(body.price_label || "Custom license").trim() || "Custom license";
  const price_note = String(body.price_note || "License \u2014 contact for pricing").trim() || "License \u2014 contact for pricing";
  let price_cents = body.price_cents;
  if (price_cents === "" || price_cents == null)
    price_cents = null;
  else {
    price_cents = Number(price_cents);
    if (!Number.isFinite(price_cents) || price_cents < 0) {
      return json({ error: "price_cents must be a non-negative integer or null" }, 400);
    }
    price_cents = Math.round(price_cents);
  }
  let points = body.points;
  if (typeof points === "string") {
    try {
      points = JSON.parse(points);
    } catch {
      points = points.split("\n").map((s) => s.trim()).filter(Boolean);
    }
  }
  if (!Array.isArray(points))
    points = [];
  points = points.map((p) => String(p).trim()).filter(Boolean);
  if (!name || !summary) {
    return json({ error: "name and summary are required" }, 400);
  }
  if (!slug) {
    slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return json({ error: "slug must be lowercase letters, numbers, and hyphens" }, 400);
  }
  const existing = await env.DB.prepare("SELECT id FROM products WHERE slug = ?").bind(slug).first();
  if (existing)
    return json({ error: "A product with this slug already exists" }, 409);
  const id = crypto.randomUUID();
  const updated_at = (/* @__PURE__ */ new Date()).toISOString();
  const active = body.active === false || body.active === 0 ? 0 : 1;
  await env.DB.prepare(
    `INSERT INTO products (id, slug, name, summary, points_json, price_label, price_note, price_cents, active, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    slug,
    name,
    summary,
    JSON.stringify(points),
    price_label,
    price_note,
    price_cents,
    active,
    updated_at
  ).run();
  return json(
    {
      product: formatProduct({
        id,
        slug,
        name,
        summary,
        points_json: JSON.stringify(points),
        price_label,
        price_note,
        price_cents,
        active,
        updated_at
      })
    },
    201
  );
}
async function adminPatchProduct(request, env, productId) {
  const body = await parseJson(request);
  if (!body)
    return json({ error: "Invalid JSON body" }, 400);
  const row = await env.DB.prepare(
    `SELECT id, slug, name, summary, points_json, price_label, price_note, price_cents, active, updated_at, kind
     FROM products WHERE id = ? OR slug = ?`
  ).bind(productId, productId).first();
  if (!row)
    return json({ error: "Product not found" }, 404);
  const name = body.name != null ? String(body.name).trim() : row.name;
  const summary = body.summary != null ? String(body.summary).trim() : row.summary;
  const price_label = body.price_label != null ? String(body.price_label).trim() : row.price_label;
  const price_note = body.price_note != null ? String(body.price_note).trim() : row.price_note;
  let price_cents = row.price_cents;
  if (Object.prototype.hasOwnProperty.call(body, "price_cents")) {
    if (body.price_cents === "" || body.price_cents == null)
      price_cents = null;
    else {
      price_cents = Number(body.price_cents);
      if (!Number.isFinite(price_cents) || price_cents < 0) {
        return json({ error: "price_cents must be a non-negative integer or null" }, 400);
      }
      price_cents = Math.round(price_cents);
    }
  }
  let points_json = row.points_json;
  if (body.points != null) {
    let points = body.points;
    if (typeof points === "string") {
      try {
        points = JSON.parse(points);
      } catch {
        points = points.split("\n").map((s) => s.trim()).filter(Boolean);
      }
    }
    if (!Array.isArray(points))
      points = [];
    points_json = JSON.stringify(points.map((p) => String(p).trim()).filter(Boolean));
  }
  let active = Number(row.active);
  if (body.active != null) {
    active = body.active === false || body.active === 0 ? 0 : 1;
  }
  if (body.deactivate === true)
    active = 0;
  if (!name || !summary) {
    return json({ error: "name and summary are required" }, 400);
  }
  const updated_at = (/* @__PURE__ */ new Date()).toISOString();
  await env.DB.prepare(
    `UPDATE products SET name = ?, summary = ?, points_json = ?, price_label = ?,
     price_note = ?, price_cents = ?, active = ?, updated_at = ? WHERE id = ?`
  ).bind(
    name,
    summary,
    points_json,
    price_label || "Custom license",
    price_note || "License \u2014 contact for pricing",
    price_cents,
    active,
    updated_at,
    row.id
  ).run();
  return json(
    {
      product: formatProduct({
        ...row,
        name,
        summary,
        points_json,
        price_label: price_label || "Custom license",
        price_note: price_note || "License \u2014 contact for pricing",
        price_cents,
        active,
        updated_at
      })
    },
    200
  );
}
async function adminListOrders(env) {
  const { results } = await env.DB.prepare(
    `SELECT o.id, o.user_id, o.product_id, o.product_slug, o.buyer_name, o.buyer_email,
            o.buyer_phone, o.organization, o.status, o.customer_note, o.admin_reply,
            o.stripe_session_id, o.created_at, o.updated_at, p.name AS product_name, p.kind AS product_kind
     FROM orders o
     LEFT JOIN products p ON p.id = o.product_id
     ORDER BY o.created_at DESC`
  ).all();
  const orders = (results || []).map((r) => {
    const slug = r.product_slug || "";
    const kind = r.product_kind != null && String(r.product_kind).trim() !== "" ? String(r.product_kind).trim().toLowerCase() : slug.startsWith("svc-") ? "service" : "product";
    return {
      id: r.id,
      user_id: r.user_id || null,
      product_id: r.product_id || null,
      product_slug: r.product_slug,
      product_name: r.product_name || r.product_slug,
      product_kind: kind,
      is_service: kind === "service" || slug.startsWith("svc-"),
      buyer_name: r.buyer_name,
      buyer_email: r.buyer_email || null,
      buyer_phone: r.buyer_phone || null,
      organization: r.organization || null,
      status: r.status,
      customer_note: r.customer_note || null,
      admin_reply: r.admin_reply || null,
      stripe_session_id: r.stripe_session_id || null,
      created_at: r.created_at,
      updated_at: r.updated_at
    };
  });
  return json({ orders }, 200);
}
async function adminPatchOrder(request, env, orderId) {
  const body = await parseJson(request);
  if (!body)
    return json({ error: "Invalid JSON body" }, 400);
  const row = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first();
  if (!row)
    return json({ error: "Order not found" }, 404);
  let status = row.status;
  if (body.status != null) {
    status = String(body.status).trim().toLowerCase();
    const allowed = SERVICE_ORDER_STATUSES;
    if (!allowed.includes(status)) {
      return json(
        {
          error: "status must be " + SERVICE_ORDER_STATUSES.join("|")
        },
        400
      );
    }
  }
  let admin_reply = row.admin_reply;
  if (Object.prototype.hasOwnProperty.call(body, "admin_reply")) {
    admin_reply = body.admin_reply == null || body.admin_reply === "" ? null : String(body.admin_reply);
  }
  const updated_at = (/* @__PURE__ */ new Date()).toISOString();
  await env.DB.prepare(
    "UPDATE orders SET status = ?, admin_reply = ?, updated_at = ? WHERE id = ?"
  ).bind(status, admin_reply, updated_at, orderId).run();
  return json(
    {
      order: {
        id: row.id,
        user_id: row.user_id || null,
        product_id: row.product_id || null,
        product_slug: row.product_slug,
        buyer_name: row.buyer_name,
        buyer_email: row.buyer_email || null,
        buyer_phone: row.buyer_phone || null,
        organization: row.organization || null,
        status,
        customer_note: row.customer_note || null,
        admin_reply,
        created_at: row.created_at,
        updated_at
      }
    },
    200
  );
}
async function adminListMessages(env) {
  const { results } = await env.DB.prepare(
    `SELECT m.id, m.user_id, m.to_email, m.to_phone, m.subject, m.body, m.created_by,
            m.created_at, u.name AS created_by_name
     FROM messages m
     LEFT JOIN users u ON u.id = m.created_by
     ORDER BY m.created_at DESC`
  ).all();
  const messages = (results || []).map((r) => ({
    id: r.id,
    user_id: r.user_id || null,
    to_email: r.to_email || null,
    to_phone: r.to_phone || null,
    subject: r.subject,
    body: r.body,
    created_by: r.created_by,
    created_by_name: r.created_by_name || null,
    created_at: r.created_at
  }));
  return json({ messages }, 200);
}
async function adminCreateMessage(request, env, session) {
  const body = await parseJson(request);
  if (!body)
    return json({ error: "Invalid JSON body" }, 400);
  const subject = String(body.subject || "").trim();
  const msgBody = String(body.body || "").trim();
  let user_id = body.user_id != null ? String(body.user_id).trim() : null;
  if (user_id === "")
    user_id = null;
  let to_email = body.to_email != null && String(body.to_email).trim() !== "" ? normalizeEmail(body.to_email) : null;
  let to_phone = null;
  if (body.to_phone != null && String(body.to_phone).trim() !== "") {
    const pr = normalizePhone(body.to_phone);
    if (!pr.ok)
      return json({ error: pr.error }, 400);
    to_phone = pr.phone;
  }
  if (!subject || !msgBody) {
    return json({ error: "subject and body are required" }, 400);
  }
  if (user_id) {
    const u = await env.DB.prepare(
      "SELECT id, email, phone FROM users WHERE id = ?"
    ).bind(user_id).first();
    if (!u)
      return json({ error: "Recipient user not found" }, 404);
    if (!to_email && u.email)
      to_email = u.email;
    if (!to_phone && u.phone)
      to_phone = u.phone;
  }
  if (!to_email && !to_phone) {
    return json({ error: "Provide to_email, to_phone, or a user_id with contact info" }, 400);
  }
  if (to_email && !isValidEmail(to_email)) {
    return json({ error: "Invalid to_email" }, 400);
  }
  const id = crypto.randomUUID();
  const created_at = (/* @__PURE__ */ new Date()).toISOString();
  await env.DB.prepare(
    `INSERT INTO messages (id, user_id, to_email, to_phone, subject, body, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, user_id, to_email, to_phone, subject, msgBody, session.user.id, created_at).run();
  const mailto = to_email ? "mailto:" + encodeURIComponent(to_email).replace(/%40/g, "@") + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(msgBody) : null;
  return json(
    {
      message: {
        id,
        user_id,
        to_email,
        to_phone,
        subject,
        body: msgBody,
        created_by: session.user.id,
        created_by_name: session.user.name,
        created_at
      },
      mailto
    },
    201
  );
}
async function createSession(env, userId, fullAccess) {
  const token = randomHex(SESSION_TOKEN_BYTES);
  const sessionId = await hashToken(token);
  const expires = new Date(Date.now() + SESSION_IDLE_SEC * 1e3).toISOString();
  const fa = fullAccess ? 1 : 0;
  await env.DB.prepare(
    "INSERT INTO sessions (session_id, user_id, expires_at, full_access) VALUES (?, ?, ?, ?)"
  ).bind(sessionId, userId, expires, fa).run();
  return token;
}
async function sessionFromRequest(request, env) {
  const token = getCookie(request, COOKIE_NAME);
  if (!token)
    return null;
  const sessionId = await hashToken(token);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const row = await env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.phone, u.organization, u.mfa_enabled, u.role,
            u.disabled, u.totp_secret, s.expires_at, s.full_access, s.session_id
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.session_id = ?`
  ).bind(sessionId).first();
  if (!row)
    return null;
  if (row.expires_at < now) {
    await env.DB.prepare("DELETE FROM sessions WHERE session_id = ?").bind(sessionId).run();
    return null;
  }
  const newExpires = new Date(Date.now() + SESSION_IDLE_SEC * 1e3).toISOString();
  await env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE session_id = ?").bind(newExpires, sessionId).run();
  pendingSessionCookie = sessionCookieHeader(token, SESSION_IDLE_SEC);
  return {
    session_id: row.session_id,
    full_access: row.full_access == null ? 1 : Number(row.full_access),
    user: {
      id: row.id,
      name: row.name,
      email: row.email || null,
      phone: row.phone || null,
      organization: row.organization,
      mfa_enabled: Number(row.mfa_enabled) || 0,
      role: row.role || "customer",
      disabled: Number(row.disabled) || 0,
      totp_secret: row.totp_secret || null
    }
  };
}
async function ensureFirstAdmin(env, user) {
  if (!user || !user.email)
    return user;
  const email = normalizeEmail(user.email);
  if (email === FIRST_ADMIN_EMAIL && (user.role || "customer") !== "admin") {
    await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(user.id).run();
    user.role = "admin";
  }
  return user;
}
function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email || null,
    phone: row.phone || null,
    organization: row.organization || null,
    mfa_enabled: !!Number(row.mfa_enabled),
    role: row.role || "customer"
  };
}
function totpAccountLabel(user) {
  if (user.email)
    return user.email;
  if (user.phone)
    return user.phone;
  return user.id || "user";
}
var BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function generateTotpSecret() {
  const bytes = new Uint8Array(TOTP_SECRET_BYTES);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes);
}
function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (let i = 0; i < bytes.length; i++) {
    value = value << 8 | bytes[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[value >>> bits - 5 & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[value << 5 - bits & 31];
  }
  return output;
}
function base32Decode(str) {
  const cleaned = String(str || "").toUpperCase().replace(/=+$/, "").replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out = [];
  for (let i = 0; i < cleaned.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(cleaned[i]);
    if (idx === -1)
      continue;
    value = value << 5 | idx;
    bits += 5;
    if (bits >= 8) {
      out.push(value >>> bits - 8 & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}
async function hotp(secretBytes, counter) {
  const counterBuf = new ArrayBuffer(8);
  const view = new DataView(counterBuf);
  const high = Math.floor(counter / 4294967296);
  const low = counter >>> 0;
  view.setUint32(0, high);
  view.setUint32(4, low);
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, counterBuf);
  const hmac = new Uint8Array(sig);
  const offset = hmac[hmac.length - 1] & 15;
  const binCode = (hmac[offset] & 127) << 24 | (hmac[offset + 1] & 255) << 16 | (hmac[offset + 2] & 255) << 8 | hmac[offset + 3] & 255;
  const mod = Math.pow(10, TOTP_DIGITS);
  const code = String(binCode % mod).padStart(TOTP_DIGITS, "0");
  return code;
}
async function verifyTotp(secretBase32, code) {
  const secretBytes = base32Decode(secretBase32);
  if (!secretBytes.length)
    return false;
  const timestep = Math.floor(Date.now() / 1e3 / TOTP_PERIOD);
  for (let w = -TOTP_WINDOW; w <= TOTP_WINDOW; w++) {
    const expected = await hotp(secretBytes, timestep + w);
    if (timingSafeEqualHex(expected, code)) {
      return true;
    }
  }
  return false;
}
async function hashPassword(password, saltHex) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const salt = hexToBytes(saltHex);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256"
    },
    keyMaterial,
    256
  );
  return bytesToHex(new Uint8Array(bits));
}
async function verifyPassword(password, saltHex, expectedHash) {
  const actual = await hashPassword(password, saltHex);
  return timingSafeEqualHex(actual, expectedHash);
}
function timingSafeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
async function hashToken(token) {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(token));
  return bytesToHex(new Uint8Array(digest));
}
function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}
function normalizePhone(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) {
    return { ok: false, error: "Phone number is required" };
  }
  let s = trimmed.replace(/[^\d+]/g, "");
  if (s.indexOf("+") > 0) {
    s = s.replace(/\+/g, "");
  }
  if (!s.startsWith("+")) {
    return {
      ok: false,
      error: "Phone must include country code with + (for example +1 for US/Canada)"
    };
  }
  s = "+" + s.slice(1).replace(/\+/g, "");
  const digits = s.slice(1);
  if (!/^\d{8,15}$/.test(digits)) {
    return {
      ok: false,
      error: "Phone must be + followed by 8\u201315 digits (E.164)"
    };
  }
  return { ok: true, phone: "+" + digits };
}
function resolveLoginIdentifier(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) {
    return { ok: false, error: "Email or phone is required" };
  }
  if (trimmed.includes("@")) {
    const email = normalizeEmail(trimmed);
    if (!isValidEmail(email)) {
      return { ok: false, error: "Invalid email address" };
    }
    return { ok: true, kind: "email", value: email };
  }
  const phoneResult = normalizePhone(trimmed);
  if (!phoneResult.ok) {
    if (/^[\d\s().-]+$/.test(trimmed)) {
      return {
        ok: false,
        error: "Phone must include country code with + (for example +15551234567)"
      };
    }
    return { ok: false, error: phoneResult.error };
  }
  return { ok: true, kind: "phone", value: phoneResult.phone };
}
function validatePasswordStrength(password) {
  if (password.length < 8) {
    return "Password must be at least 8 characters and include uppercase, lowercase, a number, and a symbol";
  }
  if (!/[a-z]/.test(password)) {
    return "Password must include at least one lowercase letter";
  }
  if (!/[A-Z]/.test(password)) {
    return "Password must include at least one uppercase letter";
  }
  if (!/[0-9]/.test(password)) {
    return "Password must include at least one number";
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return "Password must include at least one symbol (for example !@#$%)";
  }
  return null;
}
var CHAT_THREAD_COOKIE = "mun_chat_thread";
var CHAT_THREAD_MAX_AGE = 60 * 60 * 24 * 30;
var CHAT_MAX_BODY = 4000;
var CHAT_NOTIFY_EMAIL = "info@muncyber.com";
var CHAT_STATUSES = ["open", "closed", "reviewed", "needs_human", "handoff"];
function chatThreadCookieHeader(threadId) {
  return `${CHAT_THREAD_COOKIE}=${encodeURIComponent(threadId)}; Secure; SameSite=Lax; Path=/; Max-Age=${CHAT_THREAD_MAX_AGE}`;
}
function extractEmailFromText(text) {
  const m = String(text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? normalizeEmail(m[0]) : null;
}
function wantsHumanHandoff(userText, action) {
  if (action === "handoff" || action === "connect" || action === "needs_human") return true;
  const t = String(userText || "").toLowerCase();
  return /connect me|speak (to|with)|talk to|human|real person|live agent|mun cyber team|customer service|representative|agent please/.test(t);
}
function generateChatReply(userText, thread, opts) {
  const t = String(userText || "").toLowerCase().trim();
  const name = thread && thread.visitor_name || null;
  const email = thread && thread.visitor_email || null;
  const hasLead = !!(name && email);
  const handed = thread && (thread.status === "needs_human" || thread.status === "handoff");
  if (opts && opts.handoffConfirmed) {
    return "You're connected \u2014 the Mun Cyber Team will follow up from info@muncyber.com. You can keep messaging here; they can reply in this thread from the admin panel.";
  }
  if (opts && opts.needsContact) {
    return "I can connect you to the Mun Cyber Team. Please share your name and email (phone optional), or use the Connect form below.";
  }
  if (!t) {
    return "Hi \u2014 I am MC Chat Bot. Ask about our services, products, or how to get started. Use \u201cConnect me to the Mun Cyber Team\u201d for a human follow-up from info@muncyber.com.";
  }
  if (handed && hasLead) {
    return "You're already connected with the Mun Cyber Team on this thread. They will follow up from info@muncyber.com; you can keep adding details here.";
  }
  if (/(hello|hi\b|hey|good (morning|afternoon|evening))/.test(t) && t.length < 40) {
    return "Hello! Welcome to MC Chat Bot. I can help with cybersecurity awareness, software development, defensive systems, AI for security ops, and our products (AI-Powered SOC Assistant and Mun Cyber Eye). What are you looking for?";
  }
  if (/sign[\s-]?in|log[\s-]?in|account|sign[\s-]?up|register/.test(t)) {
    return "You can create an account or sign in at signup.html on this site. Admins use MFA. If you hit a snag, email info@muncyber.com and the team can help.";
  }
  if (/request (a )?service|how (do|to) (i )?request|service request|hire|engagement/.test(t)) {
    return "To request a service, open Services and use Request service on a card, or go to service-request.html. Prefer to talk first? Use Connect me to the Mun Cyber Team.";
  }
  if (/awareness|training|phishing|human risk/.test(t)) {
    return "Cybersecurity awareness covers training and programs that help teams recognize threats like phishing and social engineering. Request it from Services (svc-awareness) or tell me your goals and I can note them for the team.";
  }
  if (/software|app(lication)?|web (app|site)|custom (dev|build)|development/.test(t)) {
    return "Software development covers custom applications and integrations built with security in mind. Use Request service on the Software card, or describe what you need here and we will route it to the Mun Cyber Team.";
  }
  if (/defensive|blue team|harden|incident|soc workflow|monitoring/.test(t)) {
    return "Defensive cyber systems help organizations detect, harden, and respond. We design support for security professionals \u2014 not a replacement for them. Request via Services or share requirements here for a follow-up.";
  }
  if (/\bai\b|artificial intelligence|machine learning|security ops|ai ops/.test(t) && !/soc assistant|cyber eye/.test(t)) {
    return "We apply AI to security operations \u2014 reducing noise and speeding triage while keeping humans in control. See AI for security ops under Services, and our products AI-Powered SOC Assistant and Mun Cyber Eye under Products.";
  }
  if (/soc assistant|false positive|analyst/.test(t)) {
    return "AI-Powered SOC Assistant helps security teams cut false positives so analysts focus on real alerts. It supports professionals; it does not replace them. See Products for licensing discussion, or purchase/request flow on the product page.";
  }
  if (/cyber eye|camera|shooting|fight|surveillance|detection/.test(t)) {
    return "Mun Cyber Eye is camera-based detection for fights, shootings, and related threats, with instant alerts to agencies, police, homeowners, and schools. See Products for licensing or ask here and we will connect you.";
  }
  if (/product|license|pricing|buy|purchase|download/.test(t)) {
    return "Our products are AI-Powered SOC Assistant and Mun Cyber Eye. Open Products to review and start a purchase/request. Pricing is often custom license \u2014 chat here or email info@muncyber.com for a tailored quote.";
  }
  if (/contact|email|phone|reach/.test(t) && !wantsHumanHandoff(userText, null)) {
    return "You can email info@muncyber.com anytime, or use the Contact page. Conversations here are saved so the Mun Cyber Team can review them. Share your name and best email if you want a direct follow-up, or use Connect me to the Mun Cyber Team.";
  }
  if (/thank|thanks|appreciate/.test(t)) {
    return "You are welcome. Anything else about services or products I can help with?";
  }
  const maybeEmail = extractEmailFromText(userText);
  if (maybeEmail && !email) {
    return `Thanks \u2014 I noted ${maybeEmail} for the team. What is your name, and briefly what do you need help with? A human may follow up from info@muncyber.com.`;
  }
  if (!hasLead && /(my name is|i am |i'm |call me )/.test(t)) {
    return "Nice to meet you. Please also share a best email so the Mun Cyber Team can follow up from info@muncyber.com if needed. How can we help?";
  }
  if (!hasLead && /(follow up|call me|contact me|leave my|my email|reach me)/.test(t)) {
    return "Gladly. Please reply with your name and email (for example: Jane Doe, jane@company.com). I will save them with this chat so the team can follow up from info@muncyber.com.";
  }
  if (hasLead) {
    return "Thanks \u2014 I have your contact on this thread. I noted your message for the Mun Cyber Team; a human may follow up from info@muncyber.com. Meanwhile I can still answer questions about services and products.";
  }
  return "I am not fully sure on that one. I can help with awareness training, software development, defensive systems, AI for security ops, AI-Powered SOC Assistant, Mun Cyber Eye, sign-in, and how to request a service. Or use Connect me to the Mun Cyber Team for a human follow-up from info@muncyber.com.";
}
function parseVisitorNameFromText(text) {
  const s = String(text || "").trim();
  let m = s.match(/(?:my name is|i am|i'm|call me)\s+([A-Za-z][A-Za-z .'-]{1,60})/i);
  if (m) return m[1].replace(/[,.].*$/, "").trim();
  m = s.match(/^([A-Za-z][A-Za-z .'-]{1,60})\s*,\s*[^\s@]+@[^\s@]+/);
  if (m) return m[1].trim();
  return null;
}
async function loadChatThread(env, threadId) {
  if (!threadId) return null;
  try {
    return await env.DB.prepare(
      `SELECT id, visitor_name, visitor_email, visitor_phone, handoff_note, handoff_at,
              created_at, updated_at, status
       FROM chat_threads WHERE id = ?`
    ).bind(threadId).first();
  } catch (e) {
    return env.DB.prepare(
      `SELECT id, visitor_name, visitor_email, created_at, updated_at, status
       FROM chat_threads WHERE id = ?`
    ).bind(threadId).first();
  }
}
function publicChatThread(thread) {
  if (!thread) return null;
  return {
    id: thread.id,
    visitor_name: thread.visitor_name || null,
    visitor_email: thread.visitor_email || null,
    visitor_phone: thread.visitor_phone || null,
    handoff_note: thread.handoff_note || null,
    handoff_at: thread.handoff_at || null,
    status: thread.status,
    created_at: thread.created_at,
    updated_at: thread.updated_at
  };
}
async function listChatMessages(env, threadId) {
  const { results } = await env.DB.prepare(
    `SELECT id, thread_id, role, body, created_at
     FROM chat_messages WHERE thread_id = ?
     ORDER BY created_at ASC`
  ).bind(threadId).all();
  return (results || []).map((r) => ({
    id: r.id,
    thread_id: r.thread_id,
    role: r.role,
    body: r.body,
    created_at: r.created_at
  }));
}
async function ensureChatThread(env, request, body) {
  let threadId = body && body.thread_id && String(body.thread_id).trim() || getCookie(request, CHAT_THREAD_COOKIE) || null;
  let thread = threadId ? await loadChatThread(env, threadId) : null;
  const now = new Date().toISOString();
  if (!thread) {
    threadId = crypto.randomUUID();
    const visitor_name = body && body.visitor_name != null && String(body.visitor_name).trim() ? String(body.visitor_name).trim().slice(0, 120) : null;
    let visitor_email = null;
    if (body && body.visitor_email != null && String(body.visitor_email).trim()) {
      const em = normalizeEmail(body.visitor_email);
      if (isValidEmail(em)) visitor_email = em;
    }
    let visitor_phone = null;
    if (body && body.visitor_phone != null && String(body.visitor_phone).trim()) {
      visitor_phone = String(body.visitor_phone).trim().slice(0, 40);
    }
    try {
      await env.DB.prepare(
        `INSERT INTO chat_threads (id, visitor_name, visitor_email, visitor_phone, created_at, updated_at, status)
         VALUES (?, ?, ?, ?, ?, ?, 'open')`
      ).bind(threadId, visitor_name, visitor_email, visitor_phone, now, now).run();
    } catch (e) {
      await env.DB.prepare(
        `INSERT INTO chat_threads (id, visitor_name, visitor_email, created_at, updated_at, status)
         VALUES (?, ?, ?, ?, ?, 'open')`
      ).bind(threadId, visitor_name, visitor_email, now, now).run();
    }
    thread = await loadChatThread(env, threadId);
    return { thread, created: true };
  }
  return { thread, created: false };
}
async function updateChatLeadFields(env, thread, fields) {
  const now = new Date().toISOString();
  let visitor_name = thread.visitor_name;
  let visitor_email = thread.visitor_email;
  let visitor_phone = thread.visitor_phone || null;
  if (fields.visitor_name != null && String(fields.visitor_name).trim()) {
    visitor_name = String(fields.visitor_name).trim().slice(0, 120);
  }
  if (fields.parsedName && !visitor_name) {
    visitor_name = String(fields.parsedName).trim().slice(0, 120);
  }
  if (fields.visitor_email != null && String(fields.visitor_email).trim()) {
    const em = normalizeEmail(fields.visitor_email);
    if (isValidEmail(em)) visitor_email = em;
  }
  if (fields.parsedEmail && !visitor_email && isValidEmail(fields.parsedEmail)) {
    visitor_email = fields.parsedEmail;
  }
  if (fields.visitor_phone != null && String(fields.visitor_phone).trim()) {
    visitor_phone = String(fields.visitor_phone).trim().slice(0, 40);
  }
  const changed = visitor_name !== thread.visitor_name || visitor_email !== thread.visitor_email || visitor_phone !== (thread.visitor_phone || null);
  if (changed) {
    try {
      await env.DB.prepare(
        `UPDATE chat_threads SET visitor_name = ?, visitor_email = ?, visitor_phone = ?, updated_at = ? WHERE id = ?`
      ).bind(visitor_name, visitor_email, visitor_phone, now, thread.id).run();
    } catch (e) {
      await env.DB.prepare(
        `UPDATE chat_threads SET visitor_name = ?, visitor_email = ?, updated_at = ? WHERE id = ?`
      ).bind(visitor_name, visitor_email, now, thread.id).run();
    }
  } else {
    await env.DB.prepare(`UPDATE chat_threads SET updated_at = ? WHERE id = ?`).bind(now, thread.id).run();
  }
  return loadChatThread(env, thread.id);
}
async function notifyTeamOfHandoff(env, thread, summary) {
  const subject = `MC Chat Bot handoff \u2014 ${(thread.visitor_name || "Visitor").slice(0, 60)}`;
  const body = `A visitor asked to connect with the Mun Cyber Team via MC Chat Bot.\n\n` +
    `Thread: ${thread.id}\n` +
    `Name: ${thread.visitor_name || "\u2014"}\n` +
    `Email: ${thread.visitor_email || "\u2014"}\n` +
    `Phone: ${thread.visitor_phone || "\u2014"}\n` +
    `Note: ${thread.handoff_note || "\u2014"}\n` +
    `Status: ${thread.status}\n\n` +
    `Recent transcript:\n${summary || "(no messages yet)"}\n\n` +
    `Reply from Admin \u2192 MC Chat Bot tab.`;
  let created_by = null;
  try {
    const admin = await env.DB.prepare(
      "SELECT id FROM users WHERE email = ? AND disabled = 0 LIMIT 1"
    ).bind(FIRST_ADMIN_EMAIL).first();
    if (admin && admin.id) created_by = admin.id;
    if (!created_by) {
      const anyAdmin = await env.DB.prepare(
        "SELECT id FROM users WHERE role = 'admin' AND disabled = 0 LIMIT 1"
      ).first();
      if (anyAdmin && anyAdmin.id) created_by = anyAdmin.id;
    }
  } catch (e) {
    console.error("handoff notify lookup:", e);
  }
  if (!created_by) {
    console.error("handoff notify: no admin user to attribute messages row");
    return { notified: false, via: "status_only" };
  }
  const id = crypto.randomUUID();
  const created_at = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO messages (id, user_id, to_email, to_phone, subject, body, created_by, created_at)
     VALUES (?, NULL, ?, NULL, ?, ?, ?, ?)`
  ).bind(id, CHAT_NOTIFY_EMAIL, subject, body, created_by, created_at).run();
  return { notified: true, via: "messages", message_id: id };
}
async function markThreadNeedsHuman(env, thread, handoffNote) {
  const now = new Date().toISOString();
  const note = handoffNote != null && String(handoffNote).trim() ? String(handoffNote).trim().slice(0, 2000) : thread.handoff_note || null;
  try {
    await env.DB.prepare(
      `UPDATE chat_threads SET status = 'needs_human', handoff_note = ?, handoff_at = ?, updated_at = ? WHERE id = ?`
    ).bind(note, now, now, thread.id).run();
  } catch (e) {
    await env.DB.prepare(
      `UPDATE chat_threads SET status = 'needs_human', updated_at = ? WHERE id = ?`
    ).bind(now, thread.id).run();
  }
  return loadChatThread(env, thread.id);
}
async function insertChatMessage(env, threadId, role, body, at) {
  const id = crypto.randomUUID();
  const created_at = at || new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO chat_messages (id, thread_id, role, body, created_at) VALUES (?, ?, ?, ?, ?)`
  ).bind(id, threadId, role, body, created_at).run();
  return { id, thread_id: threadId, role, body, created_at };
}
async function chatPost(request, env) {
  const body = await parseJson(request);
  if (!body) return json({ error: "Invalid JSON body" }, 400);
  const message = String(body.message || "").trim();
  if (!message) return json({ error: "message is required" }, 400);
  if (message.length > CHAT_MAX_BODY) return json({ error: "message is too long" }, 400);
  const action = body.action != null ? String(body.action).trim().toLowerCase() : "";
  const handoffIntent = wantsHumanHandoff(message, action);
  const ensured = await ensureChatThread(env, request, body);
  let thread = ensured.thread;
  const threadId = thread.id;
  thread = await updateChatLeadFields(env, thread, {
    visitor_name: body.visitor_name,
    visitor_email: body.visitor_email,
    visitor_phone: body.visitor_phone,
    parsedName: parseVisitorNameFromText(message),
    parsedEmail: extractEmailFromText(message)
  });
  await insertChatMessage(env, threadId, "user", message);
  const hasLead = !!(thread.visitor_name && thread.visitor_email);
  if (handoffIntent && !hasLead) {
    const replyText = generateChatReply(message, thread, { needsContact: true });
    const reply = await insertChatMessage(env, threadId, "assistant", replyText);
    await env.DB.prepare(`UPDATE chat_threads SET updated_at = ? WHERE id = ?`).bind(reply.created_at, threadId).run();
    const messages = await listChatMessages(env, threadId);
    return json(
      {
        thread_id: threadId,
        thread: publicChatThread(thread),
        needs_contact: true,
        reply,
        messages
      },
      ensured.created ? 201 : 200,
      chatThreadCookieHeader(threadId)
    );
  }
  if (handoffIntent && hasLead) {
    const note = body.handoff_note != null && String(body.handoff_note).trim() ? String(body.handoff_note).trim().slice(0, 2000) : message;
    thread = await markThreadNeedsHuman(env, thread, note);
    const recent = await listChatMessages(env, threadId);
    const summary = recent.slice(-12).map((m) => `[${m.role}] ${m.body}`).join("\n");
    const notify = await notifyTeamOfHandoff(env, thread, summary);
    const replyText = generateChatReply(message, thread, { handoffConfirmed: true });
    const reply = await insertChatMessage(env, threadId, "assistant", replyText);
    await env.DB.prepare(`UPDATE chat_threads SET updated_at = ? WHERE id = ?`).bind(reply.created_at, threadId).run();
    thread = await loadChatThread(env, threadId);
    const messages = await listChatMessages(env, threadId);
    return json(
      {
        thread_id: threadId,
        thread: publicChatThread(thread),
        handoff: true,
        notify,
        reply,
        messages
      },
      ensured.created ? 201 : 200,
      chatThreadCookieHeader(threadId)
    );
  }
  const replyText = generateChatReply(message, thread, {});
  const reply = await insertChatMessage(env, threadId, "assistant", replyText);
  await env.DB.prepare(`UPDATE chat_threads SET updated_at = ? WHERE id = ?`).bind(reply.created_at, threadId).run();
  thread = await loadChatThread(env, threadId);
  const messages = await listChatMessages(env, threadId);
  return json(
    {
      thread_id: threadId,
      thread: publicChatThread(thread),
      reply,
      messages
    },
    ensured.created ? 201 : 200,
    chatThreadCookieHeader(threadId)
  );
}
async function chatGetHistory(request, env, url) {
  let threadId = url.searchParams.get("thread_id") || getCookie(request, CHAT_THREAD_COOKIE);
  if (!threadId) return json({ error: "thread_id is required" }, 400);
  const thread = await loadChatThread(env, threadId);
  if (!thread) return json({ error: "Thread not found" }, 404);
  const messages = await listChatMessages(env, threadId);
  return json(
    {
      thread: publicChatThread(thread),
      messages
    },
    200,
    chatThreadCookieHeader(threadId)
  );
}
async function adminListChats(env) {
  let results = [];
  try {
    const q = await env.DB.prepare(
      `SELECT t.id, t.visitor_name, t.visitor_email, t.visitor_phone, t.handoff_note, t.handoff_at,
              t.created_at, t.updated_at, t.status,
              (SELECT COUNT(*) FROM chat_messages m WHERE m.thread_id = t.id) AS message_count,
              (SELECT body FROM chat_messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_body
       FROM chat_threads t
       ORDER BY
         CASE WHEN t.status IN ('needs_human', 'handoff') THEN 0 WHEN t.status = 'open' THEN 1 ELSE 2 END,
         t.updated_at DESC`
    ).all();
    results = q.results || [];
  } catch (e) {
    const q = await env.DB.prepare(
      `SELECT t.id, t.visitor_name, t.visitor_email, t.created_at, t.updated_at, t.status,
              (SELECT COUNT(*) FROM chat_messages m WHERE m.thread_id = t.id) AS message_count,
              (SELECT body FROM chat_messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_body
       FROM chat_threads t
       ORDER BY t.updated_at DESC`
    ).all();
    results = q.results || [];
  }
  const chats = (results || []).map((r) => ({
    id: r.id,
    visitor_name: r.visitor_name || null,
    visitor_email: r.visitor_email || null,
    visitor_phone: r.visitor_phone || null,
    handoff_note: r.handoff_note || null,
    handoff_at: r.handoff_at || null,
    created_at: r.created_at,
    updated_at: r.updated_at,
    status: r.status,
    message_count: Number(r.message_count) || 0,
    last_body: r.last_body || null,
    needs_human: r.status === "needs_human" || r.status === "handoff"
  }));
  return json({ chats }, 200);
}
async function adminGetChat(env, chatId) {
  const thread = await loadChatThread(env, chatId);
  if (!thread) return json({ error: "Chat not found" }, 404);
  const messages = await listChatMessages(env, chatId);
  return json({ thread: publicChatThread(thread), messages }, 200);
}
async function adminPatchChat(request, env, chatId) {
  const thread = await loadChatThread(env, chatId);
  if (!thread) return json({ error: "Chat not found" }, 404);
  const body = await parseJson(request);
  if (!body) return json({ error: "Invalid JSON body" }, 400);
  const status = body.status != null ? String(body.status).trim().toLowerCase() : null;
  if (!status || !CHAT_STATUSES.includes(status)) {
    return json({ error: "status must be open, closed, reviewed, needs_human, or handoff" }, 400);
  }
  const now = new Date().toISOString();
  await env.DB.prepare(`UPDATE chat_threads SET status = ?, updated_at = ? WHERE id = ?`).bind(status, now, chatId).run();
  const updated = await loadChatThread(env, chatId);
  return json({ thread: publicChatThread(updated) }, 200);
}
async function adminPostChatMessage(request, env, chatId, session) {
  const thread = await loadChatThread(env, chatId);
  if (!thread) return json({ error: "Chat not found" }, 404);
  const body = await parseJson(request);
  if (!body) return json({ error: "Invalid JSON body" }, 400);
  const msg = String(body.body || body.message || "").trim();
  if (!msg) return json({ error: "body is required" }, 400);
  if (msg.length > CHAT_MAX_BODY) return json({ error: "message is too long" }, 400);
  const role = body.role === "assistant" ? "assistant" : "admin";
  const reply = await insertChatMessage(env, chatId, role, msg);
  const now = reply.created_at;
  let status = thread.status;
  if (status === "needs_human" || status === "handoff") {
    status = "needs_human";
  } else if (status === "closed" || status === "reviewed") {
    status = "open";
  }
  await env.DB.prepare(`UPDATE chat_threads SET status = ?, updated_at = ? WHERE id = ?`).bind(status, now, chatId).run();
  const updated = await loadChatThread(env, chatId);
  const messages = await listChatMessages(env, chatId);
  return json(
    {
      thread: publicChatThread(updated),
      reply,
      messages,
      by: session && session.user ? session.user.email || session.user.id : null
    },
    201
  );
}
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
async function parseJson(request) {
  try {
    const text = await request.text();
    if (!text)
      return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Light per-IP rate limit for forgot-password (~10/min). */
var _forgotPasswordBuckets = /* @__PURE__ */ new Map();
function checkForgotPasswordRateLimit(request) {
  const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
  const now = Date.now();
  const key = String(ip).split(",")[0].trim() || "unknown";
  let bucket = _forgotPasswordBuckets.get(key);
  if (!bucket || now - bucket.windowStart > 6e4) {
    bucket = { windowStart: now, count: 0 };
    _forgotPasswordBuckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > 10) {
    return json({ ok: false, error: "Too many reset requests. Try again shortly." }, 429);
  }
  if (_forgotPasswordBuckets.size > 500) {
    _forgotPasswordBuckets.clear();
  }
  return null;
}

/** Rate-limited client error beacon — logs truncated payload server-side. */
var _clientErrorBuckets = /* @__PURE__ */ new Map();
function clientErrorBeacon(request) {
  const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
  const now = Date.now();
  const key = String(ip).split(",")[0].trim() || "unknown";
  let bucket = _clientErrorBuckets.get(key);
  if (!bucket || now - bucket.windowStart > 6e4) {
    bucket = { windowStart: now, count: 0 };
    _clientErrorBuckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > 20) {
    return json({ ok: false, error: "rate_limited" }, 429);
  }
  // Bound map size
  if (_clientErrorBuckets.size > 500) {
    _clientErrorBuckets.clear();
  }
  return (async () => {
    let body = null;
    try {
      body = await request.json();
    } catch (_) {
      body = null;
    }
    const safe = {
      type: String(body && body.type || "error").slice(0, 40),
      message: String(body && body.message || "").slice(0, 500),
      source: String(body && body.source || "").slice(0, 300),
      href: String(body && body.href || "").slice(0, 500),
      line: body && body.line,
      col: body && body.col
    };
    console.warn("[client-error]", JSON.stringify(safe));
    return json({ ok: true }, 204);
  })();
}

function json(data, status, setCookie) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  };
  if (setCookie) {
    headers["Set-Cookie"] = setCookie;
  }
  return new Response(JSON.stringify(data), { status, headers });
}
function sessionCookieHeader(token, maxAge) {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}
function clearSessionCookieHeader() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  const parts = header.split(";");
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx === -1)
      continue;
    const key = part.slice(0, idx).trim();
    if (key === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}
function randomHex(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}
function bytesToHex(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}
function hexToBytes(hex) {
  const len = hex.length / 2;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}
