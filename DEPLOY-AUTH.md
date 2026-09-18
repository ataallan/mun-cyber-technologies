# Deploy real auth (Cloudflare Workers + D1)

This site uses Worker `fancy-breeze-64bc` with static assets from `./improved` and a D1 database `mun-cyber-auth` for multi-user accounts, server-side sessions, TOTP MFA, products, orders, and admin messaging.

## Identity

- Users sign up with **email OR phone** (not both required).
- Phone numbers must include country code with `+` (E.164-ish), e.g. `+15551234567`.
- Sign-in uses a single **Email or phone** field + password.

## MFA (required at sign-in)

- **Primary: email OTP** — after password succeeds, if the account has an email and `RESEND_API_KEY` is set, the Worker creates an MFA challenge and emails a 6-digit code (expires in **5 minutes**) via Resend from `Mun Cyber Technologies <info@muncyber.com>`. User verifies at `mfa-verify.html` → `POST /api/mfa/verify`.
- Resend: `POST /api/mfa/email-code` with `{ challenge_id }` (rate-limited: ~5/challenge, ~10/min/IP).
- **Phone-only + prior TOTP**: authenticator code still accepted as fallback.
- **Phone-only, no TOTP**: clear error asking to add email or contact support.
- Signup authenticator setup (`mfa-setup.html`) remains available; successful email OTP verify also sets `mfa_enabled=1` so accounts are not stuck requiring TOTP.
- Migration: `0010_email_otp.sql` (`email_otp_challenges` table).

## First admin (`info@muncyber.com`)

**No password bootstrap was created** (correct). There is no seeded admin row and no temporary password in D1.

1. Open **Sign up** and create an account with email **`info@muncyber.com`** (and a strong password).
2. Complete authenticator MFA (`mfa-setup.html`).
3. Open **Admin** (`admin.html`) — the nav shows an Admin link when `role === 'admin'` and MFA is done.

On `POST /api/signup`, and again on sign-in / `GET /api/me` / MFA completion if needed, if the normalized email is `info@muncyber.com`, the Worker sets `role = 'admin'` automatically.

## Migrations

```bash
./node_modules/.bin/wrangler d1 migrations apply mun-cyber-auth --remote
# or: node node_modules/wrangler/bin/wrangler.js d1 migrations apply mun-cyber-auth --remote
```

- `0001_users.sql` — users + sessions
- `0002_mfa.sql` — totp_secret, mfa_enabled, role, disabled, mfa_challenges, sessions.full_access
- `0003_phone_identity.sql` — nullable email, unique phone, CHECK at least one identity
- `0004_admin.sql` — products, orders, messages + seed AI SOC Assistant / Mun Cyber Eye
- `0010_email_otp.sql` — email OTP challenges for sign-in MFA

## Deploy

```bash
./node_modules/.bin/wrangler deploy
```

## Admin dashboard

- UI: `improved/admin.html` (Overview, Users, Products, Orders, Messages)
- API: `/api/admin/*` — requires session with `role === 'admin'` and `full_access` (MFA complete); otherwise 403
- Public: `GET /api/products`, `POST /api/orders`

Capabilities: list/create/disable/enable/delete users; change roles; manage products & prices; list/update orders; compose customer messages (stored in D1; mailto draft from UI). Wire Resend/Mailgun later for real email send (see `improved/README.md`).




## Forgot password

Two paths (both coded in the Worker):

1. **Authenticator reset (works without email)** — `POST /api/forgot-password` with `{ identifier }` looks up the account. If MFA is enabled, returns `{ mfa_required, challenge_id }` and inserts an `mfa_challenges` row. The UI (`forgot-password.html`) then submits `{ challenge_id, code, password }` to `POST /api/reset-password`.
2. **Email reset link (optional)** — when `RESEND_API_KEY` is set and the account has an email, a one-hour `password_reset_tokens` row is created and Resend sends a link to `/reset-password.html?token=…` from `info@muncyber.com`. That page posts `{ token, password }` to `/api/reset-password`.

Successful reset updates the password hash, deletes all sessions for that user, and returns `{ ok: true, message: "Password updated. You can sign in." }`.

```bash
npx wrangler secret put RESEND_API_KEY
npx wrangler deploy
```

Migration: `0009_password_reset.sql` (`password_reset_tokens` table).

## Stripe (service deposits)

Optional. Without this secret, service requests still save to D1; the payment modal offers Confirm request + mailto.

```bash
npx wrangler secret put STRIPE_SECRET_KEY
# later (webhooks):
# npx wrangler secret put STRIPE_WEBHOOK_SECRET
```

Then `npx wrangler deploy`. Checkout Sessions are created in `POST /api/service-checkout`.
