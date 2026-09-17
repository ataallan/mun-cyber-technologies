# MUN Cyber Technologies

Company website and Cloudflare Worker for [muncyber.com](https://muncyber.com).

## What's included

- `improved/` — public multi-page site (HTML/CSS/JS/assets)
- `src/worker.js` — Cloudflare Worker (auth, MFA, admin, products, chat, routing)
- `migrations/` — D1 database migrations
- `wrangler.toml` — Worker + assets + D1 binding

## Local deploy (Cloudflare)

```bash
npm install
npx wrangler login
npx wrangler d1 migrations apply mun-cyber-auth --remote
npx wrangler deploy
```

Live site: https://muncyber.com

## Notes

- Auth uses Cloudflare D1 (`mun-cyber-auth`) with PBKDF2 password hashing and TOTP MFA.
- Do not commit real Stripe keys or session secrets. Configure those as Worker secrets when you go live.
