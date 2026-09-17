# SEO & ops basics — muncyber.com

Company is still forming; this covers crawlability, social previews, health checks, and lightweight analytics only (no Privacy/Terms/Stripe yet).

## Verify robots & sitemap

```bash
curl -sS https://www.muncyber.com/robots.txt
curl -sS https://www.muncyber.com/sitemap.xml
```

Confirm:

- `robots.txt` is plain text (not the homepage HTML) and includes `Sitemap: https://www.muncyber.com/sitemap.xml`
- `sitemap.xml` lists public `.html` URLs matching page canonicals
- Unknown paths return **404** (not homepage 200):

```bash
curl -sSI https://www.muncyber.com/this-page-does-not-exist-xyz | head -20
```

After deploy, optionally submit the sitemap in Google Search Console / Bing Webmaster Tools.

## Cloudflare Web Analytics

1. Cloudflare dashboard → **Web Analytics** (or the zone’s **Analytics & Logs** → Web Analytics) → add `muncyber.com` if needed.
2. Copy the **beacon token** (not a GA ID).
3. Either:
   - Set a site-wide meta on pages: `<meta name="cf-web-analytics-token" content="YOUR_TOKEN">`, or
   - Before `analytics.js` loads: `window.__MC_ANALYTICS_TOKEN = "YOUR_TOKEN";`
4. `improved/js/analytics.js` loads `beacon.min.js` only when a token is present; otherwise it no-ops (no invented IDs).

Optional Worker/env later: you can inject the meta from a build step using `CF_WEB_ANALYTICS_TOKEN` — do **not** commit real tokens to git.

## Uptime / health

Point UptimeRobot, Better Stack, or similar at:

- `GET https://www.muncyber.com/api/health` → JSON `{ "ok": true, "ts": "..." }`
- Or static: `https://www.muncyber.com/health.html`

Expect HTTP 200 and `ok: true`.

## Always Use HTTPS

In the Cloudflare dashboard for `muncyber.com`:

**SSL/TLS** → **Edge Certificates** → enable **Always Use HTTPS**.

The Worker already redirects HTTP→HTTPS and sets HSTS when the request is HTTPS; the dashboard toggle covers edge cases and apex/www consistently.

## Client error beacon (optional)

`analytics.js` posts console/`error` / `unhandledrejection` summaries to `POST /api/client-error` (rate-limited in the Worker). Check Worker logs in the Cloudflare dashboard if debugging production JS issues.

## Security headers

Worker applies: `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, and `Strict-Transport-Security` on HTTPS responses. Keep `run_worker_first = true` in `wrangler.toml` so they apply to static assets.

## Deploy

From `/workspace/mun-cyber`:

```bash
./node_modules/.bin/wrangler deploy
```

Assets live under `improved/` (`[assets]` in `wrangler.toml`). `not_found_handling = "404-page"` serves `improved/404.html` with status 404.

## HTML URL shape

`wrangler.toml` sets `html_handling = "none"` so public URLs keep the `.html` suffix (matching page canonicals and `sitemap.xml`). Without this, Cloudflare Assets defaults to redirecting `/page.html` → `/page`.

The Worker maps `/` → `/index.html` before `ASSETS.fetch` so the apex path stays HTTP 200 with the homepage (sitemap `loc` is `https://www.muncyber.com/`).
