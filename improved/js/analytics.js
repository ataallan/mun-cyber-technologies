/**
 * Lightweight analytics loader for MUN Cyber Technologies.
 * No-ops unless a Cloudflare Web Analytics token is present via:
 *   - <meta name="cf-web-analytics-token" content="TOKEN">
 *   - window.__MC_ANALYTICS_TOKEN = "TOKEN"
 *   - localStorage key mc_cf_analytics_token (dev only)
 * Do not invent a GA / fake ID. See SEO-OPS.md for dashboard setup.
 */
(function () {
  "use strict";

  function readToken() {
    if (typeof window.__MC_ANALYTICS_TOKEN === "string" && window.__MC_ANALYTICS_TOKEN.trim()) {
      return window.__MC_ANALYTICS_TOKEN.trim();
    }
    var meta = document.querySelector('meta[name="cf-web-analytics-token"]');
    if (meta && meta.content && meta.content.trim()) {
      return meta.content.trim();
    }
    try {
      var ls = localStorage.getItem("mc_cf_analytics_token");
      if (ls && ls.trim()) return ls.trim();
    } catch (_) {}
    return "";
  }

  function loadBeacon(token) {
    if (!token || document.querySelector('script[data-cf-beacon]')) return;
    var s = document.createElement("script");
    s.defer = true;
    s.src = "https://static.cloudflareinsights.com/beacon.min.js";
    s.setAttribute("data-cf-beacon", JSON.stringify({ token: token }));
    document.head.appendChild(s);
  }

  // Optional client-error beacon (rate-limited server-side)
  function installErrorBeacon() {
    var lastSent = 0;
    var MIN_GAP_MS = 5000;
    function send(payload) {
      var now = Date.now();
      if (now - lastSent < MIN_GAP_MS) return;
      lastSent = now;
      try {
        var body = JSON.stringify(payload);
        if (navigator.sendBeacon) {
          navigator.sendBeacon("/api/client-error", new Blob([body], { type: "application/json" }));
        } else {
          fetch("/api/client-error", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: body,
            keepalive: true,
          }).catch(function () {});
        }
      } catch (_) {}
    }
    window.addEventListener("error", function (ev) {
      send({
        type: "error",
        message: String((ev && ev.message) || "error").slice(0, 500),
        source: String((ev && ev.filename) || "").slice(0, 300),
        line: ev && ev.lineno,
        col: ev && ev.colno,
        href: String(location.href || "").slice(0, 500),
        ua: String(navigator.userAgent || "").slice(0, 200),
      });
    });
    window.addEventListener("unhandledrejection", function (ev) {
      var reason = ev && ev.reason;
      var msg = reason && reason.message ? reason.message : String(reason || "rejection");
      send({
        type: "unhandledrejection",
        message: String(msg).slice(0, 500),
        href: String(location.href || "").slice(0, 500),
        ua: String(navigator.userAgent || "").slice(0, 200),
      });
    });
  }

  var token = readToken();
  if (token) loadBeacon(token);
  installErrorBeacon();
})();
