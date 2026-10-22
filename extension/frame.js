// Runs inside the dex, but only when it's framed by pokerogue.net (i.e. in our drawer). While the dex
// has focus, key presses never reach the game page, so the toggle shortcut is caught here and
// forwarded to content.js — along with route changes so the drawer reopens where the user left off.
(() => {
  if (window === window.top) return;
  const PARENTS = ["https://pokerogue.net", "https://www.pokerogue.net"];
  const parentOrigin = (() => {
    try {
      return location.ancestorOrigins?.[0] ?? new URL(document.referrer).origin;
    } catch {
      return null;
    }
  })();
  if (!PARENTS.includes(parentOrigin)) return;

  const { allowedIn, matches, watch } = globalThis.PRDexShortcut;
  const post = msg => window.parent.postMessage({ source: "prdex", ...msg }, parentOrigin);

  let shortcut = null;
  watch(sc => (shortcut = sc));

  window.addEventListener(
    "keydown",
    e => {
      if (e.repeat || !matches(shortcut, e) || !allowedIn(shortcut, e.target)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      post({ type: "toggle" });
    },
    true,
  );

  // Filters update the URL with history.replaceState (site/assets/js/lib/nav.js), which fires no
  // event, so also report the route whenever the dex loses focus (drawer closed, game clicked).
  let lastHash = null;
  const report = () => {
    if (location.hash === lastHash) return;
    lastHash = location.hash;
    post({ type: "route", hash: location.hash });
  };
  window.addEventListener("hashchange", report);
  window.addEventListener("blur", report);
  window.addEventListener("pagehide", report);
})();
