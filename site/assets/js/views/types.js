import { $, $$, html } from "../lib/dom.js";
import { db, defensiveMatchups, typeBadge, typeBadges, typeLabel } from "../lib/data.js";
import { viewHeader } from "./shared.js";

const MULT_LABEL = { 0: "0", 0.25: "¼", 0.5: "½", 2: "2", 4: "4" };

export function list(el) {
  const types = db.types.list.filter(t => t !== "stellar");
  const picked = [];

  el.innerHTML = String(html`<section class="view">
    ${viewHeader("Type chart", "Read across: the attacking type. Read down: the defending type. Extracted from the game's own damage code.")}
    <section class="card calc">
      <h2 class="h3">Defense calculator</h2>
      <p class="muted small">Pick one or two types to see what hits them hard.</p>
      <div class="chips" id="calcPick">
        ${types.map(t => html`<button type="button" class="chip type-chip type-${t}" data-type="${t}" aria-pressed="false">${typeLabel(t)}</button>`)}
      </div>
      <div id="calcOut" class="calc-out"></div>
    </section>
    <div class="type-chart-wrap">
      <table class="type-chart" id="typeChart">
        <thead>
          <tr><th class="corner"><span>ATK ↓ / DEF →</span></th>${types.map(t => html`<th class="col-head" data-col="${t}"><span class="tc tc-${t}" title="${typeLabel(t)}">${typeLabel(t).slice(0, 3)}</span></th>`)}</tr>
        </thead>
        <tbody>
          ${types.map(
            atk => html`<tr data-row="${atk}">
              <th scope="row"><span class="tc tc-${atk}">${typeLabel(atk)}</span></th>
              ${types.map(def => {
                const m = db.types.chart[atk]?.[def] ?? 1;
                return html`<td data-col="${def}" class="m-${String(m).replace(".", "_")}" title="${typeLabel(atk)} → ${typeLabel(def)}: ×${m}">${m === 1 ? "" : MULT_LABEL[m] ?? m}</td>`;
              })}
            </tr>`,
          )}
        </tbody>
      </table>
    </div>
  </section>`);

  const chart = $("#typeChart", el);
  chart.addEventListener("mouseover", e => {
    const td = e.target.closest("td, th[data-col]");
    $$(".hl", chart).forEach(x => x.classList.remove("hl"));
    if (!td) return;
    const col = td.dataset.col;
    const row = td.closest("tr")?.dataset.row;
    if (col) $$(`[data-col="${col}"]`, chart).forEach(x => x.classList.add("hl"));
    if (row) td.closest("tr").classList.add("hl");
  });
  chart.addEventListener("mouseleave", () => $$(".hl", chart).forEach(x => x.classList.remove("hl")));

  const renderCalc = () => {
    const out = $("#calcOut", el);
    if (!picked.length) {
      out.innerHTML = "";
      return;
    }
    const m = defensiveMatchups(picked);
    const groups = [
      [4, "Takes 4×"],
      [2, "Takes 2×"],
      [0.5, "Takes ½×"],
      [0.25, "Takes ¼×"],
      [0, "Immune"],
    ];
    out.innerHTML = String(html`<div class="calc-for">${typeBadges(picked, { link: false })}</div>
      <div class="defenses">${groups.map(([mult, label]) => {
        const list = Object.entries(m).filter(([, v]) => v === mult).map(([t]) => t);
        return list.length ? html`<div class="def-row"><span class="def-mult m${String(mult).replace(".", "_")}">${label}</span><div>${list.map(t => typeBadge(t, { small: true }))}</div></div>` : "";
      })}</div>
      <p><a href="#/pokemon?type=${picked.join(",")}">See Pokémon with this typing →</a></p>`);
  };

  $("#calcPick", el).addEventListener("click", e => {
    const b = e.target.closest("[data-type]");
    if (!b) return;
    const t = b.dataset.type;
    const i = picked.indexOf(t);
    if (i >= 0) picked.splice(i, 1);
    else {
      picked.push(t);
      if (picked.length > 2) picked.shift();
    }
    $$("#calcPick .chip", el).forEach(c => {
      const on = picked.includes(c.dataset.type);
      c.classList.toggle("on", on);
      c.setAttribute("aria-pressed", on);
    });
    renderCalc();
  });
}
