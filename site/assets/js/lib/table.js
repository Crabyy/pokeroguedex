// A sortable table that renders rows in chunks as you scroll, so ~1,700 rows stay snappy.
import { html, raw } from "./dom.js";

export class DataTable {
  /**
   * @param {HTMLElement} container
   * @param {{
   *   columns: { id: string, label: string, title?: string, sort?: (row) => any, render: (row) => any,
   *              className?: string, hide?: "sm"|"md"|"lg", defaultDir?: 1|-1 }[],
   *   rowHref?: (row) => string,
   *   rowClass?: (row) => string,
   *   sort?: { id: string, dir: 1|-1 },
   *   onSort?: (sort) => void,
   *   pageSize?: number,
   *   empty?: string,
   * }} options
   */
  constructor(container, options) {
    this.container = container;
    this.o = { pageSize: 80, empty: "Nothing matches these filters.", ...options };
    this.rows = [];
    this.sorted = [];
    this.sort = this.o.sort ?? null;
    this.rendered = 0;

    container.innerHTML = html`<div class="table-wrap">
      <table class="data-table">
        <thead><tr></tr></thead>
        <tbody></tbody>
      </table>
      <div class="table-sentinel" aria-hidden="true"></div>
      <p class="table-empty" hidden>${this.o.empty}</p>
    </div>`;
    this.thead = container.querySelector("thead tr");
    this.tbody = container.querySelector("tbody");
    this.empty = container.querySelector(".table-empty");
    this.sentinel = container.querySelector(".table-sentinel");

    this.thead.addEventListener("click", e => {
      const th = e.target.closest("th[data-sort]");
      if (!th) return;
      const id = th.dataset.sort;
      const col = this.o.columns.find(c => c.id === id);
      if (this.sort?.id === id) this.sort = { id, dir: -this.sort.dir };
      else this.sort = { id, dir: col.defaultDir ?? 1 };
      this.o.onSort?.(this.sort);
      this.apply();
    });

    this.tbody.addEventListener("click", e => {
      if (e.target.closest("a, button, input, label")) return;
      const tr = e.target.closest("tr[data-href]");
      if (tr) location.hash = tr.dataset.href;
    });

    this.observer = new IntersectionObserver(
      entries => {
        if (entries.some(en => en.isIntersecting)) this.renderMore();
      },
      { rootMargin: "800px 0px" },
    );
    this.observer.observe(this.sentinel);
  }

  setRows(rows) {
    this.rows = rows;
    this.apply();
  }

  setSort(sort) {
    this.sort = sort;
    this.apply();
  }

  apply() {
    const col = this.sort && this.o.columns.find(c => c.id === this.sort.id);
    this.sorted = this.rows.slice();
    if (col?.sort) {
      const dir = this.sort.dir;
      const decorated = this.sorted.map((row, i) => ({ row, i, v: col.sort(row) }));
      decorated.sort((a, b) => {
        const av = a.v;
        const bv = b.v;
        const aNull = av == null || av === "";
        const bNull = bv == null || bv === "";
        if (aNull !== bNull) return aNull ? 1 : -1; // empty values always last
        if (av < bv) return -dir;
        if (av > bv) return dir;
        return a.i - b.i;
      });
      this.sorted = decorated.map(d => d.row);
    }
    this.renderHead();
    this.tbody.innerHTML = "";
    this.rendered = 0;
    this.empty.hidden = this.sorted.length > 0;
    this.renderMore();
  }

  renderHead() {
    this.thead.innerHTML = this.o.columns
      .map(c => {
        const active = this.sort?.id === c.id;
        const ariaSort = active ? (this.sort.dir === 1 ? "ascending" : "descending") : "none";
        const cls = [c.className, c.hide ? `hide-${c.hide}` : "", c.sort ? "sortable" : "", active ? "sorted" : ""].filter(Boolean).join(" ");
        return String(html`<th scope="col" class="${cls}" ${raw(c.sort ? `data-sort="${c.id}" aria-sort="${ariaSort}" tabindex="0"` : "")} title="${c.title ?? ""}">
          <span>${c.label}</span>${c.sort ? raw(`<i class="sort-arrow" aria-hidden="true">${active ? (this.sort.dir === 1 ? "▲" : "▼") : "↕"}</i>`) : ""}
        </th>`);
      })
      .join("");
    this.thead.querySelectorAll("th[data-sort]").forEach(th =>
      th.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          th.click();
        }
      }),
    );
  }

  renderMore() {
    if (this.rendered >= this.sorted.length) return;
    const slice = this.sorted.slice(this.rendered, this.rendered + this.o.pageSize);
    const htmlRows = slice
      .map(row => {
        const href = this.o.rowHref?.(row);
        const cls = this.o.rowClass?.(row) ?? "";
        const cells = this.o.columns
          .map(c => `<td class="${[c.className, c.hide ? `hide-${c.hide}` : ""].filter(Boolean).join(" ")}">${c.render(row) ?? ""}</td>`)
          .join("");
        return `<tr${href ? ` data-href="${href}"` : ""}${cls ? ` class="${cls}"` : ""}>${cells}</tr>`;
      })
      .join("");
    this.tbody.insertAdjacentHTML("beforeend", htmlRows);
    this.rendered += slice.length;
    // If the sentinel is still on screen (tall viewport), keep filling.
    requestAnimationFrame(() => {
      const rect = this.sentinel.getBoundingClientRect();
      if (rect.top < window.innerHeight + 800 && this.rendered < this.sorted.length) this.renderMore();
    });
  }

  destroy() {
    this.observer.disconnect();
  }
}
