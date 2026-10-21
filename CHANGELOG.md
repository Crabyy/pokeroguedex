# Changelog

All notable changes to **PokéRogue Dex** are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) — see _Versioning_ in the README.

Game-data refreshes (a new PokéRogue release being picked up automatically) don't bump the
dex version; they're listed on the site under **What's new → Game updates**.

## [Unreleased]

## [1.0.0] — 2026-10-22

The first release: a complete, auto-updating dex for PokéRogue **v1.12.1.3**.

### Added

- **Pokémon** — all 1,084 species and every alternate form (Megas, G-Max, regional forms, etc.) in one
  sortable table: types, abilities, hidden ability, passive, base stats, BST and starter cost.
  - Filters for type, generation, starter cost, legendary/mythical status, shiny variants, ability/passive
    and "learns move".
  - Detail page with the game's **animated sprites**, including front/back, female and all three
    **shiny tiers** (variant palettes are recoloured exactly like the game does).
  - Abilities and passive with descriptions, base-stat bars, type defenses, full evolution tree with
    methods (items, friendship, time of day, …), form changes, candy costs and egg tier.
  - Level-up, egg (with the rare 4th egg move) and TM learnsets — TMs include everything inherited from
    pre-evolutions, matching the game.
  - Where to find it: every biome, rarity tier and time of day.
- **Moves** — power, accuracy, PP, priority, target, flags and TM tier, plus PokéRogue's
  implementation status (not implemented / partial / edge cases). Each move lists who learns it and how.
- **Abilities** — descriptions, implementation status, flags (e.g. whether Mold Breaker ignores it), and every
  Pokémon that has it as a regular, hidden or **passive** ability.
- **Biomes** — wild pools by rarity and time of day with odds, boss pools, trainers, weather/terrain
  chances and the routes in and out of each biome.
- **Items** — reward-shop items with tier and roll weight.
- **Type chart** — read straight from the game's damage code, with a dual-type defense calculator.
- **What's new** — an automatically generated, readable diff of every game release (learnset, egg-move,
  passive, stat, biome and item changes), shown alongside the official patch notes.
- Global quick search (`/` or `Ctrl+K`) across Pokémon, moves, abilities, biomes and items.
- Shareable URLs for every page and filter, light/dark themes, keyboard navigation and a mobile-friendly
  layout.
- **Data pipeline** that parses PokéRogue's TypeScript source with the TypeScript compiler API (no
  fragile regexes), pinned to the exact locales/assets commits of each release.
- GitHub Actions that check for new PokéRogue releases every 6 hours and commit fresh data, plus Vercel
  deployment config (`vercel.json`).
- Licensed under the [GNU AGPL-3.0](https://github.com/Crabyy/pokeroguedex/blob/main/LICENSE), matching PokéRogue.

[Unreleased]: https://github.com/Crabyy/pokeroguedex/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Crabyy/pokeroguedex/releases/tag/v1.0.0
