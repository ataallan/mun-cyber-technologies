# Deploy real auth (Cloudflare Workers + D1)

This site uses Worker `fancy-breeze-64bc` with static assets from `./improved` and a D1 database `mun-cyber-auth` for multi-user accounts, server-side sessions, TOTP MFA, products, orders, and admin messaging.

## Identity

- Users sign up with **email OR phone** (not both required).
- Phone numbers must include country code with `+` (E.164-ish), e.g. `+15551234567`.
- Sign-in uses a single **Email or phone** field + password.

## MFA (required)

- Authenticator-app TOTP (RFC 6238, SHA1, 30s, 6 digits, ±1 window). No SMS gateway yet.
- After signup (or first login if MFA not enabled), session has `full_access=0` until MFA is enabled.
- If MFA already enabled: password succeeds → MFA challenge (no session cookie) → `/api/mfa/verify` → full session.
- Existing accounts without MFA must set it up on next login.

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

## Deploy

```bash
./node_modules/.bin/wrangler deploy
```

## Admin dashboard

- UI: `improved/admin.html` (Overview, Users, Products, Orders, Messages)
- API: `/api/admin/*` — requires session with `role === 'admin'` and `full_access` (MFA complete); otherwise 403
- Public: `GET /api/products`, `POST /api/orders`

Capabilities: list/create/disable/enable/delete users; change roles; manage products & prices; list/update orders; compose customer messages (stored in D1; mailto draft from UI). Wire Resend/Mailgun later for real email send (see `improved/README.md`).


## Stripe (service deposits)

Optional. Without this secret, service requests still save to D1; the payment modal offers Confirm request + mailto.

```bash
npx wrangler secret put STRIPE_SECRET_KEY
# later (webhooks):
# npx wrangler secret put STRIPE_WEBHOOK_SECRET
```

Then `npx wrangler deploy`. Checkout Sessions are created in `POST /api/service-checkout`.
