#!/usr/bin/env node
// Builds the dex data from PokéRogue's source.
//
//   npm run data                     # latest release + diffs for the last 4 releases
//   npm run data -- --tag v1.12.1.3  # a specific release
//   npm run data -- --history 8      # generate more "game changes" history
//   npm run data -- --force          # rebuild even if the data is already up to date
//   npm run data:check               # only report whether a newer game release exists
//
// Output goes to site/data/. Sources are cached in .cache/.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { diffGameData } from "./lib/diff.mjs";
import { extractGameData } from "./lib/extract.mjs";
import { fetchGameSources, listReleases } from "./lib/sources.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.join(ROOT, ".cache");
const OUT = path.join(ROOT, "site", "data");
const CHANGES_DIR = path.join(OUT, "changes");

const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

/** One entry per line: compact, but git diffs still show exactly which entries changed. */
function writeJsonLines(file, value) {
  const body = Array.isArray(value) ? `[\n${value.map(v => JSON.stringify(v)).join(",\n")}\n]\n` : `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(file, body);
}

const readJson = file => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null);

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

const extracted = new Map();
async function extractTag(tag) {
  if (extracted.has(tag)) return extracted.get(tag);
  console.log(`\n▸ ${tag}`);
  const sources = await fetchGameSources(tag, CACHE);
  const t0 = Date.now();
  const data = extractGameData(sources);
  console.log(
    `  ✓ extracted ${data.species.length} species, ${data.moves.length} moves, ${data.abilities.length} abilities, ` +
      `${data.biomes.length} biomes, ${data.items.length} items in ${Date.now() - t0} ms`,
  );
  for (const w of data.warnings) console.warn(`  ⚠ ${w}`);
  const result = { sources, data };
  extracted.set(tag, result);
  return result;
}

/** Strips the release notes down to a short, safe markdown brief. */
function briefNotes(body) {
  return (body ?? "")
    .replace(/\r/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim()
    .slice(0, 6000);
}

async function main() {
  const releases = await listReleases(Math.max(Number(option("history", 4)) + 1, 2));
  if (!releases.length) throw new Error("No PokéRogue releases found.");
  const latest = releases[0];
  const meta = readJson(path.join(OUT, "meta.json"));

  if (flag("check")) {
    const outdated = meta?.game?.tag !== latest.tag;
    console.log(outdated ? `Newer release available: ${meta?.game?.tag ?? "none"} → ${latest.tag}` : `Up to date (${latest.tag}).`);
    setOutput("outdated", outdated);
    setOutput("tag", latest.tag);
    return;
  }

  const tag = option("tag", latest.tag);
  const release = releases.find(r => r.tag === tag) ?? { tag, name: tag, publishedAt: null, url: null, body: "" };
  if (meta?.game?.tag === tag && !flag("force")) {
    console.log(`Data is already built for ${tag}. Use --force to rebuild.`);
    setOutput("changed", false);
    return;
  }

  mkdirSync(CHANGES_DIR, { recursive: true });
  const { sources, data } = await extractTag(tag);
  const pkg = readJson(path.join(ROOT, "package.json"));

  for (const key of ["species", "moves", "abilities", "biomes", "items"]) writeJsonLines(path.join(OUT, `${key}.json`), data[key]);
  writeFileSync(path.join(OUT, "types.json"), `${JSON.stringify(data.types)}\n`);
  writeJsonLines(path.join(OUT, "rules.json"), data.rules);

  // ---- "What's new → game changes" history: diff each release against the one before it.
  const history = Number(option("history", 4));
  const index = readJson(path.join(CHANGES_DIR, "index.json")) ?? [];
  const startAt = Math.max(releases.findIndex(r => r.tag === tag), 0);
  for (let i = startAt; i < Math.min(startAt + history, releases.length - 1); i++) {
    const cur = releases[i];
    const prev = releases[i + 1];
    const file = path.join(CHANGES_DIR, `${cur.tag}.json`);
    if (existsSync(file) && !flag("force")) continue;
    try {
      const [a, b] = [await extractTag(prev.tag), await extractTag(cur.tag)];
      const diff = diffGameData(a.data, b.data);
      writeJsonLines(file, { from: prev.tag, to: cur.tag, ...diff });
      const entry = {
        tag: cur.tag,
        from: prev.tag,
        name: cur.name,
        publishedAt: cur.publishedAt,
        url: cur.url,
        notes: briefNotes(cur.body),
        summary: diff.summary,
        total: diff.total,
      };
      const existing = index.findIndex(e => e.tag === cur.tag);
      if (existing >= 0) index[existing] = entry;
      else index.push(entry);
      console.log(`  ✓ diff ${prev.tag} → ${cur.tag}: ${diff.total} change(s)`);
    } catch (err) {
      console.warn(`  ⚠ could not diff ${prev.tag} → ${cur.tag}: ${err.message}`);
    }
  }
  index.sort((x, y) => String(y.publishedAt).localeCompare(String(x.publishedAt)));
  writeJsonLines(path.join(CHANGES_DIR, "index.json"), index);

  writeJsonLines(path.join(OUT, "meta.json"), {
    dex: { version: pkg.version },
    game: {
      version: sources.version,
      tag,
      name: release.name,
      publishedAt: release.publishedAt,
      url: release.url,
      commit: sources.commit,
      localesCommit: sources.localesCommit,
      assetsCommit: sources.assetsCommit,
    },
    generatedAt: new Date().toISOString(),
    counts: {
      species: data.species.length,
      forms: data.species.reduce((n, s) => n + Math.max(s.forms.length, 1), 0),
      moves: data.moves.length,
      abilities: data.abilities.length,
      biomes: data.biomes.length,
      items: data.items.length,
    },
  });

  console.log(`\n✔ Wrote site/data for PokéRogue ${sources.version} (${tag}).`);
  setOutput("changed", true);
  setOutput("tag", tag);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
