// Browser extension (extension/): manifest sanity, the shared shortcut helpers and the zip packer.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { inflateRawSync } from "node:zlib";
import { zip } from "../lib/zip.mjs";

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../extension");
const manifest = JSON.parse(readFileSync(path.join(EXT, "manifest.json"), "utf8"));

// shortcut.js is a classic script that sets globalThis.PRDexShortcut; run it in a sandbox.
const sandbox = {};
vm.runInNewContext(readFileSync(path.join(EXT, "shortcut.js"), "utf8"), sandbox);
const { DEFAULT, allowedIn, format, fromEvent, matches, valid } = sandbox.PRDexShortcut;

const key = (code, key, mods = {}) => ({
  code,
  key,
  ctrlKey: !!mods.ctrl,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
  metaKey: !!mods.meta,
});

describe("extension manifest", () => {
  test("only injects into pokerogue.net (and the dex when framed there)", () => {
    const [game, frame] = manifest.content_scripts;
    assert.deepEqual(game.matches, ["https://pokerogue.net/*", "https://www.pokerogue.net/*"]);
    assert.deepEqual(frame.matches, ["https://pokeroguedex.vercel.app/*"]);
    assert.deepEqual(manifest.permissions, ["storage"]);
    assert.equal(manifest.host_permissions, undefined);
  });

  test("every referenced file exists", () => {
    const files = [
      ...manifest.content_scripts.flatMap(c => c.js),
      ...Object.values(manifest.icons),
      ...Object.values(manifest.action.default_icon),
      manifest.action.default_popup,
    ];
    for (const f of files) assert.ok(existsSync(path.join(EXT, f)), f);
  });

  test("Firefox updates come from the site, and the site's install page knows the add-on id", () => {
    const { id, update_url } = manifest.browser_specific_settings.gecko;
    assert.equal(update_url, "https://pokeroguedex.vercel.app/extension/updates.json");
    const page = readFileSync(path.join(EXT, "../site/assets/js/views/extension.js"), "utf8");
    assert.ok(page.includes(`const ADDON_ID = "${id}";`));
  });

  test("version tracks the dex version", () => {
    const pkg = JSON.parse(readFileSync(path.join(EXT, "../package.json"), "utf8"));
    assert.equal(manifest.version, pkg.version);
  });
});

describe("shortcut helpers", () => {
  test("default is Alt + P", () => assert.equal(format(DEFAULT), "Alt + P"));

  test("matches on physical key and exact modifiers", () => {
    assert.ok(matches(DEFAULT, key("KeyP", "p", { alt: true })));
    assert.ok(matches(DEFAULT, key("KeyP", "π", { alt: true })), "macOS Option produces a different key");
    assert.ok(!matches(DEFAULT, key("KeyP", "p")));
    assert.ok(!matches(DEFAULT, key("KeyP", "P", { alt: true, shift: true })));
    assert.ok(!matches(null, key("KeyP", "p", { alt: true })));
  });

  test("fromEvent ignores lone modifiers", () => {
    assert.equal(fromEvent(key("AltLeft", "Alt", { alt: true })), null);
    assert.equal(fromEvent(key("ShiftLeft", "Shift", { shift: true })), null);
    assert.deepEqual(
      { ...fromEvent(key("KeyD", "D", { ctrl: true, shift: true })) },
      { code: "KeyD", key: "D", ctrl: true, alt: false, shift: true, meta: false },
    );
  });

  test("formats keys readably", () => {
    assert.equal(format(fromEvent(key("Backquote", "`"))), "`");
    assert.equal(format(fromEvent(key("Digit1", "!", { shift: true }))), "Shift + 1");
    assert.equal(format(fromEvent(key("F2", "F2"))), "F2");
    assert.equal(format(fromEvent(key("Space", " ", { ctrl: true }))), "Ctrl + Space");
  });

  test("bare keys are ignored in text fields, combos are not", () => {
    const input = { closest: sel => (sel.includes("input") ? {} : null) };
    const canvas = { closest: () => null };
    const bare = fromEvent(key("Backquote", "`"));
    assert.ok(allowedIn(bare, canvas));
    assert.ok(!allowedIn(bare, input));
    assert.ok(allowedIn(DEFAULT, input));
  });

  test("validates stored values", () => {
    assert.ok(valid(DEFAULT));
    assert.ok(!valid(undefined));
    assert.ok(!valid({ code: "KeyP" }));
  });
});

describe("zip writer", () => {
  // Read entries back through the central directory, the way unzip tools and the stores do.
  function unzip(buf) {
    const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const count = buf.readUInt16LE(end + 10);
    let p = buf.readUInt32LE(end + 16);
    const out = {};
    for (let i = 0; i < count; i++) {
      assert.equal(buf.readUInt32LE(p), 0x02014b50);
      const method = buf.readUInt16LE(p + 10);
      const size = buf.readUInt32LE(p + 20);
      const nameLen = buf.readUInt16LE(p + 28);
      const local = buf.readUInt32LE(p + 42);
      const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const body = buf.subarray(start, start + size);
      out[name] = method === 8 ? inflateRawSync(body) : Buffer.from(body);
      p += 46 + nameLen;
    }
    return out;
  }

  test("round-trips stored and deflated entries", () => {
    const entries = [
      { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2)) },
      { name: "icons/é.txt", data: Buffer.from("x") },
      { name: "empty", data: Buffer.alloc(0) },
    ];
    const files = unzip(zip(entries));
    assert.deepEqual(Object.keys(files), entries.map(e => e.name));
    for (const e of entries) assert.ok(files[e.name].equals(e.data), e.name);
  });

  test("is deterministic", () => {
    const entries = [{ name: "a.js", data: Buffer.from("console.log(1);\n".repeat(50)) }];
    assert.ok(zip(entries).equals(zip(entries)));
  });
});
