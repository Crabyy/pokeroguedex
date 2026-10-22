// Runs on pokerogue.net only (see manifest `matches`). Adds a slide-out drawer with the live dex in
// an iframe, toggled by the user's shortcut. The iframe is created on first open so the dex costs the
// game nothing until it's wanted, and kept afterwards so its page/filters survive closing.
(() => {
  const DEX_URL = "https://pokeroguedex.vercel.app/";
  const DEX_ORIGIN = new URL(DEX_URL).origin;
  const MIN_WIDTH = 360;
  const { allowedIn, format, matches, watch } = globalThis.PRDexShortcut;

  let shortcut = null;
  let ui = null; // { panel, frame, link, hint } once built
  let building = null;
  let open = false;
  let swallowKeyUp = null;

  watch(sc => {
    shortcut = sc;
    if (ui) ui.hint.textContent = format(sc);
  });

  // Capture on window and run at document_start, so this fires before the game's (Phaser's) own
  // window keydown listener and the toggle key never reaches the game.
  window.addEventListener(
    "keydown",
    e => {
      if (e.repeat || !matches(shortcut, e) || !allowedIn(shortcut, e.target)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      swallowKeyUp = e.code;
      toggle();
    },
    true,
  );
  window.addEventListener(
    "keyup",
    e => {
      if (e.code !== swallowKeyUp) return;
      swallowKeyUp = null;
      e.stopImmediatePropagation();
    },
    true,
  );

  // Messages from frame.js inside the dex iframe (focus is there, so our keydown listener can't see it).
  window.addEventListener("message", e => {
    if (!ui || e.source !== ui.frame.contentWindow || e.origin !== DEX_ORIGIN) return;
    const msg = e.data;
    if (msg?.source !== "prdex") return;
    if (msg.type === "toggle") {
      // Focus returns to the game before the key is released; don't let it see a stray keyup.
      swallowKeyUp = shortcut?.code;
      toggle(false);
    }
    else if (msg.type === "route" && typeof msg.hash === "string" && msg.hash.startsWith("#/") && msg.hash.length < 500) {
      // Reopen on the same page next visit, and keep "open in new tab" pointing at it.
      chrome.storage.local.set({ hash: msg.hash });
      ui.link.href = DEX_URL + msg.hash;
    }
  });

  // From the toolbar popup.
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.type === "prdex:ping") reply({ open });
    else if (msg?.type === "prdex:toggle") {
      toggle();
      reply({ open });
    }
  });

  async function toggle(force = !open) {
    if (force === open) return;
    open = force;
    ui ??= await (building ??= build());
    // `open` may have flipped again while the first build was in flight; apply the latest.
    ui.panel.classList.toggle("open", open);
    ui.panel.inert = !open;
    if (open) {
      // Firefox won't focus the frame until the un-hidden panel has been styled.
      requestAnimationFrame(() => open && ui.frame.focus());
    } else {
      // Hand the keyboard back to the game.
      ui.frame.blur();
      window.focus();
    }
  }

  async function build() {
    const { hash, width } = await chrome.storage.local.get(["hash", "width"]).catch(() => ({}));

    const host = document.createElement("prdex-overlay");
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `
      <style>${CSS}</style>
      <aside class="panel" inert>
        <div class="resize" title="Drag to resize"></div>
        <header>
          ${ICON}
          <strong>PokéRogue Dex</strong>
          <kbd class="hint" title="Toggle shortcut — change it from the extension's toolbar button"></kbd>
          <span class="spacer"></span>
          <a class="btn" target="_blank" rel="noopener" title="Open in a new tab" aria-label="Open in a new tab">↗</a>
          <button class="btn close" type="button" title="Close" aria-label="Close">✕</button>
        </header>
        <iframe title="PokéRogue Dex" allow="clipboard-write"></iframe>
      </aside>`;

    const panel = shadow.querySelector(".panel");
    const frame = shadow.querySelector("iframe");
    const link = shadow.querySelector("a");
    const hint = shadow.querySelector(".hint");
    hint.textContent = format(shortcut);
    frame.src = DEX_URL + (typeof hash === "string" && hash.startsWith("#/") ? hash : "");
    link.href = frame.src;
    frame.addEventListener("load", () => open && frame.focus());
    shadow.querySelector(".close").addEventListener("click", () => toggle(false));

    const setWidth = w => {
      const px = Math.round(Math.max(MIN_WIDTH, Math.min(w, window.innerWidth)));
      panel.style.setProperty("--w", `${px}px`);
      return px;
    };
    if (typeof width === "number") setWidth(width);

    const handle = shadow.querySelector(".resize");
    handle.addEventListener("pointerdown", e => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      panel.classList.add("resizing");
      let last = null;
      const move = ev => (last = setWidth(window.innerWidth - ev.clientX));
      const up = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        panel.classList.remove("resizing");
        if (last) chrome.storage.local.set({ width: last });
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    });

    document.documentElement.append(host);
    // Let the closed state paint once so the first open animates.
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { panel, frame, link, hint };
  }

  const ICON = `<svg class="logo" viewBox="0 0 32 32" aria-hidden="true">
    <defs><linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffcf5a"/><stop offset="1" stop-color="#f08a24"/></linearGradient></defs>
    <circle cx="16" cy="16" r="14" fill="#1b1f36"/><path d="M2 16a14 14 0 0 1 28 0z" fill="url(#t)"/>
    <rect x="2" y="14.5" width="28" height="3" fill="#1b1f36"/><circle cx="16" cy="16" r="5" fill="#1b1f36"/>
    <circle cx="16" cy="16" r="2.6" fill="#e9ecff"/><circle cx="16" cy="16" r="14" fill="none" stroke="#1b1f36" stroke-width="2"/>
  </svg>`;

  // Colours mirror the dex's dark theme (site/assets/css/main.css).
  const CSS = `
    :host { all: initial; }
    .panel {
      --w: min(560px, 100vw);
      position: fixed; top: 0; right: 0; bottom: 0; z-index: 2147483647;
      width: var(--w); max-width: 100vw;
      display: flex; flex-direction: column;
      background: #0f111c; color: #e9ebf8;
      border-left: 1px solid #3a4270; box-shadow: -10px 0 30px rgb(0 0 0 / 0.45);
      font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      transform: translateX(calc(100% + 40px)); visibility: hidden;
      transition: transform 0.22s ease, visibility 0s linear 0.22s;
    }
    .panel.open { transform: none; visibility: visible; transition: transform 0.22s ease; }
    .panel.resizing { transition: none; user-select: none; }
    .panel.resizing iframe { pointer-events: none; }
    header {
      display: flex; align-items: center; gap: 8px;
      height: 38px; padding: 0 6px 0 12px; flex: none;
      background: #191d31; border-bottom: 1px solid #2b3152;
    }
    .logo { width: 18px; height: 18px; flex: none; }
    strong { font-weight: 650; white-space: nowrap; }
    kbd {
      font: 11px/1 ui-monospace, SFMono-Regular, Consolas, monospace; color: #8e94b8;
      border: 1px solid #2b3152; border-radius: 5px; padding: 3px 6px; white-space: nowrap;
    }
    .spacer { flex: 1; }
    .btn {
      all: unset; cursor: pointer; display: grid; place-items: center;
      width: 28px; height: 28px; border-radius: 8px; color: #c3c7e0; font-size: 15px;
    }
    .btn:hover { background: #2a3050; color: #e9ebf8; }
    .btn:focus-visible { outline: 2px solid #ffd36b; outline-offset: 1px; }
    iframe { flex: 1; width: 100%; border: 0; background: #0f111c; color-scheme: normal; }
    .resize { position: absolute; left: -4px; top: 0; bottom: 0; width: 8px; cursor: ew-resize; z-index: 1; }
    .resize:hover, .resizing .resize { background: rgb(245 184 61 / 0.35); }
    @media (max-width: 480px) { .resize { display: none; } .panel { width: 100vw; } }
    @media (prefers-reduced-motion: reduce) { .panel, .panel.open { transition: none; } }
  `;
})();
