#!/usr/bin/env node
// Signs extension/ with Mozilla as an *unlisted* add-on (signed, but not listed on addons.mozilla.org)
// and publishes it on the site, which is how the dex distributes it:
//
//   site/extension/pokeroguedex-<version>.xpi   the install link on #/extension
//   site/extension/updates.json                 Firefox's auto-update manifest (manifest gecko.update_url)
//
// Needs AMO API credentials (https://addons.mozilla.org/developers/addon/api/key/):
//
//   AMO_JWT_ISSUER=user:… AMO_JWT_SECRET=… npm run extension:sign
//
// AMO signs each version only once, so bump the version (package.json + manifest) before re-signing.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB_EXT = "web-ext@10.7.0";
const SITE_URL = "https://pokeroguedex.vercel.app";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXT = path.join(ROOT, "extension");
const OUT = path.join(ROOT, "site", "extension");
const ARTIFACTS = path.join(ROOT, ".cache", "web-ext");

const manifest = JSON.parse(readFileSync(path.join(EXT, "manifest.json"), "utf8"));
const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
const { version } = manifest;
const id = manifest.browser_specific_settings.gecko.id;
const xpiName = `pokeroguedex-${version}.xpi`;

if (version !== pkg.version) fail(`extension/manifest.json is ${version} but package.json is ${pkg.version} — bump both.`);
if (existsSync(path.join(OUT, xpiName))) {
  console.log(`site/extension/${xpiName} already exists — nothing to sign. Bump the version to release a new build.`);
  process.exit(0);
}
const { AMO_JWT_ISSUER, AMO_JWT_SECRET } = process.env;
if (!AMO_JWT_ISSUER || !AMO_JWT_SECRET) {
  fail("Set AMO_JWT_ISSUER and AMO_JWT_SECRET (https://addons.mozilla.org/developers/addon/api/key/).");
}

rmSync(ARTIFACTS, { recursive: true, force: true });
mkdirSync(ARTIFACTS, { recursive: true });
// Credentials go through web-ext's WEB_EXT_* env vars rather than argv, so they never show in a process list.
const res = spawnSync(
  "npx",
  ["--yes", WEB_EXT, "sign", "--channel=unlisted", `--source-dir=${EXT}`, `--artifacts-dir=${ARTIFACTS}`],
  {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, WEB_EXT_API_KEY: AMO_JWT_ISSUER, WEB_EXT_API_SECRET: AMO_JWT_SECRET },
  },
);
if (res.status !== 0) fail(`web-ext sign failed (exit ${res.status}).`);

const signed = readdirSync(ARTIFACTS).find(f => f.endsWith(`-${version}.xpi`));
if (!signed) fail(`No signed .xpi for ${version} in ${path.relative(ROOT, ARTIFACTS)}.`);

mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (/^pokeroguedex-.*\.xpi$/.test(f)) rmSync(path.join(OUT, f));
copyFileSync(path.join(ARTIFACTS, signed), path.join(OUT, xpiName));

const hash = createHash("sha256").update(readFileSync(path.join(OUT, xpiName))).digest("hex");
const updates = {
  addons: {
    [id]: {
      updates: [{ version, update_link: `${SITE_URL}/extension/${xpiName}`, update_hash: `sha256:${hash}` }],
    },
  },
};
writeFileSync(path.join(OUT, "updates.json"), `${JSON.stringify(updates, null, 2)}\n`);
console.log(`Signed → site/extension/${xpiName} + updates.json`);
if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `signed=true\nversion=${version}\n`, { flag: "a" });

function fail(msg) {
  console.error(msg);
  process.exit(1);
}
