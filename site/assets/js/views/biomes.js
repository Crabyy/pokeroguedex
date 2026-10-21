import { $, debounce, html, normalize } from "../lib/dom.js";
import { BIOME_TIERS, TIME_LABEL, biomeHref, db, iconUrl, speciesIcon } from "../lib/data.js";
import { replaceListQuery } from "../lib/nav.js";
import { searchBox, viewHeader } from "./shared.js";

const TIME_ORDER = ["ALL", "DAWN", "DAY", "DUSK", "NIGHT"];

function speciesIn(b) {
  const ids = new Set();
  for (const times of Object.values(b.pokemon)) for (const list of Object.values(times)) list.forEach(id => ids.add(id));
  return ids;
}

function incoming(b) {
  return db.biomes.filter(o => o.links.some(l => l.to === b.id));
}

const chanceLabel = c => (c > 1 ? `1/${c}` : "");

function linkChips(links) {
  return html`${links.map(l => {
    const t = db.biomeById.get(l.to);
    return t ? html`<a class="biome-chip" href="${biomeHref(t)}">${t.name}${l.chance > 1 ? html` <small>${chanceLabel(l.chance)}</small>` : ""}</a>` : "";
  })}`;
}

export function list(el, params) {
  let q = params.get("q") ?? "";
  el.innerHTML = String(html`<section class="view">
    ${viewHeader("Biomes", `${db.biomes.length} biomes — wild pools by rarity and time of day, trainers, weather and where each route leads.`)}
    <div class="toolbar">${searchBox({ id: "biomeSearch", placeholder: "Search biomes or Pokémon in them…", value: q })}</div>
    <p class="hint">Links marked <b>1/N</b> only appear with that chance; the others are always offered. With a <b>Map</b> you choose between them.</p>
    <div class="biome-grid" id="biomeGrid"></div>
  </section>`);

  const grid = $("#biomeGrid", el);
  const sync = () => {
    const n = normalize(q);
    const matches = db.biomes.filter(b => {
      if (!n) return true;
      if (normalize(b.name).includes(n)) return true;
      return [...speciesIn(b)].some(id => db.speciesById.get(id)?.search.includes(n));
    });
    grid.innerHTML = matches.length
      ? matches
          .map(b => {
            const ids = [...speciesIn(b)];
            const bosses = Object.entries(b.pokemon)
              .filter(([tier]) => tier.startsWith("BOSS"))
              .flatMap(([, times]) => Object.values(times).flat());
            // Bosses make the best preview; biomes without any (e.g. Town) show their wild Pokémon.
            const preview = [...new Set(bosses.length ? bosses : ids)].slice(0, 6);
            return String(html`<article class="biome-card">
              <a class="biome-card-head" href="${biomeHref(b)}">
                <h2>${b.name}</h2>
                <span class="muted small">${ids.length} species${b.trainerChance ? ` · trainer 1/${b.trainerChance}` : ""}</span>
              </a>
              <div class="biome-bosses">${preview.map(id => {
                const s = db.speciesById.get(id);
                return s ? html`<img src="${iconUrl(s.icon)}" alt="${s.name}" title="${bosses.length ? "Boss: " : ""}${s.name}" loading="lazy" />` : "";
              })}</div>
              <div class="biome-links"><span class="muted small">Leads to</span> ${b.links.length ? linkChips(b.links) : html`<span class="muted small">—</span>`}</div>
            </article>`);
          })
          .join("")
      : `<p class="table-empty">No biome matches “${q}”.</p>`;
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    replaceListQuery(p);
  };
  $("#biomeSearch", el).addEventListener("input", debounce(e => ((q = e.target.value), sync()), 80));
  sync();
}

export function detail(el, slugValue) {
  const b = db.biomeBySlug.get(slugValue);
  if (!b) return null;
  const totalWeight = list => list.reduce((n, x) => n + x.weight, 0);
  const pct = (w, list) => `${Math.round((w / totalWeight(list)) * 100)}%`;
  const from = incoming(b);

  el.innerHTML = String(html`<article class="detail">
    <header class="simple-hero">
      <p class="dex-no">Biome</p>
      <h2 id="panelTitle" tabindex="-1">${b.name}</h2>
    </header>
    <section class="card">
      <dl class="kv">
        <div><dt>Leads to</dt><dd class="chip-row">${b.links.length ? linkChips(b.links) : "—"}</dd></div>
        <div><dt>Reached from</dt><dd class="chip-row">${from.length ? linkChips(from.map(o => ({ to: o.id, chance: o.links.find(l => l.to === b.id).chance }))) : "—"}</dd></div>
        <div><dt>Weather</dt><dd>${b.weather.map((w, i) => html`${i ? ", " : ""}${w.name} <span class="muted">${pct(w.weight, b.weather)}</span>`)}</dd></div>
        <div><dt>Terrain</dt><dd>${b.terrain.map((t, i) => html`${i ? ", " : ""}${t.name} <span class="muted">${pct(t.weight, b.terrain)}</span>`)}</dd></div>
        <div><dt>Trainer chance</dt><dd>${b.trainerChance ? `1 in ${b.trainerChance} waves` : "No trainers"}</dd></div>
      </dl>
    </section>

    ${Object.keys(b.trainers).length
      ? html`<section class="card">
          <h3>Trainers</h3>
          <dl class="kv">
            ${BIOME_TIERS.filter(([k]) => b.trainers[k]).map(([k, label]) => html`<div><dt>${label}</dt><dd>${b.trainers[k].map(t => t.name).join(", ")}</dd></div>`)}
          </dl>
        </section>`
      : ""}

    <section class="card">
      <h3>Wild Pokémon</h3>
      <p class="muted small">Wild tier odds are per encounter (out of 512); boss odds are per boss wave (out of 64). Time-specific pools are added to “Any time”.</p>
      ${BIOME_TIERS.filter(([k]) => b.pokemon[k]).map(
        ([k, label, odds]) => html`<div class="pool">
          <div class="pool-head"><span class="tier btier-${k.toLowerCase()}">${label}</span><span class="muted small">${odds}</span></div>
          ${TIME_ORDER.filter(t => b.pokemon[k][t]?.length).map(
            t => html`<div class="pool-time">
              <span class="time-label time-${t.toLowerCase()}">${TIME_LABEL[t]}</span>
              <div class="mon-grid compact">${b.pokemon[k][t].map(id => {
                const s = db.speciesById.get(id);
                return s ? speciesIcon(s) : "";
              })}</div>
            </div>`,
          )}
        </div>`,
      )}
    </section>
  </article>`);
  return { title: b.name };
}
