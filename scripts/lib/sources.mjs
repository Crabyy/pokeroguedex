// Fetches the PokéRogue game source (at a release tag) plus the locale and asset
// files pinned by that release's git submodules. Everything is cached under .cache/.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const GAME_REPO = "pagefaultgames/pokerogue";
export const LOCALES_REPO = "pagefaultgames/pokerogue-locales";
export const ASSETS_REPO = "pagefaultgames/pokerogue-assets";

/** English locale files the extractor reads. */
const LOCALE_FILES = [
  "pokemon.json",
  "pokemon-form.json",
  "move.json",
  "ability.json",
  "biomes.json",
  "modifier-type.json",
  "trainer-classes.json",
  "trainer-names.json",
  "weather.json",
  "pokeball.json",
];

/** Asset files (JSON only — sprites are hot-linked by the site). */
const ASSET_FILES = ["images/pokemon/variant/_masterlist.json"];

const githubHeaders = () => {
  const headers = { "User-Agent": "pokeroguedex-builder", Accept: "application/vnd.github+json" };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
};

async function fetchJson(url) {
  const res = await fetch(url, { headers: githubHeaders() });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": "pokeroguedex-builder" } });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  return res.text();
}

/** Returns the newest releases (newest first), skipping drafts and pre-releases. */
export async function listReleases(count = 10) {
  const releases = await fetchJson(`https://api.github.com/repos/${GAME_REPO}/releases?per_page=${Math.max(count, 10)}`);
  return releases
    .filter(r => !r.draft && !r.prerelease)
    .slice(0, count)
    .map(r => ({ tag: r.tag_name, name: r.name, publishedAt: r.published_at, url: r.html_url, body: r.body ?? "" }));
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/**
 * Sparse-clones the game repo at `tag` (only `src/`), then downloads the pinned
 * locale and asset files. Returns paths and the pinned commit SHAs.
 */
export async function fetchGameSources(tag, cacheDir) {
  const root = path.join(cacheDir, `pokerogue-${tag}`);
  const gameDir = path.join(root, "game");
  const manifestPath = path.join(root, "manifest.json");

  if (existsSync(manifestPath)) {
    return JSON.parse(readFileSync(manifestPath, "utf8"));
  }

  mkdirSync(root, { recursive: true });
  if (!existsSync(path.join(gameDir, ".git"))) {
    console.log(`  ↳ cloning ${GAME_REPO}@${tag} (sparse: src/)`);
    git(
      ["clone", "--quiet", "--depth", "1", "--branch", tag, "--filter=blob:none", "--sparse",
        `https://github.com/${GAME_REPO}.git`, gameDir],
      root,
    );
    git(["sparse-checkout", "set", "src"], gameDir);
  }

  const commit = git(["rev-parse", "HEAD"], gameDir);
  const submodules = Object.fromEntries(
    git(["ls-tree", "HEAD", "locales", "assets"], gameDir)
      .split("\n")
      .filter(Boolean)
      .map(line => {
        const [, , sha, name] = line.split(/\s+/);
        return [name, sha];
      }),
  );
  const pkg = JSON.parse(git(["show", "HEAD:package.json"], gameDir));

  const localesDir = path.join(root, "locales", "en");
  mkdirSync(localesDir, { recursive: true });
  console.log(`  ↳ downloading ${LOCALE_FILES.length} locale files @ ${submodules.locales.slice(0, 7)}`);
  await Promise.all(
    LOCALE_FILES.map(async file => {
      const text = await fetchText(`https://raw.githubusercontent.com/${LOCALES_REPO}/${submodules.locales}/en/${file}`);
      writeFileSync(path.join(localesDir, file), text);
    }),
  );

  const assetsDir = path.join(root, "assets");
  console.log(`  ↳ downloading ${ASSET_FILES.length} asset index file(s) @ ${submodules.assets.slice(0, 7)}`);
  await Promise.all(
    ASSET_FILES.map(async file => {
      const dest = path.join(assetsDir, file);
      mkdirSync(path.dirname(dest), { recursive: true });
      writeFileSync(dest, await fetchText(`https://raw.githubusercontent.com/${ASSETS_REPO}/${submodules.assets}/${file}`));
    }),
  );

  const manifest = {
    tag,
    version: pkg.version,
    commit,
    localesCommit: submodules.locales,
    assetsCommit: submodules.assets,
    gameDir,
    localesDir,
    assetsDir,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return manifest;
}
