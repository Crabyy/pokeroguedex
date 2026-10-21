// Tiny DOM helpers: an escaping `html` template tag, query shortcuts and a minimal markdown renderer.

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = s => String(s ?? "").replace(/[&<>"']/g, c => ESC[c]);

class Raw {
  constructor(html) {
    this.html = html;
  }
  toString() {
    return this.html;
  }
}

/** Marks a string as trusted HTML so `html` won't escape it. */
export const raw = s => new Raw(s ?? "");

const interp = v => {
  if (v == null || v === false) return "";
  if (v instanceof Raw) return v.html;
  if (Array.isArray(v)) return v.map(interp).join("");
  return escapeHtml(v);
};

/** Template tag: interpolations are HTML-escaped unless wrapped in `raw()` (arrays are joined). */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += interp(values[i]) + strings[i + 1];
  return new Raw(out);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function debounce(fn, ms = 120) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Lowercase, accent-free, punctuation-free string for forgiving search. */
export const normalize = s =>
  String(s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/♀/g, "f")
    .replace(/♂/g, "m")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** localStorage that never throws (private mode, blocked storage, …). */
export const storage = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable */
    }
  },
};

/**
 * Minimal, safe markdown → HTML for changelogs and release notes:
 * headings, nested bullet lists, paragraphs, **bold**, _italic_, `code` and [links](https://…).
 */
export function markdown(src) {
  const inline = text =>
    escapeHtml(text)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])_([^_]+)_(?=[\s).,!?:;]|$)/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  const lines = String(src ?? "").replace(/\r/g, "").split("\n");
  let out = "";
  const listStack = []; // indentation levels of open <ul>s
  let para = [];
  const flushPara = () => {
    if (para.length) out += `<p>${inline(para.join(" "))}</p>`;
    para = [];
  };
  const closeLists = (toIndent = -1) => {
    while (listStack.length && listStack.at(-1) > toIndent) {
      out += "</li></ul>";
      listStack.pop();
    }
  };

  for (const line of lines) {
    if (/^\[[^\]]+\]:\s+\S+\s*$/.test(line)) continue; // link reference definitions
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    const item = line.match(/^(\s*)[-*+]\s+(.*)$/);
    if (heading) {
      flushPara();
      closeLists();
      const level = Math.min(heading[1].length + 1, 6);
      out += `<h${level}>${inline(heading[2])}</h${level}>`;
    } else if (item) {
      flushPara();
      const indent = item[1].replace(/\t/g, "  ").length;
      if (!listStack.length || indent > listStack.at(-1)) {
        out += "<ul><li>";
        listStack.push(indent);
      } else {
        closeLists(indent);
        if (listStack.length && listStack.at(-1) === indent) out += "</li><li>";
        else {
          out += "<ul><li>";
          listStack.push(indent);
        }
      }
      out += inline(item[2]);
    } else if (!line.trim()) {
      flushPara();
      closeLists();
    } else if (listStack.length) {
      out += ` ${inline(line.trim())}`;
    } else {
      para.push(line.trim());
    }
  }
  flushPara();
  closeLists();
  return out;
}

export function formatDate(iso, opts = { year: "numeric", month: "short", day: "numeric" }) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, opts);
  } catch {
    return iso.slice(0, 10);
  }
}

export function timeAgo(iso) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  const units = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, secs] of units) {
    const n = Math.floor(s / secs);
    if (n >= 1) return `${n} ${unit}${n > 1 ? "s" : ""} ago`;
  }
  return "just now";
}
