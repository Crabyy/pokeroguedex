import { $, $$, debounce, html, normalize, raw } from "../lib/dom.js";
import {
  BIOME_TIER_LABEL,
  STAT_LABELS,
  STAT_NAMES,
  TIME_LABEL,
  abilityLink,
  biomeHref,
  db,
  defensiveMatchups,
  iconUrl,
  levelLabel,
  speciesHref,
  statColor,
  typeBadges,
  typeLabel,
} from "../lib/data.js";
import { nav, replaceListQuery } from "../lib/nav.js";
import { SpriteViewer } from "../lib/sprites.js";
import { DataTable } from "../lib/table.js";
import { bindChips, bindRowLinks, chipGroup, fmt, moveTable, paramsFromFilters, searchBox, setFromParam, tierBadge, viewHeader } from "./shared.js";

const pad = n => `#${String(n).padStart(4, "0")}`;
const SHOW_OPTIONS = [
  { value: "starters", label: "Starters only", title: "Only Pokémon you can pick on the starter screen" },
  { value: "noforms", label: "Hide alt forms", title: "Hide Megas, G-Max and other alternate forms" },
  { value: "legendary", label: "Legendary & Mythical" },
  { value: "variants", label: "Has shiny variants", title: "Has tier 2 / tier 3 shiny variants" },
];

// ==================================================================== list

export function list(el, params) {
  const filters = new Map([
    ["type", setFromParam(params, "type")],
    ["gen", setFromParam(params, "gen")],
    ["cost", setFromParam(params, "cost")],
    ["show", setFromParam(params, "show")],
  ]);
  let q = params.get("q") ?? "";
  let abilityId = db.abilityBySlug.get(params.get("ability") ?? "")?.id ?? null;
  let moveId = db.moveBySlug.get(params.get("move") ?? "")?.id ?? null;
  const sortParam = params.get("sort");
  const sort = sortParam ? { id: sortParam, dir: params.get("dir") === "desc" ? -1 : 1 } : { id: "no", dir: 1 };
  const filtersOpen = [...filters.values()].some(s => s.size) || abilityId || moveId;

  const { meta } = db;
  el.innerHTML = String(html`
    <section class="view">
      ${viewHeader("Pokémon", raw(`Every species and form in PokéRogue <b>${meta.game.version}</b> — ${meta.counts.species.toLocaleString()} species, ${meta.counts.forms.toLocaleString()} forms.`))}
      <div class="toolbar">
        ${searchBox({ id: "monSearch", placeholder: "Search by name or #…", value: q })}
        <button type="button" class="btn filters-toggle ${filtersOpen ? "active" : ""}" aria-expanded="${filtersOpen ? "true" : "false"}" aria-controls="monFilters">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M3 5h18v2H3zm3 6h12v2H6zm4 6h4v2h-4z"/></svg> Filters
        </button>
      </div>
      <div class="filters" id="monFilters" ${filtersOpen ? "" : raw("data-collapsed")}>
        ${chipGroup({ label: "Type", name: "type", selected: filters.get("type"), options: db.types.list.filter(t => t !== "stellar").map(t => ({ value: t, label: typeLabel(t), className: `type-chip type-${t}` })) })}
        ${chipGroup({ label: "Gen", name: "gen", selected: filters.get("gen"), options: [1, 2, 3, 4, 5, 6, 7, 8, 9].map(g => ({ value: g, label: g })) })}
        ${chipGroup({ label: "Cost", name: "cost", selected: filters.get("cost"), options: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(c => ({ value: c, label: c, title: `Starter cost ${c}` })) })}
        ${chipGroup({ label: "Show", name: "show", selected: filters.get("show"), options: SHOW_OPTIONS })}
        <div class="filter-group">
          <span class="filter-label">Has</span>
          <div class="filter-inputs">
            <label class="mini-field"><span>Ability / passive</span>
              <input id="abilityFilter" list="abilityOptions" placeholder="e.g. Intimidate" value="${abilityId ? db.abilityById.get(abilityId).name : ""}" autocomplete="off" />
            </label>
            <label class="mini-field"><span>Learns move</span>
              <input id="moveFilter" list="moveOptions" placeholder="e.g. Earthquake" value="${moveId ? db.moveById.get(moveId).name : ""}" autocomplete="off" />
            </label>
          </div>
          <datalist id="abilityOptions">${db.abilities.map(a => html`<option value="${a.name}"></option>`)}</datalist>
          <datalist id="moveOptions">${db.moves.map(m => html`<option value="${m.name}"></option>`)}</datalist>
        </div>
      </div>
      <div class="result-bar"><span id="monCount"></span><button type="button" class="link-btn" id="monClear">Clear filters</button></div>
      <div id="monTable"></div>
    </section>`);

  const table = new DataTable($("#monTable", el), {
    columns: [
      { id: "icon", label: "", className: "icon-col", render: r => `<img class="mon-icon" src="${iconUrl(r.icon)}" alt="" loading="lazy" decoding="async" width="40" height="30">` },
      { id: "no", label: "#", className: "num muted-col", sort: r => r.species.dexNo + r.formIndex / 100 + (r.species.regional ? 0.001 : 0), render: r => pad(r.species.dexNo) },
      {
        id: "name",
        label: "Name",
        className: "name-col",
        sort: r => `${r.name} ${r.formName}`,
        render: r =>
          String(html`<span class="name-line"><a href="${speciesHref(r.species, r.isAltForm ? r.form.key : "")}" class="mon-name">${r.name}</a>${
            r.species.mythical
              ? html`<span class="mini-badge myth" title="Mythical">M</span>`
              : r.species.legendary
                ? html`<span class="mini-badge leg" title="Legendary">L</span>`
                : r.species.subLegendary
                  ? html`<span class="mini-badge sub" title="Sub-legendary">SL</span>`
                  : ""
          }</span>
            ${r.formName || r.species.regional ? html`<small class="form-name">${r.formName || r.species.regionLabel}</small>` : ""}`),
      },
      { id: "types", label: "Type", sort: r => r.types.join(" "), render: r => String(typeBadges(r.types, { small: true })) },
      {
        id: "abilities",
        label: "Abilities",
        hide: "md",
        className: "abil-col",
        render: r => {
          const [a1, a2, h] = r.abilities;
          return String(html`<div class="abil-list">
            ${abilityLink(a1)}${a2 && a2 !== a1 ? abilityLink(a2) : ""}${h && h !== a1 && h !== a2 ? html`<span class="ha">${abilityLink(h)}</span>` : ""}
          </div>`);
        },
      },
      { id: "passive", label: "Passive", hide: "md", className: "passive-col", sort: r => db.abilityById.get(r.passive)?.name, render: r => String(abilityLink(r.passive, "passive")) },
      ...STAT_LABELS.map((label, i) => ({
        id: `s${i}`,
        label,
        title: STAT_NAMES[i],
        className: "num stat-col",
        hide: "lg",
        defaultDir: -1,
        sort: r => r.stats[i],
        render: r => `<span style="--c:${statColor(r.stats[i])}" class="stat-num">${r.stats[i]}</span>`,
      })),
      { id: "bst", label: "BST", title: "Base stat total", className: "num bst-col", defaultDir: -1, sort: r => r.bst, render: r => `<b>${r.bst}</b>` },
      {
        id: "cost",
        label: "Cost",
        title: "Starter cost of this evolution line",
        className: "num",
        sort: r => r.species.lineCost,
        render: r => (r.species.lineCost ? `<span class="cost cost-${r.species.lineCost}${r.species.cost ? "" : " inherited"}">${r.species.lineCost}</span>` : ""),
      },
    ],
    rowHref: r => speciesHref(r.species, r.isAltForm ? r.form.key : ""),
    rowClass: r => (r.isAltForm ? "alt-form" : ""),
    sort,
    onSort: s => {
      sort.id = s.id;
      sort.dir = s.dir;
      sync();
    },
  });

  function filtered() {
    const n = normalize(q);
    const numQuery = /^#?\d+$/.test(q.trim()) ? Number(q.trim().replace("#", "")) : null;
    const types = filters.get("type");
    const gens = filters.get("gen");
    const costs = filters.get("cost");
    const show = filters.get("show");
    const learners = moveId != null ? new Set((db.learners.get(moveId) ?? []).map(l => l.species.id)) : null;
    return db.rows.filter(r => {
      const s = r.species;
      if (numQuery != null ? s.dexNo !== numQuery && s.id !== numQuery : n && !r.search.includes(n)) return false;
      if (types.size && ![...types].every(t => r.types.includes(t))) return false;
      if (gens.size && !gens.has(String(s.gen))) return false;
      if (costs.size && !costs.has(String(s.lineCost))) return false;
      if (show.has("starters") && (s.cost == null || r.isAltForm)) return false;
      if (show.has("noforms") && r.isAltForm) return false;
      if (show.has("legendary") && !(s.legendary || s.mythical || s.subLegendary)) return false;
      if (show.has("variants") && !r.variants?.tiers?.some(v => v)) return false;
      if (abilityId != null && !r.abilities.includes(abilityId) && r.passive !== abilityId) return false;
      if (learners && !learners.has(s.id)) return false;
      return true;
    });
  }

  function sync() {
    const rows = filtered();
    table.setRows(rows);
    const speciesCount = new Set(rows.map(r => r.species.id)).size;
    $("#monCount", el).textContent = `${rows.length.toLocaleString()} result${rows.length === 1 ? "" : "s"} · ${speciesCount.toLocaleString()} species`;
    const active = q || [...filters.values()].some(s => s.size) || abilityId || moveId;
    $("#monClear", el).hidden = !active;
    replaceListQuery(
      paramsFromFilters(filters, {
        q,
        ability: abilityId ? db.abilityById.get(abilityId).slug : "",
        move: moveId ? db.moveById.get(moveId).slug : "",
        ...(sort.id !== "no" || sort.dir !== 1 ? { sort: sort.id, dir: sort.dir === 1 ? "asc" : "desc" } : {}),
      }),
    );
  }

  $("#monSearch", el).addEventListener("input", debounce(e => ((q = e.target.value), sync()), 80));
  bindChips($("#monFilters", el), filters, sync);
  const byName = (list, value) => list.find(x => normalize(x.name) === normalize(value))?.id ?? null;
  $("#abilityFilter", el).addEventListener("change", e => ((abilityId = byName(db.abilities, e.target.value)), sync()));
  $("#moveFilter", el).addEventListener("change", e => ((moveId = byName(db.moves, e.target.value)), sync()));
  $(".filters-toggle", el).addEventListener("click", e => {
    const f = $("#monFilters", el);
    const open = f.hasAttribute("data-collapsed");
    f.toggleAttribute("data-collapsed", !open);
    e.currentTarget.setAttribute("aria-expanded", open);
    e.currentTarget.classList.toggle("active", open);
  });
  $("#monClear", el).addEventListener("click", () => {
    location.hash = "#/pokemon";
  });

  sync();
  return { destroy: () => table.destroy() };
}

// ================================================================== detail

const spritePrefs = { shiny: 0, female: false, back: false };

export function detail(el, slugValue, params) {
  const s = db.speciesBySlug.get(slugValue);
  if (!s) return null;
  const formKey = params.get("form") ?? "";
  let formIndex = Math.max(0, s.forms.findIndex(f => f.key === formKey));
  let viewer = null;

  const render = () => {
    viewer?.destroy();
    const f = s.forms[formIndex] ?? null;
    const src = f ?? s;
    const types = src.types;
    const abilities = src.abilities;
    const passive = src.passive ?? s.passive;
    const variants = src.variants ?? s.variants;
    const starter = db.speciesById.get(s.starter) ?? s;
    const cost = starter.cost;
    const candy = db.rules.starterCandy.find(c => c.cost === cost);
    const title = f && formIndex > 0 ? `${s.name} (${f.name})` : s.name;
    const genderless = s.malePercent == null;

    el.innerHTML = String(html`
      <article class="detail mon-detail" style="--hero:var(--t-${types[0]})">
        <header class="mon-hero">
          <div class="sprite-stage">
            <canvas class="sprite" id="spriteCanvas" width="96" height="96" aria-label="${title} sprite"></canvas>
            <img class="sprite-fallback" src="${iconUrl(src.icon ?? s.icon)}" alt="" />
          </div>
          <div class="hero-text">
            <p class="dex-no">${pad(s.dexNo)}${s.regional ? html` · ${s.regionLabel} form` : ""} · Gen ${s.gen}</p>
            <h2 id="panelTitle" tabindex="-1">${s.name}${f && formIndex > 0 ? html` <span class="form-title">${f.name}</span>` : ""}</h2>
            <p class="category">${s.category}</p>
            <div class="badges">${typeBadges(types)}
              ${s.mythical ? html`<span class="pill myth">Mythical</span>` : s.legendary ? html`<span class="pill leg">Legendary</span>` : s.subLegendary ? html`<span class="pill sub">Sub-legendary</span>` : ""}
            </div>
          </div>
        </header>

        <div class="sprite-controls" role="toolbar" aria-label="Sprite options">
          <div class="seg" role="group" aria-label="Shiny">
            ${[0, 1, 2, 3].map(t => {
              const available = t < 2 || !!variants?.tiers?.[t - 1];
              return html`<button type="button" class="seg-btn shiny-${t} ${spritePrefs.shiny === t ? "on" : ""}" data-shiny="${t}" ${available ? "" : raw("disabled")}
                title="${t === 0 ? "Normal" : available ? `Shiny tier ${t}` : `No tier ${t} variant`}" aria-pressed="${spritePrefs.shiny === t}">${t === 0 ? "Normal" : raw(`<span class="star">★</span>${t}`)}</button>`;
            })}
          </div>
          <div class="seg" role="group" aria-label="View">
            ${(src.genderDiffs ?? s.genderDiffs) ? html`<button type="button" class="seg-btn ${spritePrefs.female ? "on" : ""}" data-toggle="female" aria-pressed="${spritePrefs.female}" title="Female sprite">♀</button>` : ""}
            <button type="button" class="seg-btn ${spritePrefs.back ? "on" : ""}" data-toggle="back" aria-pressed="${spritePrefs.back}" title="Back sprite">Back</button>
          </div>
        </div>

        ${s.forms.length > 1
          ? html`<nav class="form-tabs" aria-label="Forms">
              ${s.forms.map((fm, i) => html`<button type="button" class="form-tab ${i === formIndex ? "on" : ""}" data-form="${i}" aria-pressed="${i === formIndex}">
                <img src="${iconUrl(fm.icon)}" alt="" loading="lazy" />${fm.name || "Normal"}</button>`)}
            </nav>`
          : ""}

        <section class="card">
          <h3>Abilities</h3>
          <div class="ability-grid">
            ${abilities.map((id, i) => {
              if (!id || abilities.indexOf(id) !== i) return ""; // skip empty and duplicate slots
              const a = db.abilityById.get(id);
              return a
                ? html`<a class="ability-card" href="#/abilities/${a.slug}">
                    <span class="slot">${["Ability 1", "Ability 2", "Hidden"][i]}</span>
                    <b>${a.name}</b><span class="desc">${a.description}</span>
                  </a>`
                : "";
            })}
            ${passive
              ? html`<a class="ability-card passive" href="#/abilities/${db.abilityById.get(passive)?.slug}">
                  <span class="slot">Passive${candy ? html` · ${candy.passive} candies` : ""}</span>
                  <b>${db.abilityById.get(passive)?.name}</b><span class="desc">${db.abilityById.get(passive)?.description}</span>
                </a>`
              : ""}
          </div>
        </section>

        <section class="card">
          <h3>Base stats</h3>
          <div class="stat-bars">
            ${src.stats.map(
              (v, i) => html`<div class="stat-row">
                <span class="stat-name">${STAT_NAMES[i]}</span>
                <span class="stat-val">${v}</span>
                <span class="bar"><i style="width:${Math.min(100, (v / 200) * 100)}%;background:${statColor(v)}"></i></span>
              </div>`,
            )}
            <div class="stat-row total"><span class="stat-name">Total</span><span class="stat-val">${src.bst}</span><span></span></div>
          </div>
        </section>

        <section class="card">
          <h3>Type defenses</h3>
          ${typeDefenses(types)}
        </section>

        ${cost
          ? html`<section class="card starter-card">
              <h3>Starter</h3>
              <dl class="kv">
                <div><dt>Cost</dt><dd><span class="cost cost-${cost}">${cost}</span>${s.id !== starter.id ? html` <span class="muted small">via ${speciesLinkText(starter)}</span>` : ""}</dd></div>
                ${starter.eggTier ? html`<div><dt>Egg tier</dt><dd>${tierBadge(`egg-${starter.eggTier}`, starter.eggTier[0].toUpperCase() + starter.eggTier.slice(1))}</dd></div>` : ""}
                ${candy
                  ? html`<div><dt>Passive unlock</dt><dd>${candy.passive} candies</dd></div>
                      <div><dt>Cost reduction</dt><dd>${candy.costReduction.join(" / ")} candies</dd></div>
                      <div><dt>Same-species egg</dt><dd>${candy.eggCosts.join(" → ")} candies</dd></div>`
                  : ""}
              </dl>
            </section>`
          : ""}

        <section class="card">
          <h3>Evolution</h3>
          ${evolutionTree(s)}
          ${s.formChanges.length
            ? html`<h4>Form changes</h4>
                <ul class="form-changes">
                  ${s.formChanges.map(fc => html`<li><span>${formName(s, fc.from)}</span><i aria-hidden="true">→</i><span>${formName(s, fc.to)}</span><span class="muted">${fc.trigger}</span></li>`)}
                </ul>`
            : ""}
        </section>

        <section class="card">
          <div class="card-head">
            <h3>Moves</h3>
            <div class="seg" role="tablist" id="moveTabs">
              ${moveTabs(s, f, starter).map((t, i) => html`<button type="button" role="tab" class="seg-btn ${i === 0 ? "on" : ""}" data-tab="${t.id}" aria-selected="${i === 0}">${t.label} <span class="muted">${t.count}</span></button>`)}
            </div>
          </div>
          <div id="moveTabBody"></div>
        </section>

        <section class="card">
          <h3>Where to find</h3>
          ${whereToFind(s)}
        </section>

        <section class="card">
          <h3>Details</h3>
          <dl class="kv grid">
            <div><dt>Height</dt><dd>${src.height} m</dd></div>
            <div><dt>Weight</dt><dd>${src.weight} kg</dd></div>
            <div><dt>Catch rate</dt><dd>${src.catchRate ?? s.catchRate}</dd></div>
            <div><dt>Growth</dt><dd>${s.growth}</dd></div>
            <div><dt>Gender</dt><dd>${genderless ? "Genderless" : html`<span class="male">♂ ${s.malePercent}%</span> <span class="female">♀ ${100 - s.malePercent}%</span>`}</dd></div>
            <div><dt>Base friendship</dt><dd>${s.friendship}</dd></div>
            <div><dt>Base EXP</dt><dd>${s.baseExp}</dd></div>
            <div><dt>Internal ID</dt><dd><code>${s.key}</code> (${s.id})</dd></div>
          </dl>
        </section>
      </article>`);

    // Sprite
    const canvas = $("#spriteCanvas", el);
    viewer = new SpriteViewer(canvas);
    const showSprite = () =>
      viewer
        .show({ sprite: src.sprite ?? s.sprite, formKey: f?.key ?? "", shiny: spritePrefs.shiny, female: spritePrefs.female, back: spritePrefs.back, variants })
        .then(ok => el.querySelector(".sprite-stage")?.classList.toggle("no-sprite", !ok));
    if (spritePrefs.shiny > 1 && !variants?.tiers?.[spritePrefs.shiny - 1]) spritePrefs.shiny = 1;
    showSprite();

    $(".sprite-controls", el).addEventListener("click", e => {
      const b = e.target.closest("button");
      if (!b || b.disabled) return;
      if (b.dataset.shiny) spritePrefs.shiny = Number(b.dataset.shiny);
      if (b.dataset.toggle) spritePrefs[b.dataset.toggle] = !spritePrefs[b.dataset.toggle];
      $$(".seg-btn[data-shiny]", el).forEach(x => x.classList.toggle("on", Number(x.dataset.shiny) === spritePrefs.shiny));
      $$(".seg-btn[data-toggle]", el).forEach(x => x.classList.toggle("on", !!spritePrefs[x.dataset.toggle]));
      showSprite();
    });

    $(".form-tabs", el)?.addEventListener("click", e => {
      const b = e.target.closest("[data-form]");
      if (!b) return;
      formIndex = Number(b.dataset.form);
      const key = s.forms[formIndex].key;
      history.replaceState(null, "", speciesHref(s, formIndex > 0 ? key : ""));
      render();
    });

    // Move tabs
    const tabs = moveTabs(s, f, starter);
    const showTab = id => {
      const t = tabs.find(x => x.id === id) ?? tabs[0];
      $("#moveTabBody", el).innerHTML = String(t.render());
      $$("#moveTabs .seg-btn", el).forEach(b => {
        b.classList.toggle("on", b.dataset.tab === t.id);
        b.setAttribute("aria-selected", b.dataset.tab === t.id);
      });
    };
    $("#moveTabs", el).addEventListener("click", e => {
      const b = e.target.closest("[data-tab]");
      if (b) showTab(b.dataset.tab);
    });
    showTab(tabs[0].id);
    document.title = `${title} · PokéRogue Dex`;
  };

  bindRowLinks(el);
  render();
  return {
    title: formIndex > 0 ? `${s.name} (${s.forms[formIndex].name})` : s.name,
    cleanup: () => viewer?.destroy(),
  };
}

// ----------------------------------------------------------------- pieces

function speciesLinkText(s) {
  return html`<a href="${speciesHref(s)}">${s.name}</a>`;
}

function formName(s, key) {
  return s.forms.find(f => f.key === key)?.name || (key ? key : "Normal");
}

function moveTabs(s, f, starter) {
  const levelMoves = (f?.levelMoves ?? s.levelMoves).slice().sort((a, b) => {
    const rank = l => (l === 0 ? -1 : l === -1 ? 999 : l);
    return rank(a[0]) - rank(b[0]);
  });
  const tms = (f?.tms ?? s.tms).slice().sort((a, b) => (db.moveById.get(a)?.name ?? "").localeCompare(db.moveById.get(b)?.name ?? ""));
  const eggMoves = starter.eggMoves ?? [];
  const tabs = [
    {
      id: "level",
      label: "Level-up",
      count: levelMoves.length,
      render: () =>
        moveTable(
          levelMoves.map(([lvl, move]) => ({ lead: levelLabel(lvl), move })),
          "Lv.",
        ),
    },
    {
      id: "egg",
      label: "Egg",
      count: eggMoves.length,
      render: () =>
        html`${s.id !== starter.id ? html`<p class="muted small">Egg moves belong to the line's starter, ${speciesLinkText(starter)}.</p>` : ""}
          ${moveTable(
            eggMoves.map((move, i) => ({ lead: i === 3 ? raw('<span class="tier tier-rare" title="Rare egg move">Rare</span>') : i + 1, move })),
            "#",
          )}`,
    },
    {
      id: "tm",
      label: "TM",
      count: tms.length,
      render: () =>
        moveTable(
          tms.map(move => {
            const tier = db.moveById.get(move)?.tm;
            return { lead: tier ? tierBadge(tier) : "", move };
          }),
          "Tier",
        ),
    },
  ];
  return tabs;
}

function typeDefenses(types) {
  const m = defensiveMatchups(types);
  const groups = [
    [4, "4×"],
    [2, "2×"],
    [0.5, "½×"],
    [0.25, "¼×"],
    [0, "0×"],
  ];
  return html`<div class="defenses">
    ${groups.map(([mult, label]) => {
      const list = Object.entries(m)
        .filter(([, v]) => v === mult)
        .map(([t]) => t);
      if (!list.length) return "";
      return html`<div class="def-row"><span class="def-mult m${String(mult).replace(".", "_")}">${label}</span><div>${typeBadges(list, { small: true })}</div></div>`;
    })}
  </div>
  <p class="muted small">Before abilities (e.g. Levitate) and passives.</p>`;
}

function evoMethod(e) {
  const parts = [];
  if (e.item) parts.push(html`<span class="evo-item tier-${e.itemTier}">${e.item}</span>`);
  if (e.level > 1) parts.push(`Lv. ${e.level}`);
  else if (!e.item) parts.push("Level up");
  for (const c of e.conditions) parts.push(c.text);
  return html`${parts.map((p, i) => html`${i ? " · " : ""}${p}`)}`;
}

function evolutionTree(current) {
  let root = current;
  const guard = new Set();
  while (root.prevo != null && !guard.has(root.id)) {
    guard.add(root.id);
    root = db.speciesById.get(root.prevo) ?? root;
  }
  const seen = new Set();
  const node = (s, method) => {
    seen.add(s.id);
    const children = [];
    const byTarget = new Map();
    for (const e of s.evolutions) {
      const target = db.speciesById.get(e.to);
      if (!target || seen.has(target.id) || byTarget.has(e.to)) continue;
      byTarget.set(e.to, e);
    }
    for (const [to, e] of byTarget) {
      const t = db.speciesById.get(to);
      if (t.prevo !== s.id && t.prevo != null) continue;
      children.push(node(t, e));
    }
    return html`<div class="evo-branch">
      <div class="evo-step">
        ${method ? html`<div class="evo-arrow"><span>${evoMethod(method)}</span></div>` : ""}
        <a class="evo-mon ${s.id === current.id ? "current" : ""}" href="${speciesHref(s)}">
          <img src="${iconUrl(s.icon)}" alt="" loading="lazy" /><span>${s.name}</span>
        </a>
      </div>
      ${children.length ? html`<div class="evo-children">${children}</div>` : ""}
    </div>`;
  };
  if (!root.evolutions.length && root.id === current.id) return html`<p class="muted">Does not evolve.</p>`;
  return html`<div class="evo-tree">${node(root, null)}</div>`;
}

function whereToFind(s) {
  if (!s.biomes.length) {
    const relatives = [s.prevo, ...s.evolutions.map(e => e.to)].map(id => db.speciesById.get(id)).filter(r => r?.biomes.length);
    return html`<p class="muted">Not found in any biome's wild pool. ${s.cost ? "Unlock it from eggs or the starter screen." : ""}
      ${relatives.length ? html`Try ${relatives.map((r, i) => html`${i ? ", " : ""}<a href="${speciesHref(r)}">${r.name}</a>`)}.` : ""}</p>`;
  }
  const order = Object.keys(BIOME_TIER_LABEL);
  const sorted = s.biomes.slice().sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier));
  return html`<ul class="biome-list">
    ${sorted.map(b => {
      const biome = db.biomeById.get(b.biome);
      return html`<li>
        <a href="${biomeHref(biome)}" class="biome-name">${biome.name}</a>
        <span class="tier btier-${b.tier.toLowerCase()}">${BIOME_TIER_LABEL[b.tier]}</span>
        <span class="muted small">${b.times.map(t => TIME_LABEL[t] ?? t).join(", ")} · ${db.rules.biomeTierOdds[b.tier] ?? ""}</span>
      </li>`;
    })}
  </ul>`;
}

export { pad, fmt };
