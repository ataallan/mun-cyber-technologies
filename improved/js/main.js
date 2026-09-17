/**
 * MUN Cyber Technologies — site interactions
 * - Mobile navigation
 * - Contact form → mailto (no server storage)
 * - Footer year
 */
(function () {
  "use strict";

  const CONTACT_EMAIL = "info@muncyber.com";

  /* ---------- Footer year ---------- */
  const yearEl = document.getElementById("year");
  if (yearEl) {
    yearEl.textContent = String(new Date().getFullYear());
  }

  /* ---------- Mobile nav ---------- */
  const toggle = document.querySelector(".menu-toggle");
  const links = document.querySelector(".nav-links");
  const header = document.querySelector(".site-header");

  function setMenuOpen(open) {
    if (!links || !toggle) return;
    links.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
    document.body.style.overflow = open ? "hidden" : "";
  }

  if (toggle && links) {
    toggle.addEventListener("click", () => {
      setMenuOpen(!links.classList.contains("open"));
    });

    links.querySelectorAll("a").forEach((anchor) => {
      anchor.addEventListener("click", () => setMenuOpen(false));
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") setMenuOpen(false);
    });

    document.addEventListener("click", (event) => {
      if (!header) return;
      if (links.classList.contains("open") && !header.contains(event.target)) {
        setMenuOpen(false);
      }
    });

    window.addEventListener("resize", () => {
      if (window.matchMedia("(min-width: 801px)").matches) {
        setMenuOpen(false);
      }
    });
  }

  /* ---------- Contact form (mailto) ---------- */
  const form = document.getElementById("contact-form");
  const statusEl = document.getElementById("form-status");

  function encodeBody(lines) {
    return encodeURIComponent(lines.join("\r\n"));
  }

  if (form) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();

      const name = (form.elements.namedItem("name") || {}).value || "";
      const email = (form.elements.namedItem("email") || {}).value || "";
      const organization = (form.elements.namedItem("organization") || {}).value || "";
      const message = (form.elements.namedItem("message") || {}).value || "";

      const subject = encodeURIComponent("Inquiry from MUN Cyber website");
      const body = encodeBody([
        "Name: " + name.trim(),
        "Email: " + email.trim(),
        "Organization: " + (organization.trim() || "(not provided)"),
        "",
        "Message:",
        message.trim(),
      ]);

      const mailto = "mailto:" + CONTACT_EMAIL + "?subject=" + subject + "&body=" + body;

      if (statusEl) {
        statusEl.hidden = false;
        statusEl.textContent =
          "Opening your email application… If nothing opens, email " + CONTACT_EMAIL + " directly.";
      }

      window.location.href = mailto;
    });
  }
})();
