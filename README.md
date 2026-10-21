<div align="center">

# PokéRogue Dex

**The always-up-to-date Pokédex for [PokéRogue](https://pokerogue.net).**

Every species, form, move, ability, biome and item — extracted straight from the latest game release,
rebuilt automatically whenever PokéRogue ships an update.

![Dex version](https://img.shields.io/badge/dex-v1.0.0-f5b83d)
![Game data](https://img.shields.io/badge/game%20data-PokéRogue%20v1.12.1.3-4a9bf8)
![Auto-updated](https://img.shields.io/badge/updates-every%206%20hours-4fd17f)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)

### **[🔗 pokeroguedex.vercel.app](https://pokeroguedex.vercel.app)**

</div>

---

## What's new?

### v1.0.0 — first release (Oct 22, 2026)

- 🧬 **Complete data for PokéRogue v1.12.1.3** — 1,084 species / 1,500 forms, 920 moves, 319 abilities,
  35 biomes and the reward-shop items.
- ✨ **Animated sprites with all three shiny tiers**, front/back and female variants — recoloured exactly like the game does.
- 🔎 **Powerful filters** (type, generation, cost, ability/passive, "learns move" …) and a global quick search (`/`).
- 🗺️ **Biomes** with encounter odds by rarity and time of day, bosses, trainers and route links.
- 📰 **Automatic patch diffs** — the site's _What's new_ page shows exactly which learnsets, egg moves,
  passives, stats and biomes changed in each game release, next to the official patch notes.
- 🔄 **Never goes stale** — a GitHub Action checks for new PokéRogue releases every 6 hours and redeploys.

See the full history in [CHANGELOG.md](CHANGELOG.md) (also on the site under _What's new → Dex changelog_).

---

## Versioning

The project tracks **two independent versions**:

| | Current | Where it's shown | Changes when… |
|---|---|---|---|
| **Dex version** | `v1.0.0` | `package.json`, footer, _What's new_ | the website/tooling changes |
| **Game data version** | PokéRogue `v1.12.1.3` | header pill, `site/data/meta.json` | a new PokéRogue release is picked up |

The dex follows [Semantic Versioning](https://semver.org/):

- **MAJOR** (`2.0.0`) — breaking changes: URL/route scheme or `site/data/*.json` format changes that
  would break links or anyone consuming the data.
- **MINOR** (`1.1.0`) — new features: new pages, filters, data fields or tools.
- **PATCH** (`1.0.1`) — fixes and polish: bug fixes, wording, styling, extraction corrections.

Game-data refreshes are automatic and **don't bump the dex version** — they appear under
_What's new → Game updates_ on the site, with a generated diff for every release.

### Releasing a new dex version

1. Move the entries under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md) into a new `## [x.y.z] — YYYY-MM-DD` section.
2. Bump `"version"` in `package.json` (and the dex badge + _What's new?_ section above).
3. Rebuild data so `meta.json` carries the new version: `npm run data -- --force`.
4. Commit, then tag: `git tag vx.y.z && git push --tags`.

---

## Features

| Section | What you get |
|---|---|
| **Pokémon** | Sortable table of every species & form · types, abilities, hidden ability, **passive**, base stats, BST, starter cost · filters for type, gen, cost, legendary status, shiny variants, ability and "learns move" |
| **Pokémon page** | Animated sprite (normal, ★1–★3 shiny, female, back) · abilities & passive with descriptions · stat bars · type defenses · evolution tree with methods · form changes · candy costs & egg tier · level-up / egg (incl. rare egg move) / TM learnsets · biomes, rarity and time of day |
| **Moves** | Power, accuracy, PP, priority, target, flags, TM tier and **PokéRogue implementation status** · who learns each move and how |
| **Abilities** | Descriptions, implementation status, flags · every Pokémon with it as a regular, hidden or passive ability |
| **Biomes** | Wild & boss pools by rarity and time of day with odds · trainers · weather & terrain · routes in and out |
| **Items** | Reward-shop items with tier and roll weight, and every pool they drop from |
| **Types** | The game's own type chart plus a dual-type defense calculator |
| **What's new** | Auto-generated, human-readable diffs between game releases + official patch notes + dex changelog |

Plus: shareable URLs for every page and filter, light/dark theme, keyboard shortcuts
(`/` or `Ctrl+K` to search, `Esc` to close), and a layout that works on phones.

---

## How it stays up to date

The old community dex regex-scraped PokéRogue's source, so it broke whenever the game was refactored.
This project reads the game's TypeScript **as code** instead:

```
PokéRogue release tag ──► sparse clone of src/ ──► TypeScript AST evaluator ──► site/data/*.json
        │                                             (enums, consts, object literals,
        ├─► locales @ pinned submodule commit          builder chains like
        └─► assets  @ pinned submodule commit          new AttackMove(...).attr(...))
```

- `scripts/lib/ts-eval.mjs` — a small static evaluator built on the TypeScript compiler API. It resolves
  enums (including auto-increment and `as const` objects), constants, computed keys, spreads and
  `new X({...})` expressions into plain data, without executing any game code.
- `scripts/lib/extract.mjs` — turns that into species, moves, abilities, biomes, items, the type chart and
  balance tables, mirroring the game's own logic where it matters (e.g. TMs inherited from
  pre-evolutions, sprite/variant keys, locale keys).
- `scripts/lib/diff.mjs` — compares two releases and produces the _What's new → Game updates_ feed.
- `.github/workflows/update-data.yml` — every 6 hours: if there's a new PokéRogue release, rebuild the
  data and commit it; Vercel redeploys on the new commit.

Sprites and icons are loaded from the official
[pokerogue-assets](https://github.com/pagefaultgames/pokerogue-assets) repository, pinned to the exact
commit used by the game release.

---

## Development

Requires **Node.js 22+** and **git**.

```bash
npm install          # just TypeScript (used by the data pipeline)
npm run data         # build site/data from the latest PokéRogue release (+ diffs for the last 4 releases)
npm run dev          # http://localhost:5173
npm test             # unit tests for the evaluator, extractor helpers, diff and markdown renderer
```

Useful options:

```bash
npm run data -- --tag v1.12.1.3   # build a specific release
npm run data -- --history 8       # generate diffs for more past releases
npm run data -- --force           # rebuild even if data is current
npm run data:check                # only check whether a newer release exists
```

Set `GITHUB_TOKEN` to avoid GitHub API rate limits. Downloaded sources are cached in `.cache/`.

The site itself is dependency-free: plain HTML, CSS and ES modules in `site/` — no build step.

### Project structure

```
site/                     The static website (deployed as-is)
  index.html
  assets/css/main.css
  assets/js/main.js       Router, detail panel, quick search, theme
  assets/js/lib/          Data loading, sprites, table, DOM helpers
  assets/js/views/        One module per section (pokemon, moves, abilities, …)
  data/                   Generated JSON (committed) + changes/ release diffs
scripts/
  build-data.mjs          Data pipeline CLI
  serve.mjs               Local dev server
  lib/                    sources, ts-eval, extract, diff
  test/                   node:test unit tests
.github/workflows/        ci.yml (tests) · update-data.yml (auto-update)
CHANGELOG.md              Dex changelog (rendered on the site)
vercel.json               Vercel deployment config
```

### Deploying (Vercel)

The site is static, so there's nothing to build — `vercel.json` already configures everything:

- **Output directory:** `site`
- **Build command:** copies `CHANGELOG.md` into `site/` so the _Dex changelog_ tab works
- **Install command:** skipped (the site has no dependencies)

1. On [vercel.com](https://vercel.com), choose **Add New → Project** and import this GitHub repository.
2. Leave the framework preset as **Other** — the settings come from `vercel.json`. Click **Deploy**.
3. That's it. Every push to `main` redeploys, including the data commits made by `update-data.yml`.

You can run the updater manually from the **Actions** tab (tick _force_ to rebuild regardless).

> **If Vercel ignores the bot's data commits** (it can skip commits whose author isn't a member of your
> Vercel team), create a Deploy Hook in _Vercel → Project → Settings → Git → Deploy Hooks_ and save its
> URL as a repository secret named `VERCEL_DEPLOY_HOOK`. The updater will call it after each data commit.

---

## Contributing

Issues and pull requests are welcome! If something in the dex doesn't match the game, please open an issue
with the Pokémon/move and the game version shown in the header.

## Credits

- Game data, text and sprites: [PokéRogue](https://github.com/pagefaultgames/pokerogue) by Pagefault Games (AGPL-3.0).
- Inspired by the original community dex at dex.playpokerogue.com.
- Pokémon and all related names are trademarks of Nintendo, Game Freak and The Pokémon Company.
  This is an unofficial fan project and is not affiliated with any of them.

## License

Copyright © 2026 Crabyy and contributors.

PokéRogue Dex is free software, licensed under the
[GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-only) — the same license as PokéRogue,
whose source the dex's data is extracted from. You may use, modify and redistribute it, but if you
run a modified version as a public website you must make your source code available under the same license.
