import { $, $$, formatDate, html, markdown, raw, timeAgo } from "../lib/dom.js";
import { BIOME_TIER_LABEL, STAT_LABELS, STATUS_LABELS, abilityLink, biomeHref, db, iconUrl, levelLabel, moveLink, speciesHref, typeBadges } from "../lib/data.js";
import { viewHeader } from "./shared.js";

const cache = new Map();
async function getJson(path) {
  if (!cache.has(path)) {
    cache.set(
      path,
      fetch(path, { cache: "no-cache" }).then(r => {
        if (!r.ok) throw new Error(`${path}: ${r.status}`);
        return r.json();
      }),
    );
  }
  return cache.get(path);
}

export function list(el, params) {
  const tab = params.get("tab") === "dex" ? "dex" : "game";
  const { meta } = db;
  el.innerHTML = String(html`<section class="view whats-new">
    ${viewHeader("What's new", "Every change between PokéRogue releases, detected automatically from the game's source — plus updates to this dex.")}
    <div class="status-strip">
      <div><span class="muted small">Game data</span><b>PokéRogue ${meta.game.tag}</b><span class="muted small">released ${formatDate(meta.game.publishedAt)}</span></div>
      <div><span class="muted small">This dex</span><b>v${meta.dex.version}</b><span class="muted small">data rebuilt ${timeAgo(meta.generatedAt)}</span></div>
      <div><span class="muted small">Updates</span><b>Every 6 hours</b><span class="muted small">new game releases are picked up automatically</span></div>
    </div>
    <div class="seg big" role="tablist">
      <a role="tab" class="seg-btn ${tab === "game" ? "on" : ""}" href="#/whats-new" aria-selected="${tab === "game"}">Game updates</a>
      <a role="tab" class="seg-btn ${tab === "dex" ? "on" : ""}" href="#/whats-new?tab=dex" aria-selected="${tab === "dex"}">Dex changelog</a>
    </div>
    <div id="wnBody"><p class="muted">Loading…</p></div>
  </section>`);

  const body = $("#wnBody", el);
  if (tab === "dex") renderDexChangelog(body);
  else renderGameUpdates(body);
}

async function renderDexChangelog(body) {
  try {
    const res = await fetch("CHANGELOG.md", { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status);
    const text = await res.text();
    // Drop the file's own H1 and intro; start at the first version heading.
    const fromFirstVersion = text
      .slice(Math.max(0, text.search(/^## /m)))
      .replace(/^## \[Unreleased\]\s*(?=^## )/ms, "") // hide an empty Unreleased section
      .replace(/^(## )\[([^\]]+)\]/gm, "$1v$2");
    body.innerHTML = `<div class="card prose changelog">${markdown(fromFirstVersion)}</div>`;
  } catch {
    body.innerHTML = String(html`<div class="card"><p>The changelog lives in <a href="https://github.com/Crabyy/pokeroguedex/blob/main/CHANGELOG.md" target="_blank" rel="noopener">CHANGELOG.md on GitHub</a>.</p></div>`);
  }
}

async function renderGameUpdates(body) {
  let index;
  try {
    index = await getJson("data/changes/index.json");
  } catch {
    body.innerHTML = `<p class="muted">No release history has been generated yet.</p>`;
    return;
  }
  if (!index.length) {
    body.innerHTML = `<p class="muted">No release history has been generated yet.</p>`;
    return;
  }
  body.innerHTML = String(html`<ol class="release-list">
    ${index.map(
      (r, i) => html`<li class="release card" data-tag="${r.tag}">
        <header class="release-head">
          <div>
            <h2 class="h3">${r.name || r.tag}</h2>
            <p class="muted small">${formatDate(r.publishedAt)} · compared with ${r.from}${r.url ? html` · <a href="${r.url}" target="_blank" rel="noopener">GitHub release</a>` : ""}</p>
          </div>
          ${i === 0 ? html`<span class="pill new">Latest</span>` : ""}
        </header>
        <div class="summary-chips">${summaryChips(r)}</div>
        <details class="diff-details" ${i === 0 ? raw("open") : ""}>
          <summary>Detected data changes</summary>
          <div class="diff-body" data-loaded="0"><p class="muted small">Loading…</p></div>
        </details>
        ${r.notes
          ? html`<details class="notes-details">
              <summary>Official patch notes</summary>
              <div class="prose">${raw(markdown(r.notes))}</div>
            </details>`
          : ""}
      </li>`,
    )}
  </ol>`);

  const load = async details => {
    const holder = details.querySelector(".diff-body");
    if (holder.dataset.loaded === "1") return;
    holder.dataset.loaded = "1";
    const tag = details.closest(".release").dataset.tag;
    try {
      const diff = await getJson(`data/changes/${tag}.json`);
      holder.innerHTML = String(renderDiff(diff));
    } catch (err) {
      holder.innerHTML = `<p class="muted">Couldn't load details (${err.message}).</p>`;
    }
  };
  $$(".diff-details", body).forEach(d => {
    if (d.open) load(d);
    d.addEventListener("toggle", () => d.open && load(d));
  });
}

function summaryChips(r) {
  if (!r.total) return html`<span class="chip static">No data changes — code/bug fixes only</span>`;
  const labels = {
    species: ["Pokémon", "Pokémon"],
    moves: ["move", "moves"],
    abilities: ["ability", "abilities"],
    biomes: ["biome", "biomes"],
    items: ["item", "items"],
  };
  const noun = (k, n) => labels[k][n === 1 ? 0 : 1];
  const out = [];
  for (const [k, s] of Object.entries(r.summary)) {
    if (s.added) out.push(html`<span class="chip static add">+${s.added} new ${noun(k, s.added)}</span>`);
    if (s.changed) out.push(html`<span class="chip static">${s.changed} ${noun(k, s.changed)} changed</span>`);
    if (s.removed) out.push(html`<span class="chip static rem">−${s.removed} ${noun(k, s.removed)} removed</span>`);
  }
  return out;
}

// ------------------------------------------------------------ diff render

const MAX_LIST = 12;

function moveList(ids) {
  const shown = ids.slice(0, MAX_LIST);
  return html`${shown.map((id, i) => html`${i ? ", " : ""}${moveLink(id)}`)}${ids.length > MAX_LIST ? html` <span class="muted">and ${ids.length - MAX_LIST} more</span>` : ""}`;
}

const abilityName = id => (id ? abilityLink(id) : html`<span class="muted">none</span>`);

function speciesFieldLine(s, c) {
  const [, formKey, field] = c.field.startsWith("form:") ? c.field.split(":") : [null, null, c.field];
  const formLabel = formKey ? html`<span class="form-tag">${s?.forms.find(f => f.key === formKey)?.name ?? formKey}</span> ` : "";
  switch (field) {
    case "levelMoves":
      return html`${c.added.map(x => html`<li class="add">Learns ${moveLink(x.move)} at ${x.level > 0 ? `Lv. ${x.level}` : levelLabel(x.level)}</li>`)}
        ${c.removed.map(x => html`<li class="rem">No longer learns ${moveLink(x.move)} at ${x.level > 0 ? `Lv. ${x.level}` : levelLabel(x.level)}</li>`)}`;
    case "eggMoves":
      return html`<li>Egg moves: ${c.added.length ? html`<span class="add-text">+ ${moveList(c.added)}</span>` : ""} ${c.removed.length ? html`<span class="rem-text">− ${moveList(c.removed)}</span>` : ""}</li>`;
    case "tms":
      return html`${c.added.length ? html`<li class="add">${c.added.length} new TM${c.added.length > 1 ? "s" : ""}: ${moveList(c.added)}</li>` : ""}
        ${c.removed.length ? html`<li class="rem">${c.removed.length} TM${c.removed.length > 1 ? "s" : ""} removed: ${moveList(c.removed)}</li>` : ""}`;
    case "passive":
      return html`<li>${formLabel}Passive: ${abilityName(c.before)} → ${abilityName(c.after)}</li>`;
    case "abilities": {
      const slots = ["Ability 1", "Ability 2", "Hidden"];
      return html`${c.after.map((a, i) => (a !== c.before?.[i] ? html`<li>${formLabel}${slots[i]}: ${abilityName(c.before?.[i])} → ${abilityName(a)}</li>` : ""))}`;
    }
    case "stats":
      return html`<li>${formLabel}Base stats: ${c.after
        .map((v, i) => [i, c.before?.[i], v])
        .filter(([, b, a]) => b !== a)
        .map(([i, b, a], n) => html`${n ? ", " : ""}${STAT_LABELS[i]} ${b} → <b class="${a > b ? "up" : "down"}">${a}</b>`)}</li>`;
    case "types":
      return html`<li>${formLabel}Type: ${typeBadges(c.before ?? [], { small: true, link: false })} → ${typeBadges(c.after ?? [], { small: true, link: false })}</li>`;
    case "forms":
      return html`<li class="add">New forms: ${c.added.join(", ")}</li>`;
    case "evolutions":
      return html`<li>Evolution method changed</li>`;
    case "biomes":
      return html`${c.added.map(b => html`<li class="add">Now found in ${biomeLink(b.biome)} (${BIOME_TIER_LABEL[b.tier] ?? b.tier})</li>`)}
        ${c.removed.map(b => html`<li class="rem">No longer in ${biomeLink(b.biome)} (${BIOME_TIER_LABEL[b.tier] ?? b.tier})</li>`)}`;
    case "cost":
      return html`<li>Starter cost: ${c.before ?? "—"} → <b>${c.after ?? "—"}</b></li>`;
    case "eggTier":
      return html`<li>Egg tier: ${c.before ?? "—"} → <b>${c.after ?? "—"}</b></li>`;
    default:
      return html`<li>${formLabel}${field}: ${JSON.stringify(c.before)} → ${JSON.stringify(c.after)}</li>`;
  }
}

function biomeLink(id) {
  const b = db.biomeById.get(id);
  return b ? html`<a href="${biomeHref(b)}">${b.name}</a>` : `#${id}`;
}

const STATUS_TEXT = s => (s ? STATUS_LABELS[s]?.[0] ?? s : "Fully implemented");

function moveFieldLine(c) {
  const label = { type: "Type", category: "Category", power: "Power", accuracy: "Accuracy", pp: "PP", chance: "Effect chance", priority: "Priority", target: "Target", tm: "TM tier" }[c.field];
  if (c.field === "status") return html`<li class="${c.after ? "rem" : "add"}">${STATUS_TEXT(c.before)} → <b>${STATUS_TEXT(c.after)}</b></li>`;
  if (c.field === "effect" || c.field === "description") return html`<li class="muted">Description updated</li>`;
  if (c.field === "flags") return html`<li>Flags: ${c.added.map(f => html`<span class="add-text">+${f}</span> `)}${c.removed.map(f => html`<span class="rem-text">−${f}</span> `)}</li>`;
  return html`<li>${label ?? c.field}: ${c.before ?? "—"} → <b>${c.after ?? "—"}</b></li>`;
}

function renderDiff(diff) {
  const sections = [];
  const added = [
    ...diff.species.added.map(s => ({ kind: "Pokémon", html: speciesChip(s.id, s.name) })),
    ...diff.moves.added.map(m => ({ kind: "Move", html: moveLink(m.id) })),
    ...diff.abilities.added.map(a => ({ kind: "Ability", html: abilityLink(a.id) || a.name })),
    ...diff.biomes.added.map(b => ({ kind: "Biome", html: biomeLink(b.id) })),
    ...diff.items.added.map(i => ({ kind: "Item", html: html`<a href="#/items/${i.key.toLowerCase().replace(/_/g, "-")}">${i.name}</a>` })),
  ];
  if (added.length) {
    sections.push(html`<section class="diff-section"><h3>New</h3><ul class="diff-added">${added.map(a => html`<li><span class="pill">${a.kind}</span> ${a.html}</li>`)}</ul></section>`);
  }

  if (diff.species.changed.length) {
    sections.push(html`<section class="diff-section"><h3>Pokémon <span class="muted">${diff.species.changed.length}</span></h3>
      <div class="diff-cards">${diff.species.changed.map(entry => {
        const s = db.speciesById.get(entry.id);
        return html`<div class="diff-card">
          <div class="diff-card-head">${speciesChip(entry.id, entry.name)}</div>
          <ul class="diff-lines">${entry.changes.map(c => speciesFieldLine(s, c))}</ul>
        </div>`;
      })}</div></section>`);
  }

  const simple = (title, list, linkFn, lineFn) =>
    list.length
      ? html`<section class="diff-section"><h3>${title} <span class="muted">${list.length}</span></h3>
          <div class="diff-cards">${list.map(e => html`<div class="diff-card"><div class="diff-card-head">${linkFn(e)}</div><ul class="diff-lines">${e.changes.map(lineFn)}</ul></div>`)}</div>
        </section>`
      : "";

  sections.push(simple("Moves", diff.moves.changed, e => moveLink(e.id), moveFieldLine));
  sections.push(simple("Abilities", diff.abilities.changed, e => abilityLink(e.id) || e.name, moveFieldLine));
  sections.push(
    simple(
      "Biomes",
      diff.biomes.changed,
      e => biomeLink(e.id),
      c => {
        if (c.field === "pokemon")
          return html`${c.added.length ? html`<li class="add">Added: ${c.added.map(x => html`${speciesChip(x.species)} `)}</li>` : ""}
            ${c.removed.length ? html`<li class="rem">Removed: ${c.removed.map(x => html`${speciesChip(x.species)} `)}</li>` : ""}`;
        if (c.field === "links") {
          const names = l => l.map(x => db.biomeById.get(x.to)?.name + (x.chance > 1 ? ` (1/${x.chance})` : "")).join(", ");
          return html`<li>Routes: ${names(c.before)} → <b>${names(c.after)}</b></li>`;
        }
        return html`<li>${c.field} changed</li>`;
      },
    ),
  );
  sections.push(
    simple(
      "Items",
      diff.items.changed,
      e => html`<a href="#/items/${e.key.toLowerCase().replace(/_/g, "-")}">${e.name}</a>`,
      c => {
        if (c.field === "pools") {
          const fmt = pools => pools.filter(p => p.pool === "player").map(p => `${p.tier} (${p.maxWeight})`).join(", ") || "none";
          return html`<li>Shop: ${fmt(c.before)} → <b>${fmt(c.after)}</b></li>`;
        }
        return html`<li class="muted">Description updated</li>`;
      },
    ),
  );

  const removed = [...diff.species.removed, ...diff.moves.removed, ...diff.abilities.removed, ...diff.biomes.removed, ...diff.items.removed];
  if (removed.length) sections.push(html`<section class="diff-section"><h3>Removed</h3><p>${removed.map(r => r.name).join(", ")}</p></section>`);

  return sections.some(s => String(s)) ? html`${sections}` : html`<p class="muted">No differences in species, moves, abilities, biomes or items — this release only changed game code.</p>`;
}

function speciesChip(id, fallbackName) {
  const s = db.speciesById.get(id);
  if (!s) return html`<span>${fallbackName ?? `#${id}`}</span>`;
  return html`<a class="mon-chip mon-sm" href="${speciesHref(s)}"><img class="mon-icon" src="${iconUrl(s.icon)}" alt="" loading="lazy" /><span>${s.name}</span></a>`;
}
