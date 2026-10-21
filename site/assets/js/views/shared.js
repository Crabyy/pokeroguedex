// Building blocks shared by several views.
import { html, raw } from "../lib/dom.js";
import { categoryIcon, db, moveHref, statusDot, typeBadge } from "../lib/data.js";

export const fmt = n => (n == null ? "—" : Number(n).toLocaleString());

export function viewHeader(title, subtitle, extra = "") {
  return html`<header class="view-head">
    <div>
      <h1>${title}</h1>
      ${subtitle ? html`<p class="lede">${subtitle}</p>` : ""}
    </div>
    ${extra}
  </header>`;
}

/** A row of toggle chips. `selected` is a Set of values. */
export function chipGroup({ label, name, options, selected, multi = true, className = "" }) {
  return html`<div class="filter-group ${className}" role="group" aria-label="${label}">
    <span class="filter-label">${label}</span>
    <div class="chips">
      ${options.map(
        o => html`<button type="button" class="chip ${o.className ?? ""} ${selected.has(String(o.value)) ? "on" : ""}"
          data-filter="${name}" data-value="${o.value}" data-multi="${multi ? 1 : 0}" aria-pressed="${selected.has(String(o.value))}"
          title="${o.title ?? ""}">${o.label}</button>`,
      )}
    </div>
  </div>`;
}

/** Wires `.chip[data-filter]` buttons inside `root` to a Map<name, Set<string>>. */
export function bindChips(root, filters, onChange) {
  root.addEventListener("click", e => {
    const chip = e.target.closest(".chip[data-filter]");
    if (!chip) return;
    const { filter, value, multi } = chip.dataset;
    const set = filters.get(filter) ?? new Set();
    if (set.has(value)) set.delete(value);
    else {
      if (multi === "0") set.clear();
      set.add(value);
    }
    filters.set(filter, set);
    root.querySelectorAll(`.chip[data-filter="${filter}"]`).forEach(c => {
      const on = set.has(c.dataset.value);
      c.classList.toggle("on", on);
      c.setAttribute("aria-pressed", on);
    });
    onChange();
  });
}

export function searchBox({ id, placeholder, value = "" }) {
  return html`<label class="search-box" for="${id}">
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M10 4a6 6 0 1 0 3.87 10.59l4.77 4.77 1.41-1.41-4.77-4.77A6 6 0 0 0 10 4m0 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8"/></svg>
    <input id="${id}" type="search" placeholder="${placeholder}" value="${value}" autocomplete="off" spellcheck="false" />
  </label>`;
}

export const setFromParam = (params, key) => new Set((params.get(key) ?? "").split(",").filter(Boolean));

export function paramsFromFilters(filters, extra = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(extra)) if (v !== "" && v != null && v !== false) p.set(k, v === true ? "1" : v);
  for (const [k, set] of filters) if (set.size) p.set(k, [...set].join(","));
  return p;
}

export const powerCell = v => (v == null ? html`<span class="muted">—</span>` : v);
export const accCell = v => (v == null ? html`<span class="muted">—</span>` : `${v}%`);

/**
 * Compact move table used in Pokémon detail.
 * @param {{ lead: any, leadSort?: number, move: number, note?: any }[]} entries
 */
export function moveTable(entries, leadLabel) {
  if (!entries.length) return html`<p class="muted small">None.</p>`;
  return html`<div class="table-scroll"><table class="mini-table move-table">
    <thead><tr>
      ${leadLabel ? html`<th class="num">${leadLabel}</th>` : ""}
      <th>Move</th><th>Type</th><th class="hide-sm">Cat.</th><th class="num">Pow</th><th class="num">Acc</th><th class="num hide-sm">PP</th>
    </tr></thead>
    <tbody>
      ${entries.map(e => {
        const m = db.moveById.get(e.move);
        if (!m) return "";
        return html`<tr data-href="${moveHref(m)}" title="${m.effect}">
          ${leadLabel ? html`<td class="num lead">${e.lead}</td>` : ""}
          <td><a href="${moveHref(m)}" class="move-link">${m.name}</a>${statusDot(m.status)}${e.note ? html` <span class="note">${e.note}</span>` : ""}</td>
          <td>${typeBadge(m.type, { small: true, link: false })}</td>
          <td class="hide-sm">${categoryIcon(m.category)}</td>
          <td class="num">${powerCell(m.power)}</td>
          <td class="num">${accCell(m.accuracy)}</td>
          <td class="num hide-sm">${m.pp}</td>
        </tr>`;
      })}
    </tbody>
  </table></div>`;
}

/** Makes `tr[data-href]` rows in mini tables clickable. */
export function bindRowLinks(root) {
  root.addEventListener("click", e => {
    if (e.target.closest("a, button")) return;
    const tr = e.target.closest("tr[data-href]");
    if (tr) location.hash = tr.dataset.href;
  });
}

export const tierBadge = (tier, label) =>
  tier ? html`<span class="tier tier-${tier}">${label ?? tier[0].toUpperCase() + tier.slice(1)}</span>` : "";

export const flagList = (flags, labels) =>
  flags?.length ? raw(flags.map(f => String(html`<span class="flag">${labels[f] ?? f}</span>`)).join("")) : "";
