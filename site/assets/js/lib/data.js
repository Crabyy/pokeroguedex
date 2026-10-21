// Loads the generated JSON and builds the lookup indexes every view shares.
import { html, normalize, raw } from "./dom.js";

export const STAT_LABELS = ["HP", "Atk", "Def", "SpA", "SpD", "Spe"];
export const STAT_NAMES = ["HP", "Attack", "Defense", "Sp. Atk", "Sp. Def", "Speed"];

export const BIOME_TIERS = [
  ["COMMON", "Common", "356/512"],
  ["UNCOMMON", "Uncommon", "124/512"],
  ["RARE", "Rare", "26/512"],
  ["SUPER_RARE", "Super Rare", "5/512"],
  ["ULTRA_RARE", "Ultra Rare", "1/512"],
  ["BOSS", "Boss", "44/64"],
  ["BOSS_RARE", "Boss Rare", "14/64"],
  ["BOSS_SUPER_RARE", "Boss Super Rare", "5/64"],
  ["BOSS_ULTRA_RARE", "Boss Ultra Rare", "1/64"],
];
export const BIOME_TIER_LABEL = Object.fromEntries(BIOME_TIERS.map(([k, l]) => [k, l]));
export const TIME_LABEL = { ALL: "Any time", DAWN: "Dawn", DAY: "Day", DUSK: "Dusk", NIGHT: "Night" };

export const SHOP_TIERS = ["common", "great", "ultra", "rogue", "master", "luxury"];
export const EGG_TIERS = ["common", "rare", "epic", "legendary"];

export const MOVE_FLAG_LABELS = {
  contact: "Makes contact",
  sound: "Sound",
  punch: "Punch",
  bite: "Bite",
  slicing: "Slicing",
  pulse: "Pulse",
  bullet: "Ball / Bomb",
  powder: "Powder",
  dance: "Dance",
  wind: "Wind",
  healing: "Healing",
  reckless: "Recoil",
  charging: "Charging",
  bypassProtect: "Bypasses Protect",
  bypassSubstitute: "Bypasses Substitute",
  reflectable: "Magic Coat-able",
  gravity: "Fails in Gravity",
  ignoresAbilities: "Ignores abilities",
};

export const ABILITY_FLAG_LABELS = {
  ignorable: "Breakable (Mold Breaker)",
  uncopiable: "Can't be copied",
  unsuppressable: "Can't be suppressed",
  unreplaceable: "Can't be replaced",
  bypassFaint: "Works on faint",
};

export const STATUS_LABELS = {
  unimplemented: ["Not implemented", "This doesn't work in PokéRogue yet."],
  partial: ["Partially implemented", "Some of this effect is missing in PokéRogue."],
  edgeCase: ["Edge cases", "Works, but has known edge-case bugs."],
};

/** Everything the app knows, plus derived indexes. Populated by `loadData()`. */
export const db = {
  meta: null,
  species: [],
  moves: [],
  abilities: [],
  biomes: [],
  items: [],
  types: { list: [], chart: {} },
  rules: { starterCandy: [], biomeTierOdds: {} },
  speciesById: new Map(),
  speciesBySlug: new Map(),
  moveById: new Map(),
  moveBySlug: new Map(),
  abilityById: new Map(),
  abilityBySlug: new Map(),
  biomeById: new Map(),
  biomeBySlug: new Map(),
  itemByKey: new Map(),
  /** moveId → [{ species, how: "level"|"egg"|"tm", level?, form? }] */
  learners: new Map(),
  /** abilityId → [{ species, form, slot: 0|1|2|"passive" }] */
  abilityHolders: new Map(),
  /** flattened species+form rows for the Pokémon table */
  rows: [],
};

export const slug = key => String(key).toLowerCase().replace(/_/g, "-");

async function getJson(path) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

export async function loadData(onProgress = () => {}) {
  const files = ["meta", "species", "moves", "abilities", "biomes", "items", "types", "rules"];
  let done = 0;
  const results = await Promise.all(
    files.map(f =>
      getJson(`data/${f}.json`).then(v => {
        onProgress(++done / files.length);
        return v;
      }),
    ),
  );
  Object.assign(db, Object.fromEntries(files.map((f, i) => [f, results[i]])));
  buildIndexes();
  return db;
}

function buildIndexes() {
  const nationalByName = new Map();
  for (const s of db.species) {
    db.speciesById.set(s.id, s);
    db.speciesBySlug.set(s.slug, s);
    s.search = normalize(`${s.name} ${s.key.replace(/_/g, " ")}`);
    if (s.id < 2000 && !nationalByName.has(s.name)) nationalByName.set(s.name, s.id);
  }
  for (const s of db.species) {
    // Regional variants use ids ≥ 2000 in PokéRogue; show their National Dex number instead.
    s.regional = s.id >= 2000;
    s.dexNo = s.regional ? (nationalByName.get(s.name) ?? s.id) : s.id;
    s.regionLabel = s.regional ? s.key.split("_")[0][0] + s.key.split("_")[0].slice(1).toLowerCase() : "";
    s.lineCost = db.speciesById.get(s.starter)?.cost ?? s.cost;
  }
  for (const m of db.moves) {
    m.slug = slug(m.key);
    db.moveById.set(m.id, m);
    db.moveBySlug.set(m.slug, m);
    m.search = normalize(m.name);
  }
  for (const a of db.abilities) {
    a.slug = slug(a.key);
    db.abilityById.set(a.id, a);
    db.abilityBySlug.set(a.slug, a);
    a.search = normalize(a.name);
  }
  for (const b of db.biomes) {
    b.slug = slug(b.key);
    db.biomeById.set(b.id, b);
    db.biomeBySlug.set(b.slug, b);
  }
  for (const i of db.items) {
    i.slug = slug(i.key);
    db.itemByKey.set(i.slug, i);
    i.search = normalize(i.name);
  }

  // Who learns what.
  const addLearner = (moveId, entry) => {
    if (!db.learners.has(moveId)) db.learners.set(moveId, []);
    db.learners.get(moveId).push(entry);
  };
  for (const s of db.species) {
    const seenLevel = new Set();
    for (const [level, moveId] of s.levelMoves) {
      if (seenLevel.has(moveId)) continue;
      seenLevel.add(moveId);
      addLearner(moveId, { species: s, how: "level", level });
    }
    for (const f of s.forms) {
      for (const [level, moveId] of f.levelMoves ?? []) {
        if (seenLevel.has(moveId)) continue;
        seenLevel.add(moveId);
        addLearner(moveId, { species: s, how: "level", level, form: f });
      }
    }
    for (const moveId of s.tms) addLearner(moveId, { species: s, how: "tm" });
    s.eggMoves?.forEach((moveId, i) => addLearner(moveId, { species: s, how: "egg", rare: i === 3 }));
  }

  // Who has which ability.
  const addHolder = (abilityId, entry) => {
    if (!abilityId) return;
    if (!db.abilityHolders.has(abilityId)) db.abilityHolders.set(abilityId, []);
    const list = db.abilityHolders.get(abilityId);
    if (!list.some(e => e.species === entry.species && e.slot === entry.slot && e.form?.key === entry.form?.key)) list.push(entry);
  };

  // Table rows: one per species, plus one per alternate form.
  db.rows = [];
  for (const s of db.species) {
    const forms = s.forms.length ? s.forms : [null];
    forms.forEach((f, i) => {
      const src = f ?? s;
      const row = {
        species: s,
        form: f,
        formIndex: i,
        isAltForm: i > 0,
        name: s.name,
        formName: f && i > 0 ? f.name : f && s.forms.length > 1 && f.name !== "Normal" ? f.name : "",
        types: src.types,
        abilities: src.abilities,
        passive: src.passive ?? s.passive,
        stats: src.stats,
        bst: src.bst,
        icon: src.icon ?? s.icon,
        variants: src.variants ?? s.variants,
      };
      row.search = normalize(`${s.name} ${row.formName} ${s.key.replace(/_/g, " ")}`);
      db.rows.push(row);
      src.abilities.forEach((a, slot) => addHolder(a, { species: s, form: i > 0 ? f : null, slot }));
      addHolder(row.passive, { species: s, form: i > 0 ? f : null, slot: "passive" });
    });
  }
}

// ------------------------------------------------------------------ sprites

export function assetBase() {
  const commit = db.meta?.game?.assetsCommit ?? "beta";
  return `https://raw.githubusercontent.com/pagefaultgames/pokerogue-assets/${commit}/images`;
}

/** Icon URL. `shiny` = 0 (normal) or 1..3 (shiny tier). */
export function iconUrl(icon, shiny = 0, variants) {
  const [gen, id] = String(icon).split("/");
  if (!shiny) return `${assetBase()}/pokemon/icons/${gen}/${id}.png`;
  if (shiny > 1 && variants?.tiers?.[shiny - 1]) return `${assetBase()}/pokemon/icons/variant/${gen}/${id}_${shiny}.png`;
  return `${assetBase()}/pokemon/icons/${gen}/${id}s.png`;
}

export const itemIconUrl = icon => `${assetBase()}/items/${icon}.png`;

// ------------------------------------------------------------- formatting

export const typeLabel = t => (t ? t[0].toUpperCase() + t.slice(1) : "");

export function typeBadge(t, { small = false, link = true } = {}) {
  if (!t) return "";
  const cls = `type-badge type-${t}${small ? " sm" : ""}`;
  return link
    ? html`<a class="${cls}" href="#/pokemon?type=${t}" title="${typeLabel(t)} type">${typeLabel(t)}</a>`
    : html`<span class="${cls}">${typeLabel(t)}</span>`;
}

export const typeBadges = (types, opts) => raw(types.map(t => typeBadge(t, opts)).join(""));

export function categoryIcon(cat) {
  const label = { physical: "Physical", special: "Special", status: "Status" }[cat] ?? cat;
  return html`<span class="cat cat-${cat}" title="${label}">${label}</span>`;
}

export function levelLabel(level) {
  if (level === 0) return "Evo";
  if (level === -1) return "Relearn";
  return String(level);
}

export const speciesHref = (s, formKey) => `#/pokemon/${s.slug}${formKey ? `?form=${encodeURIComponent(formKey)}` : ""}`;
export const moveHref = m => `#/moves/${m.slug}`;
export const abilityHref = a => `#/abilities/${a.slug}`;
export const biomeHref = b => `#/biomes/${b.slug}`;

export function abilityLink(id, extraClass = "") {
  const a = db.abilityById.get(id);
  if (!a) return "";
  return html`<a class="ability-link ${extraClass}" href="${abilityHref(a)}" title="${a.description}">${a.name}${statusDot(a.status)}</a>`;
}

export function moveLink(id) {
  const m = db.moveById.get(id);
  if (!m) return html`<span class="muted">#${id}</span>`;
  return html`<a href="${moveHref(m)}" class="move-link">${m.name}${statusDot(m.status)}</a>`;
}

export function statusDot(status) {
  if (!status) return "";
  const [label, tip] = STATUS_LABELS[status] ?? [status, ""];
  return html`<span class="status-dot status-${status}" title="${label}: ${tip}" aria-label="${label}"></span>`;
}

export function speciesIcon(s, { form = null, size = "md", shiny = 0, label = true } = {}) {
  const icon = form?.icon ?? s.icon;
  const name = form && form.name && form.name !== "Normal" && s.forms.length > 1 ? `${s.name} (${form.name})` : s.name;
  return html`<a class="mon-chip mon-${size}" href="${speciesHref(s, form?.key)}" title="${name}">
    <img class="mon-icon" src="${iconUrl(icon, shiny, form?.variants ?? s.variants)}" alt="" loading="lazy" decoding="async" width="40" height="30" />
    ${label ? html`<span>${name}</span>` : ""}
  </a>`;
}

export function statColor(v) {
  if (v < 50) return "var(--stat-1)";
  if (v < 80) return "var(--stat-2)";
  if (v < 100) return "var(--stat-3)";
  if (v < 120) return "var(--stat-4)";
  if (v < 150) return "var(--stat-5)";
  return "var(--stat-6)";
}

/** Defensive multipliers for a type combination: { type: multiplier } */
export function defensiveMatchups(types) {
  const out = {};
  for (const atk of db.types.list) {
    if (atk === "stellar") continue;
    let m = 1;
    for (const d of types) m *= db.types.chart[atk]?.[d] ?? 1;
    out[atk] = m;
  }
  return out;
}
