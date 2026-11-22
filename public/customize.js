
"use strict";

(() => {
  const $ = (id) => document.getElementById(id);

  const DEFAULTS = {
    theme: "teal",
    homeTitle: "Emnity",
    homeSubtitle: "Search or enter an address."
  };

  const VALID_THEMES = [
    "teal",
    "pastel",
    "earth",
    "christmas"
  ];

  // ==========================================
  // SETTINGS STORAGE
  // ==========================================

  function readSettings() {
    try {
      const stored = JSON.parse(
        localStorage.getItem("emn_settings") || "{}"
      );

      return {
        ...DEFAULTS,
        ...stored
      };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function saveSetting(key, value) {
    const current = readSettings();

    current[key] = value;

    try {
      localStorage.setItem(
        "emn_settings",
        JSON.stringify(current)
      );
    } catch {
      // Storage may be unavailable.
    }
  }

  // ==========================================
  // APPLY SETTINGS
  // ==========================================

  function applySettings() {
    const settings = readSettings();

    const theme = VALID_THEMES.includes(settings.theme)
      ? settings.theme
      : DEFAULTS.theme;

    document.documentElement.dataset.theme = theme;

    const title = $("home-title");
    const subtitle = $("home-subtitle");

    if (title) {
      title.textContent =
        settings.homeTitle || DEFAULTS.homeTitle;
    }

    if (subtitle) {
      subtitle.textContent =
        settings.homeSubtitle || DEFAULTS.homeSubtitle;
    }

    const themeSelect = $("theme-select");
    const titleInput = $("home-title-input");
    const subtitleInput = $("home-subtitle-input");

    if (themeSelect) {
      themeSelect.value = theme;
    }

    if (titleInput) {
      titleInput.value = settings.homeTitle;
    }

    if (subtitleInput) {
      subtitleInput.value = settings.homeSubtitle;
    }
  }

  // ==========================================
  // THEME SELECTOR
  // ==========================================

  $("theme-select")?.addEventListener("change", (event) => {
    const theme = event.target.value;

    if (!VALID_THEMES.includes(theme)) {
      return;
    }

    saveSetting("theme", theme);
    applySettings();
  });

  // ==========================================
  // HOMEPAGE CUSTOMIZATION
  // ==========================================

  $("home-title-input")?.addEventListener("input", (event) => {
    const value = event.target.value.slice(0, 32);

    saveSetting("homeTitle", value);

    const title = $("home-title");

    if (title) {
      title.textContent = value || DEFAULTS.homeTitle;
    }
  });

  $("home-subtitle-input")?.addEventListener("input", (event) => {
    const value = event.target.value.slice(0, 80);

    saveSetting("homeSubtitle", value);

    const subtitle = $("home-subtitle");

    if (subtitle) {
      subtitle.textContent =
        value || DEFAULTS.homeSubtitle;
    }
  });

  // ==========================================
  // SESSION TIMER
  // ==========================================

  let expiresAt = null;
  let previouslyAuthenticated = false;
  let expirationHandled = false;
  let checking = false;

  function formatTime(milliseconds) {
    const total = Math.max(
      0,
      Math.floor(milliseconds / 1000)
    );

    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;

    return [
      hours,
      minutes,
      seconds
    ]
      .map(number => String(number).padStart(2, "0"))
      .join(":");
  }

  function updateTimerDisplay() {
    const timer = $("session-remaining");
    const state = $("session-state");

    if (!timer || !state) {
      return;
    }

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
    if (checking || expirationHandled) {
      return;
    }

    checking = true;

    try {
      const response = await fetch("/session-status", {
        cache: "no-store",
        credentials: "same-origin"
      });

      if (!response.ok) {
        return;
      }

      const data = await response.json();

      if (
        data.authenticated &&
        Number.isFinite(data.expiresAt)
      ) {
        previouslyAuthenticated = true;
        expiresAt = data.expiresAt;

        updateTimerDisplay();

        return;
      }

      if (previouslyAuthenticated) {
        expirationHandled = true;

        const timer = $("session-remaining");
        const state = $("session-state");

        if (timer) {
          timer.textContent = "00:00:00";
        }

        if (state) {
          state.textContent = "Session expired";
        }

        alert(
          "Your access session timer has run out."
        );

        window.location.replace("/");

        return;
      }

      const timer = $("session-remaining");
      const state = $("session-state");

      if (timer) {
        timer.textContent = "--:--:--";
      }

      if (state) {
        state.textContent = "Session unavailable";
      }

    } catch (error) {
      // Keep the last displayed timer during
      // temporary network interruptions.
    } finally {
      checking = false;
    }
  }

  // ==========================================
  // INITIALIZATION
  // ==========================================

  applySettings();

  checkSession();

  // Update the countdown every second.
  setInterval(updateTimerDisplay, 1000);

  // Check the server every five seconds.
  setInterval(checkSession, 5000);

  // Refresh session status when returning to the tab.
  document.addEventListener(
    "visibilitychange",
    () => {
      if (!document.hidden) {
        checkSession();
      }
    }
  );

})();
