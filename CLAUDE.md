# CLAUDE.md — PokéRogue Dex

Notes for AI agents (and humans) working on this repo. Read this before changing anything.

## What this is

An always-up-to-date Pokédex for PokéRogue (https://pokerogue.net), live at
**https://pokeroguedex.vercel.app**. The game's TypeScript source is parsed into JSON by a Node
pipeline (`scripts/`), and a dependency-free static site (`site/`) renders it.

- Game source: https://github.com/pagefaultgames/pokerogue (default branch `beta`; we only use **release tags**)
- Locales/assets are git submodules of the game, pinned per release (`pokerogue-locales`, `pokerogue-assets`).

## Commands

```bash
npm install                      # only dependency: typescript (for the AST parser)
npm run dev                      # local server → http://localhost:5173 (serves site/ + root CHANGELOG.md)
npm run data                     # rebuild site/data from the latest game release (+ diffs for last 4 releases)
npm run data -- --force          # rebuild even if already current (needed after changing the extractor)
npm run data -- --history 0      # skip release diffs (fast iteration on the extractor)
npm run data:check               # only report whether a newer game release exists
npm test                         # node:test unit tests (scripts/test/)
```

Requires **Node 22+** (CI and the updater use 22; the test script relies on `node --test` globs).

## Architecture

```
scripts/build-data.mjs     CLI: fetch → extract → write site/data/*.json + changes/<tag>.json diffs
scripts/lib/sources.mjs    sparse git clone of src/ at a tag; downloads pinned locale + asset JSON → .cache/
scripts/lib/ts-eval.mjs    static evaluator on the TypeScript compiler API (enums, consts, literals,
                           `new X(...)`, builder chains). Unknowns become Ref/New/Call/Fn markers.
scripts/lib/extract.mjs    game data → species, moves, abilities, biomes, items, type chart, rules
scripts/lib/diff.mjs       release-to-release diff powering "What's new → Game updates"
site/assets/js/main.js     hash router, slide-over detail panel, quick search, theme
site/assets/js/lib/        data.js (load + indexes + shared renderers), sprites.js, table.js, dom.js, nav.js
site/assets/js/views/      one module per section; each exports list(el, params) and optionally detail(el, slug, params)
```

Routes: `#/<section>[?filters]` renders a list; `#/<section>/<slug>[?form=…]` opens the detail panel over
the current list. Views keep filters in the URL via `replaceListQuery()` (no re-render).

## Rules

- **Never hand-edit `site/data/`** — it's generated. Fix the extractor and rerun `npm run data -- --force`.
- **Don't regex-scrape game source.** Extend `ts-eval.mjs` / `extract.mjs` instead. Mirror the game's own
  logic and cite the game file in a comment when you do (see `getTms`, sprite keys, `toCamelCase`).
- **The site has no build step and no npm dependencies.** Plain ES modules; keep it that way. Use the
  `html` tagged template from `dom.js` (escapes by default; wrap trusted HTML in `raw()`).
- Match existing style: 2-space indent, double quotes, trailing commas, comments explain *why*.
- Verify UI changes in a real browser at desktop (1440px) and phone (390px) widths: no console errors,
  no horizontal overflow.

## Gotchas learned the hard way

- **TMs are inherited.** Evolved species only list *extra* TMs; the game merges the whole pre-evolution
  chain (`SpeciesDataRegistry.getTms`). Pre-evolutions are computed from starters, skipping Mega links.
- **Some "enums" are `as const` objects** (e.g. `BiomeId`); `enumValues()` falls back to those.
- **Regional forms have ids ≥ 2000** (e.g. Alolan Rattata = 2019). The site shows the National Dex number.
- **Shiny variants:** tier 1 = `shiny/` sprite; tiers 2–3 use the variant masterlist — value `2` means a
  dedicated `variant/<key>_<tier>` sprite, value `1` means recolour the *normal* sprite with
  `variant/<key>.json` palettes. Back/female sprites have their own masterlist entries.
- **Sprites are hot-linked** from raw.githubusercontent.com pinned to the release's `assetsCommit`
  (jsDelivr has ~10 s cold starts; raw sends CORS headers needed for canvas recolouring).
- **Locale keys** = the game's `toCamelCase(ENUM_NAME)`; Poké Ball keys differ (`pokeBall`), matched loosely.
- On Windows Git Bash, prefix commands that pass `#/route` args with `MSYS_NO_PATHCONV=1`, or they get
  rewritten into file paths.

## Deployment & automation

- **Vercel** deploys every push to `main` (`vercel.json`: output `site/`, build copies `CHANGELOG.md` into it).
- **`.github/workflows/update-data.yml`** runs every 6 h: if a new PokéRogue release exists it rebuilds
  data, tests, and commits as `github-actions[bot]` → Vercel redeploys. Optional `VERCEL_DEPLOY_HOOK` secret.
- **`.github/workflows/ci.yml`** runs `npm test` on pushes and PRs.
- The bot commits to `main` on its own — **always `git pull --rebase` before pushing**.

## Versioning (see README → Versioning)

- Two versions: the **dex** (SemVer, `package.json`, currently tagged `v1.0.0`) and the **game data**
  (PokéRogue release in `site/data/meta.json`, updated automatically — never bumps the dex version).
- Every user-facing change gets a line under `## [Unreleased]` in `CHANGELOG.md`. The site renders that
  file on *What's new → Dex changelog* and hides an empty Unreleased section.
- To release: move Unreleased notes into `## [x.y.z] — YYYY-MM-DD`, bump `package.json` + the README badge
  and "What's new?" section, run `npm run data -- --force` (so `meta.json` carries the version), commit,
  `git tag -a vx.y.z`, push the commit and the tag.

## License

AGPL-3.0-only, matching PokéRogue.
