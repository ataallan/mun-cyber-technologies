/**
 * MUN Cyber Technologies — service request form + payment modal
 * Form submit → toast + Complete payment dialog; Pay → POST /api/service-checkout
 */
(function () {
  "use strict";

  var CONTACT_EMAIL = "info@muncyber.com";

  var STATIC_SERVICES = {
    "svc-awareness": {
      slug: "svc-awareness",
      name: "Cybersecurity Awareness",
      price_cents: 49900,
      price_label: "Deposit $499",
      price_note: "Starting engagement deposit — balance invoiced after scope",
    },
    "svc-software": {
      slug: "svc-software",
      name: "Software Development",
      price_cents: 99900,
      price_label: "Deposit $999",
      price_note: "Starting engagement deposit — balance invoiced after scope",
    },
    "svc-defensive": {
      slug: "svc-defensive",
      name: "Defensive Cyber Systems",
      price_cents: 79900,
      price_label: "Deposit $799",
      price_note: "Starting engagement deposit — balance invoiced after scope",
    },
    "svc-ai-ops": {
      slug: "svc-ai-ops",
      name: "AI for Security Operations",
      price_cents: 89900,
      price_label: "Deposit $899",
      price_note: "Starting engagement deposit — balance invoiced after scope",
    },
  };

  var SERVICES = Object.assign({}, STATIC_SERVICES);
  var formState = null;
  var lastFocus = null;
  var focusableSelector =
    'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

  function formatUsd(cents) {
    var n = Number(cents) || 0;
    return "$" + (n / 100).toFixed(2);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function queryParam(name) {
    return (new URLSearchParams(window.location.search).get(name) || "").trim();
  }

  function loadServicesFromApi() {
    return fetch("/api/products", { credentials: "same-origin" })
      .then(function (res) {
        if (!res.ok) return false;
        return res.json();
      })
      .then(function (body) {
        var list = body && body.products;
        if (!list || !list.length) return false;
        var next = Object.assign({}, STATIC_SERVICES);
        list.forEach(function (p) {
          var slug = p.slug || p.id;
          var isSvc =
            (p.kind && String(p.kind).toLowerCase() === "service") ||
            String(slug).indexOf("svc-") === 0;
          if (!isSvc) return;
          next[slug] = {
            slug: slug,
            name: p.name,
            price_cents: p.price_cents,
            price_label: p.price_label || ("Deposit " + formatUsd(p.price_cents)),
            price_note: p.price_note || "",
            summary: p.summary || "",
          };
        });
        SERVICES = next;
        return true;
      })
      .catch(function () {
        return false;
      });
  }

  function fillServiceSelect() {
    var select = document.getElementById("sr-service");
    if (!select) return;
    var current = select.value;
    var pref = queryParam("service") || current;
    var html = '<option value="">Select a service…</option>';
    Object.keys(SERVICES).forEach(function (slug) {
      var s = SERVICES[slug];
      html +=
        '<option value="' +
        escapeHtml(slug) +
        '">' +
        escapeHtml(s.name) +
        " — " +
        escapeHtml(formatUsd(s.price_cents)) +
        " deposit</option>";
    });
    select.innerHTML = html;
    if (pref && SERVICES[pref]) select.value = pref;
  }

  function hideToast() {
    var toast = document.getElementById("sr-toast");
    if (!toast) return;
    window.clearTimeout(showToast._t);
    window.clearTimeout(showToast._hide);
    toast.classList.remove("sr-toast-visible");
    showToast._hide = window.setTimeout(function () {
      toast.hidden = true;
    }, 280);
  }

  /**
   * Visible payment/status notification.
   * @param {string} message
   * @param {"success"|"warn"|"info"} [variant]
   */
  function showToast(message, variant) {
    var toast = document.getElementById("sr-toast");
    if (!toast) return;
    var msgEl = document.getElementById("sr-toast-msg");
    variant = variant || "info";
    toast.classList.remove("sr-toast-success", "sr-toast-warn", "sr-toast-info");
    toast.classList.add(
      variant === "success"
        ? "sr-toast-success"
        : variant === "warn"
          ? "sr-toast-warn"
          : "sr-toast-info"
    );
    if (msgEl) {
      msgEl.textContent = message;
    } else {
      toast.textContent = message;
    }
    toast.hidden = false;
    // force reflow so transition restarts
    void toast.offsetWidth;
    toast.classList.add("sr-toast-visible");
    window.clearTimeout(showToast._t);
    window.clearTimeout(showToast._hide);
    showToast._t = window.setTimeout(hideToast, 6500);
  }

  function notifyPaymentSuccess(orderId) {
    var short =
      orderId && String(orderId).length > 8
        ? String(orderId).slice(0, 8) + "…"
        : orderId || "";
    var msg = short
      ? "Payment confirmed (order " + short + "). We’ll email next steps."
      : "Payment confirmed. We’ll email next steps.";
    showToast(msg, "success");
    setFormStatus(msg, false);
  }

  function notifyPaymentNotCompleted(detail) {
    var msg =
      detail ||
      "Payment was not completed. No charge was taken.";
    showToast(msg, "warn");
    setFormStatus(msg + " You can edit the form or try Pay again.", false);
  }

  function setFormStatus(msg, isError) {
    var el = document.getElementById("sr-status");
    if (!el) return;
    el.hidden = !msg;
    el.textContent = msg || "";
    el.classList.toggle("form-status-error", !!isError);
  }

  function setModalStatus(msg, isError) {
    var el = document.getElementById("sr-modal-status");
    if (!el) return;
    el.hidden = !msg;
    el.textContent = msg || "";
    el.classList.toggle("form-status-error", !!isError);
  }

  function getFocusable(dialog) {
    return Array.prototype.slice
      .call(dialog.querySelectorAll(focusableSelector))
      .filter(function (el) {
        return !el.hasAttribute("disabled") && el.offsetParent !== null;
      });
  }

  function openModal() {
    var modal = document.getElementById("sr-modal");
    var dialog = modal && modal.querySelector(".sr-modal-dialog");
    if (!modal || !dialog || !formState) return;

    var svc = SERVICES[formState.service] || STATIC_SERVICES[formState.service];
    document.getElementById("sr-modal-service-name").textContent = svc
      ? svc.name
      : formState.service;
    document.getElementById("sr-modal-amount").textContent = svc
      ? formatUsd(svc.price_cents) + " USD"
      : "—";
    document.getElementById("sr-modal-price-note").textContent = svc
      ? svc.price_note || ""
      : "";
    var summaryLines = [
      "Organization: " + formState.organization,
      "Contact: " + formState.name + " <" + formState.email + ">",
    ];
    if (formState.phone) summaryLines.push("Phone: " + formState.phone);
    if (formState.timeline) summaryLines.push("Timeline: " + formState.timeline);
    summaryLines.push("");
    summaryLines.push(formState.details);
    document.getElementById("sr-modal-summary-text").textContent = summaryLines.join("\n");

    // Reset panels: try Stripe path first; fallback appears if checkout says no Stripe
    var stripePanel = document.getElementById("sr-modal-stripe-panel");
    var fallback = document.getElementById("sr-modal-fallback");
    if (stripePanel) stripePanel.hidden = false;
    if (fallback) fallback.hidden = true;
    setModalStatus("", false);
    var orderEl = document.getElementById("sr-modal-order-id");
    if (orderEl) {
      orderEl.hidden = true;
      orderEl.textContent = "";
    }

    lastFocus = document.activeElement;
    modal.hidden = false;
    document.body.classList.add("sr-modal-open");
    window.setTimeout(function () {
      var focusables = getFocusable(dialog);
      (focusables[0] || dialog).focus();
    }, 10);
  }

  function closeModal(opts) {
    opts = opts || {};
    var modal = document.getElementById("sr-modal");
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    document.body.classList.remove("sr-modal-open");
    if (opts.cancelled) {
      var pendingId =
        (formState && formState.savedOrderId) ||
        (formState && formState.pendingOrderId) ||
        null;
      if (pendingId) {
        postPaymentOutcome(pendingId, "cancelled")
          .then(function (r) {
            var st =
              r.data && r.data.order && r.data.order.status
                ? r.data.order.status
                : "cancelled";
            notifyPaymentNotCompleted(
              "Payment was not completed (status: " +
                st +
                "). No charge was taken."
            );
          })
          .catch(function () {
            notifyPaymentNotCompleted(
              "Payment was not completed. No charge was taken."
            );
          });
        if (formState) {
          formState.pendingOrderId = null;
          formState.savedOrderId = null;
        }
      } else {
        notifyPaymentNotCompleted(
          "Payment was not completed. No charge was taken."
        );
      }
    }
    // Prefer returning focus to the form submit (or name field), not only lastFocus
    var focusTarget =
      document.getElementById("sr-submit") ||
      document.getElementById("sr-name") ||
      lastFocus;
    if (focusTarget && typeof focusTarget.focus === "function") {
      try {
        focusTarget.focus();
      } catch (e) {}
    }
  }

  function onModalKeydown(e) {
    var modal = document.getElementById("sr-modal");
    if (!modal || modal.hidden) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closeModal({ cancelled: true });
      return;
    }
    if (e.key !== "Tab") return;
    var dialog = modal.querySelector(".sr-modal-dialog");
    var focusables = getFocusable(dialog);
    if (!focusables.length) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function readForm() {
    var form = document.getElementById("sr-form");
    if (!form) return null;
    return {
      name: (form.elements.namedItem("name").value || "").trim(),
      email: (form.elements.namedItem("email").value || "").trim(),
      phone: (form.elements.namedItem("phone").value || "").trim(),
      organization: (form.elements.namedItem("organization").value || "").trim(),
      service: (form.elements.namedItem("service").value || "").trim(),
      details: (form.elements.namedItem("details").value || "").trim(),
      timeline: (form.elements.namedItem("timeline").value || "").trim(),
    };
  }

  function validateForm(data) {
    if (!data.name) return "Please enter your name.";
    if (!data.email) return "Please enter your email.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      return "Please enter a valid email address.";
    }
    if (!data.organization) return "Please enter your organization.";
    if (!data.service || !SERVICES[data.service]) return "Please select a service.";
    if (!data.details) return "Please describe your project or needs.";
    return null;
  }

  function mailtoHref(orderId) {
    var svc = SERVICES[formState.service];
    var subject = encodeURIComponent(
      "Service request: " + (svc ? svc.name : formState.service)
    );
    var lines = [
      "MUN Cyber Technologies — Service request",
      "",
      "Service: " + (svc ? svc.name : formState.service),
      "Deposit: " + (svc ? formatUsd(svc.price_cents) : ""),
      "",
      "Name: " + formState.name,
      "Email: " + formState.email,
      "Phone: " + (formState.phone || "(not provided)"),
      "Organization: " + formState.organization,
      "Timeline: " + (formState.timeline || "(not provided)"),
      "",
      "Details:",
      formState.details,
      "",
      orderId ? "Order ID: " + orderId : "Order may not have been saved yet.",
    ];
    return (
      "mailto:" +
      CONTACT_EMAIL +
      "?subject=" +
      subject +
      "&body=" +
      encodeURIComponent(lines.join("\r\n"))
    );
  }

  function showFallback(orderId, message) {
    var stripePanel = document.getElementById("sr-modal-stripe-panel");
    var fallback = document.getElementById("sr-modal-fallback");
    if (stripePanel) stripePanel.hidden = true;
    if (fallback) fallback.hidden = false;
    var mail = document.getElementById("sr-mailto-btn");
    if (mail) mail.href = mailtoHref(orderId);
    if (orderId) {
      var orderEl = document.getElementById("sr-modal-order-id");
      if (orderEl) {
        orderEl.hidden = false;
        orderEl.textContent = "Saved order ID: " + orderId;
      }
    }
    if (message) setModalStatus(message, false);
  }

  function postCheckout(opts) {
    opts = opts || {};
    var payload = {
      service_slug: formState.service,
      buyer_name: formState.name,
      buyer_email: formState.email,
      buyer_phone: formState.phone || undefined,
      organization: formState.organization,
      details: formState.details,
      timeline: formState.timeline || undefined,
      confirm_only: !!opts.confirm_only,
    };
    return fetch("/api/service-checkout", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch (e) {
          data = null;
        }
        return { ok: res.ok, status: res.status, data: data };
      });
    });
  }

  /** Persist payment outcome to D1 (orders.status). */
  function postPaymentOutcome(orderId, outcome, sessionId) {
    if (!orderId) {
      return Promise.resolve({ ok: false, status: 0, data: null });
    }
    var payload = {
      order_id: orderId,
      outcome: outcome,
    };
    if (sessionId) payload.stripe_session_id = sessionId;
    return fetch("/api/service-payment-outcome", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch (e) {
          data = null;
        }
        return { ok: res.ok, status: res.status, data: data };
      });
    });
  }

  function onPayDeposit() {
    var btn = document.getElementById("sr-pay-btn");
    if (btn) btn.disabled = true;
    setModalStatus("Starting secure checkout…", false);

    postCheckout({ confirm_only: false })
      .then(function (result) {
        var data = result.data || {};
        var order = data.order;
        var orderId = order && order.id;

        if (orderId) {
          formState.pendingOrderId = orderId;
          formState.savedOrderId = orderId;
        }

        if (data.url) {
          setModalStatus("Redirecting to Stripe Checkout…", false);
          window.location.href = data.url;
          return;
        }

        if (data.stripe_enabled === false) {
          showFallback(
            orderId,
            data.message ||
              data.error ||
              "Card checkout is not available yet. Confirm below to finalize, or use email backup."
          );
          var confirmBtn = document.getElementById("sr-confirm-btn");
          if (confirmBtn) {
            confirmBtn.textContent = "Confirm request";
            confirmBtn.disabled = false;
          }
          setFormStatus(
            "Request saved as awaiting_payment — Confirm to finalize (or Cancel).",
            false
          );
          showToast(
            "Card checkout unavailable. Confirm below to save your request — no charge was taken.",
            "warn"
          );
          return;
        }

        var failMsg =
          (data.error || "Checkout could not start.") +
          (orderId ? " Order: " + orderId : "");
        setModalStatus(failMsg, true);
        showToast(
          "Payment was not completed. " +
            (data.error || "Checkout could not start.") +
            " No charge was taken.",
          "warn"
        );
        if (orderId) {
          // Worker should have set payment_failed; ensure UI can confirm/cancel
          showFallback(orderId, failMsg);
          var cbtn = document.getElementById("sr-confirm-btn");
          if (cbtn) {
            cbtn.textContent = "Confirm request";
            cbtn.disabled = false;
          }
        } else {
          showFallback(null);
        }
      })
      .catch(function () {
        setModalStatus("Network error starting checkout. Try Confirm request or email backup.", true);
        showToast(
          "Payment was not completed. Network error — no charge was taken.",
          "warn"
        );
        showFallback(null);
      })
      .finally(function () {
        if (btn) btn.disabled = false;
      });
  }

  function onConfirmRequest() {
    var btn = document.getElementById("sr-confirm-btn");
    if (btn) btn.disabled = true;
    setModalStatus("Confirming your request…", false);

    var existingId =
      (formState && (formState.savedOrderId || formState.pendingOrderId)) || null;

    var done = function (orderId, status) {
      if (formState) {
        formState.savedOrderId = orderId;
        formState.pendingOrderId = null;
      }
      var orderEl = document.getElementById("sr-modal-order-id");
      if (orderEl && orderId) {
        orderEl.hidden = false;
        orderEl.textContent =
          "Order " + orderId + " · status: " + (status || "payment_confirmed");
      }
      var mail = document.getElementById("sr-mailto-btn");
      if (mail) mail.href = mailtoHref(orderId);
      closeModal({});
      notifyPaymentSuccess(orderId);
    };

    var fail = function (errMsg) {
      setModalStatus(errMsg, true);
      showToast("Payment was not completed. " + errMsg, "warn");
      var mail2 = document.getElementById("sr-mailto-btn");
      if (mail2) mail2.href = mailtoHref(existingId || null);
    };

    var chain;
    if (existingId) {
      chain = postPaymentOutcome(existingId, "payment_confirmed").then(function (
        result
      ) {
        var data = result.data || {};
        if (result.ok && data.order) {
          done(data.order.id, data.order.status);
        } else {
          fail((data && data.error) || "Could not confirm payment in database.");
        }
      });
    } else {
      chain = postCheckout({ confirm_only: true }).then(function (result) {
        var data = result.data || {};
        var order = data.order;
        if (result.ok && order) {
          done(order.id, order.status || "payment_confirmed");
        } else {
          fail((data && data.error) || "Could not save request. Use email backup.");
        }
      });
    }

    chain
      .catch(function () {
        fail("Network error — no charge was taken.");
      })
      .finally(function () {
        if (btn) btn.disabled = false;
      });
  }

  function scrubPaymentQueryParams() {
    try {
      var u = new URL(window.location.href);
      var keys = ["paid", "canceled", "cancelled", "order", "session_id"];
      var changed = false;
      keys.forEach(function (k) {
        if (u.searchParams.has(k)) {
          u.searchParams.delete(k);
          changed = true;
        }
      });
      if (changed) {
        window.history.replaceState({}, "", u.pathname + (u.search ? u.search : "") + u.hash);
      }
    } catch (e) {}
  }

  function handleBanners() {
    var paidRaw = queryParam("paid");
    var paid = paidRaw === "1";
    var paidFail = paidRaw === "0";
    var cancelled =
      queryParam("canceled") === "1" ||
      queryParam("cancelled") === "1" ||
      paidFail;
    var order = queryParam("order");
    var sessionId = queryParam("session_id");

    if (!(paid || cancelled)) return;

    closeModal({});

    if (paid) {
      var banner = document.getElementById("sr-paid-banner");
      if (banner) banner.hidden = false;
      var apply = order
        ? postPaymentOutcome(order, "paid", sessionId || undefined)
        : Promise.resolve({ ok: false, data: null });
      apply
        .then(function (r) {
          var st =
            r.data && r.data.order && r.data.order.status
              ? r.data.order.status
              : "paid";
          var detail = document.getElementById("sr-paid-detail");
          if (detail) {
            detail.textContent = order
              ? " Order " +
                order.slice(0, 8) +
                "… · status: " +
                st +
                ". We will email next steps."
              : " We will email next steps.";
          }
          if (r.ok || (r.status === 200)) {
            notifyPaymentSuccess(order || null);
          } else if (r.status === 409) {
            notifyPaymentSuccess(order || null);
          } else {
            notifyPaymentSuccess(order || null);
            setFormStatus(
              "Payment return received" +
                (order ? " for order " + order.slice(0, 8) + "…" : "") +
                ". If status looks wrong in admin, contact support.",
              false
            );
          }
        })
        .catch(function () {
          notifyPaymentSuccess(order || null);
        })
        .then(function () {
          scrubPaymentQueryParams();
        });
      return;
    }

    if (cancelled) {
      var c = document.getElementById("sr-cancel-banner");
      if (c) c.hidden = false;
      var applyCancel = order
        ? postPaymentOutcome(order, "cancelled")
        : Promise.resolve({ ok: true, data: { order: { status: "cancelled" } } });
      applyCancel
        .then(function (r) {
          var st =
            r.data && r.data.order && r.data.order.status
              ? r.data.order.status
              : "cancelled";
          notifyPaymentNotCompleted(
            "Payment was not completed (status: " +
              st +
              "). No charge was taken."
          );
        })
        .catch(function () {
          notifyPaymentNotCompleted(
            "Payment was not completed. No charge was taken."
          );
        })
        .then(function () {
          scrubPaymentQueryParams();
        });
    }
  }

  function prefillsFromMe() {
    return fetch("/api/me", { credentials: "same-origin" })
      .then(function (res) {
        if (!res.ok) return null;
        return res.json();
      })
      .then(function (body) {
        var u = body && body.user;
        if (!u) return;
        var name = document.getElementById("sr-name");
        var email = document.getElementById("sr-email");
        var org = document.getElementById("sr-organization");
        var phone = document.getElementById("sr-phone");
        if (name && !name.value && u.name) name.value = u.name;
        if (email && !email.value && u.email) email.value = u.email;
        if (org && !org.value && u.organization) org.value = u.organization;
        if (phone && !phone.value && u.phone) phone.value = u.phone;
      })
      .catch(function () {});
  }

  function init() {
    var form = document.getElementById("sr-form");
    if (!form) return;

    fillServiceSelect();
    handleBanners();
    prefillsFromMe();

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var data = readForm();
      var err = validateForm(data);
      if (err) {
        setFormStatus(err, true);
        return;
      }
      formState = data;
      setFormStatus("Request ready — complete payment in the dialog to confirm (or Cancel to back out).", false);
      showToast("Request received — complete payment to confirm.", "info");
      openModal();
    });

    var modal = document.getElementById("sr-modal");
    if (modal) {
      modal.addEventListener("click", function (e) {
        if (e.target && e.target.getAttribute("data-sr-close") === "1") {
          closeModal({ cancelled: true });
        }
      });
    }
    document.addEventListener("keydown", onModalKeydown);

    var payBtn = document.getElementById("sr-pay-btn");
    if (payBtn) payBtn.addEventListener("click", onPayDeposit);
    var confirmBtn = document.getElementById("sr-confirm-btn");
    if (confirmBtn) confirmBtn.addEventListener("click", onConfirmRequest);
    var toastDismiss = document.getElementById("sr-toast-dismiss");
    if (toastDismiss) {
      toastDismiss.addEventListener("click", function () {
        hideToast();
      });
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    var select = document.getElementById("sr-service");
    if (select) {
      select.innerHTML = '<option value="">Loading service prices…</option>';
      select.disabled = true;
    }
    var note = document.getElementById("sr-price-load-note");
    if (note) {
      note.hidden = false;
      note.textContent = "Loading current deposit amounts…";
    }
    loadServicesFromApi().then(function () {
      if (select) select.disabled = false;
      if (note) note.hidden = true;
      init();
    });
  });
})();
