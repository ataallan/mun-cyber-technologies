/**
 * MUN Cyber Technologies — Admin dashboard
 */
(function () {
  "use strict";

  var API = {
    overview: "/api/admin/overview",
    users: "/api/admin/users",
    products: "/api/admin/products",
    orders: "/api/admin/orders",
    messages: "/api/admin/messages",
    chats: "/api/admin/chats",
  };

  var titles = {
    overview: "Overview",
    users: "Accounts — create, disable, delete, roles",
    products: "Products & prices",
    orders: "Purchases & customer requests",
    messages: "Notify customers",
    chats: "MC Chat Bot"
  };

  var currentUser = null;
  var usersCache = [];

  function api(url, options) {
    var opts = options || {};
    var headers = Object.assign(
      { "Content-Type": "application/json" },
      opts.headers || {}
    );
    return fetch(url, Object.assign({}, opts, {
      credentials: "same-origin",
      headers: headers,
    })).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        if (text) {
          try {
            data = JSON.parse(text);
          } catch (e) {
            data = null;
          }
        }
        return { ok: res.ok, status: res.status, data: data };
      });
    });
  }

  function setStatus(msg, isError) {
    var el = document.getElementById("admin-status");
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = msg;
    el.classList.toggle("is-error", !!isError);
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleString();
    } catch (e) {
      return iso;
    }
  }

  function showGate(msg) {
    var gate = document.getElementById("admin-gate");
    var app = document.getElementById("admin-app");
    var msgEl = document.getElementById("admin-gate-msg");
    if (app) app.hidden = true;
    if (gate) gate.hidden = false;
    if (msgEl) msgEl.textContent = msg || "Admin access required.";
  }

  function showApp() {
    var gate = document.getElementById("admin-gate");
    var app = document.getElementById("admin-app");
    if (gate) gate.hidden = true;
    if (app) app.hidden = false;
  }

  function switchTab(name) {
    document.querySelectorAll(".admin-nav-btn").forEach(function (btn) {
      var on = btn.getAttribute("data-tab") === name;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelectorAll(".admin-panel").forEach(function (panel) {
      var on = panel.id === "tab-" + name;
      panel.hidden = !on;
      panel.classList.toggle("is-active", on);
    });
    var title = document.getElementById("admin-section-title");
    if (title) title.textContent = titles[name] || name;
    if (name === "overview") loadOverview();
    if (name === "users") loadUsers();
    if (name === "products") loadProducts();
    if (name === "orders") loadOrders();
    if (name === "messages") {
      loadUsersForSelect().then(loadMessages);
    }
    if (name === "chats") {
      loadChats();
    }
  }

  function loadOverview() {
    return api(API.overview).then(function (r) {
      if (!r.ok) {
        setStatus((r.data && r.data.error) || "Failed to load overview", true);
        return;
      }
      var d = r.data || {};
      setText("stat-users", d.users);
      setText("stat-admins", d.admins);
      setText("stat-products", d.products_active);
      setText("stat-orders-new", d.orders_new);
      setText("stat-orders", d.orders_total);
      setText("stat-messages", d.messages);
      setText("stat-chats-open", d.chats_open);
      setText("stat-chats-needs-human", d.chats_needs_human);
      setText("stat-chats", d.chats_total);
      var badge = document.getElementById("chats-nav-badge");
      if (badge) {
        var n = Number(d.chats_needs_human) || 0;
        if (n > 0) {
          badge.hidden = false;
          badge.textContent = String(n);
        } else {
          badge.hidden = true;
          badge.textContent = "";
        }
      }
    });
  }

  function setText(id, v) {
    var el = document.getElementById(id);
    if (el) el.textContent = v == null ? "—" : String(v);
  }

  function setTbodyLoading(id, cols, label) {
    var tbody = document.getElementById(id);
    if (!tbody) return;
    tbody.innerHTML =
      '<tr><td colspan="' +
      cols +
      '" class="admin-empty-state">' +
      (label || "Loading…") +
      "</td></tr>";
  }

  /* ---------- Users ---------- */
  function loadUsers() {
    setTbodyLoading("users-tbody", 8, "Loading users…");
    return api(API.users).then(function (r) {
      if (!r.ok) {
        setStatus((r.data && r.data.error) || "Failed to load users", true);
        setTbodyLoading("users-tbody", 8, "Could not load users.");
        return;
      }
      usersCache = (r.data && r.data.users) || [];
      renderUsers(usersCache);
    });
  }

  function loadUsersForSelect() {
    return api(API.users).then(function (r) {
      if (!r.ok) return;
      usersCache = (r.data && r.data.users) || [];
      var sel = document.getElementById("msg-user");
      if (!sel) return;
      var cur = sel.value;
      sel.innerHTML = '<option value="">— none —</option>';
      usersCache.forEach(function (u) {
        var opt = document.createElement("option");
        opt.value = u.id;
        opt.textContent =
          (u.name || "User") +
          " — " +
          (u.email || u.phone || u.id);
        sel.appendChild(opt);
      });
      if (cur) sel.value = cur;
    });
  }

  function renderUsers(users) {
    var tbody = document.getElementById("users-tbody");
    if (!tbody) return;
    if (!users.length) {
      tbody.innerHTML = '<tr><td colspan="8">No users yet.</td></tr>';
      return;
    }
    tbody.innerHTML = users
      .map(function (u) {
        var mfa = u.mfa_enabled
          ? '<span class="admin-badge ok">on</span>'
          : '<span class="admin-badge warn">off</span>';
        var status = u.disabled
          ? '<span class="admin-badge bad">disabled</span>'
          : '<span class="admin-badge ok">active</span>';
        var isSelf = currentUser && u.id === currentUser.id;
        var actions = [];
        actions.push(
          '<button type="button" class="button secondary" data-act="role" data-id="' +
            esc(u.id) +
            '" data-role="' +
            esc(u.role === "admin" ? "customer" : "admin") +
            '">Make ' +
            (u.role === "admin" ? "customer" : "admin") +
            "</button>"
        );
        actions.push(
          '<button type="button" class="button secondary" data-act="toggle" data-id="' +
            esc(u.id) +
            '" data-disabled="' +
            (u.disabled ? "0" : "1") +
            '">' +
            (u.disabled ? "Enable" : "Disable") +
            "</button>"
        );
        if (!isSelf) {
          actions.push(
            '<button type="button" class="button secondary" data-act="delete" data-id="' +
              esc(u.id) +
              '">Delete</button>'
          );
        }
        return (
          "<tr>" +
          "<td>" +
          esc(u.name) +
          (isSelf ? " <em>(you)</em>" : "") +
          "</td>" +
          "<td>" +
          esc(u.email || "—") +
          "</td>" +
          "<td>" +
          esc(u.phone || "—") +
          "</td>" +
          "<td>" +
          esc(u.role) +
          "</td>" +
          "<td>" +
          mfa +
          "</td>" +
          "<td>" +
          status +
          "</td>" +
          "<td>" +
          esc(fmtDate(u.created_at)) +
          "</td>" +
          '<td class="admin-actions">' +
          actions.join("") +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function onUsersClick(e) {
    var btn = e.target.closest("button[data-act]");
    if (!btn) return;
    var id = btn.getAttribute("data-id");
    var act = btn.getAttribute("data-act");
    if (act === "role") {
      var role = btn.getAttribute("data-role");
      api(API.users + "/" + encodeURIComponent(id), {
        method: "PATCH",
        body: JSON.stringify({ role: role }),
      }).then(function (r) {
        if (!r.ok) {
          setStatus((r.data && r.data.error) || "Could not change role", true);
          return;
        }
        setStatus("Role updated");
        loadUsers();
        loadOverview();
      });
    } else if (act === "toggle") {
      var disabled = btn.getAttribute("data-disabled") === "1";
      api(API.users + "/" + encodeURIComponent(id), {
        method: "PATCH",
        body: JSON.stringify({ disabled: disabled }),
      }).then(function (r) {
        if (!r.ok) {
          setStatus((r.data && r.data.error) || "Could not update user", true);
          return;
        }
        setStatus(disabled ? "User disabled" : "User enabled");
        loadUsers();
        loadOverview();
      });
    } else if (act === "delete") {
      if (!window.confirm("Delete this user permanently?")) return;
      api(API.users + "/" + encodeURIComponent(id), { method: "DELETE", body: "{}" }).then(
        function (r) {
          if (!r.ok) {
            setStatus((r.data && r.data.error) || "Could not delete user", true);
            return;
          }
          setStatus("User deleted");
          loadUsers();
          loadOverview();
        }
      );
    }
  }

  /* ---------- Products ---------- */
  function loadProducts() {
    setTbodyLoading("products-tbody", 7, "Loading products…");
    return api(API.products).then(function (r) {
      if (!r.ok) {
        setStatus((r.data && r.data.error) || "Failed to load products", true);
        setTbodyLoading("products-tbody", 7, "Could not load products.");
        return;
      }
      renderProducts((r.data && r.data.products) || []);
    });
  }

  function renderProducts(products) {
    var tbody = document.getElementById("products-tbody");
    if (!tbody) return;
    if (!products.length) {
      tbody.innerHTML = '<tr><td colspan="7">No products.</td></tr>';
      return;
    }
    tbody.innerHTML = products
      .map(function (p) {
        var active = p.active
          ? '<span class="admin-badge ok">yes</span>'
          : '<span class="admin-badge bad">no</span>';
        return (
          "<tr>" +
          "<td>" +
          esc(p.name) +
          "</td>" +
          "<td>" +
          esc(p.slug) +
          "</td>" +
          "<td>" +
          esc(p.price_label) +
          "</td>" +
          "<td>" +
          (p.price_cents == null ? "—" : esc(p.price_cents)) +
          "</td>" +
          "<td>" +
          active +
          "</td>" +
          "<td>" +
          esc(fmtDate(p.updated_at)) +
          "</td>" +
          '<td class="admin-actions">' +
          '<button type="button" class="button secondary" data-pact="edit" data-id="' +
          esc(p.id) +
          '">Edit</button>' +
          (p.active
            ? '<button type="button" class="button secondary" data-pact="deactivate" data-id="' +
              esc(p.id) +
              '">Deactivate</button>'
            : '<button type="button" class="button secondary" data-pact="activate" data-id="' +
              esc(p.id) +
              '">Activate</button>') +
          "</td></tr>"
        );
      })
      .join("");
    tbody._products = products;
  }

  function openProductForm(product) {
    var wrap = document.getElementById("product-form-wrap");
    var title = document.getElementById("product-form-title");
    var form = document.getElementById("product-form");
    if (!wrap || !form) return;
    wrap.hidden = false;
    title.textContent = product ? "Edit product" : "Create product";
    form.elements.namedItem("id").value = product ? product.id : "";
    form.elements.namedItem("name").value = product ? product.name : "";
    var slugEl = form.elements.namedItem("slug");
    slugEl.value = product ? product.slug : "";
    slugEl.disabled = !!product;
    form.elements.namedItem("summary").value = product ? product.summary : "";
    form.elements.namedItem("points").value = product && product.points
      ? product.points.join("\n")
      : "";
    form.elements.namedItem("price_label").value = product
      ? product.price_label
      : "Custom license";
    form.elements.namedItem("price_note").value = product
      ? product.price_note
      : "License — contact for pricing";
    form.elements.namedItem("price_cents").value =
      product && product.price_cents != null ? product.price_cents : "";
    form.elements.namedItem("active").value = product && !product.active ? "0" : "1";
  }

  function onProductsClick(e) {
    var btn = e.target.closest("button[data-pact]");
    if (!btn) return;
    var id = btn.getAttribute("data-id");
    var act = btn.getAttribute("data-pact");
    var tbody = document.getElementById("products-tbody");
    var list = (tbody && tbody._products) || [];
    var product = list.find(function (p) {
      return p.id === id;
    });
    if (act === "edit" && product) {
      openProductForm(product);
      return;
    }
    if (act === "deactivate" || act === "activate") {
      api(API.products + "/" + encodeURIComponent(id), {
        method: "PATCH",
        body: JSON.stringify({ active: act === "activate" }),
      }).then(function (r) {
        if (!r.ok) {
          setStatus((r.data && r.data.error) || "Could not update product", true);
          return;
        }
        setStatus("Product updated");
        loadProducts();
        loadOverview();
      });
    }
  }

  /* ---------- Orders ---------- */
  function loadOrders() {
    setTbodyLoading("orders-tbody", 7, "Loading orders…");
    return api(API.orders).then(function (r) {
      if (!r.ok) {
        setStatus((r.data && r.data.error) || "Failed to load orders", true);
        setTbodyLoading("orders-tbody", 7, "Could not load orders.");
        return;
      }
      renderOrders((r.data && r.data.orders) || []);
    });
  }

  function renderOrders(orders) {
    var tbody = document.getElementById("orders-tbody");
    if (!tbody) return;
    tbody._orders = orders;
    if (!orders.length) {
      tbody.innerHTML = '<tr><td colspan="7">No orders yet.</td></tr>';
      return;
    }
    tbody.innerHTML = orders
      .map(function (o) {
        var contact = o.buyer_email || o.buyer_phone || "—";
        return (
          "<tr>" +
          "<td>" +
          esc(fmtDate(o.created_at)) +
          "</td>" +
          "<td>" +
          esc(o.product_name || o.product_slug) +
          (o.is_service || (o.product_slug && String(o.product_slug).indexOf("svc-") === 0)
            ? ' <span class="admin-badge admin-badge-service">Service</span>'
            : "") +
          "</td>" +
          "<td>" +
          esc(o.buyer_name) +
          "</td>" +
          "<td>" +
          esc(contact) +
          "</td>" +
          "<td>" +
          esc(o.organization || "—") +
          "</td>" +
          "<td><span class=\"admin-badge admin-status-" +
          esc(String(o.status || "new").replace(/[^a-z0-9_\-]/gi, "")) +
          '\">' +
          esc(o.status) +
          "</span></td>" +
          '<td class="admin-actions"><button type="button" class="button secondary" data-oact="edit" data-id="' +
          esc(o.id) +
          '">Manage</button></td>' +
          "</tr>"
        );
      })
      .join("");
  }

  function openOrder(order) {
    var detail = document.getElementById("order-detail");
    if (!detail || !order) return;
    detail.hidden = false;
    document.getElementById("ou-id").value = order.id;
    document.getElementById("ou-status").value = order.status || "new";
    document.getElementById("ou-reply").value = order.admin_reply || "";
    document.getElementById("order-detail-meta").textContent =
      order.buyer_name +
      " · " +
      (order.buyer_email || order.buyer_phone || "") +
      " · " +
      (order.product_name || order.product_slug);
    document.getElementById("order-detail-note").textContent = order.customer_note
      ? "Customer note: " + order.customer_note
      : "No customer note.";
    var sess = document.getElementById("order-detail-session");
    if (sess) {
      sess.textContent = order.stripe_session_id
        ? "Stripe session: " + order.stripe_session_id
        : "Stripe session: (none)";
    }
  }

  function onOrdersClick(e) {
    var btn = e.target.closest("button[data-oact]");
    if (!btn) return;
    var id = btn.getAttribute("data-id");
    var tbody = document.getElementById("orders-tbody");
    var list = (tbody && tbody._orders) || [];
    var order = list.find(function (o) {
      return o.id === id;
    });
    if (order) openOrder(order);
  }

  /* ---------- Messages ---------- */
  function loadMessages() {
    setTbodyLoading("messages-tbody", 5, "Loading messages…");
    return api(API.messages).then(function (r) {
      if (!r.ok) {
        setStatus((r.data && r.data.error) || "Failed to load messages", true);
        setTbodyLoading("messages-tbody", 5, "Could not load messages.");
        return;
      }
      renderMessages((r.data && r.data.messages) || []);
    });
  }

  function renderMessages(messages) {
    var tbody = document.getElementById("messages-tbody");
    if (!tbody) return;
    tbody._messages = messages;
    if (!messages.length) {
      tbody.innerHTML = '<tr><td colspan="5">No messages yet.</td></tr>';
      return;
    }
    tbody.innerHTML = messages
      .map(function (m) {
        var to = m.to_email || m.to_phone || "—";
        var mailto = "";
        if (m.to_email) {
          var href =
            "mailto:" +
            m.to_email +
            "?subject=" +
            encodeURIComponent(m.subject) +
            "&body=" +
            encodeURIComponent(m.body);
          mailto =
            '<a class="button secondary" href="' +
            esc(href) +
            '">mailto</a>';
        }
        return (
          "<tr>" +
          "<td>" +
          esc(fmtDate(m.created_at)) +
          "</td>" +
          "<td>" +
          esc(to) +
          "</td>" +
          "<td>" +
          esc(m.subject) +
          "</td>" +
          "<td>" +
          esc(m.created_by_name || m.created_by) +
          "</td>" +
          '<td class="admin-actions">' +
          mailto +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  /* ---------- Init ---------- */
  function bindEvents() {
    document.querySelectorAll(".admin-nav-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        switchTab(btn.getAttribute("data-tab"));
      });
    });

    document.querySelectorAll("[data-goto]").forEach(function (card) {
      card.addEventListener("click", function () {
        var tab = card.getAttribute("data-goto");
        if (tab) switchTab(tab);
      });
    });

    var signout = document.getElementById("admin-signout");
    if (signout) {
      signout.addEventListener("click", function () {
        if (window.MunAuth && window.MunAuth.signOut) {
          window.MunAuth.signOut().then(function () {
            window.location.href = "/signup";
          });
        } else {
          window.location.href = "/signup";
        }
      });
    }

    var btnCreate = document.getElementById("btn-user-create");
    var createWrap = document.getElementById("user-create-form-wrap");
    var createCancel = document.getElementById("btn-user-create-cancel");
    if (btnCreate && createWrap) {
      btnCreate.addEventListener("click", function () {
        createWrap.hidden = false;
      });
    }
    if (createCancel && createWrap) {
      createCancel.addEventListener("click", function () {
        createWrap.hidden = true;
      });
    }

    var userForm = document.getElementById("user-create-form");
    if (userForm) {
      userForm.addEventListener("submit", function (ev) {
        ev.preventDefault();
        var payload = {
          name: (userForm.elements.namedItem("name").value || "").trim(),
          email: (userForm.elements.namedItem("email").value || "").trim() || undefined,
          phone: (userForm.elements.namedItem("phone").value || "").trim() || undefined,
          password: userForm.elements.namedItem("password").value || "",
          role: userForm.elements.namedItem("role").value || "customer",
        };
        api(API.users, { method: "POST", body: JSON.stringify(payload) }).then(function (r) {
          if (!r.ok) {
            setStatus((r.data && r.data.error) || "Could not create user", true);
            return;
          }
          setStatus("User created");
          userForm.reset();
          createWrap.hidden = true;
          loadUsers();
          loadOverview();
        });
      });
    }

    var usersTbody = document.getElementById("users-tbody");
    if (usersTbody) usersTbody.addEventListener("click", onUsersClick);

    var btnProd = document.getElementById("btn-product-create");
    if (btnProd) {
      btnProd.addEventListener("click", function () {
        openProductForm(null);
      });
    }
    var prodCancel = document.getElementById("btn-product-cancel");
    var prodWrap = document.getElementById("product-form-wrap");
    if (prodCancel && prodWrap) {
      prodCancel.addEventListener("click", function () {
        prodWrap.hidden = true;
      });
    }
    var prodForm = document.getElementById("product-form");
    if (prodForm) {
      prodForm.addEventListener("submit", function (ev) {
        ev.preventDefault();
        var id = (prodForm.elements.namedItem("id").value || "").trim();
        var pointsRaw = prodForm.elements.namedItem("points").value || "";
        var points = pointsRaw
          .split("\n")
          .map(function (s) {
            return s.trim();
          })
          .filter(Boolean);
        var centsRaw = prodForm.elements.namedItem("price_cents").value;
        var payload = {
          name: (prodForm.elements.namedItem("name").value || "").trim(),
          summary: (prodForm.elements.namedItem("summary").value || "").trim(),
          points: points,
          price_label: (prodForm.elements.namedItem("price_label").value || "").trim(),
          price_note: (prodForm.elements.namedItem("price_note").value || "").trim(),
          price_cents: centsRaw === "" ? null : Number(centsRaw),
          active: prodForm.elements.namedItem("active").value === "1",
        };
        if (!id) {
          payload.slug = (prodForm.elements.namedItem("slug").value || "").trim();
        }
        var req = id
          ? api(API.products + "/" + encodeURIComponent(id), {
              method: "PATCH",
              body: JSON.stringify(payload),
            })
          : api(API.products, { method: "POST", body: JSON.stringify(payload) });
        req.then(function (r) {
          if (!r.ok) {
            setStatus((r.data && r.data.error) || "Could not save product", true);
            return;
          }
          setStatus(id ? "Product updated" : "Product created");
          prodWrap.hidden = true;
          loadProducts();
          loadOverview();
        });
      });
    }
    var productsTbody = document.getElementById("products-tbody");
    if (productsTbody) productsTbody.addEventListener("click", onProductsClick);

    var btnOrdersRefresh = document.getElementById("btn-orders-refresh");
    if (btnOrdersRefresh) btnOrdersRefresh.addEventListener("click", loadOrders);
    var ordersTbody = document.getElementById("orders-tbody");
    if (ordersTbody) ordersTbody.addEventListener("click", onOrdersClick);

    var orderForm = document.getElementById("order-update-form");
    if (orderForm) {
      orderForm.addEventListener("submit", function (ev) {
        ev.preventDefault();
        var id = document.getElementById("ou-id").value;
        var payload = {
          status: document.getElementById("ou-status").value,
          admin_reply: document.getElementById("ou-reply").value,
        };
        api(API.orders + "/" + encodeURIComponent(id), {
          method: "PATCH",
          body: JSON.stringify(payload),
        }).then(function (r) {
          if (!r.ok) {
            setStatus((r.data && r.data.error) || "Could not update order", true);
            return;
          }
          setStatus("Order updated");
          document.getElementById("order-detail").hidden = true;
          loadOrders();
          loadOverview();
        });
      });
    }
    var orderClose = document.getElementById("btn-order-close");
    if (orderClose) {
      orderClose.addEventListener("click", function () {
        document.getElementById("order-detail").hidden = true;
      });
    }

    var msgUser = document.getElementById("msg-user");
    if (msgUser) {
      msgUser.addEventListener("change", function () {
        var id = msgUser.value;
        var u = usersCache.find(function (x) {
          return x.id === id;
        });
        if (!u) return;
        var emailEl = document.getElementById("msg-email");
        var phoneEl = document.getElementById("msg-phone");
        if (emailEl && u.email) emailEl.value = u.email;
        if (phoneEl && u.phone) phoneEl.value = u.phone;
      });
    }

    var msgForm = document.getElementById("message-form");
    if (msgForm) {
      msgForm.addEventListener("submit", function (ev) {
        ev.preventDefault();
        var payload = {
          user_id: document.getElementById("msg-user").value || undefined,
          to_email: (document.getElementById("msg-email").value || "").trim() || undefined,
          to_phone: (document.getElementById("msg-phone").value || "").trim() || undefined,
          subject: (document.getElementById("msg-subject").value || "").trim(),
          body: (document.getElementById("msg-body").value || "").trim(),
        };
        api(API.messages, { method: "POST", body: JSON.stringify(payload) }).then(function (r) {
          if (!r.ok) {
            setStatus((r.data && r.data.error) || "Could not save message", true);
            return;
          }
          setStatus("Message saved");
          var wrap = document.getElementById("message-mailto-wrap");
          var link = document.getElementById("message-mailto");
          if (r.data && r.data.mailto && wrap && link) {
            wrap.hidden = false;
            link.href = r.data.mailto;
          } else if (wrap) {
            wrap.hidden = true;
          }
          msgForm.reset();
          loadMessages();
          loadOverview();
        });
      });
    }
  }

  function boot() {
    bindEvents();
    var gate = document.getElementById("admin-gate");
    if (gate) {
      gate.hidden = false;
      var msgEl = document.getElementById("admin-gate-msg");
      if (msgEl) msgEl.textContent = "Checking your session…";
    }

    var fetchMe =
      window.MunAuth && window.MunAuth.fetchMe
        ? window.MunAuth.fetchMe
        : function () {
            return api("/api/me").then(function (r) {
              return r.ok && r.data ? r.data.user : null;
            });
          };

    fetchMe().then(function (user) {
      // MunAuth.fetchMe returns user; also check mfa via isMfaSetupRequired
      if (!user) {
        showGate("Sign in with an admin account to continue.");
        return;
      }
      var mfaRequired =
        (window.MunAuth && window.MunAuth.isMfaSetupRequired && window.MunAuth.isMfaSetupRequired()) ||
        !!user.mfa_setup_required;
      if (mfaRequired) {
        showGate("Complete MFA setup first, then return to Admin.");
        window.setTimeout(function () {
          window.location.href = "/mfa-setup";
        }, 900);
        return;
      }
      if (user.role !== "admin") {
        showGate("This account is not an admin. Sign up as info@muncyber.com to become the first admin, or ask an existing admin.");
        return;
      }
      currentUser = user;
      showApp();
      var who = document.getElementById("admin-who");
      if (who) {
        who.textContent = "Signed in as " + (user.name || user.email || user.phone);
      }
      switchTab("overview");
    });
  }



  /* ---------- MC Chat Bot ---------- */
  var activeChatId = null;

  function loadChats() {
    setTbodyLoading("chats-tbody", 6, "Loading chats…");
    return api(API.chats).then(function (r) {
      if (!r.ok) {
        setStatus((r.data && r.data.error) || "Failed to load chats", true);
        setTbodyLoading("chats-tbody", 6, "Could not load chats.");
        return;
      }
      renderChats((r.data && r.data.chats) || []);
    });
  }

  function renderChats(chats) {
    var tbody = document.getElementById("chats-tbody");
    if (!tbody) return;
    tbody._chats = chats;
    if (!chats.length) {
      tbody.innerHTML = '<tr><td colspan="6">No chat conversations yet.</td></tr>';
      return;
    }
    var needCount = 0;
    tbody.innerHTML = chats
      .map(function (c) {
        var needs = c.needs_human || c.status === "needs_human" || c.status === "handoff";
        if (needs) needCount += 1;
        var visitor =
          (c.visitor_name || "") +
          (c.visitor_name && c.visitor_email ? " · " : "") +
          (c.visitor_email || "") ||
          "Anonymous";
        var preview = (c.last_body || "").slice(0, 80);
        if ((c.last_body || "").length > 80) preview += "\u2026";
        var badgeClass = needs ? "admin-badge warn" : "admin-badge";
        return (
          "<tr data-chat-id=\"" +
          esc(c.id) +
          "\" class=\"" +
          (needs ? "admin-chat-row--needs-human" : "") +
          "\">" +
          "<td>" +
          esc(fmtDate(c.updated_at)) +
          "</td>" +
          "<td>" +
          esc(visitor) +
          "</td>" +
          "<td><span class=\"" +
          badgeClass +
          "\">" +
          esc(c.status) +
          "</span></td>" +
          "<td>" +
          esc(c.message_count) +
          "</td>" +
          "<td>" +
          esc(preview || "\u2014") +
          "</td>" +
          "<td><button type=\"button\" class=\"button secondary btn-chat-open\" data-id=\"" +
          esc(c.id) +
          "\">Open</button></td>" +
          "</tr>"
        );
      })
      .join("");
    var badge = document.getElementById("chats-nav-badge");
    if (badge) {
      if (needCount > 0) {
        badge.hidden = false;
        badge.textContent = String(needCount);
      } else {
        badge.hidden = true;
        badge.textContent = "";
      }
    }
  }

  function openChat(id) {
    activeChatId = id;
    var boxPre = document.getElementById("chat-detail-messages");
    var detailPre = document.getElementById("chat-detail");
    if (detailPre) detailPre.hidden = false;
    if (boxPre) boxPre.innerHTML = "<p class=\"admin-hint\" role=\"status\">Loading conversation…</p>";
    return api(API.chats + "/" + encodeURIComponent(id)).then(function (r) {
      if (!r.ok) {
        setStatus((r.data && r.data.error) || "Failed to load chat", true);
        if (boxPre) boxPre.innerHTML = "<p class=\"admin-hint\">Could not load conversation.</p>";
        return;
      }
      var thread = (r.data && r.data.thread) || {};
      var messages = (r.data && r.data.messages) || [];
      var detail = document.getElementById("chat-detail");
      var title = document.getElementById("chat-detail-title");
      var meta = document.getElementById("chat-detail-meta");
      var box = document.getElementById("chat-detail-messages");
      if (detail) detail.hidden = false;
      if (title) title.textContent = "Conversation " + (thread.id || id).slice(0, 8) + "\u2026";
      if (meta) {
        meta.textContent =
          "Status: " +
          (thread.status || "\u2014") +
          " \u00b7 Visitor: " +
          (thread.visitor_name || "\u2014") +
          " \u00b7 Email: " +
          (thread.visitor_email || "\u2014") +
          " \u00b7 Phone: " +
          (thread.visitor_phone || "\u2014") +
          " \u00b7 Started: " +
          fmtDate(thread.created_at) +
          (thread.handoff_note ? " \u00b7 Note: " + thread.handoff_note : "");
      }
      if (box) {
        if (!messages.length) {
          box.innerHTML = "<p class=\"admin-hint\">No messages.</p>";
        } else {
          box.innerHTML = messages
            .map(function (m) {
              var who =
                m.role === "user"
                  ? "Visitor"
                  : m.role === "admin"
                  ? "Mun Cyber Team"
                  : m.role === "assistant"
                  ? "MC Chat Bot"
                  : m.role;
              return (
                '<div class="admin-chat-bubble admin-chat-bubble--' +
                esc(m.role) +
                '">' +
                '<div class="admin-chat-bubble-meta"><strong>' +
                esc(who) +
                "</strong> \u00b7 " +
                esc(fmtDate(m.created_at)) +
                "</div>" +
                '<div class="admin-chat-bubble-body">' +
                esc(m.body).replace(/\n/g, "<br>") +
                "</div></div>"
              );
            })
            .join("");
        }
      }
    });
  }

  function patchChatStatus(status) {
    if (!activeChatId) {
      setStatus("Open a chat first", true);
      return;
    }
    return api(API.chats + "/" + encodeURIComponent(activeChatId), {
      method: "PATCH",
      body: JSON.stringify({ status: status }),
    }).then(function (r) {
      if (!r.ok) {
        setStatus((r.data && r.data.error) || "Update failed", true);
        return;
      }
      setStatus("Chat marked " + status);
      loadChats();
      openChat(activeChatId);
    });
  }

  function sendChatReply(e) {
    if (e) e.preventDefault();
    if (!activeChatId) {
      setStatus("Open a chat first", true);
      return;
    }
    var ta = document.getElementById("chat-reply-body");
    var body = ta ? String(ta.value || "").trim() : "";
    if (!body) {
      setStatus("Reply text is required", true);
      return;
    }
    return api(API.chats + "/" + encodeURIComponent(activeChatId) + "/messages", {
      method: "POST",
      body: JSON.stringify({ body: body }),
    }).then(function (r) {
      if (!r.ok) {
        setStatus((r.data && r.data.error) || "Reply failed", true);
        return;
      }
      if (ta) ta.value = "";
      setStatus("Reply sent to visitor thread");
      loadChats();
      openChat(activeChatId);
    });
  }

  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var openBtn = t.closest(".btn-chat-open");
    if (openBtn) {
      e.preventDefault();
      openChat(openBtn.getAttribute("data-id"));
      return;
    }
  });

  document.addEventListener("DOMContentLoaded", function () {
    var refresh = document.getElementById("btn-chats-refresh");
    if (refresh) refresh.addEventListener("click", function () { loadChats(); });
    var reviewed = document.getElementById("btn-chat-mark-reviewed");
    if (reviewed) reviewed.addEventListener("click", function () { patchChatStatus("reviewed"); });
    var closeBtn = document.getElementById("btn-chat-close-thread");
    if (closeBtn) closeBtn.addEventListener("click", function () { patchChatStatus("closed"); });
    var reopen = document.getElementById("btn-chat-reopen");
    if (reopen) reopen.addEventListener("click", function () { patchChatStatus("open"); });
    var replyForm = document.getElementById("chat-reply-form");
    if (replyForm) replyForm.addEventListener("submit", sendChatReply);
  });

  document.addEventListener("DOMContentLoaded", boot);
})();
