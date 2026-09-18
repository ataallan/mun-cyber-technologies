# MUN Cyber Technologies — Marketing Site

Polished multi-page marketing site for **MUN Cyber Technologies** (cybersecurity & defensive technology), including a Products catalog, purchase flow, and real account Sign up / Sign in (Cloudflare Workers + D1).

## Open locally (static preview)

**Option A — double-click / open file**

Open `index.html` in a modern browser. Static pages work from disk; **auth API calls need the Worker** (see root `DEPLOY-AUTH.md`).

**Option B — local HTTP server**

```bash
cd /path/to/improved
python3 -m http.server 8080
```

Visit [http://localhost:8080](http://localhost:8080). Auth endpoints (`/api/*`) require `wrangler dev` from the repo root so D1 and the Worker run together.

## Full stack (auth + assets)

From the parent folder (`mun-cyber/`):

```bash
npx wrangler login
npx wrangler d1 create mun-cyber-auth   # once; put id in wrangler.toml
npx wrangler d1 migrations apply mun-cyber-auth --remote
npx wrangler deploy
# or locally:
npx wrangler d1 migrations apply mun-cyber-auth --local
npx wrangler dev
```

See `/workspace/mun-cyber/DEPLOY-AUTH.md` for details.

## Pages

| Page | File | Contents |
|------|------|----------|
| Home | `index.html` | Hero, mission, services teaser, **products teaser**, AI/innovation teaser, CTA → Contact |
| Services | `services.html` | Full core capabilities + **Request service** → form |
| Service request | `service-request.html` | Request form + **payment modal** (Stripe Checkout when configured) |
| Products | `products.html` | Catalog: **AI-Powered SOC Assistant**, **Mun Cyber Eye** — Download → purchase |
| Purchase | `purchase.html` | Order form for `?product=…`; mailto + localStorage purchase mark; download stub |
| Sign up | `signup.html` | Create / sign in account (Worker API + HTTP-only session cookie) |
| About | `about.html` | About MUN Cyber + 4-step approach |
| Contact | `contact.html` | Conversation CTA + mailto contact form (`info@muncyber.com`) |
| Admin | `admin.html` | Admin-only dashboard (users, products, orders, messages) |
| MFA setup / verify | `mfa-setup.html` / `mfa-verify.html` | Authenticator enrollment and login challenge |

Shared on every page: skip link, sticky header/nav (active item marked with `aria-current="page"`), footer, mobile menu, signed-in state in nav via `GET /api/me`.

## Project layout

```
improved/
├── index.html
├── services.html
├── service-request.html
├── products.html
├── purchase.html
├── signup.html
├── about.html
├── contact.html
├── css/styles.css
├── js/main.js          # Mobile nav + mailto contact form
├── js/auth.js          # Sign up / sign in / me / sign out (API)
├── js/shop.js          # Product catalog + purchase / download flow
├── js/service-request.js # Service request form + payment modal
├── js/admin.js         # Admin dashboard
├── css/admin.css       # Admin layout
├── admin.html
├── assets/             # Logo / favicon + downloads/ stubs
└── README.md
```

Repo root also has `src/worker.js`, `migrations/`, and `wrangler.toml`.

## Products & purchase (demo)

1. On **Products**, each card’s primary **Download** button goes to `purchase.html?product=ai-soc-assistant` or `purchase.html?product=mun-cyber-eye`.
2. **Purchase** shows product name, summary, custom license copy, and buyer fields (name, email, organization).
3. **Complete purchase** validates the form, saves an order via `POST /api/orders`, opens a structured `mailto:` backup to `info@muncyber.com`, and marks that product as purchased in `localStorage` for this browser.
4. Buyer fields are prefilled from `GET /api/me` when you are signed in.
5. A **Download** area then appears with a demo `.txt` package note. Live card payments can be wired to Stripe later — **no fake card charge**.
6. Pricing UI uses **Custom license** / “License — contact for pricing”.

## Sign up / sign in

- `signup.html`: name, email, password, confirm password, optional organization.
- Accounts are stored in Cloudflare D1; passwords are PBKDF2-hashed (never plaintext).
- Sessions use an HTTP-only `mun_session` cookie (server-side row in D1).
- On success, redirect to Products.
- Same page includes **Already have an account? Sign in**.
- Nav shows **Signed in as …** / **Sign out** when `GET /api/me` returns a user.

## Contact form

The contact form does **not** store data on a server. Submitting it builds a `mailto:` link to `info@muncyber.com` and opens the visitor’s email client.



## Service requests & deposits

1. On **Services**, each card (and the page CTA) has **Request service** → `service-request.html?service=svc-…`.
2. Submit the form → toast **“Request received — complete payment to confirm”** and an accessible **Complete payment** modal (Esc / backdrop close, focus trap).
3. **Pay deposit** calls `POST /api/service-checkout` (saves a D1 order). If `STRIPE_SECRET_KEY` is set on the Worker, the browser redirects to **Stripe Checkout**. We never collect PAN/CVC on our site.
4. If Stripe is **not** configured, the modal honestly says so and offers **Confirm request** (order saved for admin) plus a mailto backup to `info@muncyber.com`.
5. Catalog deposits (cents): Awareness `$499`, Software `$999`, Defensive `$799`, AI Ops `$899` — labeled as starting engagement deposits.

### Configure Stripe (optional)

From the repo root (after `wrangler login`):

```bash
npx wrangler secret put STRIPE_SECRET_KEY
# optional later for webhooks:
# npx wrangler secret put STRIPE_WEBHOOK_SECRET
```

Use a Stripe **secret** key (`sk_live_…` or `sk_test_…`). Do not commit keys. Redeploy after setting secrets.

## Notes

- Brand copy and service bullets are preserved from the original draft.
- No fake clients, metrics, or testimonials. Service pages show real engagement **deposit** amounts from the catalog.
- Relative links only for pages.


## Admin & email

- First admin: sign up as **info@muncyber.com**, complete MFA, open **Admin**. No password bootstrap is created in D1.
- Purchase flow posts to `POST /api/orders` (primary) and still opens mailto as backup.
- Admin **Messages** store outbound notes in D1 and offer a mailto draft. **Later:** wire Resend or Mailgun for real send (no provider API key is configured yet).

## SEO & ops

See repo-root [`SEO-OPS.md`](../SEO-OPS.md) for:

- Verifying `robots.txt` / `sitemap.xml` and true 404s (`not_found_handling = "404-page"`)
- Adding Cloudflare Web Analytics (paste token into `meta name="cf-web-analytics-token"` or `window.__MC_ANALYTICS_TOKEN` — `js/analytics.js` no-ops without a token)
- Pointing uptime monitors at `GET /api/health` (or `/health.html`)
- Enabling **Always Use HTTPS** in the Cloudflare dashboard

Public pages include Open Graph / Twitter card tags and a shared `assets/og-image.png`. Homepage includes Organization + WebSite JSON-LD.
