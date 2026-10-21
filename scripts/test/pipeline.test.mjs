// Run with `npm test`. Uses small in-memory fixtures — no network or game checkout needed.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { markdown } from "../../site/assets/js/lib/dom.js";
import { diffGameData } from "../lib/diff.mjs";
import { toCamelCase, toTitle } from "../lib/extract.mjs";
import { Call, Fn, New, TsProject, flattenChain, findNodes, ts } from "../lib/ts-eval.mjs";

describe("toCamelCase mirrors the game's locale keys", () => {
  for (const [input, expected] of [
    ["BULBASAUR", "bulbasaur"],
    ["NIDORAN_F", "nidoranF"],
    ["HO_OH", "hoOh"],
    ["PORYGON_Z", "porygonZ"],
    ["ALOLA_RATTATA", "alolaRattata"],
    ["KARATE_CHOP", "karateChop"],
    ["U_TURN", "uTurn"],
    ["TALL_GRASS", "tallGrass"],
  ]) {
    test(`${input} → ${expected}`, () => assert.equal(toCamelCase(input), expected));
  }
  test("toTitle", () => assert.equal(toTitle("MEDIUM_SLOW"), "Medium Slow"));
});

describe("TsProject evaluator", () => {
  let dir;
  let project;
  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), "prdex-"));
    mkdirSync(path.join(dir, "enums"));
    mkdirSync(path.join(dir, "data"));
    writeFileSync(
      path.join(dir, "enums", "species-id.ts"),
      "export enum SpeciesId { NONE, BULBASAUR, IVYSAUR, ALOLA_RATTATA = 2019, ALOLA_RATICATE }",
    );
    writeFileSync(path.join(dir, "enums", "biome-id.ts"), "export const BiomeId = { TOWN: 0, PLAINS: 1 } as const;");
    writeFileSync(path.join(dir, "enums", "flags.ts"), "export enum Flags { NONE = 0, A = 1 << 0, B = 1 << 3 }");
    writeFileSync(
      path.join(dir, "data", "stuff.ts"),
      `import { SpeciesId } from "#enums/species-id";
       const LOCAL = 7;
       const pool = { [SpeciesId.IVYSAUR]: [SpeciesId.BULBASAUR, -1], ...{ extra: true } };
       export const thing = {
         pool,
         biome: BiomeId.PLAINS,
         spread: [...[1, 2], LOCAL],
         species: new Species({ id: SpeciesId.ALOLA_RATICATE, fn: () => 1 }),
         chain: new AttackMove(SpeciesId.BULBASAUR).attr(HighCritAttr).target(Flags.B).build(),
         text: \`id-\${LOCAL}\`,
       };`,
    );
    project = new TsProject(dir);
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  test("enums auto-increment and honour explicit values", () => {
    const e = project.enumValues("SpeciesId");
    assert.equal(e.BULBASAUR, 1);
    assert.equal(e.ALOLA_RATTATA, 2019);
    assert.equal(e.ALOLA_RATICATE, 2020);
    assert.equal(project.enumName("SpeciesId", 2), "IVYSAUR");
  });

  test("const-object enums and bit-shift initialisers", () => {
    assert.equal(project.enumValues("BiomeId").PLAINS, 1);
    assert.equal(project.enumValues("Flags").B, 8);
  });

  test("object literals, computed keys, spreads, locals and templates", () => {
    const v = project.constIn("data/stuff.ts", "thing");
    assert.deepEqual(v.pool, { 2: [1, -1], extra: true });
    assert.equal(v.biome, 1);
    assert.deepEqual(v.spread, [1, 2, 7]);
    assert.equal(v.text, "id-7");
  });

  test("new-expressions and builder chains stay inspectable", () => {
    const v = project.constIn("data/stuff.ts", "thing");
    assert.ok(v.species instanceof New);
    assert.equal(v.species.args[0].id, 2020);
    assert.ok(v.species.args[0].fn instanceof Fn);
    assert.ok(v.chain instanceof Call);
    const { base, calls } = flattenChain(v.chain);
    assert.equal(base.cls, "AttackMove");
    assert.deepEqual(
      calls.map(c => c.name),
      ["attr", "target", "build"],
    );
    assert.equal(calls[1].args[0], 8);
  });

  test("findNodes walks the AST", () => {
    const sf = project.sourceFile("data/stuff.ts");
    assert.ok(findNodes(sf, ts.isNewExpression).length >= 2);
  });
});

describe("diffGameData", () => {
  const species = (over = {}) => ({
    id: 1,
    key: "BULBASAUR",
    name: "Bulbasaur",
    types: ["grass", "poison"],
    abilities: [65, 0, 34],
    passive: 229,
    stats: [45, 49, 49, 65, 65, 45],
    cost: 3,
    eggTier: "common",
    catchRate: 45,
    growth: "Medium Slow",
    forms: [],
    eggMoves: [1, 2, 3, 4],
    levelMoves: [
      [1, 33],
      [66, 89],
    ],
    tms: [10, 11],
    evolutions: [],
    biomes: [],
    ...over,
  });
  const base = { species: [species()], moves: [], abilities: [], biomes: [], items: [] };

  test("no changes → empty diff", () => {
    const d = diffGameData(base, structuredClone(base));
    assert.equal(d.total, 0);
  });

  test("level change shows as removed + added, egg/passive/tm changes are reported", () => {
    const next = {
      ...base,
      species: [species({ levelMoves: [[1, 33], [60, 89]], eggMoves: [1, 2, 3, 5], passive: 300, tms: [10, 12] })],
      moves: [{ id: 5, key: "NEW_MOVE", name: "New Move", flags: [], effect: "" }],
    };
    const d = diffGameData(base, next);
    const changes = Object.fromEntries(d.species.changed[0].changes.map(c => [c.field, c]));
    assert.deepEqual(changes.levelMoves.added, [{ move: 89, level: 60 }]);
    assert.deepEqual(changes.levelMoves.removed, [{ move: 89, level: 66 }]);
    assert.deepEqual(changes.eggMoves, { field: "eggMoves", added: [5], removed: [4] });
    assert.deepEqual([changes.passive.before, changes.passive.after], [229, 300]);
    assert.deepEqual(changes.tms, { field: "tms", added: [12], removed: [11] });
    assert.equal(d.summary.moves.added, 1);
  });
});

describe("markdown", () => {
  test("headings, nested lists, inline formatting", () => {
    const out = markdown("## Title\n- **Bold** item\n  - nested `code`\n- [link](https://example.com)\n\n[ref]: https://x.y");
    assert.match(out, /<h3>Title<\/h3>/);
    assert.match(out, /<strong>Bold<\/strong>/);
    assert.match(out, /<ul><li>nested <code>code<\/code>/);
    assert.match(out, /<a href="https:\/\/example.com"/);
    assert.doesNotMatch(out, /\[ref\]|x\.y/); // reference definitions are dropped
  });
  test("escapes HTML", () => {
    assert.doesNotMatch(markdown("<script>alert(1)</script>"), /<script>/);
  });
});
