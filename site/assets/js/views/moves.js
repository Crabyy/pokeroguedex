import { $, $$, debounce, html, normalize, raw } from "../lib/dom.js";
import { MOVE_FLAG_LABELS, STATUS_LABELS, categoryIcon, db, levelLabel, moveHref, speciesIcon, statusDot, typeBadge, typeLabel } from "../lib/data.js";
import { replaceListQuery } from "../lib/nav.js";
import { DataTable } from "../lib/table.js";
import { accCell, bindChips, chipGroup, flagList, paramsFromFilters, powerCell, searchBox, setFromParam, tierBadge, viewHeader } from "./shared.js";

const FLAG_FILTERS = ["contact", "sound", "punch", "bite", "slicing", "pulse", "bullet", "wind", "dance", "powder", "healing"];

export function list(el, params) {
  const filters = new Map([
    ["type", setFromParam(params, "type")],
    ["cat", setFromParam(params, "cat")],
    ["tm", setFromParam(params, "tm")],
    ["flag", setFromParam(params, "flag")],
    ["impl", setFromParam(params, "impl")],
  ]);
  let q = params.get("q") ?? "";
  const sort = params.get("sort") ? { id: params.get("sort"), dir: params.get("dir") === "desc" ? -1 : 1 } : { id: "name", dir: 1 };
  const open = [...filters.values()].some(s => s.size);

  el.innerHTML = String(html`<section class="view">
    ${viewHeader("Moves", `${db.moves.length.toLocaleString()} moves, with PokéRogue's implementation status and TM tiers.`)}
    <div class="toolbar">
      ${searchBox({ id: "moveSearch", placeholder: "Search moves or effects…", value: q })}
      <button type="button" class="btn filters-toggle ${open ? "active" : ""}" aria-expanded="${open}">Filters</button>
    </div>
    <div class="filters" id="moveFilters" ${open ? "" : raw("data-collapsed")}>
      ${chipGroup({ label: "Type", name: "type", selected: filters.get("type"), options: db.types.list.map(t => ({ value: t, label: typeLabel(t), className: `type-chip type-${t}` })) })}
      ${chipGroup({ label: "Category", name: "cat", selected: filters.get("cat"), options: ["physical", "special", "status"].map(c => ({ value: c, label: c[0].toUpperCase() + c.slice(1) })) })}
      ${chipGroup({ label: "TM", name: "tm", selected: filters.get("tm"), options: [["common", "Common"], ["great", "Great"], ["ultra", "Ultra"], ["none", "Not a TM"]].map(([v, l]) => ({ value: v, label: l, className: `tier-chip tier-${v}` })) })}
      ${chipGroup({ label: "Flags", name: "flag", selected: filters.get("flag"), options: FLAG_FILTERS.map(f => ({ value: f, label: MOVE_FLAG_LABELS[f] })) })}
      ${chipGroup({ label: "Status", name: "impl", selected: filters.get("impl"), options: [["ok", "Fully working"], ...Object.entries(STATUS_LABELS).map(([k, [l]]) => [k, l])].map(([v, l]) => ({ value: v, label: l })) })}
    </div>
    <div class="result-bar"><span id="moveCount"></span><button type="button" class="link-btn" id="moveClear">Clear filters</button></div>
    <div id="moveTable"></div>
  </section>`);

  const table = new DataTable($("#moveTable", el), {
    columns: [
      { id: "name", label: "Name", className: "name-col", sort: m => m.name, render: m => String(html`<a href="${moveHref(m)}">${m.name}</a>${statusDot(m.status)}`) },
      { id: "type", label: "Type", sort: m => m.type, render: m => String(typeBadge(m.type, { small: true, link: false })) },
      { id: "cat", label: "Cat.", hide: "sm", sort: m => m.category, render: m => String(categoryIcon(m.category)) },
      { id: "power", label: "Pow", className: "num", defaultDir: -1, sort: m => m.power, render: m => String(powerCell(m.power)) },
      { id: "acc", label: "Acc", className: "num", defaultDir: -1, sort: m => m.accuracy, render: m => String(accCell(m.accuracy)) },
      { id: "pp", label: "PP", className: "num", hide: "sm", defaultDir: -1, sort: m => m.pp, render: m => m.pp },
      { id: "prio", label: "Prio", className: "num", hide: "md", defaultDir: -1, sort: m => m.priority, render: m => (m.priority ? `<b>${m.priority > 0 ? "+" : ""}${m.priority}</b>` : "") },
      { id: "tm", label: "TM", hide: "sm", sort: m => ["common", "great", "ultra"].indexOf(m.tm) + 1 || null, render: m => String(tierBadge(m.tm)) },
      { id: "gen", label: "Gen", className: "num", hide: "lg", sort: m => m.gen, render: m => m.gen },
      { id: "effect", label: "Effect", hide: "lg", className: "effect-col", render: m => String(html`<span class="clamp">${m.effect}</span>`) },
    ],
    rowHref: m => moveHref(m),
    sort,
    onSort: s => {
      Object.assign(sort, s);
      sync();
    },
  });

  function sync() {
    const n = normalize(q);
    const f = id => filters.get(id);
    const rows = db.moves.filter(m => {
      if (n && !m.search.includes(n) && !normalize(m.effect).includes(n)) return false;
      if (f("type").size && !f("type").has(m.type)) return false;
      if (f("cat").size && !f("cat").has(m.category)) return false;
      if (f("tm").size && !f("tm").has(m.tm ?? "none")) return false;
      if (f("flag").size && ![...f("flag")].every(x => m.flags.includes(x))) return false;
      if (f("impl").size && !f("impl").has(m.status ?? "ok")) return false;
      return true;
    });
    table.setRows(rows);
    $("#moveCount", el).textContent = `${rows.length.toLocaleString()} move${rows.length === 1 ? "" : "s"}`;
    $("#moveClear", el).hidden = !(q || [...filters.values()].some(s => s.size));
    replaceListQuery(paramsFromFilters(filters, { q, ...(sort.id !== "name" || sort.dir !== 1 ? { sort: sort.id, dir: sort.dir === 1 ? "asc" : "desc" } : {}) }));
  }

  $("#moveSearch", el).addEventListener("input", debounce(e => ((q = e.target.value), sync()), 80));
  bindChips($("#moveFilters", el), filters, sync);
  $(".filters-toggle", el).addEventListener("click", e => {
    const fl = $("#moveFilters", el);
    const willOpen = fl.hasAttribute("data-collapsed");
    fl.toggleAttribute("data-collapsed", !willOpen);
    e.currentTarget.classList.toggle("active", willOpen);
    e.currentTarget.setAttribute("aria-expanded", willOpen);
  });
  $("#moveClear", el).addEventListener("click", () => (location.hash = "#/moves"));
  sync();
  return { destroy: () => table.destroy() };
}

export function detail(el, slugValue) {
  const m = db.moveBySlug.get(slugValue);
  if (!m) return null;
  const learners = db.learners.get(m.id) ?? [];
  const groups = {
    level: learners.filter(l => l.how === "level").sort((a, b) => a.level - b.level || a.species.id - b.species.id),
    egg: learners.filter(l => l.how === "egg").sort((a, b) => a.species.id - b.species.id),
    tm: learners.filter(l => l.how === "tm").sort((a, b) => a.species.id - b.species.id),
  };
  const status = m.status && STATUS_LABELS[m.status];

  el.innerHTML = String(html`<article class="detail" style="--hero:var(--t-${m.type})">
    <header class="simple-hero">
      <p class="dex-no">Move · Gen ${m.gen}</p>
      <h2 id="panelTitle" tabindex="-1">${m.name}</h2>
      <div class="badges">${typeBadge(m.type)} ${categoryIcon(m.category)} ${m.tm ? html`<span class="tier tier-${m.tm}">TM · ${m.tm}</span>` : ""}</div>
    </header>
    ${status ? html`<div class="banner banner-${m.status}"><b>${status[0]}.</b> ${status[1]}</div>` : ""}
    <section class="card">
      <div class="stat-tiles">
        <div><span>Power</span><b>${m.power ?? "—"}</b></div>
        <div><span>Accuracy</span><b>${m.accuracy ? `${m.accuracy}%` : "—"}</b></div>
        <div><span>PP</span><b>${m.pp}</b></div>
        <div><span>Priority</span><b>${m.priority > 0 ? "+" : ""}${m.priority}</b></div>
        <div><span>Effect chance</span><b>${m.chance ? `${m.chance}%` : "—"}</b></div>
        <div><span>Target</span><b class="small">${m.target}</b></div>
      </div>
      <p class="effect">${m.effect}</p>
      ${m.flags.length ? html`<div class="flags">${flagList(m.flags, MOVE_FLAG_LABELS)}</div>` : ""}
    </section>
    <section class="card">
      <div class="card-head">
        <h3>Learned by</h3>
        <div class="seg" role="tablist" id="learnTabs">
          ${[["level", "Level-up"], ["egg", "Egg"], ["tm", "TM"]].map(([id, label], i) => html`<button type="button" role="tab" class="seg-btn ${i === 0 ? "on" : ""}" data-tab="${id}">${label} <span class="muted">${groups[id].length}</span></button>`)}
        </div>
      </div>
      <div id="learnBody"></div>
    </section>
  </article>`);

  const renderGroup = id => {
    const list = groups[id];
    $("#learnBody", el).innerHTML = list.length
      ? String(html`<div class="mon-grid">
          ${list.map(l => html`<div class="mon-cell">
            ${speciesIcon(l.species, { form: l.form })}
            ${l.how === "level" ? html`<span class="mon-meta">Lv. ${levelLabel(l.level)}</span>` : ""}
            ${l.how === "egg" && l.rare ? html`<span class="mon-meta tier tier-rare">Rare</span>` : ""}
          </div>`)}
        </div>`)
      : `<p class="muted">No Pokémon learn ${m.name} this way.</p>`;
    $$("#learnTabs .seg-btn", el).forEach(b => b.classList.toggle("on", b.dataset.tab === id));
  };
  $("#learnTabs", el).addEventListener("click", e => {
    const b = e.target.closest("[data-tab]");
    if (b) renderGroup(b.dataset.tab);
  });
  renderGroup(groups.level.length ? "level" : groups.egg.length ? "egg" : "tm");
  return { title: m.name };
}
