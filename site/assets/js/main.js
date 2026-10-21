import { $, $$, debounce, escapeHtml, formatDate, html, normalize, storage, timeAgo } from "./lib/dom.js";
import { db, iconUrl, itemIconUrl, loadData } from "./lib/data.js";
import { nav } from "./lib/nav.js";
import * as abilities from "./views/abilities.js";
import * as biomes from "./views/biomes.js";
import * as items from "./views/items.js";
import * as moves from "./views/moves.js";
import * as pokemon from "./views/pokemon.js";
import * as types from "./views/types.js";
import * as whatsNew from "./views/whats-new.js";

const SECTIONS = {
  pokemon: { module: pokemon, title: "Pokémon", kind: "Pokémon" },
  moves: { module: moves, title: "Moves", kind: "Move" },
  abilities: { module: abilities, title: "Abilities", kind: "Ability" },
  biomes: { module: biomes, title: "Biomes", kind: "Biome" },
  items: { module: items, title: "Items", kind: "Item" },
  types: { module: types, title: "Type chart" },
  "whats-new": { module: whatsNew, title: "What's new" },
};

const state = {
  view: null,
  panelOpen: false,
  panelDepth: 0,
  panelCleanup: null,
};

// ---------------------------------------------------------------- routing

function parseHash() {
  const h = location.hash.replace(/^#\/?/, "");
  const [path, query = ""] = h.split("?");
  const [section = "pokemon", ...rest] = path.split("/").filter(Boolean);
  return { section, slug: rest.join("/") || null, params: new URLSearchParams(query), query };
}

function setActiveTab(section) {
  $$(".tabs a").forEach(a => a.classList.toggle("active", a.dataset.tab === section));
}

function renderList(section, params, query) {
  const def = SECTIONS[section];
  state.view?.destroy?.();
  const el = $("#view");
  el.innerHTML = "";
  el.dataset.section = section;
  nav.section = section;
  nav.listQuery = query;
  state.view = def.module.list(el, params) ?? null;
  setActiveTab(section);
  document.title = `${def.title} · PokéRogue Dex`;
  if (section === "whats-new") markWhatsNewSeen();
}

function route() {
  const { section, slug, params, query } = parseHash();
  const def = SECTIONS[section];
  if (!def) {
    location.replace("#/pokemon");
    return;
  }

  if (slug && def.module.detail) {
    if (!nav.section) renderList(section, new URLSearchParams(), "");
    openPanel(section, slug, params);
    return;
  }

  if (state.panelOpen) closePanelUi();
  if (nav.section !== section || nav.listQuery !== query) {
    if (nav.section === section && state.view?.update) {
      nav.listQuery = query;
      state.view.update(params);
    } else {
      renderList(section, params, query);
      window.scrollTo({ top: 0 });
    }
  }
  nav.listHash = location.hash || `#/${section}`;
}

// ------------------------------------------------------------------ panel

const panel = $("#panel");
const panelBody = $("#panelBody");
const backdrop = $("#panelBackdrop");

function openPanel(section, slug, params) {
  const def = SECTIONS[section];
  state.panelCleanup?.();
  state.panelCleanup = null;
  panelBody.innerHTML = "";
  panelBody.scrollTop = 0;
  const result = def.module.detail(panelBody, decodeURIComponent(slug), params);
  if (!result) {
    panelBody.innerHTML = String(html`<div class="empty-state"><h2>Not found</h2><p>Nothing called “${slug}” exists in this game version.</p></div>`);
  }
  state.panelCleanup = result?.cleanup ?? null;
  $("#panelKind").textContent = def.kind;
  document.title = `${result?.title ?? "Not found"} · PokéRogue Dex`;

  if (!state.panelOpen) {
    state.panelOpen = true;
    state.panelDepth = 0;
    panel.hidden = false;
    backdrop.hidden = false;
    document.body.classList.add("panel-open");
    requestAnimationFrame(() => {
      panel.classList.add("open");
      backdrop.classList.add("open");
    });
    panel.focus({ preventScroll: true });
  } else {
    state.panelDepth++;
  }
  $("#panelBack").hidden = state.panelDepth === 0;
  $("#panelTitle")?.focus?.({ preventScroll: true });
}

function closePanelUi() {
  state.panelOpen = false;
  state.panelDepth = 0;
  state.panelCleanup?.();
  state.panelCleanup = null;
  panel.classList.remove("open");
  backdrop.classList.remove("open");
  document.body.classList.remove("panel-open");
  setTimeout(() => {
    if (!state.panelOpen) {
      panel.hidden = true;
      backdrop.hidden = true;
      panelBody.innerHTML = "";
    }
  }, 220);
  if (nav.section) document.title = `${SECTIONS[nav.section].title} · PokéRogue Dex`;
}

function closePanel() {
  location.hash = nav.listHash || `#/${nav.section ?? "pokemon"}`;
}

$("#panelClose").addEventListener("click", closePanel);
backdrop.addEventListener("click", closePanel);
$("#panelBack").addEventListener("click", () => {
  if (state.panelDepth > 0) {
    state.panelDepth -= 2; // the resulting hashchange re-opens (+1)
    history.back();
  } else closePanel();
});
$("#panelCopy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    toast("Link copied to clipboard");
  } catch {
    toast("Couldn't copy — use the address bar");
  }
});

// ------------------------------------------------------------ quick search

const qs = $("#qs");
const qsInput = $("#qsInput");
const qsResults = $("#qsResults");
let qsIndex = null;
let qsActive = 0;

function buildQuickIndex() {
  qsIndex = [
    ...db.species.map(s => ({
      kind: "Pokémon",
      label: s.name,
      sub: `#${String(s.id).padStart(4, "0")}${s.forms.length > 1 ? ` · ${s.forms.length} forms` : ""}`,
      href: `#/pokemon/${s.slug}`,
      icon: iconUrl(s.icon),
      search: s.search,
    })),
    ...db.moves.map(m => ({ kind: "Move", label: m.name, sub: `${m.type} · ${m.category}`, href: `#/moves/${m.slug}`, search: m.search, type: m.type })),
    ...db.abilities.map(a => ({ kind: "Ability", label: a.name, sub: `Gen ${a.gen}`, href: `#/abilities/${a.slug}`, search: a.search })),
    ...db.biomes.map(b => ({ kind: "Biome", label: b.name, sub: "Biome", href: `#/biomes/${b.slug}`, search: normalize(b.name) })),
    ...db.items.map(i => ({
      kind: "Item",
      label: i.name,
      sub: i.pools.find(p => p.pool === "player")?.tier ?? "item",
      href: `#/items/${i.slug}`,
      icon: i.icon ? itemIconUrl(i.icon) : null,
      search: i.search,
    })),
  ];
}

function openQuickSearch() {
  if (!qsIndex) return;
  qs.hidden = false;
  qsInput.value = "";
  renderQuick("");
  requestAnimationFrame(() => qsInput.focus());
}

function closeQuickSearch() {
  qs.hidden = true;
}

function renderQuick(q) {
  const n = normalize(q);
  let results;
  if (!n) {
    results = [];
  } else {
    results = qsIndex
      .map(e => {
        const i = e.search.indexOf(n);
        if (i < 0) return null;
        const score = (e.search === n ? 0 : i === 0 ? 1 : e.search.includes(` ${n}`) ? 2 : 3) * 1000 + e.search.length;
        return { e, score };
      })
      .filter(Boolean)
      .sort((a, b) => a.score - b.score)
      .slice(0, 40)
      .map(r => r.e);
  }
  qsActive = 0;
  qsResults.innerHTML = results.length
    ? results
        .map(
          (r, i) =>
            String(html`<li role="option" id="qs-${i}" aria-selected="${i === 0}" class="${i === 0 ? "active" : ""}">
              <a href="${r.href}">
                <span class="qs-icon">${r.icon ? html`<img src="${r.icon}" alt="" loading="lazy" />` : r.type ? html`<i class="type-dot type-${r.type}"></i>` : ""}</span>
                <span class="qs-label">${r.label}</span>
                <span class="qs-sub">${r.sub}</span>
                <span class="qs-kind">${r.kind}</span>
              </a>
            </li>`),
        )
        .join("")
    : n
      ? `<li class="qs-empty">No results for “${escapeHtml(q)}”.</li>`
      : `<li class="qs-empty">Try “Garchomp”, “Earthquake”, “Speed Boost”, “Volcano” or “Leftovers”.</li>`;
}

function moveQuick(delta) {
  const items = $$("li[role=option]", qsResults);
  if (!items.length) return;
  items[qsActive]?.classList.remove("active");
  items[qsActive]?.setAttribute("aria-selected", "false");
  qsActive = (qsActive + delta + items.length) % items.length;
  items[qsActive].classList.add("active");
  items[qsActive].setAttribute("aria-selected", "true");
  items[qsActive].scrollIntoView({ block: "nearest" });
}

qsInput.addEventListener("input", debounce(() => renderQuick(qsInput.value), 60));
qsInput.addEventListener("keydown", e => {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    moveQuick(1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    moveQuick(-1);
  } else if (e.key === "Enter") {
    const a = $$("li[role=option] a", qsResults)[qsActive];
    if (a) {
      location.hash = a.getAttribute("href");
      closeQuickSearch();
    }
  }
});
qsResults.addEventListener("click", e => {
  if (e.target.closest("a")) closeQuickSearch();
});
qs.addEventListener("click", e => {
  if (e.target === qs) closeQuickSearch();
});
$("#quickSearchBtn").addEventListener("click", openQuickSearch);

// --------------------------------------------------------------- keyboard

document.addEventListener("keydown", e => {
  const typing = e.target.closest?.("input, textarea, select, [contenteditable]");
  if (e.key === "Escape") {
    if (!qs.hidden) closeQuickSearch();
    else if (state.panelOpen) closePanel();
    return;
  }
  if ((e.key === "/" && !typing) || (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey))) {
    e.preventDefault();
    openQuickSearch();
  }
});

// ------------------------------------------------------------------ theme

const themeBtn = $("#themeBtn");
function currentTheme() {
  return document.documentElement.dataset.theme ?? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
}
themeBtn.addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  storage.set("prdex:theme", next);
});

// ------------------------------------------------------------------ toast

let toastTimer;
export function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => (t.hidden = true), 200);
  }, 1800);
}

// ------------------------------------------------------------- what's new

function seenKey() {
  return `${db.meta.dex.version}|${db.meta.game.tag}`;
}
function markWhatsNewSeen() {
  if (!db.meta) return;
  storage.set("prdex:seen", seenKey());
  $("#newDot").hidden = true;
}

// ------------------------------------------------------------------- boot

// Sticky table headers sit just below the (variable-height) site header.
const header = $(".site-header");
new ResizeObserver(() => document.documentElement.style.setProperty("--header-h", `${header.offsetHeight}px`)).observe(header);

async function boot() {
  try {
    await loadData(p => ($("#bootBar").style.width = `${Math.round(p * 100)}%`));
  } catch (err) {
    $("#boot").innerHTML = String(html`<div class="empty-state"><h2>Couldn't load the dex data</h2><p>${err.message}</p>
      <p class="muted">If you're running locally, start the dev server with <code>npm run dev</code>.</p></div>`);
    return;
  }
  $("#boot").remove();

  const { game, dex, generatedAt } = db.meta;
  $("#versionText").textContent = `v${game.version}`;
  $("#versionPill").title = `Data from PokéRogue ${game.tag} (released ${formatDate(game.publishedAt)}) · rebuilt ${timeAgo(generatedAt)}`;
  $("#footerMeta").innerHTML = String(
    html`PokéRogue Dex <b>v${dex.version}</b> · data from PokéRogue
      <a href="${game.url ?? "https://github.com/pagefaultgames/pokerogue/releases"}" target="_blank" rel="noopener">${game.tag}</a>
      (<code>${game.commit.slice(0, 7)}</code>) · generated ${formatDate(generatedAt)} ·
      <a href="https://github.com/Crabyy/pokeroguedex/issues" target="_blank" rel="noopener">Report an issue</a>`,
  );
  if (storage.get("prdex:seen") !== seenKey()) $("#newDot").hidden = false;

  buildQuickIndex();
  window.addEventListener("hashchange", route);
  route();
}

boot();
