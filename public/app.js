
"use strict";
(() => {
  const $ = (id) => document.getElementById(id);

  // ---------- SESSION EXPIRATION ----------
  let sessionExpired = false;
  let checkingSession = false;

  async function checkSessionExpiry() {
    if (sessionExpired || checkingSession) return;

    checkingSession = true;

    try {
      const response = await fetch("/session-status", {
        cache: "no-store",
        credentials: "same-origin"
      });

      if (!response.ok) return;

      const data = await response.json();

      if (data.authenticated === false) {
        sessionExpired = true;

        alert("Your access session timer has run out.");

        window.location.replace("/");
      }
    } catch {
      // Ignore temporary connection errors.
    } finally {
      checkingSession = false;
    }
  }

  checkSessionExpiry();
  setInterval(checkSessionExpiry, 1000);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) checkSessionExpiry();
  });

  // ---------- storage ----------
  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* storage unavailable */
      }
    },
    clear() {
      try {
        localStorage.removeItem("emn_settings");
        localStorage.removeItem("emn_links");
      } catch {
        /* ignore */
      }
    },
  };

  // ---------- data ----------
  const ENGINES = {
    google: { name: "Google", url: "https://www.google.com/search?q=" },
    bing: { name: "Bing", url: "https://www.bing.com/search?q=" },
    duckduckgo: { name: "DuckDuckGo", url: "https://duckduckgo.com/?q=" },
    brave: { name: "Brave", url: "https://search.brave.com/search?q=" },
    startpage: { name: "Startpage", url: "https://www.startpage.com/do/search?q=" },
    mojeek: { name: "Mojeek", url: "https://www.mojeek.com/search?q=" },
  };

  const DEFAULT_LINKS = [
    { title: "YouTube", url: "https://www.youtube.com" },
    { title: "TikTok", url: "https://www.tiktok.com" },
    { title: "Google", url: "https://www.google.com" },
    { title: "Wikipedia", url: "https://www.wikipedia.org" },
    { title: "Reddit", url: "https://www.reddit.com" },
  ];

  const settings = Object.assign(
    { engine: "google", transport: "epoxy" },
    store.get("emn_settings", {})
  );

  if (!ENGINES[settings.engine]) settings.engine = "google";
  if (settings.transport !== "libcurl") settings.transport = "epoxy";

  let links = store.get("emn_links", null);
  if (!Array.isArray(links)) {
    links = DEFAULT_LINKS.map((l) => ({ ...l }));
  }

  const DEFAULT_ICON =
    "data:image/svg+xml," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0b0b0b"/>' +
      '<text x="32" y="45" font-size="40" font-family="Arial,sans-serif" font-weight="800" text-anchor="middle" fill="#14b8a6">E</text></svg>'
    );

  const MAX_TABS = 20;
  const tabs = [];
  let cur = null;
  let seq = 0;

  // ---------- helpers ----------
  const hostOf = (url) => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  };

  const engineUrl = (q) =>
    ENGINES[settings.engine].url + encodeURIComponent(q);

  function resolve(raw) {
    const v = String(raw || "").trim();
    if (!v) return "";

    if (/^https?:\/\//i.test(v)) return v;

    if (/^[a-z][a-z0-9+.-]*:/i.test(v) && !/^[\w.-]+:\d+/.test(v)) {
      return engineUrl(v);
    }

    if (!/\s/.test(v) && v.includes(".")) return "https://" + v;

    return engineUrl(v);
  }

  const curTab = () => tabs.find((t) => t.id === cur) || null;

  const uvReady = () =>
    typeof __uv$config !== "undefined" &&
    typeof Ultraviolet !== "undefined";

  // ---------- engine boot (service worker + transport) ----------
  let bootPromise = null;

  function setStatus(kind, text) {
    const s = $("status");
    s.className = kind;
    s.textContent = text;
    $("set-status").textContent = text;
  }

  function showBanner(title, text) {
    $("banner-title").textContent = title;
    $("banner-text").textContent = text;
    $("banner").hidden = false;
  }

  function waitForActive(worker, ms) {
    return new Promise((resolveWait) => {
      if (!worker || worker.state === "activated") return resolveWait();

      const done = () => {
        if (worker.state === "activated") {
          worker.removeEventListener("statechange", done);
          resolveWait();
        }
      };

      worker.addEventListener("statechange", done);
      setTimeout(resolveWait, ms);
    });
  }

  async function bootEngine() {
    if (!uvReady()) {
      throw new Error(
        "Ultraviolet files didn't load. Check that the server started without errors."
      );
    }

    if (typeof BareMux === "undefined") {
      throw new Error("The BareMux script didn't load from /baremux/index.js.");
    }

    if (!("serviceWorker" in navigator)) {
      throw new Error(
        "This browser blocks service workers. Use https and a normal (non-private) window."
      );
    }

    const reg = await navigator.serviceWorker.register(
      "/uv/sw.js",
      { scope: __uv$config.prefix }
    );

    await waitForActive(reg.installing || reg.waiting || reg.active, 8000);

    const connection = new BareMux.BareMuxConnection("/baremux/worker.js");
    const wispUrl =
      (location.protocol === "https:" ? "wss" : "ws") +
      "://" + location.host + "/wisp/";

    const transportFile =
      settings.transport === "libcurl"
        ? "/libcurl/index.mjs"
        : "/epoxy/index.mjs";

    await connection.setTransport(transportFile, [{ wisp: wispUrl }]);
  }

  function boot() {
    if (bootPromise) return bootPromise;

    setStatus("wait", "starting");
    $("banner").hidden = true;

    bootPromise = bootEngine().then(
      () => {
        setStatus("ok", "ready");
      },
      (err) => {
        bootPromise = null;
        setStatus("bad", "error");
        showBanner(
          "Engine failed to start.",
          err && err.message ? err.message : String(err)
        );
        throw err;
      }
    );

    return bootPromise;
  }

  // ---------- tabs ----------
  function newTab(raw) {
    if (tabs.length >= MAX_TABS) return curTab();

    const frame = document.createElement("iframe");

    frame.setAttribute(
      "allow",
      "autoplay; fullscreen; clipboard-write; encrypted-media; picture-in-picture; web-share"
    );

    frame.setAttribute("allowfullscreen", "");
    frame.title = "Page";

    const tab = {
      id: ++seq,
      url: "",
      title: "New tab",
      icon: "",
      badIcon: "",
      loading: false,
      frame
    };

    frame.addEventListener("load", () => {
      sync(tab);
      tab.loading = false;
      render();
    });

    $("views").appendChild(frame);
    tabs.push(tab);
    cur = tab.id;
    render();

    if (raw) go(tab, raw);

    return tab;
  }

  async function go(tab, raw) {
    if (!tab) tab = newTab();

    const url = resolve(raw);
    if (!url) return;

    try {
      await boot();
    } catch {
      return;
    }

    tab.url = url;
    tab.title = hostOf(url);
    tab.loading = true;
    cur = tab.id;
    tab.frame.src = __uv$config.prefix + __uv$config.encodeUrl(url);
    render();
  }

  // Find the page's icon and return a URL that loads through the proxy.
  function findIcon(w, pageUrl) {
    try {
      const link = w.document && w.document.querySelector('link[rel~="icon"]');
      const raw = link && link.href;

      if (raw) {
        if (raw.startsWith("data:")) return raw;

        if (raw.startsWith(location.origin + __uv$config.prefix)) {
          return raw;
        }

        if (/^https?:\/\//i.test(raw)) {
          return __uv$config.prefix + __uv$config.encodeUrl(raw);
        }
      }

      if (pageUrl) {
        return __uv$config.prefix +
          __uv$config.encodeUrl(new URL("/favicon.ico", pageUrl).href);
      }
    } catch {
      /* page not ready */
    }

    return "";
  }

  // Read the real address and title back out of the proxied page.
  function sync(tab) {
    let changed = false;

    try {
      const w = tab.frame.contentWindow;
      const base = location.origin + __uv$config.prefix;
      const href = w.location.href;

      if (href.indexOf(base) === 0) {
        const real = __uv$config.decodeUrl(href.slice(base.length));
        const title = (w.document && w.document.title) || hostOf(real);

        if (real && real !== tab.url) {
          tab.url = real;
          changed = true;
        }

        if (title !== tab.title) {
          tab.title = title;
          changed = true;
        }

        let icon = findIcon(w, tab.url);
        if (icon && icon === tab.badIcon) icon = "";

        if (icon !== tab.icon) {
          tab.icon = icon;
          changed = true;
        }
      }
    } catch {
      /* cross-origin or not ready */
    }

    return changed;
  }

  function select(id) {
    cur = id;
    render();
  }

  function closeTab(id) {
    const i = tabs.findIndex((t) => t.id === id);
    if (i < 0) return;

    tabs[i].frame.remove();
    tabs.splice(i, 1);

    if (!tabs.length) {
      newTab();
      return;
    }

    if (cur === id) cur = tabs[Math.max(0, i - 1)].id;

    render();
  }

  function goHome(tab) {
    if (!tab) return;

    tab.url = "";
    tab.title = "New tab";
    tab.icon = "";
    tab.loading = false;
    tab.frame.src = "about:blank";
    render();
  }

  // ---------- rendering ----------
  function render() {
    const strip = $("tabs");
    strip.textContent = "";

    for (const t of tabs) {
      const el = document.createElement("div");
      el.className = "tab" + (t.id === cur ? " on" : "");
      el.setAttribute("role", "tab");

      let lead;

      if (t.url && t.icon && !t.loading) {
        lead = document.createElement("img");
        lead.className = "fav";
        lead.alt = "";
        lead.src = t.icon;

        lead.addEventListener("error", () => {
          t.badIcon = t.icon;
          t.icon = "";
          render();
        });
      } else {
        lead = document.createElement("i");
        lead.className = "dot" + (t.loading ? " spin" : "");
      }

      const label = document.createElement("span");
      label.textContent = t.url ? t.title : "New tab";

      const x = document.createElement("b");
      x.textContent = "×";
      x.title = "Close tab";

      x.addEventListener("click", (e) => {
        e.stopPropagation();
        closeTab(t.id);
      });

      el.addEventListener("click", () => select(t.id));

      el.addEventListener("auxclick", (e) => {
        if (e.button === 1) closeTab(t.id);
      });

      el.append(lead, label, x);
      strip.append(el);

      t.frame.style.display =
        t.id === cur && t.url ? "block" : "none";
    }

    const c = curTab();

    $("start").style.display = c && !c.url ? "flex" : "none";

    if (document.activeElement !== $("addr")) {
      $("addr").value = c && c.url ? c.url : "";
    }

    $("load").className = c && c.loading ? "on" : "";

    $("star").classList.toggle(
      "on",
      !!(c && c.url && links.some((l) => l.url === c.url))
    );

    $("star").textContent =
      c && c.url && links.some((l) => l.url === c.url) ? "★" : "☆";

    document.title =
      c && c.url ? c.title + " - Emnity" : "Emnity";

    // Mirror the current page's icon onto the real browser tab.
    const fav = $("favicon");
    const want =
      c && c.url && c.icon && !c.loading
        ? c.icon
        : DEFAULT_ICON;

    if (fav.getAttribute("href") !== want) {
      fav.setAttribute("href", want);
    }
  }

  function renderLinks() {
    const bar = $("bookmarks");
    bar.textContent = "";
    bar.style.display = links.length ? "flex" : "none";

    for (const l of links) {
      const chip = document.createElement("button");
      chip.className = "chip";
      chip.title = l.url;

      const letter = document.createElement("span");
      letter.className = "l";
      letter.textContent = (l.title || "?").charAt(0).toUpperCase();

      const name = document.createElement("span");
      name.textContent = l.title;

      const x = document.createElement("span");
      x.className = "x";
      x.textContent = "×";
      x.title = "Remove";

      x.addEventListener("click", (e) => {
        e.stopPropagation();
        removeLink(l.url);
      });

      chip.addEventListener("click", () => go(curTab(), l.url));
      chip.append(letter, name, x);
      bar.append(chip);
    }

    const tiles = $("tiles");
    tiles.textContent = "";

    for (const l of links) {
      const tile = document.createElement("button");
      tile.className = "tile";

      const ic = document.createElement("div");
      ic.className = "ic";
      ic.textContent = (l.title || "?").charAt(0).toUpperCase();

      const t = document.createElement("span");
      t.className = "t";
      t.textContent = l.title;

      tile.append(ic, t);
      tile.addEventListener("click", () => go(curTab(), l.url));
      tiles.append(tile);
    }

    const add = document.createElement("button");
    add.className = "tile add";

    const aic = document.createElement("div");
    aic.className = "ic";
    aic.textContent = "+";

    const at = document.createElement("span");
    at.className = "t";
    at.textContent = "Add shortcut";

    add.append(aic, at);

    add.addEventListener("click", () => {
      const raw = prompt("Website address (for example example.com)");
      const url = raw ? resolve(raw) : "";

      if (!url || /\s/.test(raw.trim())) return;

      addLink(hostOf(url), url);
    });

    tiles.append(add);
    $("set-count").textContent = String(links.length);
  }

  function saveLinks() {
    store.set("emn_links", links);
    renderLinks();
    render();
  }

  function addLink(title, url) {
    if (links.some((l) => l.url === url)) return;

    links.push({ title, url });
    saveLinks();
  }

  function removeLink(url) {
    links = links.filter((l) => l.url !== url);
    saveLinks();
  }

  // ---------- wiring ----------
  function fillEngines() {
    const sel = $("eng");

    for (const [key, e] of Object.entries(ENGINES)) {
      const o = document.createElement("option");
      o.value = key;
      o.textContent = e.name;
      sel.append(o);
    }

    sel.value = settings.engine;

    sel.addEventListener("change", () => {
      settings.engine = sel.value;
      store.set("emn_settings", settings);
    });
  }

  $("plus").addEventListener("click", () => newTab());

  $("addr").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      go(curTab(), e.target.value);
      e.target.blur();
    }
  });

  $("addr").addEventListener("focus", (e) => e.target.select());

  $("sform").addEventListener("submit", (e) => {
    e.preventDefault();

    const v = $("sq").value;
    $("sq").value = "";

    go(curTab(), v);
  });

  $("back").addEventListener("click", () => {
    try {
      curTab().frame.contentWindow.history.back();
    } catch {
      /* ignore */
    }
  });

  $("fwd").addEventListener("click", () => {
    try {
      curTab().frame.contentWindow.history.forward();
    } catch {
      /* ignore */
    }
  });

  $("reload").addEventListener("click", () => {
    const t = curTab();

    if (!t || !t.url) return;

    t.loading = true;
    render();

    try {
      t.frame.contentWindow.location.reload();
    } catch {
      go(t, t.url);
    }
  });

  $("home").addEventListener("click", () => goHome(curTab()));

  $("star").addEventListener("click", () => {
    const t = curTab();

    if (!t || !t.url) return;

    if (links.some((l) => l.url === t.url)) {
      removeLink(t.url);
    } else {
      addLink(
        t.title && t.title !== t.url
          ? t.title.slice(0, 24)
          : hostOf(t.url),
        t.url
      );
    }
  });

  $("retry").addEventListener("click", () => boot().catch(() => {}));

  $("set-transport").value = settings.transport;

  $("set-transport").addEventListener("change", () => {
    settings.transport = $("set-transport").value;
    store.set("emn_settings", settings);
    location.reload();
  });

  $("gear").addEventListener("click", () => $("settings").showModal());

  $("reset-links").addEventListener("click", () => {
    links = DEFAULT_LINKS.map((l) => ({ ...l }));
    saveLinks();
  });

  $("reset-all").addEventListener("click", () => {
    if (!confirm("Clear your shortcuts and settings?")) return;

    store.clear();
    location.reload();
  });

  document.addEventListener("keydown", (e) => {
    if (!e.altKey) return;

    const k = e.key.toLowerCase();

    if (k === "t") {
      e.preventDefault();
      newTab();
    } else if (k === "w") {
      e.preventDefault();
      if (cur !== null) closeTab(cur);
    } else if (k === "l") {
      e.preventDefault();
      $("addr").focus();
    }
  });

  // Keep tab titles and addresses fresh for pages that change them without reloading.
  setInterval(() => {
    let changed = false;

    for (const t of tabs) {
      if (t.url && sync(t)) changed = true;
    }

    if (changed) render();
  }, 1500);

  // ---------- start ----------
  fillEngines();
  renderLinks();
  newTab();
  boot().catch(() => {});
  // ---------- ABOUT:BLANK BUTTON ----------
  const blankButton = document.createElement("button");
  blankButton.id = "blank";
  blankButton.title = "Open Emnity in about:blank";
  blankButton.setAttribute("aria-label", "Open Emnity in about:blank");
  blankButton.textContent = "↗";

  // Place between the Ready status box and Settings button.
  $("status").insertAdjacentElement("afterend", blankButton);

  blankButton.addEventListener("click", () => {
    const blankWindow = window.open("about:blank", "_blank");

    if (!blankWindow) {
      showBanner(
        "Pop-up blocked.",
        "Allow pop-ups for this site, then try again."
      );
      return;
    }

    try {
      blankWindow.opener = null;

      const doc = blankWindow.document;
      doc.title = "Emnity";
      doc.documentElement.style.cssText = "height:100%;margin:0";
      doc.body.style.cssText =
        "height:100%;margin:0;overflow:hidden;background:#fff";

      const frame = doc.createElement("iframe");
      frame.title = "Emnity";
      frame.src = window.location.href;
      frame.style.cssText =
        "position:fixed;inset:0;width:100%;height:100%;border:0;background:#fff";

      frame.setAttribute(
        "allow",
        "autoplay; fullscreen; clipboard-write; encrypted-media; picture-in-picture; web-share"
      );
      frame.setAttribute("allowfullscreen", "");

      doc.body.replaceChildren(frame);
    } catch {
      blankWindow.close();
      showBanner(
        "Couldn't open the new tab.",
        "Your browser prevented the new tab from being set up."
      );
    }
  });})();
