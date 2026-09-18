/**
 * MUN Cyber Technologies — real auth via Worker API + HTTP-only session cookie
 * Enforces TOTP MFA setup before full signed-in use.
 */
(function () {
  "use strict";

  var API = {
    signup: "/api/signup",
    signin: "/api/signin",
    signout: "/api/signout",
    me: "/api/me",
    mfaSetup: "/api/mfa/setup",
    mfaEnable: "/api/mfa/enable",
    mfaVerify: "/api/mfa/verify",
    forgotPassword: "/api/forgot-password",
    resetPassword: "/api/reset-password",
  };

  var MFA_CHALLENGE_KEY = "mun_mfa_challenge_id";
  var FORGOT_CHALLENGE_KEY = "mun_forgot_challenge_id";
  var MFA_PAGES = {
    setup: "mfa-setup.html",
    verify: "mfa-verify.html",
  };

  var cachedUser = null;
  var cachedMfaSetupRequired = false;
  var mePromise = null;
  /* ---------- Idle sign-out (30 minutes) ---------- */
  var IDLE_TIMEOUT_MS = 30 * 60 * 1000;
  var IDLE_CHECK_MS = 30 * 1000;
  var lastActivityAt = Date.now();
  var idleTimer = null;

  function touchActivity() {
    lastActivityAt = Date.now();
  }


  function enableSignInFieldSuggestions() {
    var idInput = document.getElementById("signin-identifier");
    var pwInput = document.getElementById("signin-password");
    if (!idInput || !pwInput) return;

    // Start empty — do not keep browser-prefilled values on load
    idInput.value = "";
    pwInput.value = "";

    function armField(input, autocompleteValue) {
      function unlock() {
        input.removeAttribute("readonly");
        input.setAttribute("autocomplete", autocompleteValue);
      }
      input.addEventListener("focus", unlock);
      input.addEventListener("click", unlock);
      // Extra safety: some browsers autofill after load
      window.setTimeout(function () {
        if (document.activeElement !== input && document.activeElement !== pwInput && document.activeElement !== idInput) {
          input.value = "";
        }
      }, 50);
      window.setTimeout(function () {
        if (document.activeElement !== input && document.activeElement !== pwInput && document.activeElement !== idInput) {
          input.value = "";
        }
      }, 300);
    }

    armField(idInput, "username");
    armField(pwInput, "current-password");
  }

  function startIdleWatch() {
    if (idleTimer) return;
    ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"].forEach(function (evt) {
      window.addEventListener(evt, touchActivity, { passive: true });
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") touchActivity();
    });
    idleTimer = window.setInterval(function () {
      if (!cachedUser) return;
      if (Date.now() - lastActivityAt < IDLE_TIMEOUT_MS) return;
      signOut().then(function () {
        window.location.href = "/signup?idle=1";
      });
    }, IDLE_CHECK_MS);
    // Keep server session in sync while the tab is open
    window.setInterval(function () {
      if (!cachedUser) return;
      mePromise = null;
      fetchMe().then(function (user) {
        if (!user && !isMfaSetupPage() && !isMfaVerifyPage()) {
          window.location.href = "/signup?idle=1";
        }
      });
    }, 5 * 60 * 1000);
  }


  function apiFetch(url, options) {
    var opts = options || {};
    var headers = Object.assign(
      { "Content-Type": "application/json" },
      opts.headers || {}
    );
    return fetch(url, Object.assign({}, opts, {
      credentials: "same-origin",
      headers: headers,
    }));
  }

  async function parseResponse(res) {
    var data = null;
    var text = await res.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (e) {
        data = null;
      }
    }
    return { ok: res.ok, status: res.status, data: data };
  }

  function pageName() {
    try {
      var path = window.location.pathname || "";
      var parts = path.split("/").filter(Boolean);
      var last = parts.length ? parts[parts.length - 1] : "index.html";
      return last;
    } catch (e) {
      return "";
    }
  }

  /** Normalize Cloudflare asset paths: /mfa-setup <-> mfa-setup.html */
  function pageBase(name) {
    var n = (name || "").split("?")[0].split("#")[0];
    if (!n || n === "/") return "index";
    if (n.endsWith(".html")) n = n.slice(0, -5);
    return n.toLowerCase();
  }

  function isPage() {
    var current = pageBase(pageName());
    for (var i = 0; i < arguments.length; i++) {
      if (current === pageBase(arguments[i])) return true;
    }
    return false;
  }

  function isMfaSetupPage() {
    return isPage(MFA_PAGES.setup, "mfa-setup");
  }

  function isMfaVerifyPage() {
    return isPage(MFA_PAGES.verify, "mfa-verify");
  }

  function redirectToMfaSetup() {
    if (!isMfaSetupPage()) {
      window.location.href = "/mfa-setup";
    }
  }

  function redirectToMfaVerify() {
    if (!isMfaVerifyPage()) {
      window.location.href = "/mfa-verify";
    }
  }

  function fetchMe() {
    if (mePromise) return mePromise;
    mePromise = apiFetch(API.me, { method: "GET", headers: {} })
      .then(function (res) {
        if (!res.ok) {
          cachedUser = null;
          cachedMfaSetupRequired = false;
          return null;
        }
        return res.json().then(function (body) {
          cachedUser = (body && body.user) || null;
          cachedMfaSetupRequired = !!(body && body.mfa_setup_required);
          if (cachedUser) {
            cachedUser.mfa_setup_required = cachedMfaSetupRequired;
          }
          return cachedUser;
        });
      })
      .catch(function () {
        cachedUser = null;
        cachedMfaSetupRequired = false;
        return null;
      });
    return mePromise;
  }

  function currentUser() {
    return cachedUser;
  }

  function isSignedIn() {
    return !!cachedUser && !cachedMfaSetupRequired;
  }

  function isMfaSetupRequired() {
    return cachedMfaSetupRequired;
  }

  async function signOut() {
    try {
      await apiFetch(API.signout, { method: "POST", body: "{}" });
    } catch (e) {
      /* ignore network errors; clear local state anyway */
    }
    cachedUser = null;
    cachedMfaSetupRequired = false;
    mePromise = null;
    try {
      sessionStorage.removeItem(MFA_CHALLENGE_KEY);
    } catch (e2) {}
  }

  function updateNavAuth(user) {
    var nav = document.getElementById("primary-nav");
    if (!nav) return;

    var existing = nav.querySelector(".nav-auth");
    if (existing) existing.remove();

    var signupLink = nav.querySelector('a[href="signup.html"]');

    if (user) {
      if (signupLink) signupLink.hidden = true;

      var wrap = document.createElement("div");
      wrap.className = "nav-auth";
      wrap.setAttribute("role", "group");
      wrap.setAttribute("aria-label", "Account");

      var label = document.createElement("span");
      label.className = "nav-auth-label";
      var who = user.name || user.email || user.phone || "account";
      if (cachedMfaSetupRequired) {
        label.textContent = "Finish MFA setup — " + who;
      } else {
        label.textContent = "Signed in as " + who;
      }

      var outBtn = document.createElement("button");
      outBtn.type = "button";
      outBtn.className = "nav-signout";
      outBtn.textContent = "Sign out";
      outBtn.addEventListener("click", function () {
        signOut().then(function () {
          window.location.reload();
        });
      });

      // Admin link for role === admin (full session only)
      var existingAdmin = nav.querySelector(".nav-admin-link");
      if (existingAdmin) existingAdmin.remove();
      if (!cachedMfaSetupRequired && user.role === "admin") {
        var adminLink = document.createElement("a");
        adminLink.href = "/admin";
        adminLink.className = "nav-admin-link";
        adminLink.textContent = "Admin";
        if (isPage("admin")) {
          adminLink.setAttribute("aria-current", "page");
        }
        // Insert before Contact CTA if present, else before auth wrap
        var cta = nav.querySelector(".nav-cta");
        if (cta) nav.insertBefore(adminLink, cta);
        else nav.appendChild(adminLink);
      }

      wrap.appendChild(label);
      wrap.appendChild(outBtn);
      nav.appendChild(wrap);
    } else if (signupLink) {
      signupLink.hidden = false;
      var deadAdmin = nav.querySelector(".nav-admin-link");
      if (deadAdmin) deadAdmin.remove();
    }
  }

  function showStatus(el, message, isError) {
    if (!el) return;
    el.hidden = false;
    el.textContent = message;
    el.classList.toggle("form-status-error", !!isError);
    el.classList.toggle("form-status", true);
  }

  function passwordStrengthError(password) {
    if (!password || password.length < 8) {
      return "Password must be at least 8 characters and include uppercase, lowercase, a number, and a symbol.";
    }
    if (!/[a-z]/.test(password)) return "Password must include at least one lowercase letter.";
    if (!/[A-Z]/.test(password)) return "Password must include at least one uppercase letter.";
    if (!/[0-9]/.test(password)) return "Password must include at least one number.";
    if (!/[^A-Za-z0-9]/.test(password)) return "Password must include at least one symbol (for example !@#$%).";
    return null;
  }

  function clearFormFields(form) {
    if (!form) return;
    try { form.reset(); } catch (e) {}
    Array.prototype.forEach.call(form.querySelectorAll("input"), function (input) {
      input.value = "";
    });
  }

  function setBusy(form, busy) {
    if (!form) return;
    var btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = !!busy;
  }

  function enforceMfaGate(user) {
    if (!user) return;
    if (cachedMfaSetupRequired && !isMfaSetupPage()) {
      // Allow MFA verify only when we have a challenge (password step done for MFA users)
      if (isMfaVerifyPage()) return;
      redirectToMfaSetup();
    }
  }

  /* ---------- Sign up ---------- */
  var signupForm = document.getElementById("signup-form");
  if (signupForm) {
    signupForm.addEventListener("submit", function (event) {
      event.preventDefault();
      var statusEl = document.getElementById("signup-status");
      var name = (signupForm.elements.namedItem("name").value || "").trim();
      var password = signupForm.elements.namedItem("password").value || "";
      var confirm = signupForm.elements.namedItem("confirm").value || "";
      var organization = (signupForm.elements.namedItem("organization").value || "").trim();
      var method = signupForm.getAttribute("data-method") || "email";
      var emailEl = signupForm.elements.namedItem("email");
      var phoneEl = signupForm.elements.namedItem("phone");
      var email = emailEl ? (emailEl.value || "").trim().toLowerCase() : "";
      var phone = phoneEl ? (phoneEl.value || "").trim() : "";

      if (!name || !password) {
        showStatus(statusEl, "Please fill in name and password.", true);
        return;
      }
      if (method === "email" && !email) {
        showStatus(statusEl, "Please enter an email address.", true);
        return;
      }
      if (method === "phone" && !phone) {
        showStatus(statusEl, "Please enter a phone number with +country code.", true);
        return;
      }
      var strengthErr = passwordStrengthError(password);
      if (strengthErr) {
        showStatus(statusEl, strengthErr, true);
        return;
      }
      if (password !== confirm) {
        showStatus(statusEl, "Passwords do not match.", true);
        return;
      }

      setBusy(signupForm, true);
      showStatus(statusEl, "Creating account…", false);

      var payload = {
        name: name,
        password: password,
        organization: organization || undefined,
        method: method,
      };
      if (method === "email") payload.email = email;
      else payload.phone = phone;

      apiFetch(API.signup, {
        method: "POST",
        body: JSON.stringify(payload),
      })
        .then(parseResponse)
        .then(function (result) {
          if (result.status === 409) {
            var msg =
              (result.data && result.data.error) ||
              "An account with this email already exists. Sign in instead.";
            if (typeof window.MunAuthShowSignIn === "function") {
              window.MunAuthShowSignIn();
              var signinStatus = document.getElementById("signin-status");
              var signinId = document.getElementById("signin-identifier");
              var method = signupForm.getAttribute("data-method") || "email";
              var src = method === "phone"
                ? document.getElementById("signup-phone")
                : document.getElementById("signup-email");
              if (signinId && src && src.value) {
                signinId.value = src.value;
              }
              showStatus(signinStatus, msg, true);
            } else {
              showStatus(statusEl, msg, true);
            }
            return;
          }
          if (result.status === 400) {
            showStatus(
              statusEl,
              (result.data && result.data.error) || "Please check your details.",
              true
            );
            return;
          }
          if (!result.ok || !result.data || !result.data.user) {
            showStatus(
              statusEl,
              (result.data && result.data.error) || "Could not create account. Try again.",
              true
            );
            return;
          }
          cachedUser = result.data.user;
          cachedMfaSetupRequired = true;
          mePromise = Promise.resolve(cachedUser);
          clearFormFields(signupForm);
          showStatus(statusEl, "Account created. Set up authenticator MFA…", false);
          window.setTimeout(function () {
            window.location.href = "/mfa-setup";
          }, 500);
        })
        .catch(function () {
          showStatus(statusEl, "Network error. Please try again.", true);
        })
        .finally(function () {
          setBusy(signupForm, false);
          var pw = signupForm.elements.namedItem("password");
          var cf = signupForm.elements.namedItem("confirm");
          if (pw) pw.value = "";
          if (cf) cf.value = "";
        });
    });
  }

  /* ---------- Sign in ---------- */
  var signinForm = document.getElementById("signin-form");
  if (signinForm) {
    signinForm.addEventListener("submit", function (event) {
      event.preventDefault();
      var statusEl = document.getElementById("signin-status");
      var idField = signinForm.elements.namedItem("identifier") || signinForm.elements.namedItem("email");
      var identifier = (idField && idField.value ? idField.value : "").trim();
      var password = signinForm.elements.namedItem("password").value || "";

      if (!identifier || !password) {
        showStatus(statusEl, "Please enter email or phone and password.", true);
        return;
      }

      setBusy(signinForm, true);
      showStatus(statusEl, "Signing in…", false);

      apiFetch(API.signin, {
        method: "POST",
        body: JSON.stringify({ identifier: identifier, password: password }),
      })
        .then(parseResponse)
        .then(function (result) {
          // Always clear credentials from the form after Sign in is pressed
          clearFormFields(signinForm);
          if (result.status === 401 || result.status === 403) {
            showStatus(
              statusEl,
              (result.data && result.data.error) || "Invalid email/phone or password.",
              true
            );
            return;
          }
          if (!result.ok || !result.data) {
            showStatus(
              statusEl,
              (result.data && result.data.error) || "Could not sign in. Try again.",
              true
            );
            return;
          }

          if (result.data.mfa_required && result.data.challenge_id) {
            try {
              sessionStorage.setItem(MFA_CHALLENGE_KEY, result.data.challenge_id);
            } catch (e) {}
            showStatus(statusEl, "Enter your authenticator code…", false);
            window.setTimeout(function () {
              window.location.href = "/mfa-verify";
            }, 400);
            return;
          }

          if (result.data.mfa_setup_required && result.data.user) {
            cachedUser = result.data.user;
            cachedMfaSetupRequired = true;
            mePromise = Promise.resolve(cachedUser);
            showStatus(statusEl, "MFA setup required. Redirecting…", false);
            window.setTimeout(function () {
              window.location.href = "/mfa-setup";
            }, 400);
            return;
          }

          if (!result.data.user) {
            showStatus(
              statusEl,
              (result.data && result.data.error) || "Could not sign in. Try again.",
              true
            );
            return;
          }

          cachedUser = result.data.user;
          cachedMfaSetupRequired = !!result.data.mfa_setup_required;
          mePromise = Promise.resolve(cachedUser);
          showStatus(statusEl, "Signed in. Redirecting to Products…", false);
          window.setTimeout(function () {
            window.location.href = "/products";
          }, 500);
        })
        .catch(function () {
          clearFormFields(signinForm);
          showStatus(statusEl, "Network error. Please try again.", true);
        })
        .finally(function () {
          setBusy(signinForm, false);
        });
    });
  }

  /* ---------- MFA setup page ---------- */
  function initMfaSetupPage() {
    if (!isMfaSetupPage()) return;

    var statusEl = document.getElementById("mfa-setup-status");
    var secretEl = document.getElementById("mfa-secret");
    var qrImg = document.getElementById("mfa-qr");
    var otpauthLink = document.getElementById("mfa-otpauth-link");
    var enableForm = document.getElementById("mfa-enable-form");

    fetchMe().then(function (user) {
      if (!user) {
        window.location.href = "/signup";
        return;
      }
      updateNavAuth(user);
      if (user.mfa_enabled && !cachedMfaSetupRequired) {
        window.location.href = "/products";
        return;
      }

      showStatus(statusEl, "Generating authenticator setup…", false);
      apiFetch(API.mfaSetup, { method: "POST", body: "{}" })
        .then(parseResponse)
        .then(function (result) {
          if (!result.ok || !result.data) {
            showStatus(
              statusEl,
              (result.data && result.data.error) || "Could not start MFA setup.",
              true
            );
            return;
          }
          var secret = result.data.secret;
          var otpauth = result.data.otpauth_url;
          if (secretEl) secretEl.textContent = secret;
          if (otpauthLink) {
            otpauthLink.href = otpauth;
            otpauthLink.textContent = "Open in authenticator app";
          }
          if (qrImg && otpauth) {
            qrImg.src =
              "https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=" +
              encodeURIComponent(otpauth);
            qrImg.alt = "QR code for authenticator app";
            qrImg.hidden = false;
          }
          showStatus(
            statusEl,
            "Scan the QR code or enter the secret in your authenticator app, then enter the 6-digit code below.",
            false
          );
        })
        .catch(function () {
          showStatus(statusEl, "Network error. Please try again.", true);
        });
    });

    if (enableForm) {
      enableForm.addEventListener("submit", function (event) {
        event.preventDefault();
        var codeInput = enableForm.elements.namedItem("code");
        var code = (codeInput && codeInput.value ? codeInput.value : "").trim();
        if (!/^\d{6}$/.test(code)) {
          showStatus(statusEl, "Enter the 6-digit code from your authenticator app.", true);
          return;
        }
        setBusy(enableForm, true);
        showStatus(statusEl, "Verifying code…", false);
        apiFetch(API.mfaEnable, {
          method: "POST",
          body: JSON.stringify({ code: code }),
        })
          .then(parseResponse)
          .then(function (result) {
            if (!result.ok || !result.data || !result.data.user) {
              showStatus(
                statusEl,
                (result.data && result.data.error) || "Could not enable MFA.",
                true
              );
              return;
            }
            cachedUser = result.data.user;
            cachedMfaSetupRequired = false;
            mePromise = Promise.resolve(cachedUser);
            showStatus(statusEl, "MFA enabled. Redirecting to Products…", false);
            window.setTimeout(function () {
              window.location.href = "/products";
            }, 500);
          })
          .catch(function () {
            showStatus(statusEl, "Network error. Please try again.", true);
          })
          .finally(function () {
            setBusy(enableForm, false);
            if (codeInput) codeInput.value = "";
          });
      });
    }
  }

  /* ---------- MFA verify page (post password when MFA already enabled) ---------- */
  function initMfaVerifyPage() {
    if (!isMfaVerifyPage()) return;

    var statusEl = document.getElementById("mfa-verify-status");
    var verifyForm = document.getElementById("mfa-verify-form");
    var challengeId = null;
    try {
      challengeId = sessionStorage.getItem(MFA_CHALLENGE_KEY);
    } catch (e) {}

    if (!challengeId) {
      showStatus(statusEl, "No pending sign-in challenge. Please sign in again.", true);
      window.setTimeout(function () {
        window.location.href = "/signup";
      }, 1200);
      return;
    }

    if (verifyForm) {
      verifyForm.addEventListener("submit", function (event) {
        event.preventDefault();
        var codeInput = verifyForm.elements.namedItem("code");
        var code = (codeInput && codeInput.value ? codeInput.value : "").trim();
        if (!/^\d{6}$/.test(code)) {
          showStatus(statusEl, "Enter the 6-digit code from your authenticator app.", true);
          return;
        }
        setBusy(verifyForm, true);
        showStatus(statusEl, "Verifying…", false);
        apiFetch(API.mfaVerify, {
          method: "POST",
          body: JSON.stringify({ challenge_id: challengeId, code: code }),
        })
          .then(parseResponse)
          .then(function (result) {
            if (!result.ok || !result.data || !result.data.user) {
              showStatus(
                statusEl,
                (result.data && result.data.error) || "Invalid code. Try again.",
                true
              );
              return;
            }
            try {
              sessionStorage.removeItem(MFA_CHALLENGE_KEY);
            } catch (e2) {}
            cachedUser = result.data.user;
            cachedMfaSetupRequired = false;
            mePromise = Promise.resolve(cachedUser);
            showStatus(statusEl, "Signed in. Redirecting to Products…", false);
            window.setTimeout(function () {
              window.location.href = "/products";
            }, 400);
          })
          .catch(function () {
            showStatus(statusEl, "Network error. Please try again.", true);
          })
          .finally(function () {
            setBusy(verifyForm, false);
            if (codeInput) codeInput.value = "";
          });
      });
    }
  }

  /* ---------- Forgot password ---------- */
  function initForgotPasswordPage() {
    if (!isPage("forgot-password.html", "forgot-password")) return;

    var idForm = document.getElementById("forgot-identifier-form");
    var resetForm = document.getElementById("forgot-reset-form");
    var statusEl = document.getElementById("forgot-status");
    var resetStatusEl = document.getElementById("forgot-reset-status");
    var challengeId = null;

    try {
      challengeId = sessionStorage.getItem(FORGOT_CHALLENGE_KEY);
    } catch (e) {}

    if (challengeId && resetForm && idForm) {
      idForm.hidden = true;
      resetForm.hidden = false;
    }

    if (idForm) {
      idForm.addEventListener("submit", function (event) {
        event.preventDefault();
        var idField = idForm.elements.namedItem("identifier");
        var identifier = (idField && idField.value ? idField.value : "").trim();
        if (!identifier) {
          showStatus(statusEl, "Please enter email or phone.", true);
          return;
        }
        setBusy(idForm, true);
        showStatus(statusEl, "Checking…", false);
        apiFetch(API.forgotPassword, {
          method: "POST",
          body: JSON.stringify({ identifier: identifier }),
        })
          .then(parseResponse)
          .then(function (result) {
            if (result.status === 429) {
              showStatus(
                statusEl,
                (result.data && result.data.error) || "Too many requests. Try again shortly.",
                true
              );
              return;
            }
            if (result.status === 400) {
              showStatus(
                statusEl,
                (result.data && result.data.error) || "Please check your email or phone.",
                true
              );
              return;
            }
            if (!result.ok || !result.data) {
              showStatus(
                statusEl,
                (result.data && result.data.error) || "Could not start reset. Try again.",
                true
              );
              return;
            }
            if (result.data.mfa_required && result.data.challenge_id) {
              challengeId = result.data.challenge_id;
              try {
                sessionStorage.setItem(FORGOT_CHALLENGE_KEY, challengeId);
              } catch (e2) {}
              if (idForm) idForm.hidden = true;
              if (resetForm) resetForm.hidden = false;
              var msg = result.data.message || "Enter the code from your authenticator app.";
              if (result.data.email_sent) {
                msg += " A reset link was also emailed if that address is on file.";
              }
              showStatus(resetStatusEl, msg, false);
              return;
            }
            showStatus(
              statusEl,
              (result.data && result.data.message) ||
                "If an account exists, reset instructions were sent.",
              false
            );
          })
          .catch(function () {
            showStatus(statusEl, "Network error. Please try again.", true);
          })
          .finally(function () {
            setBusy(idForm, false);
          });
      });
    }

    if (resetForm) {
      resetForm.addEventListener("submit", function (event) {
        event.preventDefault();
        var codeInput = resetForm.elements.namedItem("code");
        var passwordInput = resetForm.elements.namedItem("password");
        var confirmInput = resetForm.elements.namedItem("confirm");
        var code = (codeInput && codeInput.value ? codeInput.value : "").trim();
        var password = passwordInput ? passwordInput.value || "" : "";
        var confirm = confirmInput ? confirmInput.value || "" : "";
        if (!challengeId) {
          try {
            challengeId = sessionStorage.getItem(FORGOT_CHALLENGE_KEY);
          } catch (e3) {}
        }
        if (!challengeId) {
          showStatus(resetStatusEl, "Session expired. Start again with your email or phone.", true);
          if (idForm) idForm.hidden = false;
          resetForm.hidden = true;
          return;
        }
        if (!/^\d{6}$/.test(code)) {
          showStatus(resetStatusEl, "Enter the 6-digit code from your authenticator app.", true);
          return;
        }
        var strengthErr = passwordStrengthError(password);
        if (strengthErr) {
          showStatus(resetStatusEl, strengthErr, true);
          return;
        }
        if (password !== confirm) {
          showStatus(resetStatusEl, "Passwords do not match.", true);
          return;
        }
        setBusy(resetForm, true);
        showStatus(resetStatusEl, "Updating password…", false);
        apiFetch(API.resetPassword, {
          method: "POST",
          body: JSON.stringify({
            challenge_id: challengeId,
            code: code,
            password: password,
          }),
        })
          .then(parseResponse)
          .then(function (result) {
            if (!result.ok || !result.data || !result.data.ok) {
              showStatus(
                resetStatusEl,
                (result.data && result.data.error) || "Could not reset password. Try again.",
                true
              );
              return;
            }
            try {
              sessionStorage.removeItem(FORGOT_CHALLENGE_KEY);
            } catch (e4) {}
            showStatus(
              resetStatusEl,
              (result.data && result.data.message) || "Password updated. You can sign in.",
              false
            );
            window.setTimeout(function () {
              window.location.href = "/signup";
            }, 800);
          })
          .catch(function () {
            showStatus(resetStatusEl, "Network error. Please try again.", true);
          })
          .finally(function () {
            setBusy(resetForm, false);
            if (passwordInput) passwordInput.value = "";
            if (confirmInput) confirmInput.value = "";
            if (codeInput) codeInput.value = "";
          });
      });
    }
  }

  /* ---------- Reset password (email token) ---------- */
  function initResetPasswordPage() {
    if (!isPage("reset-password.html", "reset-password")) return;

    var form = document.getElementById("reset-password-form");
    var statusEl = document.getElementById("reset-password-status");
    var token = null;
    try {
      token = new URLSearchParams(window.location.search).get("token");
    } catch (e) {}
    if (!token) {
      showStatus(statusEl, "Missing or invalid reset link. Request a new one from Forgot password.", true);
      if (form) {
        Array.prototype.forEach.call(form.querySelectorAll("input, button"), function (el) {
          el.disabled = true;
        });
      }
      return;
    }

    if (form) {
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        var passwordInput = form.elements.namedItem("password");
        var confirmInput = form.elements.namedItem("confirm");
        var password = passwordInput ? passwordInput.value || "" : "";
        var confirm = confirmInput ? confirmInput.value || "" : "";
        var strengthErr = passwordStrengthError(password);
        if (strengthErr) {
          showStatus(statusEl, strengthErr, true);
          return;
        }
        if (password !== confirm) {
          showStatus(statusEl, "Passwords do not match.", true);
          return;
        }
        setBusy(form, true);
        showStatus(statusEl, "Updating password…", false);
        apiFetch(API.resetPassword, {
          method: "POST",
          body: JSON.stringify({ token: token, password: password }),
        })
          .then(parseResponse)
          .then(function (result) {
            if (!result.ok || !result.data || !result.data.ok) {
              showStatus(
                statusEl,
                (result.data && result.data.error) || "Could not reset password. Request a new link.",
                true
              );
              return;
            }
            showStatus(
              statusEl,
              (result.data && result.data.message) || "Password updated. You can sign in.",
              false
            );
            window.setTimeout(function () {
              window.location.href = "/signup";
            }, 800);
          })
          .catch(function () {
            showStatus(statusEl, "Network error. Please try again.", true);
          })
          .finally(function () {
            setBusy(form, false);
            if (passwordInput) passwordInput.value = "";
            if (confirmInput) confirmInput.value = "";
          });
      });
    }
  }

  /* Prefill purchase form from /api/me when available */
  function prefillFromAccount(user) {
    if (!user) return;
    var nameInput = document.getElementById("buyer-name");
    var emailInput = document.getElementById("buyer-email");
    var orgInput = document.getElementById("buyer-organization");
    if (nameInput && !nameInput.value) nameInput.value = user.name || "";
    if (emailInput && !emailInput.value) emailInput.value = user.email || user.phone || "";
    if (orgInput && !orgInput.value) orgInput.value = user.organization || "";
  }

  function showSignInPanel(focus) {
    var panelSignin = document.getElementById("panel-signin");
    var panelSignup = document.getElementById("panel-signup");
    if (!panelSignin || !panelSignup) return;
    panelSignup.hidden = true;
    panelSignin.hidden = false;
    if (focus !== false) {
      var heading = document.getElementById("signin-heading");
      if (heading) {
        heading.setAttribute("tabindex", "-1");
        heading.focus();
      }
    }
  }

  function showSignUpPanel(focus) {
    var panelSignin = document.getElementById("panel-signin");
    var panelSignup = document.getElementById("panel-signup");
    if (!panelSignin || !panelSignup) return;
    panelSignin.hidden = true;
    panelSignup.hidden = false;
    if (focus !== false) {
      var heading = document.getElementById("signup-heading");
      if (heading) {
        heading.setAttribute("tabindex", "-1");
        heading.focus();
      }
    }
  }

  window.MunAuthShowSignIn = showSignInPanel;
  window.MunAuthShowSignUp = showSignUpPanel;

  function setSignupMethod(method) {
    var form = document.getElementById("signup-form");
    var emailField = document.getElementById("signup-email-field");
    var phoneField = document.getElementById("signup-phone-field");
    var emailInput = document.getElementById("signup-email");
    var phoneInput = document.getElementById("signup-phone");
    var tabEmail = document.getElementById("tab-email");
    var tabPhone = document.getElementById("tab-phone");
    if (!form) return;
    method = method === "phone" ? "phone" : "email";
    form.setAttribute("data-method", method);
    if (emailField) emailField.hidden = method !== "email";
    if (phoneField) phoneField.hidden = method !== "phone";
    if (emailInput) {
      emailInput.required = method === "email";
      if (method !== "email") emailInput.value = "";
    }
    if (phoneInput) {
      phoneInput.required = method === "phone";
      if (method !== "phone") phoneInput.value = "";
    }
    if (tabEmail) {
      tabEmail.classList.toggle("is-active", method === "email");
      tabEmail.setAttribute("aria-selected", method === "email" ? "true" : "false");
    }
    if (tabPhone) {
      tabPhone.classList.toggle("is-active", method === "phone");
      tabPhone.setAttribute("aria-selected", method === "phone" ? "true" : "false");
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    startIdleWatch();
    try {
      if (new URLSearchParams(window.location.search).get("idle") === "1") {
        var hint = document.getElementById("signin-status");
        if (hint) {
          hint.hidden = false;
          hint.textContent = "You were signed out after 30 minutes of inactivity.";
          hint.classList.add("form-status");
        }
      }
    } catch (eIdle) {}

    var showSignupBtn = document.getElementById("show-signup");
    var showSigninBtn = document.getElementById("show-signin");
    var tabEmail = document.getElementById("tab-email");
    var tabPhone = document.getElementById("tab-phone");
    if (tabEmail) {
      tabEmail.addEventListener("click", function () { setSignupMethod("email"); });
    }
    if (tabPhone) {
      tabPhone.addEventListener("click", function () { setSignupMethod("phone"); });
    }
    setSignupMethod("email");
    if (showSignupBtn) {
      showSignupBtn.addEventListener("click", function () {
        showSignUpPanel(true);
      });
    }
    if (showSigninBtn) {
      showSigninBtn.addEventListener("click", function () {
        showSignInPanel(true);
      });
    }

    try {
      var params = new URLSearchParams(window.location.search);
      if (params.get("mode") === "signup") {
        showSignUpPanel(false);
      }
    } catch (e) {
      /* ignore */
    }


    function bindPasswordToggle(btnId, inputId) {
      var btn = document.getElementById(btnId);
      var input = document.getElementById(inputId);
      if (!btn || !input) return;
      btn.addEventListener("click", function () {
        var showing = input.type === "text";
        input.type = showing ? "password" : "text";
        btn.setAttribute("aria-pressed", showing ? "false" : "true");
        btn.setAttribute("aria-label", showing ? "Show password" : "Hide password");
        btn.textContent = showing ? "Show" : "Hide";
      });
    }
    bindPasswordToggle("toggle-signin-password", "signin-password");
    enableSignInFieldSuggestions();

    initMfaSetupPage();
    initMfaVerifyPage();
    initForgotPasswordPage();
    initResetPasswordPage();

    if (!isMfaSetupPage() && !isMfaVerifyPage()) {
      fetchMe().then(function (user) {
        updateNavAuth(user);
        prefillFromAccount(user);
        enforceMfaGate(user);
      });
    }
  });

  window.MunAuth = {
    currentUser: currentUser,
    isSignedIn: isSignedIn,
    isMfaSetupRequired: isMfaSetupRequired,
    signOut: signOut,
    fetchMe: fetchMe,
  };
})();
