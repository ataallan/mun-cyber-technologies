/**
 * MC Chat Bot — on-site assistant widget
 * Opens via floating launcher or [data-open-chat] / window.MCChatBot.open()
 * Alias: window.MuncyberChat (compatibility)
 */
(function () {
  "use strict";

  var STORAGE_KEY = "muncyber_chat_thread_id";
  var API = "/api/chat";
  var BOT_NAME = "MC Chat Bot";
  var WELCOME =
    "Hi — I am MC Chat Bot with the Mun Cyber Team. Ask about services (awareness, software, defensive, AI), products (AI SOC Assistant, Mun Cyber Eye), or how to request help. Tap “Connect me to the Mun Cyber Team” anytime for a human follow-up from info@muncyber.com.";

  var root = null;
  var panel = null;
  var launcher = null;
  var messagesEl = null;
  var form = null;
  var input = null;
  var statusEl = null;
  var actionsEl = null;
  var handoffForm = null;
  var lastFocus = null;
  var sending = false;
  var pollTimer = null;
  var lastMsgCount = 0;
  var threadMeta = null;

  function getThreadId() {
    try {
      return localStorage.getItem(STORAGE_KEY) || null;
    } catch (e) {
      return null;
    }
  }

  function setThreadId(id) {
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id);
    } catch (e) {}
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtTime(iso) {
    if (!iso) return "";
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return "";
      return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    } catch (e) {
      return "";
    }
  }

  function whoLabel(role) {
    if (role === "user") return "You";
    if (role === "admin") return "Mun Cyber Team";
    return BOT_NAME;
  }

  function buildDom() {
    if (document.getElementById("muncyber-chat-root")) return;

    root = document.createElement("div");
    root.id = "muncyber-chat-root";
    root.className = "mc-chat-root";
    root.innerHTML =
      '<button type="button" class="mc-chat-launcher" id="mc-chat-launcher" aria-label="Open MC Chat Bot" aria-expanded="false" aria-controls="mc-chat-panel">' +
      '<span class="mc-chat-launcher-icon" aria-hidden="true">💬</span>' +
      '<span class="mc-chat-launcher-label">MC Chat Bot</span>' +
      "</button>" +
      '<div class="mc-chat-panel" id="mc-chat-panel" role="dialog" aria-modal="true" aria-labelledby="mc-chat-title" aria-describedby="mc-chat-subtitle" hidden>' +
      '  <header class="mc-chat-header">' +
      '    <div class="mc-chat-header-text">' +
      '      <h2 id="mc-chat-title">MC Chat Bot</h2>' +
      '      <p id="mc-chat-subtitle">Chat with the Mun Cyber Team</p>' +
      "    </div>" +
      '    <button type="button" class="mc-chat-close" id="mc-chat-close" aria-label="Close MC Chat Bot">×</button>' +
      "  </header>" +
      '  <div class="mc-chat-messages" id="mc-chat-messages" role="log" aria-live="polite" aria-relevant="additions"></div>' +
      '  <div class="mc-chat-actions" id="mc-chat-actions">' +
      '    <button type="button" class="mc-chat-connect" id="mc-chat-connect">Connect me to the Mun Cyber Team</button>' +
      "  </div>" +
      '  <form class="mc-chat-handoff" id="mc-chat-handoff" hidden>' +
      '    <p class="mc-chat-handoff-title">Connect to the Mun Cyber Team</p>' +
      '    <label class="visually-hidden" for="mc-chat-name">Name</label>' +
      '    <input type="text" id="mc-chat-name" name="name" maxlength="120" placeholder="Your name" required autocomplete="name">' +
      '    <label class="visually-hidden" for="mc-chat-email">Email</label>' +
      '    <input type="email" id="mc-chat-email" name="email" maxlength="200" placeholder="Email" required autocomplete="email">' +
      '    <label class="visually-hidden" for="mc-chat-phone">Phone (optional)</label>' +
      '    <input type="tel" id="mc-chat-phone" name="phone" maxlength="40" placeholder="Phone (optional)" autocomplete="tel">' +
      '    <label class="visually-hidden" for="mc-chat-note">Message (optional)</label>' +
      '    <textarea id="mc-chat-note" name="note" rows="2" maxlength="2000" placeholder="How can the team help? (optional)"></textarea>' +
      '    <div class="mc-chat-handoff-actions">' +
      '      <button type="submit" class="mc-chat-send">Connect</button>' +
      '      <button type="button" class="mc-chat-cancel" id="mc-chat-handoff-cancel">Cancel</button>' +
      "    </div>" +
      "  </form>" +
      '  <p class="mc-chat-status" id="mc-chat-status" role="status" aria-live="polite" hidden></p>' +
      '  <form class="mc-chat-form" id="mc-chat-form">' +
      '    <label class="visually-hidden" for="mc-chat-input">Message</label>' +
      '    <textarea id="mc-chat-input" name="message" rows="2" maxlength="4000" placeholder="Type your message…" required autocomplete="off"></textarea>' +
      '    <button type="submit" class="mc-chat-send" id="mc-chat-send">Send</button>' +
      "  </form>" +
      "</div>";

    document.body.appendChild(root);

    launcher = document.getElementById("mc-chat-launcher");
    panel = document.getElementById("mc-chat-panel");
    messagesEl = document.getElementById("mc-chat-messages");
    form = document.getElementById("mc-chat-form");
    input = document.getElementById("mc-chat-input");
    statusEl = document.getElementById("mc-chat-status");
    actionsEl = document.getElementById("mc-chat-actions");
    handoffForm = document.getElementById("mc-chat-handoff");

    launcher.addEventListener("click", function () {
      if (panel.hidden) open();
      else close();
    });
    document.getElementById("mc-chat-close").addEventListener("click", close);
    form.addEventListener("submit", onSubmit);
    document.getElementById("mc-chat-connect").addEventListener("click", function () {
      beginHandoff();
    });
    handoffForm.addEventListener("submit", onHandoffSubmit);
    document.getElementById("mc-chat-handoff-cancel").addEventListener("click", function () {
      hideHandoffForm();
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        form.requestSubmit();
      }
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && panel && !panel.hidden) {
        e.preventDefault();
        close();
      }
    });

    document.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var opener = t.closest("[data-open-chat]");
      if (opener) {
        e.preventDefault();
        open();
      }
    });
  }

  function setStatus(msg, isError) {
    if (!statusEl) return;
    if (!msg) {
      statusEl.hidden = true;
      statusEl.textContent = "";
      return;
    }
    statusEl.hidden = false;
    statusEl.textContent = msg;
    statusEl.classList.toggle("is-error", !!isError);
  }

  function appendMessage(role, body, createdAt, id) {
    if (!messagesEl) return;
    if (id) {
      var existing = null;
      var kids = messagesEl.children;
      for (var i = 0; i < kids.length; i++) {
        if (kids[i].getAttribute("data-id") === String(id)) {
          existing = kids[i];
          break;
        }
      }
      if (existing) return;
    }
    var row = document.createElement("div");
    var kind = role === "user" ? "user" : role === "admin" ? "admin" : "assistant";
    row.className = "mc-chat-msg mc-chat-msg--" + kind;
    if (id) row.setAttribute("data-id", id);
    row.innerHTML =
      '<div class="mc-chat-msg-meta"><span class="mc-chat-msg-who">' +
      esc(whoLabel(role)) +
      '</span><span class="mc-chat-msg-time">' +
      esc(fmtTime(createdAt)) +
      "</span></div>" +
      '<div class="mc-chat-msg-body">' +
      esc(body).replace(/\n/g, "<br>") +
      "</div>";
    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function clearMessages() {
    if (messagesEl) messagesEl.innerHTML = "";
  }

  function showWelcome() {
    clearMessages();
    appendMessage("assistant", WELCOME, new Date().toISOString(), "welcome");
    lastMsgCount = 0;
  }

  function renderHistory(messages) {
    clearMessages();
    if (!messages || !messages.length) {
      showWelcome();
      return;
    }
    messages.forEach(function (m) {
      if (m.role === "system") return;
      appendMessage(m.role, m.body, m.created_at, m.id);
    });
    lastMsgCount = messages.length;
  }

  function updateConnectVisibility() {
    if (!actionsEl) return;
    var status = threadMeta && threadMeta.status;
    var handed = status === "needs_human" || status === "handoff";
    actionsEl.hidden = !!handed;
    if (handed && handoffForm) handoffForm.hidden = true;
  }

  function showHandoffForm(prefill) {
    if (!handoffForm) return;
    handoffForm.hidden = false;
    if (actionsEl) actionsEl.hidden = true;
    var name = document.getElementById("mc-chat-name");
    var email = document.getElementById("mc-chat-email");
    var phone = document.getElementById("mc-chat-phone");
    var note = document.getElementById("mc-chat-note");
    if (prefill) {
      if (prefill.visitor_name && name) name.value = prefill.visitor_name;
      if (prefill.visitor_email && email) email.value = prefill.visitor_email;
      if (prefill.visitor_phone && phone) phone.value = prefill.visitor_phone;
    } else if (threadMeta) {
      if (threadMeta.visitor_name && name && !name.value) name.value = threadMeta.visitor_name;
      if (threadMeta.visitor_email && email && !email.value) email.value = threadMeta.visitor_email;
      if (threadMeta.visitor_phone && phone && !phone.value) phone.value = threadMeta.visitor_phone;
    }
    if (name) name.focus();
  }

  function hideHandoffForm() {
    if (handoffForm) handoffForm.hidden = true;
    updateConnectVisibility();
  }

  function beginHandoff() {
    var hasLead =
      threadMeta &&
      threadMeta.visitor_name &&
      threadMeta.visitor_email;
    if (hasLead) {
      submitHandoff({
        visitor_name: threadMeta.visitor_name,
        visitor_email: threadMeta.visitor_email,
        visitor_phone: threadMeta.visitor_phone || "",
        handoff_note: "",
        message: "Please connect me to the Mun Cyber Team.",
      });
      return;
    }
    showHandoffForm();
  }

  function parseJsonResponse(res) {
    return res.text().then(function (text) {
      var data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch (e) {
        data = null;
      }
      return { ok: res.ok, status: res.status, data: data };
    });
  }

  function applyThread(thread) {
    if (thread) {
      threadMeta = thread;
      if (thread.id) setThreadId(thread.id);
      updateConnectVisibility();
    }
  }

  function showLoadingHistory() {
    if (!messagesEl) return;
    clearMessages();
    var row = document.createElement("div");
    row.className = "mc-chat-msg mc-chat-msg-system";
    row.setAttribute("role", "status");
    row.innerHTML = '<div class="mc-chat-bubble">Loading conversation…</div>';
    messagesEl.appendChild(row);
  }

  function loadHistory() {
    var tid = getThreadId();
    if (!tid) {
      showWelcome();
      threadMeta = null;
      updateConnectVisibility();
      return Promise.resolve();
    }
    showLoadingHistory();
    return fetch(API + "?thread_id=" + encodeURIComponent(tid), {
      credentials: "same-origin",
    })
      .then(parseJsonResponse)
      .then(function (r) {
        if (!r.ok) {
          if (r.status === 404) {
            try {
              localStorage.removeItem(STORAGE_KEY);
            } catch (e) {}
          }
          showWelcome();
          threadMeta = null;
          updateConnectVisibility();
          return;
        }
        applyThread(r.data && r.data.thread);
        renderHistory((r.data && r.data.messages) || []);
      })
      .catch(function () {
        showWelcome();
      });
  }

  function looksLikeHumanRequest(text) {
    var t = String(text || "").toLowerCase();
    return /connect me|speak (to|with)|talk to|human|real person|live agent|mun cyber team|customer service|representative/.test(
      t
    );
  }

  function postChat(payload) {
    return fetch(API, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(parseJsonResponse);
  }

  function handlePostResult(r, userTextShown) {
    sending = false;
    form.classList.remove("is-sending");
    if (!r.ok) {
      setStatus((r.data && r.data.error) || "Could not send message. Try again.", true);
      return;
    }
    setStatus("");
    applyThread(r.data && r.data.thread);
    if (r.data && r.data.needs_contact) {
      showHandoffForm(r.data.thread || {});
      if (r.data.reply) {
        appendMessage(
          "assistant",
          r.data.reply.body,
          r.data.reply.created_at,
          r.data.reply.id
        );
      }
      return;
    }
    hideHandoffForm();
    if (r.data && r.data.reply) {
      appendMessage(
        r.data.reply.role || "assistant",
        r.data.reply.body,
        r.data.reply.created_at,
        r.data.reply.id
      );
    } else if (r.data && r.data.messages) {
      renderHistory(r.data.messages);
    }
    if (r.data && r.data.messages) lastMsgCount = r.data.messages.length;
    input && input.focus();
  }

  function onSubmit(e) {
    e.preventDefault();
    if (sending) return;
    var text = (input.value || "").trim();
    if (!text) return;

    sending = true;
    setStatus("Sending…");
    form.classList.add("is-sending");
    appendMessage("user", text, new Date().toISOString());
    input.value = "";

    var payload = { message: text };
    var tid = getThreadId();
    if (tid) payload.thread_id = tid;
    if (looksLikeHumanRequest(text)) payload.action = "handoff";

    postChat(payload)
      .then(function (r) {
        handlePostResult(r, true);
      })
      .catch(function () {
        sending = false;
        form.classList.remove("is-sending");
        setStatus("Network error. Please try again.", true);
      });
  }

  function onHandoffSubmit(e) {
    e.preventDefault();
    if (sending) return;
    var name = (document.getElementById("mc-chat-name").value || "").trim();
    var email = (document.getElementById("mc-chat-email").value || "").trim();
    var phone = (document.getElementById("mc-chat-phone").value || "").trim();
    var note = (document.getElementById("mc-chat-note").value || "").trim();
    if (!name || !email) {
      setStatus("Name and email are required to connect.", true);
      return;
    }
    submitHandoff({
      visitor_name: name,
      visitor_email: email,
      visitor_phone: phone,
      handoff_note: note,
      message: note || "Please connect me to the Mun Cyber Team.",
    });
  }

  function submitHandoff(fields) {
    sending = true;
    setStatus("Connecting…");
    form.classList.add("is-sending");
    appendMessage("user", fields.message, new Date().toISOString());

    var payload = {
      action: "handoff",
      message: fields.message,
      visitor_name: fields.visitor_name,
      visitor_email: fields.visitor_email,
      visitor_phone: fields.visitor_phone || "",
      handoff_note: fields.handoff_note || "",
    };
    var tid = getThreadId();
    if (tid) payload.thread_id = tid;

    postChat(payload)
      .then(function (r) {
        handlePostResult(r, true);
      })
      .catch(function () {
        sending = false;
        form.classList.remove("is-sending");
        setStatus("Network error. Please try again.", true);
      });
  }

  function startPoll() {
    stopPoll();
    pollTimer = setInterval(function () {
      if (!panel || panel.hidden) return;
      var tid = getThreadId();
      if (!tid) return;
      fetch(API + "?thread_id=" + encodeURIComponent(tid), {
        credentials: "same-origin",
      })
        .then(parseJsonResponse)
        .then(function (r) {
          if (!r.ok || !r.data) return;
          applyThread(r.data.thread);
          var msgs = r.data.messages || [];
          if (msgs.length > lastMsgCount) {
            renderHistory(msgs);
          }
        })
        .catch(function () {});
    }, 8000);
  }

  function stopPoll() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function trapFocus(e) {
    if (!panel || panel.hidden || e.key !== "Tab") return;
    var focusables = panel.querySelectorAll(
      'button, [href], textarea, input, select, [tabindex]:not([tabindex="-1"])'
    );
    var list = Array.prototype.filter.call(focusables, function (el) {
      return !el.disabled && el.offsetParent !== null && !el.hidden;
    });
    if (!list.length) return;
    var first = list[0];
    var last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function open() {
    buildDom();
    if (!panel.hidden) {
      input && input.focus();
      return;
    }
    lastFocus = document.activeElement;
    panel.hidden = false;
    root.classList.add("is-open");
    launcher.setAttribute("aria-expanded", "true");
    document.addEventListener("keydown", trapFocus);
    loadHistory().then(function () {
      input && input.focus();
      startPoll();
    });
  }

  function close() {
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    root.classList.remove("is-open");
    launcher.setAttribute("aria-expanded", "false");
    document.removeEventListener("keydown", trapFocus);
    stopPoll();
    hideHandoffForm();
    if (lastFocus && lastFocus.focus) {
      try {
        lastFocus.focus();
      } catch (e) {}
    } else if (launcher) {
      launcher.focus();
    }
  }

  function boot() {
    buildDom();
  }

  var api = {
    open: open,
    close: close,
    toggle: function () {
      if (panel && !panel.hidden) close();
      else open();
    },
    connect: beginHandoff,
  };

  window.MCChatBot = api;
  window.MuncyberChat = api;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
