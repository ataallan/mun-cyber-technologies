/**
 * MUN Cyber Technologies — product catalog + purchase flow
 * Loads products from GET /api/products (static fallback). Orders POST /api/orders + optional mailto.
 */
(function () {
  "use strict";

  var CONTACT_EMAIL = "info@muncyber.com";
  var PURCHASES_KEY = "munCyberPurchases";
  var SOC_STANDALONE_ZIP =
    "https://github.com/ataallan/soc-assistant/releases/download/v1.0.0-standalone/AI-Powered-SOC-Assistant-standalone.zip";
  var EYE_STANDALONE_ZIP =
    "assets/downloads/mun-cyber-eye-standalone.zip";

  var STATIC_PRODUCTS = {
    "ai-soc-assistant": {
      id: "ai-soc-assistant",
      slug: "ai-soc-assistant",
      name: "AI-Powered SOC Assistant",
      summary:
        "Helps security teams reduce false-positive alerts so analysts can focus on real threats. Supports professionals; does not replace them.",
      points: [
        "Reduces false-positive alerts",
        "Helps analysts focus on real threats",
        "Supports SOC workflows without replacing people",
      ],
      price_label: "Custom license",
      price_note: "License — contact for pricing",
      license: "Custom license",
      downloadFile: SOC_STANDALONE_ZIP,
      downloadLabel: "Download AI-Powered SOC Assistant",
    },
    "mun-cyber-eye": {
      id: "mun-cyber-eye",
      slug: "mun-cyber-eye",
      name: "Mun Cyber Eye",
      summary:
        "Camera system that detects criminal activity such as fights and shootings, and reports instantly to security agencies, police, homeowners, and schools.",
      points: [
        "Detects fights, shootings, and related threats on camera",
        "Instant alerts to security agencies and police",
        "Also notifies homeowners and schools",
      ],
      price_label: "Custom license",
      price_note: "License — contact for pricing",
      license: "Custom license",
      downloadFile: EYE_STANDALONE_ZIP,
      downloadLabel: "Download Mun Cyber Eye",
    },
  };

  var PRODUCTS = Object.assign({}, STATIC_PRODUCTS);

  function safeParse(raw) {
    try {
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function getPurchases() {
    return safeParse(localStorage.getItem(PURCHASES_KEY));
  }

  function markPurchased(productId, meta) {
    var purchases = getPurchases();
    purchases[productId] = {
      purchasedAt: new Date().toISOString(),
      buyerName: meta.buyerName || "",
      buyerEmail: meta.buyerEmail || "",
      organization: meta.organization || "",
    };
    localStorage.setItem(PURCHASES_KEY, JSON.stringify(purchases));
  }

  function isPurchased(productId) {
    return !!getPurchases()[productId];
  }

  function queryProductId() {
    var params = new URLSearchParams(window.location.search);
    return (params.get("product") || "").trim();
  }

  function encodeBody(lines) {
    return encodeURIComponent(lines.join("\r\n"));
  }

  function downloadMeta(slug) {
    if (slug === "ai-soc-assistant") {
      return {
        downloadFile: SOC_STANDALONE_ZIP,
        downloadLabel: "Download AI-Powered SOC Assistant",
      };
    }
    if (slug === "mun-cyber-eye") {
      return {
        downloadFile: EYE_STANDALONE_ZIP,
        downloadLabel: "Download Mun Cyber Eye",
      };
    }
    return {
      downloadFile: "",
      downloadLabel: "Download",
    };
  }

  function isDirectZipDownload(url) {
    return /^https?:\/\//i.test(url || "") && /\.zip(\?|#|$)/i.test(url);
  }

  function downloadFileName(url, fallbackId) {
    var path = String(url || "").split("?")[0].split("#")[0];
    var name = path.split("/").pop();
    if (name) return name;
    return (fallbackId || "download") + ".zip";
  }

  function normalizeApiProduct(p) {
    var slug = p.slug || p.id;
    var dl = downloadMeta(slug);
    return {
      id: slug,
      slug: slug,
      db_id: p.id,
      name: p.name,
      summary: p.summary,
      points: Array.isArray(p.points) ? p.points : [],
      price_label: p.price_label || "Custom license",
      price_note: p.price_note || "License — contact for pricing",
      price_cents: p.price_cents,
      license: p.price_label || "Custom license",
      downloadFile: dl.downloadFile,
      downloadLabel: dl.downloadLabel,
      active: p.active !== false,
    };
  }

  function loadProductsFromApi() {
    return fetch("/api/products", { credentials: "same-origin" })
      .then(function (res) {
        if (!res.ok) return null;
        return res.json();
      })
      .then(function (body) {
        var list = body && body.products;
        if (!list || !list.length) return false;
        var next = {};
        list.forEach(function (p) {
          var n = normalizeApiProduct(p);
          var isSvc =
            (p.kind && String(p.kind).toLowerCase() === "service") ||
            String(n.slug).indexOf("svc-") === 0;
          if (isSvc) return;
          next[n.slug] = n;
        });
        PRODUCTS = next;
        return true;
      })
      .catch(function () {
        return false;
      });
  }

  function renderProductCard(p, featured) {
    var points = (p.points || [])
      .map(function (x) {
        return "<li>" + escapeHtml(x) + "</li>";
      })
      .join("");
    return (
      '<article class="product-card' +
      (featured ? " featured" : "") +
      '" data-product-id="' +
      escapeHtml(p.slug) +
      '" id="' +
      escapeHtml(p.slug) +
      '">' +
      '<div class="product-card-top">' +
      '<span class="product-tag">Product</span>' +
      '<span class="product-purchased-badge" hidden>Purchased in this browser</span>' +
      "</div>" +
      "<h3>" +
      escapeHtml(p.name) +
      "</h3>" +
      '<p class="product-summary">' +
      escapeHtml(p.summary) +
      "</p>" +
      (points ? '<ul class="product-points">' + points + "</ul>" : "") +
      '<div class="product-meta">' +
      '<span class="product-price">' +
      escapeHtml(p.price_label || "Custom license") +
      "</span>" +
      '<span class="product-price-note">' +
      escapeHtml(p.price_note || "") +
      "</span>" +
      "</div>" +
      '<div class="product-actions">' +
      (isDirectZipDownload(p.downloadFile)
        ? '<a class="button primary product-download-btn" href="' +
          escapeHtml(p.downloadFile) +
          '" download>' +
          escapeHtml(p.downloadLabel || "Download " + (p.name || "")) +
          "</a>" +
          '<a class="button secondary" href="purchase.html?product=' +
          encodeURIComponent(p.slug) +
          '">License / purchase</a>'
        : '<a class="button primary product-download-btn" href="purchase.html?product=' +
          encodeURIComponent(p.slug) +
          '">Download</a>' +
          '<a class="button secondary" href="contact.html">Ask about licensing</a>') +
      "</div>" +
      "</article>"
    );
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ---------- Purchase page ---------- */
  function initPurchasePage() {
    var root = document.getElementById("purchase-root");
    if (!root) return;

    var productId = queryProductId();
    var product = PRODUCTS[productId];
    var fallback = document.getElementById("purchase-fallback");
    var panel = document.getElementById("purchase-panel");

    if (!product) {
      if (panel) panel.hidden = true;
      if (fallback) {
        fallback.hidden = false;
        var h2 = fallback.querySelector("h2");
        var p = fallback.querySelector("p:not(.eyebrow)");
        if (h2) h2.textContent = productId ? "Product not found" : "Choose a product";
        if (p) {
          p.textContent = productId
            ? "That product link is missing or unknown. Choose a product from the catalog to continue."
            : "No product was selected. Choose a product from the catalog to continue.";
        }
      }
      return;
    }

    if (fallback) fallback.hidden = true;
    if (panel) panel.hidden = false;

    var titleEl = document.getElementById("purchase-product-name");
    var summaryEl = document.getElementById("purchase-product-summary");
    var licenseEl = document.getElementById("purchase-license");
    if (titleEl) titleEl.textContent = product.name;
    if (summaryEl) summaryEl.textContent = product.summary;
    if (licenseEl) licenseEl.textContent = product.price_label || product.license;

    var form = document.getElementById("purchase-form");
    var downloadArea = document.getElementById("download-area");
    var statusEl = document.getElementById("purchase-status");
    var downloadLink = document.getElementById("download-link");

    function revealDownload() {
      if (downloadArea) downloadArea.hidden = false;
      if (downloadLink) {
        downloadLink.href = product.downloadFile;
        downloadLink.setAttribute("download", downloadFileName(product.downloadFile, product.id));
        downloadLink.textContent = product.downloadLabel;
      }
      var downloadCopy = downloadArea && downloadArea.querySelector(".download-copy");
      if (downloadCopy && isDirectZipDownload(product.downloadFile)) {
        downloadCopy.textContent =
          "You can download the Windows standalone package now. License confirmation is still emailed after payment is confirmed.";
      }
      if (form) form.hidden = true;
    }

    if (isPurchased(productId)) {
      if (statusEl) {
        statusEl.hidden = false;
        statusEl.textContent =
          "This product is marked as purchased in this browser. Download the standalone package below, or wait for your emailed link after payment is confirmed.";
        statusEl.classList.remove("form-status-error");
      }
      revealDownload();
    }

    if (form) {
      form.addEventListener("submit", function (event) {
        event.preventDefault();

        var name = (form.elements.namedItem("name").value || "").trim();
        var email = (form.elements.namedItem("email").value || "").trim();
        var organization = (form.elements.namedItem("organization").value || "").trim();
        var phoneEl = form.elements.namedItem("phone");
        var noteEl = form.elements.namedItem("note");
        var phone = phoneEl ? (phoneEl.value || "").trim() : "";
        var note = noteEl ? (noteEl.value || "").trim() : "";

        if (!name || !email) {
          if (statusEl) {
            statusEl.hidden = false;
            statusEl.textContent = "Please provide your name and email.";
            statusEl.classList.add("form-status-error");
          }
          return;
        }

        var emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
        if (!emailOk) {
          if (statusEl) {
            statusEl.hidden = false;
            statusEl.textContent = "Please enter a valid email address.";
            statusEl.classList.add("form-status-error");
          }
          return;
        }

        var submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;
        if (statusEl) {
          statusEl.hidden = false;
          statusEl.classList.remove("form-status-error");
          statusEl.textContent = "Submitting order…";
        }

        var payload = {
          product_slug: product.slug || productId,
          buyer_name: name,
          buyer_email: email,
          organization: organization || undefined,
          buyer_phone: phone || undefined,
          customer_note: note || undefined,
        };

        fetch("/api/orders", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
          .then(function (res) {
            return res.text().then(function (text) {
              var data = null;
              try {
                data = text ? JSON.parse(text) : null;
              } catch (e) {
                data = null;
              }
              return { ok: res.ok, status: res.status, data: data };
            });
          })
          .then(function (result) {
            markPurchased(productId, {
              buyerName: name,
              buyerEmail: email,
              organization: organization,
            });

            var subject = encodeURIComponent("Product order: " + product.name);
            var body = encodeBody([
              "MUN Cyber Technologies — Product order",
              "",
              "Product: " + product.name,
              "Product ID: " + (product.slug || product.id),
              "License: " + (product.price_label || product.license),
              "",
              "Buyer name: " + name,
              "Buyer email: " + email,
              "Buyer phone: " + (phone || "(not provided)"),
              "Organization: " + (organization || "(not provided)"),
              "Note: " + (note || "(none)"),
              "",
              result.ok && result.data && result.data.order
                ? "Order ID (saved): " + result.data.order.id
                : "Order may not have been saved to the server; this email is the backup.",
              "Live card payments are not processed on this page; Stripe can be wired later.",
            ]);

            if (statusEl) {
              statusEl.hidden = false;
              if (result.ok) {
                statusEl.classList.remove("form-status-error");
                statusEl.textContent =
                  "Order saved. Opening your email client as a secondary notice… Live card payment is not charged here.";
              } else {
                statusEl.classList.add("form-status-error");
                statusEl.textContent =
                  ((result.data && result.data.error) ||
                    "Could not save order to the server.") +
                  " Opening email as backup…";
              }
            }

            revealDownload();
            window.setTimeout(function () {
              window.location.href =
                "mailto:" + CONTACT_EMAIL + "?subject=" + subject + "&body=" + body;
            }, 400);
          })
          .catch(function () {
            markPurchased(productId, {
              buyerName: name,
              buyerEmail: email,
              organization: organization,
            });
            if (statusEl) {
              statusEl.hidden = false;
              statusEl.classList.add("form-status-error");
              statusEl.textContent =
                "Network error saving order. Opening email as backup…";
            }
            revealDownload();
            var subject = encodeURIComponent("Product order: " + product.name);
            var body = encodeBody([
              "MUN Cyber Technologies — Product order (email backup)",
              "",
              "Product: " + product.name,
              "Buyer name: " + name,
              "Buyer email: " + email,
              "Organization: " + (organization || "(not provided)"),
            ]);
            window.location.href =
              "mailto:" + CONTACT_EMAIL + "?subject=" + subject + "&body=" + body;
          })
          .finally(function () {
            if (submitBtn) submitBtn.disabled = false;
          });
      });
    }
  }

  /* ---------- Products page ---------- */
  function setProductsGridMessage(grid, message) {
    if (!grid) return;
    grid.innerHTML =
      '<p class="product-grid-status" role="status">' + escapeHtml(message) + "</p>";
  }

  function initProductsPage() {
    var grid = document.querySelector(".product-grid");
    if (!grid) return;

    // If API provided products, re-render grid from PRODUCTS
    var slugs = Object.keys(PRODUCTS).filter(function (s) {
      return PRODUCTS[s] && PRODUCTS[s].active !== false;
    });
    var apiDriven = slugs.some(function (s) {
      return PRODUCTS[s] && PRODUCTS[s].db_id;
    });
    if (apiDriven) {
      if (!slugs.length) {
        setProductsGridMessage(grid, "No products are available right now. Check back soon or contact us.");
        return;
      }
      var html = "";
      slugs.forEach(function (slug, i) {
        html += renderProductCard(PRODUCTS[slug], i === 0);
      });
      grid.innerHTML = html;
    } else if (!grid.querySelector("[data-product-id]")) {
      setProductsGridMessage(grid, "No products are available right now. Check back soon or contact us.");
      return;
    } else {
      // Update static cards with PRODUCTS data if present
      document.querySelectorAll("[data-product-id]").forEach(function (card) {
        var id = card.getAttribute("data-product-id");
        var p = PRODUCTS[id];
        if (!p) return;
        var sum = card.querySelector(".product-summary");
        var price = card.querySelector(".product-price");
        var note = card.querySelector(".product-price-note");
        if (sum) sum.textContent = p.summary;
        if (price) price.textContent = p.price_label || p.license;
        if (note) note.textContent = p.price_note || "";
      });
    }

    document.querySelectorAll("[data-product-id]").forEach(function (card) {
      var id = card.getAttribute("data-product-id");
      if (!id || !isPurchased(id)) return;
      var badge = card.querySelector(".product-purchased-badge");
      if (badge) badge.hidden = false;
      var btn = card.querySelector(".product-download-btn");
      if (btn && !isDirectZipDownload(btn.getAttribute("href"))) {
        btn.textContent = "Continue to download";
      }
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    var grid = document.querySelector(".product-grid");
    if (grid && !grid.querySelector("[data-product-id]")) {
      setProductsGridMessage(grid, "Loading products…");
    }
    var purchaseRoot = document.getElementById("purchase-root");
    if (purchaseRoot) {
      var purchasePanel = document.getElementById("purchase-panel");
      var purchaseFallback = document.getElementById("purchase-fallback");
      if (purchasePanel) purchasePanel.hidden = true;
      if (purchaseFallback) purchaseFallback.hidden = true;
      var loading = document.createElement("p");
      loading.id = "purchase-loading";
      loading.className = "product-grid-status";
      loading.setAttribute("role", "status");
      loading.textContent = "Loading product details…";
      purchaseRoot.querySelector(".container") && purchaseRoot.querySelector(".container").prepend(loading);
    }
    loadProductsFromApi().then(function () {
      var loadingEl = document.getElementById("purchase-loading");
      if (loadingEl) loadingEl.remove();
      initPurchasePage();
      initProductsPage();
    });
  });

  window.MunShop = {
    PRODUCTS: PRODUCTS,
    isPurchased: isPurchased,
    getPurchases: getPurchases,
    loadProductsFromApi: loadProductsFromApi,
  };
})();
