// Shared by the content scripts and the popup (classic script, not a module: content scripts can't
// be ES modules in MV3). A shortcut is { code, key, ctrl, alt, shift, meta }; matching uses
// `KeyboardEvent.code` so it survives keyboard layouts and macOS Option producing odd `key`s ("π").
globalThis.PRDexShortcut = (() => {
  const DEFAULT = Object.freeze({ code: "KeyP", key: "P", ctrl: false, alt: true, shift: false, meta: false });
  const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "AltGraph", "Meta", "OS", "CapsLock", "Fn"]);
  const NAMES = {
    Space: "Space",
    Backquote: "`",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
  };

  /** The shortcut a keydown describes, or null while only modifiers are held. */
  function fromEvent(e) {
    if (MODIFIER_KEYS.has(e.key) || !e.code) return null;
    return { code: e.code, key: e.key, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey };
  }

  function matches(sc, e) {
    return (
      !!sc &&
      e.code === sc.code &&
      e.ctrlKey === sc.ctrl &&
      e.altKey === sc.alt &&
      e.shiftKey === sc.shift &&
      e.metaKey === sc.meta
    );
  }

  function keyLabel(sc) {
    const m = /^(?:Key|Digit|Numpad)(.+)$/.exec(sc.code);
    if (m) return m[1].toUpperCase();
    if (NAMES[sc.code]) return NAMES[sc.code];
    if (/^F\d+$/.test(sc.code)) return sc.code;
    return sc.key && sc.key.length === 1 ? sc.key.toUpperCase() : sc.code;
  }

  function format(sc) {
    if (!sc) return "";
    const mods = [sc.ctrl && "Ctrl", sc.alt && "Alt", sc.shift && "Shift", sc.meta && "Meta"].filter(Boolean);
    return [...mods, keyLabel(sc)].join(" + ");
  }

  /**
   * A bare key (or Shift + key) would hijack typing, so it's ignored inside text fields — the game's
   * login form, the dex's search box. Ctrl/Alt/Meta combos work everywhere.
   */
  function allowedIn(sc, target) {
    if (sc.ctrl || sc.alt || sc.meta) return true;
    return !target?.closest?.("input, textarea, select, [contenteditable]:not([contenteditable=false])");
  }

  function valid(sc) {
    return (
      !!sc &&
      typeof sc.code === "string" &&
      sc.code.length > 0 &&
      ["ctrl", "alt", "shift", "meta"].every(k => typeof sc[k] === "boolean")
    );
  }

  async function load() {
    try {
      const { shortcut } = await chrome.storage.sync.get("shortcut");
      return valid(shortcut) ? shortcut : DEFAULT;
    } catch {
      return DEFAULT;
    }
  }

  /** Calls `fn(shortcut)` now and whenever the user changes it in the popup. */
  function watch(fn) {
    load().then(fn);
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "sync" && "shortcut" in changes) fn(valid(changes.shortcut.newValue) ? changes.shortcut.newValue : DEFAULT);
    });
  }

  return { DEFAULT, fromEvent, matches, format, allowedIn, valid, load, watch };
})();
