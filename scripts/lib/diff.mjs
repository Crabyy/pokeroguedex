// Computes a human-meaningful diff between two extracted game-data snapshots.
// The result powers the "What's new → Game changes" page of the dex.

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Set-style difference for id lists. */
function listDiff(before = [], after = []) {
  const b = new Set(before);
  const a = new Set(after);
  return { added: [...a].filter(x => !b.has(x)), removed: [...b].filter(x => !a.has(x)) };
}

function fieldChange(field, before, after) {
  return eq(before, after) ? null : { field, before, after };
}

/** Level-up moves as "moveId@level" keys so level changes show up as remove+add. */
const levelKeys = list => (list ?? []).map(([lvl, move]) => `${move}@${lvl}`);

function diffSpeciesForm(prefix, a, b) {
  const out = [];
  for (const f of ["types", "abilities", "passive", "stats"]) {
    const c = fieldChange(prefix + f, a[f], b[f]);
    if (c) out.push(c);
  }
  return out;
}

function diffSpecies(prev, next) {
  const changes = [];
  for (const f of ["cost", "eggTier", "catchRate", "growth"]) {
    const c = fieldChange(f, prev[f], next[f]);
    if (c) changes.push(c);
  }
  changes.push(...diffSpeciesForm("", prev, next));

  const prevForms = new Map(prev.forms.map(f => [f.key, f]));
  for (const form of next.forms) {
    const old = prevForms.get(form.key);
    if (!old || !form.key) continue; // base form already compared above
    changes.push(...diffSpeciesForm(`form:${form.key}:`, old, form));
  }
  const addedForms = next.forms.filter(f => !prevForms.has(f.key)).map(f => f.name);
  if (addedForms.length) changes.push({ field: "forms", added: addedForms, removed: [] });

  const egg = listDiff(prev.eggMoves, next.eggMoves);
  if (egg.added.length || egg.removed.length) changes.push({ field: "eggMoves", ...egg });

  const lvl = listDiff(levelKeys(prev.levelMoves), levelKeys(next.levelMoves));
  if (lvl.added.length || lvl.removed.length) {
    const parse = k => {
      const [move, level] = k.split("@").map(Number);
      return { move, level };
    };
    changes.push({ field: "levelMoves", added: lvl.added.map(parse), removed: lvl.removed.map(parse) });
  }

  const tms = listDiff(prev.tms, next.tms);
  if (tms.added.length || tms.removed.length) changes.push({ field: "tms", ...tms });

  const evoText = s => s.evolutions.map(e => `${e.to}|${e.level}|${e.item ?? ""}|${e.conditions.map(c => c.text).join("+")}`);
  const evo = listDiff(evoText(prev), evoText(next));
  if (evo.added.length || evo.removed.length) changes.push({ field: "evolutions", before: prev.evolutions, after: next.evolutions });

  const biomeKeys = s => s.biomes.map(b => `${b.biome}|${b.tier}`);
  const bio = listDiff(biomeKeys(prev), biomeKeys(next));
  if (bio.added.length || bio.removed.length) {
    const parse = k => {
      const [biome, tier] = k.split("|");
      return { biome: Number(biome), tier };
    };
    changes.push({ field: "biomes", added: bio.added.map(parse), removed: bio.removed.map(parse) });
  }
  return changes;
}

function diffMove(prev, next) {
  const out = [];
  for (const f of ["type", "category", "power", "accuracy", "pp", "chance", "priority", "target", "status", "tm"]) {
    const c = fieldChange(f, prev[f], next[f]);
    if (c) out.push(c);
  }
  const flags = listDiff(prev.flags, next.flags);
  if (flags.added.length || flags.removed.length) out.push({ field: "flags", ...flags });
  if (prev.effect !== next.effect) out.push({ field: "effect", before: prev.effect, after: next.effect });
  return out;
}

function diffAbility(prev, next) {
  const out = [];
  for (const f of ["status"]) {
    const c = fieldChange(f, prev[f], next[f]);
    if (c) out.push(c);
  }
  const flags = listDiff(prev.flags, next.flags);
  if (flags.added.length || flags.removed.length) out.push({ field: "flags", ...flags });
  if (prev.description !== next.description) out.push({ field: "description", before: prev.description, after: next.description });
  return out;
}

function diffBiome(prev, next) {
  const out = [];
  const entries = b =>
    Object.entries(b.pokemon).flatMap(([tier, times]) =>
      Object.entries(times).flatMap(([time, ids]) => ids.map(id => `${id}|${tier}|${time}`)),
    );
  const mons = listDiff(entries(prev), entries(next));
  if (mons.added.length || mons.removed.length) {
    const parse = k => {
      const [id, tier, time] = k.split("|");
      return { species: Number(id), tier, time };
    };
    out.push({ field: "pokemon", added: mons.added.map(parse), removed: mons.removed.map(parse) });
  }
  const linkKeys = b => b.links.map(l => `${l.to}|${l.chance}`);
  const links = listDiff(linkKeys(prev), linkKeys(next));
  if (links.added.length || links.removed.length) out.push({ field: "links", before: prev.links, after: next.links });
  const trainerKeys = b => Object.entries(b.trainers).flatMap(([tier, list]) => list.map(t => `${t.id}|${tier}`));
  const tr = listDiff(trainerKeys(prev), trainerKeys(next));
  if (tr.added.length || tr.removed.length) out.push({ field: "trainers", before: prev.trainers, after: next.trainers });
  for (const f of ["weather", "terrain", "trainerChance"]) {
    const c = fieldChange(f, prev[f], next[f]);
    if (c) out.push(c);
  }
  return out;
}

function diffItem(prev, next) {
  const out = [];
  const pools = i => i.pools.filter(p => p.pool === "player").map(p => `${p.tier}|${p.maxWeight}`);
  if (!eq(pools(prev), pools(next))) out.push({ field: "pools", before: prev.pools, after: next.pools });
  if (prev.description !== next.description) out.push({ field: "description", before: prev.description, after: next.description });
  return out;
}

function diffCollection(prev, next, keyOf, diffFn, describe) {
  const prevMap = new Map(prev.map(x => [keyOf(x), x]));
  const nextMap = new Map(next.map(x => [keyOf(x), x]));
  const added = [...nextMap.keys()].filter(k => !prevMap.has(k)).map(k => describe(nextMap.get(k)));
  const removed = [...prevMap.keys()].filter(k => !nextMap.has(k)).map(k => describe(prevMap.get(k)));
  const changed = [];
  for (const [k, n] of nextMap) {
    const p = prevMap.get(k);
    if (!p) continue;
    const changes = diffFn(p, n);
    if (changes.length) changed.push({ ...describe(n), changes });
  }
  return { added, removed, changed };
}

export function diffGameData(prev, next) {
  const result = {
    species: diffCollection(prev.species, next.species, s => s.key, diffSpecies, s => ({ id: s.id, name: s.name })),
    moves: diffCollection(prev.moves, next.moves, m => m.key, diffMove, m => ({ id: m.id, name: m.name })),
    abilities: diffCollection(prev.abilities, next.abilities, a => a.key, diffAbility, a => ({ id: a.id, name: a.name })),
    biomes: diffCollection(prev.biomes, next.biomes, b => b.key, diffBiome, b => ({ id: b.id, name: b.name })),
    items: diffCollection(prev.items, next.items, i => i.key, diffItem, i => ({ key: i.key, name: i.name })),
  };
  result.summary = Object.fromEntries(
    Object.entries(result).map(([k, v]) => [k, { added: v.added.length, removed: v.removed.length, changed: v.changed.length }]),
  );
  result.total = Object.values(result.summary).reduce((n, s) => n + s.added + s.removed + s.changed, 0);
  return result;
}
