import { $, debounce, html, normalize, raw } from "../lib/dom.js";
import { ABILITY_FLAG_LABELS, STATUS_LABELS, abilityHref, db, speciesIcon, statusDot } from "../lib/data.js";
import { replaceListQuery } from "../lib/nav.js";
import { DataTable } from "../lib/table.js";
import { bindChips, chipGroup, flagList, paramsFromFilters, searchBox, setFromParam, viewHeader } from "./shared.js";

const holdersOf = id => db.abilityHolders.get(id) ?? [];
const countBy = (id, pred) => new Set(holdersOf(id).filter(pred).map(h => h.species.id)).size;

export function list(el, params) {
  const filters = new Map([
    ["gen", setFromParam(params, "gen")],
    ["impl", setFromParam(params, "impl")],
    ["flag", setFromParam(params, "flag")],
  ]);
  let q = params.get("q") ?? "";
  const sort = params.get("sort") ? { id: params.get("sort"), dir: params.get("dir") === "desc" ? -1 : 1 } : { id: "name", dir: 1 };
  const open = [...filters.values()].some(s => s.size);

  el.innerHTML = String(html`<section class="view">
    ${viewHeader("Abilities", `${db.abilities.length} abilities — including which Pokémon get them as a passive.`)}
    <div class="toolbar">
      ${searchBox({ id: "abSearch", placeholder: "Search abilities or descriptions…", value: q })}
      <button type="button" class="btn filters-toggle ${open ? "active" : ""}" aria-expanded="${open}">Filters</button>
    </div>
    <div class="filters" id="abFilters" ${open ? "" : raw("data-collapsed")}>
      ${chipGroup({ label: "Gen", name: "gen", selected: filters.get("gen"), options: [3, 4, 5, 6, 7, 8, 9].map(g => ({ value: g, label: g })) })}
      ${chipGroup({ label: "Status", name: "impl", selected: filters.get("impl"), options: [["ok", "Fully working"], ...Object.entries(STATUS_LABELS).map(([k, [l]]) => [k, l])].map(([v, l]) => ({ value: v, label: l })) })}
      ${chipGroup({ label: "Flags", name: "flag", selected: filters.get("flag"), options: Object.entries(ABILITY_FLAG_LABELS).map(([v, l]) => ({ value: v, label: l })) })}
    </div>
    <div class="result-bar"><span id="abCount"></span><button type="button" class="link-btn" id="abClear">Clear filters</button></div>
    <div id="abTable"></div>
  </section>`);

  const table = new DataTable($("#abTable", el), {
    columns: [
      { id: "name", label: "Name", className: "name-col", sort: a => a.name, render: a => String(html`<a href="${abilityHref(a)}">${a.name}</a>${statusDot(a.status)}`) },
      { id: "desc", label: "Description", className: "effect-col wide", hide: "sm", render: a => String(html`<span class="clamp">${a.description}</span>`) },
      { id: "users", label: "Pokémon", title: "Species with this as a regular or hidden ability", className: "num", defaultDir: -1, sort: a => countBy(a.id, h => h.slot !== "passive"), render: a => countBy(a.id, h => h.slot !== "passive") || "" },
      { id: "passive", label: "Passive", title: "Species with this as their passive", className: "num", defaultDir: -1, sort: a => countBy(a.id, h => h.slot === "passive"), render: a => countBy(a.id, h => h.slot === "passive") || "" },
      { id: "gen", label: "Gen", className: "num", hide: "sm", sort: a => a.gen, render: a => a.gen },
    ],
    rowHref: a => abilityHref(a),
    sort,
    onSort: s => {
      Object.assign(sort, s);
      sync();
    },
  });

  function sync() {
    const n = normalize(q);
    const rows = db.abilities.filter(a => {
      if (n && !a.search.includes(n) && !normalize(a.description).includes(n)) return false;
      if (filters.get("gen").size && !filters.get("gen").has(String(a.gen))) return false;
      if (filters.get("impl").size && !filters.get("impl").has(a.status ?? "ok")) return false;
      if (filters.get("flag").size && ![...filters.get("flag")].every(f => a.flags.includes(f))) return false;
      return true;
    });
    table.setRows(rows);
    $("#abCount", el).textContent = `${rows.length} abilit${rows.length === 1 ? "y" : "ies"}`;
    $("#abClear", el).hidden = !(q || [...filters.values()].some(s => s.size));
    replaceListQuery(paramsFromFilters(filters, { q, ...(sort.id !== "name" || sort.dir !== 1 ? { sort: sort.id, dir: sort.dir === 1 ? "asc" : "desc" } : {}) }));
  }

  $("#abSearch", el).addEventListener("input", debounce(e => ((q = e.target.value), sync()), 80));
  bindChips($("#abFilters", el), filters, sync);
  $(".filters-toggle", el).addEventListener("click", e => {
    const fl = $("#abFilters", el);
    const willOpen = fl.hasAttribute("data-collapsed");
    fl.toggleAttribute("data-collapsed", !willOpen);
    e.currentTarget.classList.toggle("active", willOpen);
    e.currentTarget.setAttribute("aria-expanded", willOpen);
  });
  $("#abClear", el).addEventListener("click", () => (location.hash = "#/abilities"));
  sync();
  return { destroy: () => table.destroy() };
}

export function detail(el, slugValue) {
  const a = db.abilityBySlug.get(slugValue);
  if (!a) return null;
  const holders = holdersOf(a.id);
  const groups = [
    ["Regular ability", holders.filter(h => h.slot === 0 || h.slot === 1)],
    ["Hidden ability", holders.filter(h => h.slot === 2)],
    ["Passive", holders.filter(h => h.slot === "passive")],
  ];
  const status = a.status && STATUS_LABELS[a.status];

  el.innerHTML = String(html`<article class="detail">
    <header class="simple-hero">
      <p class="dex-no">Ability · Gen ${a.gen}</p>
      <h2 id="panelTitle" tabindex="-1">${a.name}</h2>
    </header>
    ${status ? html`<div class="banner banner-${a.status}"><b>${status[0]}.</b> ${status[1]}</div>` : ""}
    <section class="card">
      <p class="effect">${a.description}</p>
      ${a.flags.length ? html`<div class="flags">${flagList(a.flags, ABILITY_FLAG_LABELS)}</div>` : ""}
    </section>
    ${groups.map(([label, list]) =>
      list.length
        ? html`<section class="card">
            <h3>${label} <span class="muted">${list.length}</span></h3>
            <div class="mon-grid">${list.map(h => html`<div class="mon-cell">${speciesIcon(h.species, { form: h.form })}</div>`)}</div>
          </section>`
        : "",
    )}
    ${holders.length ? "" : html`<p class="muted">No Pokémon currently has this ability.</p>`}
  </article>`);
  return { title: a.name };
}
