// Animated battle sprites, rendered from the game's own texture atlases.
//
// Mirrors PokemonSpeciesForm.getSpriteId():
//   tier 0 (normal)  → images/pokemon/[back/][female/]<id>
//   tier 1 (shiny)   → images/pokemon/[back/]shiny/[female/]<id>
//   tier 2/3 (variant), masterlist value 2 → images/pokemon/variant/[back/][female/]<id>_<tier>
//   tier 2/3 (variant), masterlist value 1 → the normal sprite recoloured with the palette in
//                                           images/pokemon/variant/[back/][female/]<id>.json
import { assetBase } from "./data.js";

const FRAME_MS = 100; // the game animates Pokémon at 10 fps
const cache = new Map();

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image failed: ${url}`));
    img.src = url;
  });
}

async function loadAtlas(path) {
  if (cache.has(path)) return cache.get(path);
  const promise = (async () => {
    const base = `${assetBase()}/pokemon/${path}`;
    const [json, img] = await Promise.all([
      fetch(`${base}.json`).then(r => {
        if (!r.ok) throw new Error(`atlas missing: ${path}`);
        return r.json();
      }),
      loadImage(`${base}.png`),
    ]);
    const frames = (json.textures?.[0]?.frames ?? json.frames ?? [])
      .slice()
      .sort((a, b) => String(a.filename).localeCompare(String(b.filename), undefined, { numeric: true }));
    return { img, frames };
  })();
  cache.set(path, promise);
  promise.catch(() => cache.delete(path));
  return promise;
}

async function loadPalette(path, index) {
  const res = await fetch(`${assetBase()}/pokemon/variant/${path}.json`);
  if (!res.ok) throw new Error(`palette missing: ${path}`);
  const palettes = await res.json();
  return palettes[String(index)] ?? null;
}

/** Returns a canvas copy of `img` with every exact colour in `palette` (hex → hex) swapped. */
function recolor(img, palette) {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const map = new Map(
    Object.entries(palette).map(([from, to]) => [parseInt(from, 16), [parseInt(to.slice(0, 2), 16), parseInt(to.slice(2, 4), 16), parseInt(to.slice(4, 6), 16)]]),
  );
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    if (!px[i + 3]) continue;
    const hit = map.get((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
    if (hit) [px[i], px[i + 1], px[i + 2]] = hit;
  }
  ctx.putImageData(data, 0, 0);
  return c;
}

const NO_FEMALE_FORMS = /^(mega|primal|gigantamax)/;

/**
 * Builds the atlas path (and optional palette) for a sprite request.
 * @param {{ sprite: string, formKey?: string, shiny: 0|1|2|3, female?: boolean, back?: boolean, variants?: object }} o
 */
export function spritePlan({ sprite, formKey = "", shiny = 0, female = false, back = false, variants }) {
  const useFemale = female && !NO_FEMALE_FORMS.test(formKey);
  const key = `${useFemale ? "female/" : ""}${sprite}`;
  const backPrefix = back ? "back/" : "";
  if (!shiny) return { path: `${backPrefix}${key}` };
  if (shiny === 1) return { path: `${backPrefix}shiny/${key}` };
  const tiers = (back ? variants?.back : useFemale ? variants?.female : null) ?? variants?.tiers;
  const mode = tiers?.[shiny - 1];
  if (mode === 2) return { path: `variant/${backPrefix}${key}_${shiny}` };
  if (mode === 1) return { path: `${backPrefix}${key}`, palette: `${backPrefix}${key}`, paletteIndex: shiny - 1 };
  return null; // this variant doesn't exist
}

export class SpriteViewer {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.token = 0;
    this.raf = 0;
    this.reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  }

  async show(options) {
    const token = ++this.token;
    cancelAnimationFrame(this.raf);
    this.canvas.classList.add("loading");
    const plan = spritePlan(options);
    try {
      if (!plan) throw new Error("variant unavailable");
      let { img, frames } = await loadAtlas(plan.path);
      if (plan.palette) {
        const palette = await loadPalette(plan.palette, plan.paletteIndex);
        if (palette) img = recolor(img, palette);
      }
      if (token !== this.token) return;
      this.play(img, frames, token);
      this.canvas.classList.remove("loading", "failed");
      return true;
    } catch {
      if (token !== this.token) return;
      // Female/back sprites don't always exist — fall back gracefully.
      if (options.female) return this.show({ ...options, female: false });
      this.canvas.classList.remove("loading");
      this.canvas.classList.add("failed");
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      return false;
    }
  }

  play(img, frames, token) {
    if (!frames.length) return;
    const w = Math.max(...frames.map(f => f.sourceSize?.w ?? f.frame.w));
    const h = Math.max(...frames.map(f => f.sourceSize?.h ?? f.frame.h));
    this.canvas.width = w;
    this.canvas.height = h;
    // Whole-number-ish scaling keeps pixels crisp; small Pokémon get blown up more than big ones.
    const scale = Math.max(1, Math.min(3, Math.floor((170 / Math.max(w, h)) * 2) / 2));
    this.canvas.style.width = `${w * scale}px`;
    this.canvas.style.height = `${h * scale}px`;
    this.ctx.imageSmoothingEnabled = false;
    let i = 0;
    let last = 0;
    const draw = () => {
      const f = frames[i];
      const off = f.spriteSourceSize ?? { x: 0, y: 0 };
      this.ctx.clearRect(0, 0, w, h);
      this.ctx.drawImage(img, f.frame.x, f.frame.y, f.frame.w, f.frame.h, off.x, off.y, f.frame.w, f.frame.h);
    };
    draw();
    if (this.reduceMotion || frames.length < 2) return;
    const tick = t => {
      if (token !== this.token) return;
      if (t - last >= FRAME_MS) {
        last = t;
        i = (i + 1) % frames.length;
        draw();
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  destroy() {
    this.token++;
    cancelAnimationFrame(this.raf);
  }
}
