# Spire Trial（尖塔試煉）

A *Slay the Spire*–style deck-building roguelike, built as an **experimental vibe-coding project** — the entire game (engine, balance tooling, UI, art, audio) was developed in an AI-assisted workflow over ~18 working days.

**Play it in your browser: <https://weiwei84530.github.io/spire-trial/>**

> ## Disclaimer
>
> This is a **non-commercial, educational experiment**. Its game design is heavily
> inspired by [*Slay the Spire*](https://www.megacrit.com/) by MegaCrit, and it exists
> purely to study (a) roguelike deck-builder mechanics and (b) how far an AI-assisted
> "vibe coding" workflow can go. It is **not affiliated with or endorsed by MegaCrit**,
> and it will never be distributed commercially. All mechanics were reimplemented from
> scratch in TypeScript; no assets or code from the original game are used.
> All artwork and audio are AI-generated (OpenAI Images, ElevenLabs).

## Features

- **Three-act dungeon**: 10-row branching maps with battle / elite / campfire / event / shop / boss nodes.
- **55 obtainable cards** (each with an upgraded version) and **18 enemy types**, including a splitting boss and a final boss with a half-HP enrage.
- **Relics, potions, gold economy, and text events** — a full roguelike resource loop.
- **Deterministic battles**: every random roll goes through a seeded RNG; the same seed always reproduces the same fight.
- **Autosave**: runs save automatically between nodes (localStorage) — close the tab, resume later.
- **Balance simulator**: a greedy-policy AI plays thousands of full runs headlessly to measure win rates that drive tuning (currently ~25% for the greedy bot, targeting ~30%+ for skilled humans).
- Fully AI-generated art set (126 images) and audio set (14 SFX + 4 looping BGM tracks + stingers), damage floats, screen shake, Web Audio music layer with crossfade.

The in-game language is currently Traditional Chinese; an English localization with an in-game language toggle is planned.

## Quick start

```bash
npm install
npm run dev    # http://localhost:5173
```

Other commands:

```bash
npm test                                # vitest (90 tests)
npm run build                           # type check + production build
npm run sim                             # balance benchmarks + full-run win rate
npm run sim -- --runs 500 --full 1000   # custom simulation counts
```

## Architecture

```
src/engine/   Pure logic, zero DOM imports
  rng.ts        seeded RNG (mulberry32)
  types.ts      core types incl. the Effect union (new cards = compose existing atomic effects)
  statuses.ts   status effects & damage formula (StS rules)
  cards.ts      card database
  enemies.ts    enemy database (sequence/weighted AI, on-death splits, half-HP enrage)
  battle.ts     single-battle state machine
  map.ts        branching map generation
  run.ts        run-level state machine (map -> node -> reward -> act transition)
  relics.ts / potions.ts / events.ts
src/sim/      balance simulation (greedy policy, full-run simulator)
src/ui/       DOM rendering layer (app.ts is the only file that touches the DOM),
              sound (file-based SFX + looping BGM), storage (localStorage saves)
scripts/      asset pipelines: generate-art.ts / generate-audio.ts (prompts in version
              control, reproducible) + optimize-art.ts / optimize-audio.ts
tests/        vitest suites
docs/         design docs (rules of record: docs/DESIGN.md)
```

Design principles: logic/presentation separation, data-driven content, all randomness reproducible.
Development history (in Traditional Chinese) lives in [PROGRESS.md](PROGRESS.md).

## License

Code is released under the [MIT License](LICENSE). Game-design concepts referenced from
*Slay the Spire* remain the property of MegaCrit; see the disclaimer above.
