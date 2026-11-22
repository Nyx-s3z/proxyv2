
"use strict";

(() => {
  const $ = (id) => document.getElementById(id);

  const DEFAULTS = {
    theme: "teal",
    homeTitle: "Emnity",
    homeSubtitle: "Search or enter an address."
  };

  function readSettings() {
    try {
      return {
        ...DEFAULTS,
        ...JSON.parse(localStorage.getItem("emn_settings") || "{}")
      };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function saveSetting(key, value) {
    const current = readSettings();
    current[key] = value;

    try {
      localStorage.setItem("emn_settings", JSON.stringify(current));
    } catch {
      // Storage may be unavailable.
    }
  }

  function applySettings() {
    const settings = readSettings();

    document.documentElement.dataset.theme =
      ["teal", "pastel", "earth"].includes(settings.theme)
        ? settings.theme
        : "teal";

    const title = $("home-title");
    const subtitle = $("home-subtitle");

    if (title) {
      title.textContent = settings.homeTitle || DEFAULTS.homeTitle;
    }

    if (subtitle) {
      subtitle.textContent = settings.homeSubtitle || DEFAULTS.homeSubtitle;
    }

    const themeSelect = $("theme-select");
    const titleInput = $("home-title-input");
    const subtitleInput = $("home-subtitle-input");

    if (themeSelect) themeSelect.value = settings.theme;
    if (titleInput) titleInput.value = settings.homeTitle;
    if (subtitleInput) subtitleInput.value = settings.homeSubtitle;
  }

  // ---------- THEME ----------
  $("theme-select")?.addEventListener("change", (event) => {
    const theme = event.target.value;

    if (!["teal", "pastel", "earth"].includes(theme)) return;

    saveSetting("theme", theme);
    applySettings();
  });

  // ---------- HOMEPAGE CUSTOMIZATION ----------
  $("home-title-input")?.addEventListener("input", (event) => {
    const value = event.target.value.slice(0, 32);

    saveSetting("homeTitle", value);

    if ($("home-title")) {
      $("home-title").textContent = value || DEFAULTS.homeTitle;
    }
  });

  $("home-subtitle-input")?.addEventListener("input", (event) => {
    const value = event.target.value.slice(0, 80);

    saveSetting("homeSubtitle", value);

    if ($("home-subtitle")) {
      $("home-subtitle").textContent = value || DEFAULTS.homeSubtitle;
    }
  });

  // ---------- SESSION TIMER ----------
  let expiresAt = null;
  let previouslyAuthenticated = false;
  let expirationHandled = false;
  let checking = false;

  function formatTime(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));

    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;

    return [hours, minutes, seconds]
      .map((number) => String(number).padStart(2, "0"))
      .join(":");
  }

  function updateTimerDisplay() {
    const timer = $("session-remaining");
    const state = $("session-state");

    if (!timer || !state) return;

    if (!expiresAt) {
      timer.textContent = "--:--:--";
      return;
    }

    const remaining = expiresAt - Date.now();

    if (remaining <= 0) {
      timer.textContent = "00:00:00";
      state.textContent = "Session expired";
      return;
    }

    timer.textContent = formatTime(remaining);
    state.textContent = "Session active";
  }

  async function checkSession() {
    if (checking || expirationHandled) return;

    checking = true;

    try {
      const response = await fetch("/session-status", {
        cache: "no-store",
        credentials: "same-origin"
      });

      if (!response.ok) return;

      const data = await response.json();

      if (data.authenticated && Number.isFinite(data.expiresAt)) {
        previouslyAuthenticated = true;
        expiresAt = data.expiresAt;
        updateTimerDisplay();
        return;
      }

      if (previouslyAuthenticated) {
        expirationHandled = true;

        const timer = $("session-remaining");
        const state = $("session-state");

        if (timer) timer.textContent = "00:00:00";
        if (state) state.textContent = "Session expired";

        alert("Your access session timer has run out.");

        window.location.replace("/");
      } else {
        const timer = $("session-remaining");
        const state = $("session-state");

        if (timer) timer.textContent = "--:--:--";
        if (state) state.textContent = "Session unavailable";
      }
    } catch {
      // Keep the displayed timer during temporary network issues.
    } finally {
      checking = false;
    }
  }

  // ---------- START ----------
  applySettings();
  checkSession();

  setInterval(updateTimerDisplay, 1000);
  setInterval(checkSession, 5000);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) checkSession();
  });
})();
