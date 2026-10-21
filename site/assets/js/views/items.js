import { $, debounce, html, normalize, raw } from "../lib/dom.js";
import { SHOP_TIERS, db, itemIconUrl } from "../lib/data.js";
import { replaceListQuery } from "../lib/nav.js";
import { DataTable } from "../lib/table.js";
import { bindChips, chipGroup, paramsFromFilters, searchBox, setFromParam, tierBadge, viewHeader } from "./shared.js";

const POOL_LABELS = {
  player: "Reward shop",
  wild: "Wild Pokémon held items",
  trainer: "Trainer Pokémon held items",
  enemyBuff: "Enemy buffs",
  dailyStarter: "Daily run starters",
};

const shopEntry = i => i.pools.find(p => p.pool === "player");
const itemHref = i => `#/items/${i.slug}`;
const icon = (i, size = 32) =>
  i.icon ? `<img class="item-icon" src="${itemIconUrl(i.icon)}" alt="" loading="lazy" width="${size}" height="${size}" onerror="this.style.visibility='hidden'">` : "";

export function list(el, params) {
  const filters = new Map([["tier", setFromParam(params, "tier")]]);
  let q = params.get("q") ?? "";
  let shopOnly = params.get("shop") !== "0";
  const sort = { id: "tier", dir: 1 };

  el.innerHTML = String(html`<section class="view">
    ${viewHeader("Items", "Rewards you can roll after battles, with their shop tier and roll weight.")}
    <div class="toolbar">
      ${searchBox({ id: "itemSearch", placeholder: "Search items…", value: q })}
      <label class="switch"><input type="checkbox" id="shopOnly" ${shopOnly ? raw("checked") : ""} /><span>Reward shop only</span></label>
    </div>
    <div class="filters" id="itemFilters">
      ${chipGroup({ label: "Tier", name: "tier", selected: filters.get("tier"), options: SHOP_TIERS.slice(0, 5).map(t => ({ value: t, label: t[0].toUpperCase() + t.slice(1), className: `tier-chip tier-${t}` })) })}
    </div>
    <p class="hint">Weight is the item's maximum weight within its tier — items marked <b>dynamic</b> scale with your party (e.g. potions only appear when someone is hurt).</p>
    <div class="result-bar"><span id="itemCount"></span></div>
    <div id="itemTable"></div>
  </section>`);

  const table = new DataTable($("#itemTable", el), {
    columns: [
      { id: "icon", label: "", className: "icon-col", render: i => icon(i) },
      { id: "name", label: "Name", className: "name-col", sort: i => i.name, render: i => String(html`<a href="${itemHref(i)}">${i.name}</a>`) },
      { id: "desc", label: "Description", className: "effect-col wide", hide: "sm", render: i => String(html`<span class="clamp">${i.description}</span>`) },
      { id: "tier", label: "Tier", sort: i => SHOP_TIERS.indexOf(shopEntry(i)?.tier ?? "") + 1 || null, render: i => String(tierBadge(shopEntry(i)?.tier)) },
      {
        id: "weight",
        label: "Weight",
        className: "num",
        defaultDir: -1,
        sort: i => shopEntry(i)?.maxWeight,
        render: i => {
          const e = shopEntry(i);
          if (!e) return "";
          if (e.maxWeight == null) return '<span class="note">dynamic</span>';
          return `${e.maxWeight}${e.dynamic ? ' <span class="note">dynamic</span>' : ""}`;
        },
      },
    ],
    rowHref: itemHref,
    sort,
    onSort: s => Object.assign(sort, s),
  });

  const sync = () => {
    const n = normalize(q);
    const rows = db.items.filter(i => {
      if (n && !i.search.includes(n) && !normalize(i.description).includes(n)) return false;
      if (shopOnly && !shopEntry(i)) return false;
      if (filters.get("tier").size && !filters.get("tier").has(shopEntry(i)?.tier)) return false;
      return true;
    });
    table.setRows(rows);
    $("#itemCount", el).textContent = `${rows.length} item${rows.length === 1 ? "" : "s"}`;
    replaceListQuery(paramsFromFilters(filters, { q, shop: shopOnly ? "" : "0" }));
  };
  $("#itemSearch", el).addEventListener("input", debounce(e => ((q = e.target.value), sync()), 80));
  $("#shopOnly", el).addEventListener("change", e => ((shopOnly = e.target.checked), sync()));
  bindChips($("#itemFilters", el), filters, sync);
  sync();
  return { destroy: () => table.destroy() };
}

export function detail(el, slugValue) {
  const i = db.itemByKey.get(slugValue);
  if (!i) return null;
  el.innerHTML = String(html`<article class="detail">
    <header class="simple-hero item-hero">
      ${raw(icon(i, 48))}
      <div>
        <p class="dex-no">Item</p>
        <h2 id="panelTitle" tabindex="-1">${i.name}</h2>
      </div>
    </header>
    <section class="card"><p class="effect">${i.description || "No description in the game files."}</p></section>
    <section class="card">
      <h3>Where it drops</h3>
      ${i.pools.length
        ? html`<table class="mini-table">
            <thead><tr><th>Pool</th><th>Tier</th><th class="num">Weight</th></tr></thead>
            <tbody>${i.pools.map(p => html`<tr><td>${POOL_LABELS[p.pool] ?? p.pool}</td><td>${tierBadge(p.tier)}</td>
              <td class="num">${p.maxWeight == null ? html`<span class="note">dynamic</span>` : p.dynamic ? html`up to ${p.maxWeight} <span class="note">dynamic</span>` : p.maxWeight}</td></tr>`)}</tbody>
          </table>`
        : html`<p class="muted">Not in any random pool — obtained through events, encounters or other means.</p>`}
    </section>
    <p class="muted small">Internal key: <code>${i.key}</code></p>
  </article>`);
  return { title: i.name };
}
