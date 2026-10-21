// Turns PokéRogue's TypeScript game data into the plain JSON the dex site consumes.
import { readFileSync } from "node:fs";
import path from "node:path";
import { Call, Fn, flattenChain, New, Ref, TsProject, findNodes, ts } from "./ts-eval.mjs";

// ------------------------------------------------------------------ helpers

/** Mirrors the game's `toCamelCase` (src/utils/strings.ts) so locale keys line up exactly. */
export function toCamelCase(str) {
  const words = str
    .trim()
    .replace(/([\p{Ll}\d])(\p{Lu})/gu, "$1\0$2")
    .replace(/(\p{Lu})([\p{Lu}][\p{Ll}])/gu, "$1\0$2")
    .replace(/[-_ ]+/giu, "\0")
    .split("\0")
    .filter(Boolean);
  return words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join("");
}

export function toTitle(enumName) {
  return String(enumName)
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map(w => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

const slugify = s =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/♀/g, "-f")
    .replace(/♂/g, "-m")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const asArray = v => (v == null ? [] : Array.isArray(v) ? v : [v]);
const newArgs = v => (v instanceof New ? (v.args[0] ?? {}) : {});
const isNum = v => typeof v === "number" && Number.isFinite(v);

/** Wild encounter tier odds from src/field/arena.ts (`generateNonBossBiomeTier` / `generateBossBiomeTier`). */
export const BIOME_TIER_ODDS = {
  COMMON: "356/512",
  UNCOMMON: "124/512",
  RARE: "26/512",
  SUPER_RARE: "5/512",
  ULTRA_RARE: "1/512",
  BOSS: "44/64",
  BOSS_RARE: "14/64",
  BOSS_SUPER_RARE: "5/64",
  BOSS_ULTRA_RARE: "1/64",
};

// ---------------------------------------------------------------- extractor

export function extractGameData({ gameDir, localesDir, assetsDir }) {
  const project = new TsProject(path.join(gameDir, "src"));
  const loc = file => JSON.parse(readFileSync(path.join(localesDir, file), "utf8"));
  const L = {
    pokemon: loc("pokemon.json"),
    move: loc("move.json"),
    ability: loc("ability.json"),
    biomes: loc("biomes.json"),
    modifierType: loc("modifier-type.json"),
    trainerClasses: loc("trainer-classes.json"),
    trainerNames: loc("trainer-names.json"),
    pokeball: loc("pokeball.json"),
  };
  const variantMasterlist = JSON.parse(readFileSync(path.join(assetsDir, "images/pokemon/variant/_masterlist.json"), "utf8"));

  const enumName = (e, v) => project.enumName(e, v);
  const warnings = [];
  const warn = msg => warnings.push(msg);

  const typeName = v => (v == null || v === -1 ? null : enumName("PokemonType", v)?.toLowerCase() ?? null);
  const speciesKey = id => enumName("SpeciesId", id);
  const moveKey = id => enumName("MoveId", id);
  const abilityKey = id => enumName("AbilityId", id);
  const biomeKey = id => enumName("BiomeId", id);

  const speciesName = id => {
    const key = speciesKey(id);
    const name = key && L.pokemon[toCamelCase(key)];
    if (!name) warn(`missing species name for ${key ?? id}`);
    return name ?? toTitle(key ?? `#${id}`);
  };
  const moveName = id => {
    const key = moveKey(id);
    return L.move[toCamelCase(key ?? "")]?.name ?? toTitle(key ?? `#${id}`);
  };
  const biomeName = id => {
    const key = biomeKey(id);
    return L.biomes[toCamelCase(key ?? "")] ?? toTitle(key ?? `#${id}`);
  };
  const trainerName = id => {
    const key = enumName("TrainerType", id) ?? String(id);
    const camel = toCamelCase(key);
    return L.trainerClasses[camel] ?? L.trainerNames[camel] ?? toTitle(key);
  };

  // ------------------------------------------------------------- moves
  const tmPoolTiers = project.constIn("data/balance/tm-pool-tiers.ts", "tmPoolTiers");
  const moves = extractMoves(project, L, tmPoolTiers, warn);

  // --------------------------------------------------------- abilities
  const abilities = extractAbilities(project, L);

  // ----------------------------------------------------------- species
  const eggMoves = project.constIn("data/balance/moves/egg-moves.ts", "speciesEggMoves");
  const species = extractSpecies(project, {
    L,
    eggMoves,
    variantMasterlist,
    typeName,
    speciesName,
    moveName,
    biomeName,
    enumName,
    warn,
  });

  // ------------------------------------------------------------ biomes
  const biomes = extractBiomes(project, { biomeName, trainerName, enumName, warn });

  // Reverse index: where can each species be found?
  const byId = new Map(species.map(s => [s.id, s]));
  for (const biome of biomes) {
    for (const [tier, times] of Object.entries(biome.pokemon)) {
      for (const [time, ids] of Object.entries(times)) {
        for (const id of ids) {
          const s = byId.get(id);
          if (!s) continue;
          let entry = s.biomes.find(b => b.biome === biome.id && b.tier === tier);
          if (!entry) s.biomes.push((entry = { biome: biome.id, tier, times: [] }));
          if (!entry.times.includes(time)) entry.times.push(time);
        }
      }
    }
  }

  // ------------------------------------------------------------- items
  const items = extractItems(project, L, warn);

  return {
    species,
    moves,
    abilities,
    biomes,
    items,
    types: extractTypeChart(project, typeName, warn),
    rules: extractRules(project, warn),
    warnings,
  };
}

/** Small balance tables the site displays alongside species. */
function extractRules(project, warn) {
  let starterCandy = [];
  try {
    starterCandy = asArray(project.constIn("data/balance/starters.ts", "allStarterCandyCosts")).map((c, i) => ({
      cost: i + 1,
      passive: c.passive,
      costReduction: c.costReduction,
      eggCosts: c.eggCosts,
      eggCostReductionThresholds: c.eggCostReductionThresholds,
    }));
  } catch (err) {
    warn(`starter candy costs: ${err.message}`);
  }
  return { starterCandy, biomeTierOdds: BIOME_TIER_ODDS };
}

// =============================================================== type chart

/** Groups switch clauses so fall-through labels share the statements that follow them. */
function switchGroups(switchStmt, file, project) {
  const groups = [];
  let labels = [];
  let isDefault = false;
  for (const clause of switchStmt.caseBlock.clauses) {
    if (ts.isDefaultClause(clause)) isDefault = true;
    else labels.push(project.evaluate(clause.expression, file));
    if (clause.statements.length) {
      groups.push({ labels, isDefault, statements: clause.statements });
      labels = [];
      isDefault = false;
    }
  }
  return groups;
}

/**
 * Reads `getTypeChartMultiplier` (a nested `switch (defType) { switch (attackType) … }`)
 * into `{ list: ["normal", …], chart: { [attacker]: { [defender]: multiplier } } }` (only ≠ 1 stored).
 */
function extractTypeChart(project, typeName, warn) {
  const file = "data/type.ts";
  const list = Object.entries(project.enumValues("PokemonType"))
    .filter(([, v]) => v >= 0)
    .map(([k]) => k.toLowerCase());
  const fn = project.sourceFile(file).statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === "getTypeChartMultiplier");
  const outer = fn && findNodes(fn, ts.isSwitchStatement)[0];
  if (!outer) {
    warn("type chart not found");
    return { list, chart: {} };
  }
  const chart = {};
  for (const group of switchGroups(outer, file, project)) {
    const inner = group.statements.find(ts.isSwitchStatement);
    if (!inner) continue;
    for (const def of group.labels) {
      for (const g of switchGroups(inner, file, project)) {
        const ret = g.statements.find(ts.isReturnStatement);
        const mult = ret ? project.evaluate(ret.expression, file) : 1;
        if (g.isDefault || mult === 1) continue;
        for (const atk of g.labels) {
          const a = typeName(atk);
          const d = typeName(def);
          if (!a || !d) continue;
          (chart[a] ??= {})[d] = mult;
        }
      }
    }
  }
  return { list, chart };
}

// ==================================================================== moves

const MOVE_FLAG_METHODS = {
  soundBased: "sound",
  punchingMove: "punch",
  bitingMove: "bite",
  slicingMove: "slicing",
  pulseMove: "pulse",
  ballBombMove: "bullet",
  powderMove: "powder",
  danceMove: "dance",
  windMove: "wind",
  healingMove: "healing",
  recklessMove: "reckless",
  ignoresProtect: "bypassProtect",
  ignoresSubstitute: "bypassSubstitute",
  reflectable: "reflectable",
  affectedByGravity: "gravity",
  ignoresAbilities: "ignoresAbilities",
};

function extractMoves(project, L, tmPoolTiers, warn) {
  const file = "data/moves/move.ts";
  const pushArgs = findPushArgs(project.sourceFile(file), "initMoves");
  const moves = [];
  for (const node of pushArgs) {
    const { base, calls } = flattenChain(project.evaluate(node, file));
    if (!(base instanceof New)) continue;
    const isStatus = /StatusMove$/.test(base.cls);
    const a = base.args;
    let m;
    if (isStatus) {
      const [id, type, accuracy, pp, chance, priority, gen] = a;
      m = { id, type, category: "status", power: null, accuracy, pp, chance, priority, gen };
    } else {
      const [id, type, category, power, accuracy, pp, chance, priority, gen] = a;
      m = { id, type, category: project.enumName("MoveCategory", category)?.toLowerCase(), power, accuracy, pp, chance, priority, gen };
    }
    if (!m.id) continue; // MoveId.NONE

    let target = base.cls.startsWith("Self") || base.cls === "ChargingSelfStatusMove" ? "USER" : "NEAR_OTHER";
    const flags = new Set();
    if (m.category === "physical") flags.add("contact");
    if (/^Charging/.test(base.cls)) flags.add("charging");
    let status = null;
    for (const { name, args } of calls) {
      if (name === "target") target = project.enumName("MoveTarget", args[0]) ?? target;
      else if (name === "makesContact") args[0] === false ? flags.delete("contact") : flags.add("contact");
      else if (MOVE_FLAG_METHODS[name]) flags.add(MOVE_FLAG_METHODS[name]);
      else if (name === "unimplemented") status = "unimplemented";
      else if (name === "partial" && status !== "unimplemented") status = "partial";
      else if (name === "edgeCase" && !status) status = "edgeCase";
    }

    const key = project.enumName("MoveId", m.id);
    const text = L.move[toCamelCase(key)];
    if (!text) warn(`missing move locale for ${key}`);
    const tmTier = tmPoolTiers[m.id] != null ? project.enumName("ModifierTier", tmPoolTiers[m.id])?.toLowerCase() : null;

    moves.push({
      id: m.id,
      key,
      name: text?.name ?? toTitle(key),
      type: project.enumName("PokemonType", m.type)?.toLowerCase() ?? "unknown",
      category: m.category,
      power: isNum(m.power) && m.power > 0 ? m.power : null,
      accuracy: isNum(m.accuracy) && m.accuracy > 0 ? m.accuracy : null,
      pp: m.pp,
      chance: isNum(m.chance) && m.chance > 0 ? m.chance : null,
      priority: m.priority ?? 0,
      gen: m.gen,
      target: toTitle(target),
      flags: [...flags].sort(),
      status,
      tm: tmTier,
      effect: text?.effect ?? "",
    });
  }
  return moves.sort((x, y) => x.id - y.id);
}

/** Finds the argument nodes of the `x.push(...)` call inside `function <fnName>()`. */
function findPushArgs(sf, fnName) {
  const fn = sf.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === fnName);
  if (!fn) throw new Error(`function ${fnName} not found in ${sf.fileName}`);
  const push = findNodes(
    fn,
    n => ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "push",
  )[0];
  if (!push) throw new Error(`push(...) not found in ${fnName}`);
  return push.arguments;
}

// ================================================================ abilities

function extractAbilities(project, L) {
  const file = "data/abilities/init-abilities.ts";
  const abilities = [];
  for (const node of findPushArgs(project.sourceFile(file), "initAbilities")) {
    const { base, calls } = flattenChain(project.evaluate(node, file));
    if (!(base instanceof New)) continue;
    const [id, gen] = base.args;
    if (!id) continue; // AbilityId.NONE
    const key = project.enumName("AbilityId", id);
    const text = L.ability[toCamelCase(key)];
    const flags = new Set();
    let status = null;
    for (const { name } of calls) {
      if (name === "unimplemented") status = "unimplemented";
      else if (name === "partial" && status !== "unimplemented") status = "partial";
      else if (name === "edgeCase" && !status) status = "edgeCase";
      else if (["ignorable", "uncopiable", "unsuppressable", "unreplaceable", "bypassFaint"].includes(name)) flags.add(name);
    }
    abilities.push({
      id,
      key,
      name: text?.name ?? toTitle(key),
      gen,
      status,
      flags: [...flags].sort(),
      description: text?.description ?? "",
    });
  }
  return abilities.sort((x, y) => x.id - y.id);
}

// ================================================================== species

const STAT_FIELDS = ["baseHp", "baseAtk", "baseDef", "baseSpatk", "baseSpdef", "baseSpd"];

function extractSpecies(project, ctx) {
  const { L, eggMoves, variantMasterlist, typeName, speciesName, moveName, biomeName, enumName, warn } = ctx;
  const configs = [];
  for (const file of project.filesUnder("data/balance/species/")) {
    const sf = project.sourceFile(file);
    const assigns = findNodes(
      sf,
      n =>
        ts.isBinaryExpression(n)
        && n.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && ts.isElementAccessExpression(n.left)
        && ts.isObjectLiteralExpression(n.right),
    );
    for (const node of assigns) configs.push(project.evaluate(node.right, file));
  }

  const formChangeItemName = v => {
    const k = enumName("FormChangeItem", v);
    return L.modifierType.FormChangeItem?.[k] ?? toTitle(k ?? "item");
  };

  const describeTrigger = trig => {
    if (!(trig instanceof New)) return "Special";
    const [arg0, arg1] = trig.args;
    switch (trig.cls) {
      case "SpeciesFormChangeItemTrigger":
        return `Hold ${formChangeItemName(arg0)}`;
      case "SpeciesFormChangeAbilityTrigger":
        return "Ability activation";
      case "SpeciesFormChangeActiveTrigger":
        return arg0 ? "Enters battle" : "Leaves battle";
      case "SpeciesFormChangeManualTrigger":
        return "Manual";
      case "SpeciesFormChangeMoveLearnedTrigger":
        return arg1 === false ? `Forgets ${moveName(arg0)}` : `Learns ${moveName(arg0)}`;
      case "SpeciesFormChangePreMoveTrigger":
        return isNum(arg0) ? `Uses ${moveName(arg0)}` : "Uses an attacking move";
      case "MeloettaFormChangePostMoveTrigger":
        return `After using ${moveName(arg0)}`;
      case "SpeciesFormChangeTeraTrigger":
        return "Terastallizes";
      case "SpeciesFormChangeLapseTeraTrigger":
        return "Terastallization ends";
      case "SpeciesFormChangeWeatherTrigger":
        return `Weather: ${asArray(arg1).map(w => toTitle(enumName("WeatherType", w))).join(" / ")}`;
      case "SpeciesFormChangeRevertWeatherFormTrigger":
        return "Weather ends";
      case "SpeciesFormChangeCompoundTrigger":
        return trig.args.map(describeTrigger).join(" + ");
      default:
        return toTitle(trig.cls.replace(/^SpeciesFormChange|Trigger$/g, "").replace(/([a-z])([A-Z])/g, "$1_$2"));
    }
  };

  const describeCondition = c => {
    const K = project.resolveConst("EvoCondKey", "data/balance/pokemon-evolutions.ts");
    const types = t => `${toTitle(enumName("PokemonType", t))}`;
    switch (c?.key) {
      case K.FRIENDSHIP:
        return { text: `Friendship ≥ ${c.value}` };
      case K.TIME:
        return { text: `Time: ${asArray(c.time).map(t => toTitle(enumName("TimeOfDay", t))).join("/")}` };
      case K.MOVE:
      case K.TYROGUE:
        return { text: `Knows ${moveName(c.move)}`, move: c.move };
      case K.MOVE_TYPE:
        return { text: `Knows a ${types(c.pkmnType)}-type move` };
      case K.PARTY_TYPE:
        return { text: `${types(c.pkmnType)}-type Pokémon in party` };
      case K.WEATHER:
        return { text: `Weather: ${asArray(c.weather).map(w => toTitle(enumName("WeatherType", w))).join("/")}` };
      case K.BIOME:
        return { text: `In ${asArray(c.biome).map(biomeName).join(" / ")}` };
      case K.SHEDINJA:
        return { text: "Empty party slot (and a spare Poké Ball)" };
      case K.EVO_TREASURE_TRACKER:
        return { text: `Holding ${c.value} Relic Gold` };
      case K.RANDOM_FORM:
        return { text: `1/${c.value} chance` };
      case K.SPECIES_CAUGHT:
        return { text: `${speciesName(c.speciesCaught)} caught`, species: c.speciesCaught };
      case K.GENDER:
        return { text: `${toTitle(enumName("Gender", c.gender) ?? "")} only` };
      case K.NATURE:
        return { text: `Nature: ${asArray(c.nature).map(n => toTitle(enumName("Nature", n))).join(", ")}` };
      case K.HELD_ITEM:
        return { text: `Holding ${toTitle(String(c.itemKey))}` };
      default:
        return { text: "Special condition" };
    }
  };

  const variantsFor = spriteKey => {
    const v = variantMasterlist[spriteKey];
    const f = variantMasterlist.female?.[spriteKey];
    const b = variantMasterlist.back?.[spriteKey];
    if (!v && !f) return undefined;
    return { ...(v ? { tiers: v } : {}), ...(f ? { female: f } : {}), ...(b ? { back: b } : {}) };
  };

  const iconIdFor = (id, formSpriteKey) => {
    if (!formSpriteKey) return String(id);
    const key = enumName("SpeciesId", id);
    if (key === "DUDUNSPARCE") return String(id);
    if ((key === "ZACIAN" || key === "ZAMAZENTA") && formSpriteKey.startsWith("behemoth")) return `${id}-crowned`;
    return `${id}-${formSpriteKey}`;
  };

  const out = [];
  for (const cfg of configs) {
    const sp = newArgs(cfg.species);
    const id = sp.id;
    const key = enumName("SpeciesId", id);
    if (!key) {
      warn(`unknown species id ${id}`);
      continue;
    }
    const name = speciesName(id);
    const stats = STAT_FIELDS.map(f => sp[f]);

    const passives =
      cfg.passives == null ? {} : typeof cfg.passives === "object" ? cfg.passives : { 0: cfg.passives };

    const rawForms = asArray(sp.forms).map(newArgs);
    const forms = rawForms.map((f, i) => {
      const spriteKey = f.formSpriteKey ?? f.formKey ?? "";
      const sprite = `${id}${spriteKey ? `-${spriteKey}` : ""}`;
      return {
        name: f.formName,
        key: f.formKey ?? "",
        sprite,
        icon: `${sp.generation}/${iconIdFor(id, spriteKey)}`,
        types: [typeName(f.type1), typeName(f.type2)].filter(Boolean),
        abilities: [f.ability1 ?? 0, f.ability2 ?? 0, f.abilityHidden ?? 0],
        passive: passives[i] ?? passives[0] ?? null,
        stats: STAT_FIELDS.map(s => f[s]),
        bst: f.baseTotal,
        height: f.height,
        weight: f.weight,
        catchRate: f.catchRate,
        selectable: f.isStarterSelectable ?? !f.formKey,
        unobtainable: f.isUnobtainable || undefined,
        genderDiffs: f.genderDiffs || undefined,
        variants: variantsFor(sprite),
      };
    });

    const evolutions = asArray(cfg.evolutions)
      .filter(e => e instanceof New)
      .map(e => {
        const a = newArgs(e);
        const item = a.item ? enumName("EvolutionItem", a.item) : null;
        return {
          to: a.speciesId,
          level: a.level ?? 1,
          ...(a.preFormKey != null ? { fromForm: a.preFormKey } : {}),
          ...(a.evoFormKey != null ? { toForm: a.evoFormKey } : {}),
          ...(item
            ? { item: L.modifierType.EvolutionItem?.[item] ?? toTitle(item), itemTier: a.item > 50 ? "ultra" : "great" }
            : {}),
          conditions: asArray(a.condition).filter(c => c && typeof c === "object" && !(c instanceof Fn)).map(describeCondition),
          ...(Array.isArray(a.evoDelay) ? { delay: a.evoDelay } : {}),
        };
      });

    const formChanges = asArray(cfg.formChanges)
      .filter(fc => fc instanceof New)
      .map(fc => {
        const a = newArgs(fc);
        return { from: a.preFormKey ?? "", to: a.evoFormKey ?? "", trigger: describeTrigger(a.trigger) };
      });

    const learn = list => asArray(list).filter(Array.isArray).map(([lvl, move]) => [lvl, move]);
    const formLevelMoves = cfg.formLevelMoves
      ? Object.fromEntries(Object.entries(cfg.formLevelMoves).map(([k, v]) => [k, learn(v)]))
      : undefined;

    const isStarter = cfg.starterCost != null;
    const spriteKey0 = forms[0] ? forms[0].sprite : String(id);
    out.push({
      id,
      key,
      slug: slugify(key),
      name,
      gen: sp.generation,
      category: sp.category,
      starter: cfg.starter ?? id,
      cost: isStarter ? cfg.starterCost : null,
      eggTier: cfg.eggTier != null ? enumName("EggTier", cfg.eggTier)?.toLowerCase() : null,
      legendary: sp.legendary || undefined,
      subLegendary: sp.subLegendary || undefined,
      mythical: sp.mythical || undefined,
      types: [typeName(sp.type1), typeName(sp.type2)].filter(Boolean),
      abilities: [sp.ability1 ?? 0, sp.ability2 ?? 0, sp.abilityHidden ?? 0],
      passive: passives[0] ?? null,
      stats,
      bst: sp.baseTotal,
      height: sp.height,
      weight: sp.weight,
      catchRate: sp.catchRate,
      friendship: sp.baseFriendship,
      baseExp: sp.baseExp,
      growth: toTitle(enumName("GrowthRate", sp.growthRate) ?? ""),
      malePercent: sp.malePercent ?? null,
      genderDiffs: sp.genderDiffs || undefined,
      sprite: spriteKey0,
      icon: forms[0]?.icon ?? `${sp.generation}/${id}`,
      variants: forms.length ? undefined : variantsFor(String(id)),
      forms,
      evolutions,
      formChanges,
      levelMoves: learn(cfg.levelMoves),
      formLevelMoves,
      tms: asArray(cfg.tms).filter(isNum),
      formTms: cfg.formTms ?? undefined,
      eggMoves: isStarter ? asArray(eggMoves[id]).filter(isNum) : undefined,
      biomes: [],
    });
  }

  // Pre-evolutions, mirroring SpeciesDataRegistry.initPreEvolutions: walk down from every
  // starter, ignoring links that only lead into a Mega form.
  const byId = new Map(out.map(s => [s.id, s]));
  const MEGA_KEYS = new Set(
    ["MEGA", "MEGA_X", "MEGA_Y", "MEGA_Z", "MEGA_ORIGINAL", "MEGA_CURLY", "MEGA_DROOPY", "MEGA_STRETCHY"].map(
      k => project.enumValues("SpeciesFormKey")[k],
    ),
  );
  const setPrevo = (s, seen = new Set()) => {
    if (seen.has(s.id)) return;
    seen.add(s.id);
    for (const evo of s.evolutions) {
      if (evo.toForm && MEGA_KEYS.has(evo.toForm)) continue;
      const target = byId.get(evo.to);
      if (!target) continue;
      target.prevo = s.id;
      setPrevo(target, seen);
    }
  };
  for (const s of out) if (s.starter === s.id) s.prevo = null;
  for (const s of out) if (s.starter === s.id) setPrevo(s);

  // Resolve the *effective* TM and level-up lists the game uses (SpeciesDataRegistry.getTms /
  // getLevelMoves): TMs are inherited from every pre-evolution, and forms can add their own.
  const raw = new Map(out.map(s => [s.id, { tms: s.tms, formTms: s.formTms ?? {}, levelMoves: s.levelMoves, formLevelMoves: s.formLevelMoves ?? {} }]));
  const baseFormKey = s => s.forms[0]?.key ?? "";
  const getTms = (id, formKey, depth = 0) => {
    const s = byId.get(id);
    const r = raw.get(id);
    if (!s || depth > 10) return [];
    const key = formKey ?? baseFormKey(s);
    const list = [...r.tms, ...(r.formTms[key] ?? [])];
    if (s.prevo != null) list.push(...getTms(s.prevo, formKey, depth + 1));
    return [...new Set(list)];
  };
  const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));
  for (const s of out) {
    const r = raw.get(s.id);
    s.tms = getTms(s.id).sort((a, b) => a - b);
    s.levelMoves = [...r.levelMoves, ...(r.formLevelMoves[baseFormKey(s)] ?? [])];
    for (const f of s.forms.slice(1)) {
      const tms = getTms(s.id, f.key);
      if (!sameSet(tms, s.tms)) f.tms = tms.sort((a, b) => a - b);
      if (r.formLevelMoves[f.key]) f.levelMoves = [...r.levelMoves, ...r.formLevelMoves[f.key]];
    }
    delete s.formTms;
    delete s.formLevelMoves;
  }
  return out.sort((a, b) => a.id - b.id);
}

// =================================================================== biomes

function extractBiomes(project, { biomeName, trainerName, enumName, warn }) {
  const biomes = [];
  for (const file of project.filesUnder("data/balance/biomes/")) {
    const consts = project.files.get(file).consts;
    const exportName = [...consts.keys()].find(n => /Biome$/.test(n));
    if (!exportName) {
      warn(`no *Biome export in ${file}`);
      continue;
    }
    const b = project.constIn(file, exportName);
    const tierName = t => enumName("BiomePoolTier", Number(t));
    const timeName = t => enumName("TimeOfDay", Number(t));

    const pokemon = {};
    for (const [tier, times] of Object.entries(b.pokemonPool ?? {})) {
      const tn = tierName(tier);
      for (const [time, ids] of Object.entries(times ?? {})) {
        const list = asArray(ids).filter(isNum);
        if (!list.length) continue;
        pokemon[tn] ??= {};
        pokemon[tn][timeName(time)] = list;
      }
    }
    const trainers = {};
    for (const [tier, list] of Object.entries(b.trainerPool ?? {})) {
      const names = asArray(list).filter(isNum).map(t => ({ id: t, name: trainerName(t) }));
      if (names.length) trainers[tierName(tier)] = names;
    }
    const weights = (pool, enumType) =>
      Object.entries(pool ?? {})
        .map(([k, w]) => ({ name: toTitle(enumName(enumType, Number(k)) ?? k), weight: w }))
        .filter(x => isNum(x.weight) && x.weight > 0);

    biomes.push({
      id: b.biomeId,
      key: enumName("BiomeId", b.biomeId),
      name: biomeName(b.biomeId),
      pokemon,
      trainers,
      trainerChance: b.trainerChance ?? 0,
      weather: weights(b.weatherPool, "WeatherType"),
      terrain: weights(b.terrainPool, "TerrainType"),
      links: asArray(b.biomeLinks).map(l => (Array.isArray(l) ? { to: l[0], chance: l[1] } : { to: l, chance: 1 })),
    });
  }
  return biomes.sort((a, b) => a.id - b.id);
}

// ==================================================================== items

/** `{{placeholder}}` values for class-level description templates, keyed by constructor arg position. */
const ITEM_TEMPLATE_ARGS = {
  PokemonHpRestoreModifierType: { restorePoints: 2, restorePercent: 3 },
  PokemonReviveModifierType: { restorePercent: 2 },
  PokemonPpRestoreModifierType: { restorePoints: 2 },
  PokemonAllMovePpRestoreModifierType: { restorePoints: 2 },
  PokemonPpUpModifierType: { upPoints: 2 },
  DoubleBattleChanceBoosterModifierType: { battleCount: 2 },
  ExpBoosterModifierType: { boostPercent: 2 },
  PokemonExpBoosterModifierType: { boostPercent: 2 },
  MoneyRewardModifierType: {
    // args[3] is a locale key like "modifierType:ModifierType.MoneyRewardModifierType.extra.small"
    moneyMultiplier: (args, mt) => String(args[3] ?? "").replace(/^modifierType:ModifierType\./, "").split(".").reduce((o, k) => o?.[k], mt),
    moneyAmount: args => `×${args[2]}`, // the real amount scales with the wave
  },
  AddVoucherModifierType: { modifierCount: 1 },
  PokemonLevelIncrementModifierType: { levels: () => 1 },
  AllPokemonLevelIncrementModifierType: { levels: () => 1 },
};

/** Constructor args that switch an item to the locale's `extra.fully*` wording (e.g. Max Potion, Max Ether). */
function fullyVariant(cls, args, mt) {
  const extra = mt[cls]?.extra;
  if (!extra) return null;
  if (cls === "PokemonHpRestoreModifierType" && args[2] === 0) return args[4] ? extra.fullyWithStatus : extra.fully;
  if (/PpRestoreModifierType$/.test(cls) && args[2] === -1) return extra.fully;
  return null;
}

/** Representative icons for items that are rolled from a family. */
const GENERATOR_ICONS = {
  EVOLUTION_ITEM: "linking_cord",
  RARE_EVOLUTION_ITEM: "sun_stone",
  FORM_CHANGE_ITEM: "mega_bracelet",
  RARE_FORM_CHANGE_ITEM: "mega_bracelet",
  SPECIES_STAT_BOOSTER: "light_ball",
  RARE_SPECIES_STAT_BOOSTER: "light_ball",
  TEMP_STAT_STAGE_BOOSTER: "x_attack",
  BASE_STAT_BOOSTER: "hp_up",
  ATTACK_TYPE_BOOSTER: "charcoal",
  MINT: "mint_neutral",
  TERA_SHARD: "stellar_tera_shard",
  BERRY: "sitrus_berry",
  TM_COMMON: "tm_normal",
  TM_GREAT: "tm_normal",
  TM_ULTRA: "tm_normal",
};

/** Descriptions for generators built from an inline function rather than a named class. */
const GENERATOR_DESCRIPTIONS_BY_KEY = {
  MINT: "A random Mint that changes a Pokémon's nature.",
  TERA_SHARD: "A random Tera Shard that changes a Pokémon's Tera type (rarely Stellar).",
  BERRY: "A random berry for a party member to hold — Sitrus, Lum and Leppa are the most common.",
};

/** Items rolled from a family ("generators") have no single locale description. */
const GENERATOR_DESCRIPTIONS = {
  EvolutionItemModifierTypeGenerator: "A random evolution item that a party member can use right now.",
  FormChangeItemModifierTypeGenerator: "A random form-change item (Mega Stones, Z-Crystals, etc.) for a party member.",
  TmModifierTypeGenerator: "A random TM compatible with a party member, drawn from this tier's TM pool.",
  AttackTypeBoosterModifierTypeGenerator: "A random type-boosting held item matching a party member's moves.",
  BaseStatBoosterModifierTypeGenerator: "A random vitamin that raises one base stat of a Pokémon.",
  TempStatStageBoosterModifierTypeGenerator: "A random X-item that raises a stat stage for the next 5 battles.",
  BerryModifierTypeGenerator: "A random berry for a party member to hold.",
  SpeciesStatBoosterModifierTypeGenerator: "A species-specific held item (e.g. Light Ball, Thick Club) for a party member.",
  PokemonNatureChangeModifierTypeGenerator: "A Mint that changes a Pokémon's nature.",
  TeraShardModifierTypeGenerator: "A Tera Shard that changes a Pokémon's Tera type.",
};

function extractItems(project, L, warn) {
  const mt = L.modifierType.ModifierType ?? {};
  const typeFile = "modifier/modifier-type.ts";
  const sf = project.sourceFile(typeFile);
  const initDecl = findNodes(sf, n => ts.isVariableDeclaration(n) && n.name.getText() === "modifierTypeInitObj")[0];
  if (!initDecl) {
    warn("modifierTypeInitObj not found — items skipped");
    return [];
  }
  let obj = initDecl.initializer;
  while (obj && !ts.isObjectLiteralExpression(obj)) obj = ts.isCallExpression(obj) ? obj.arguments[0] : obj.expression;

  const items = new Map();
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const key = prop.name.getText();
    const fn = prop.initializer;
    let body = ts.isArrowFunction(fn) ? fn.body : null;
    if (body && ts.isBlock(body)) {
      const ret = body.statements.find(ts.isReturnStatement);
      body = ret?.expression ?? null;
    }
    const value = body ? project.evaluate(body, typeFile) : null;
    const base = value instanceof New ? value : value instanceof Call ? flattenChain(value).base : null;
    let cls = base instanceof New ? base.cls : null;
    const args = base instanceof New ? base.args : [];

    let icon = null;
    let name = mt[key]?.name;
    let description = mt[key]?.description;

    // `new (class extends ModifierType { getDescription() { return i18next.t("…", { x: i18next.t("…") }) } })(…)`
    if (cls?.startsWith("(")) {
      const lookup = path => path.split(".").reduce((o, k) => o?.[k], mt);
      const outer = cls.match(/i18next\.t\(\s*"modifierType:ModifierType\.([\w.]+)"/);
      if (!description && outer) {
        description = lookup(outer[1]) ?? "";
        for (const [, ph, path] of cls.matchAll(/(\w+):\s*i18next\.t\(\s*"modifierType:ModifierType\.([\w.]+)"\s*\)/g)) {
          description = description.replaceAll(`{{${ph}}}`, lookup(path) ?? "");
        }
      }
      cls = "ModifierType";
    }
    description ??= fullyVariant(cls, args, mt);
    if (cls === "AddPokeballModifierType") {
      icon = args[0];
      // Locale keys are "pokeBall"/"greatBall" while the enum is POKEBALL/GREAT_BALL — match loosely.
      const enumKey = (project.enumName("PokeballType", args[1]) ?? key).replace(/_/g, "").toLowerCase();
      const ballName = Object.entries(L.pokeball).find(([k]) => k.toLowerCase() === enumKey)?.[1] ?? toTitle(key);
      name ??= `${ballName} ×${args[2]}`;
      description ??= `Adds ${args[2]} ${ballName}${args[2] > 1 ? "s" : ""} to your bag.`;
    } else if (typeof args[1] === "string") {
      icon = args[1];
    }
    if (!description && cls && mt[cls]?.description) {
      description = mt[cls].description;
      for (const [ph, idx] of Object.entries(ITEM_TEMPLATE_ARGS[cls] ?? {})) {
        const v = typeof idx === "function" ? idx(args, mt) : args[idx];
        if (v != null) description = description.replaceAll(`{{${ph}}}`, v);
      }
    }
    if (!description && cls && GENERATOR_DESCRIPTIONS[cls]) description = GENERATOR_DESCRIPTIONS[cls];
    description ||= GENERATOR_DESCRIPTIONS_BY_KEY[key];
    icon ??= GENERATOR_ICONS[key] ?? null;
    const tmTier = key.match(/^TM_(\w+)$/)?.[1];
    items.set(key, {
      key,
      name: name ?? (tmTier ? `TM (${toTitle(tmTier)})` : toTitle(key)),
      description: (description ?? "")
        .replace(/\s*\(Inventory: \{\{[^}]+\}\}\)/g, "")
        .replace(/\{\{[^}]+\}\}/g, "X")
        .replace(/\s*\n\s*/g, " ")
        .trim(),
      icon: icon ?? null,
      kind: cls?.replace(/ModifierType(Generator)?$/, "") ?? null,
      pools: [],
    });
  }

  // Shop pools: `modifierPool[ModifierTier.X] = [new WeightedModifierType(modifierTypes.KEY, weight, maxWeight), ...]`
  const poolFile = "modifier/init-modifier-pools.ts";
  const poolSf = project.sourceFile(poolFile);
  const assigns = findNodes(
    poolSf,
    n =>
      ts.isBinaryExpression(n)
      && n.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isElementAccessExpression(n.left)
      && /ModifierPool$|^modifierPool$/.test(n.left.expression.getText()),
  );
  for (const node of assigns) {
    const pool = node.left.expression.getText().replace(/ModifierPool$/, "") || "player";
    const tier = project.enumName("ModifierTier", project.evaluate(node.left.argumentExpression, poolFile))?.toLowerCase();
    let rhs = project.evaluate(node.right, poolFile);
    if (rhs instanceof Call && rhs.target !== undefined) rhs = flattenChain(rhs).base;
    for (const entry of asArray(rhs)) {
      if (!(entry instanceof New) || entry.cls !== "WeightedModifierType") continue;
      const ref = entry.args[0];
      const key = ref instanceof Ref ? ref.name.split(".").pop() : null;
      const item = key && items.get(key);
      if (!item) continue;
      const [, weight, maxWeight] = entry.args;
      // Weight helpers like `skipInLastClassicWaveOrDefault(5)` / `lureWeightFunc(10, 2)` take the weight last.
      const helperWeight = weight instanceof Call ? weight.args.filter(isNum).at(-1) : undefined;
      item.pools.push({
        pool: pool === "modifierPool" || pool === "modifier" ? "player" : pool,
        tier,
        weight: isNum(weight) ? weight : null,
        maxWeight: isNum(maxWeight) ? maxWeight : isNum(weight) ? weight : (helperWeight ?? null),
        dynamic: weight instanceof Fn || weight instanceof Call || undefined,
      });
    }
  }
  return [...items.values()];
}
