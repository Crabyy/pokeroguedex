import { $, html } from "../lib/dom.js";
import { viewHeader } from "./shared.js";

// Written by scripts/sign-extension.mjs next to the signed .xpi; it's also Firefox's update manifest.
const UPDATES_URL = "extension/updates.json";
const ADDON_ID = "pokeroguedex@crabyy.github.io";

// Zen, LibreWolf, Floorp … all report "Firefox/" and install the same signed .xpi.
const isFirefox = /\bFirefox\//.test(navigator.userAgent);

export function list(el) {
  el.innerHTML = String(html`<section class="view ext-page">
    ${viewHeader("Firefox extension", "The dex in a side panel right inside PokéRogue — open and close it with a key you choose.")}
    <div class="ext-grid">
      <section class="card ext-install" id="extInstall" aria-live="polite">
        <p class="muted">Checking for the latest build…</p>
      </section>
      <section class="card ext-about">
        <h3>How to use it</h3>
        <ol>
          <li>Open <a href="https://pokerogue.net" target="_blank" rel="noopener">pokerogue.net</a> and press <kbd>Alt</kbd> + <kbd>P</kbd>.</li>
          <li>Press it again (from the game or the dex) to hide the panel; the game gets the keyboard back.</li>
          <li>To pick another key, click the extension's toolbar button, then the shortcut, then press any key or combo.</li>
          <li>Drag the panel's left edge to resize it. It reopens on the page you were on.</li>
        </ol>
        <h3>Privacy</h3>
        <p>
          It only runs on pokerogue.net and collects nothing. Your shortcut and panel size are saved in your browser.
          The panel shows this site, so it's always on the latest game data.
        </p>
      </section>
    </div>
    <figure class="ext-shot">
      <img src="assets/img/extension-preview.jpg" alt="The dex open in a panel beside the PokéRogue title screen" width="1200" height="750" loading="lazy" />
    </figure>
  </section>`);

  renderInstall($("#extInstall", el));
}

async function renderInstall(box) {
  const release = await fetch(UPDATES_URL, { cache: "no-cache" })
    .then(r => (r.ok ? r.json() : null))
    .then(u => u?.addons?.[ADDON_ID]?.updates?.at(-1) ?? null)
    .catch(() => null);
  if (!box.isConnected) return;

  if (!release) {
    box.innerHTML = String(html`<h3>Install</h3>
      <p>The first signed build is on its way. Check back soon!</p>`);
    return;
  }

  const file = new URL(release.update_link).pathname.replace(/^\//, "");
  box.innerHTML = String(
    isFirefox
      ? html`<h3>Install</h3>
          <a class="btn btn-primary ext-btn" href="${file}">Add to Firefox</a>
          <p class="muted small">
            v${release.version} · signed by Mozilla · updates automatically. Firefox will ask you to allow the
            install, then to add the extension.
          </p>`
      : html`<h3>Install</h3>
          <p>
            <b>Firefox only for now.</b> Open this page in Firefox or a Firefox-based browser (Zen, LibreWolf, Floorp…)
            to install it.
          </p>
          <p class="muted small">v${release.version} · <a href="${file}" download>Download the .xpi</a></p>`,
  );
}
