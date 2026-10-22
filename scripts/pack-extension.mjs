#!/usr/bin/env node
// Packs extension/ into dist/pokeroguedex-<version>-unsigned.xpi (a zip with manifest.json at the
// root). Firefox only installs it with signing disabled (Zen, Developer Edition, Nightly) or as a
// temporary add-on; `npm run extension:sign` makes the signed build the site distributes.
//
//   npm run extension:pack
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zip } from "./lib/zip.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXT = path.join(ROOT, "extension");
const DIST = path.join(ROOT, "dist");

const manifest = JSON.parse(readFileSync(path.join(EXT, "manifest.json"), "utf8"));
const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
if (manifest.version !== pkg.version) {
  console.error(`extension/manifest.json is ${manifest.version} but package.json is ${pkg.version} — bump both.`);
  process.exit(1);
}

// Sorted, dotfiles skipped, "/" separators: the same tree always gives the same zip.
const files = readdirSync(EXT, { recursive: true, withFileTypes: true })
  .filter(d => d.isFile())
  .map(d => path.relative(EXT, path.join(d.parentPath, d.name)).split(path.sep).join("/"))
  .filter(name => !name.split("/").some(part => part.startsWith(".")))
  .sort();

const out = path.join(DIST, `pokeroguedex-${manifest.version}-unsigned.xpi`);
mkdirSync(DIST, { recursive: true });
writeFileSync(out, zip(files.map(name => ({ name, data: readFileSync(path.join(EXT, name)) }))));

console.log(`${path.relative(ROOT, out)} (${files.length} files)`);
for (const f of files) console.log(`  ${f}`);
if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `xpi=${path.relative(ROOT, out)}\n`, { flag: "a" });
