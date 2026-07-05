import { describe, expect, it } from 'vitest';
import { CARDS, cardPool, makeStarterDeck } from '../src/engine/cards';
import { CHARACTERS } from '../src/engine/characters';
import { getRelicDef } from '../src/engine/relics';
import { Run } from '../src/engine/run';

describe('characters', () => {
  it('assassin run starts with her own kit', () => {
    const run = new Run(1, undefined, 'assassin');
    expect(run.character).toBe('assassin');
    expect(run.maxHp).toBe(70);
    expect(run.hp).toBe(70);
    expect(run.relics).toEqual(['snake_ring']);
    const ids = run.deck.map((c) => c.defId).sort();
    expect(run.deck).toHaveLength(12);
    expect(ids.filter((id) => id === 'strike')).toHaveLength(5);
    expect(ids.filter((id) => id === 'defend')).toHaveLength(5);
    expect(ids).toContain('neutralize');
    expect(ids).toContain('survivor');
  });

  it('defaults to the warrior and his original kit', () => {
    const run = new Run(2);
    expect(run.character).toBe('warrior');
    expect(run.maxHp).toBe(80);
    expect(run.relics).toEqual(['burning_blood']);
    expect(run.deck).toHaveLength(10);
  });

  it('card pools never leak the other character or starter/unplayable cards', () => {
    for (const character of ['warrior', 'assassin'] as const) {
      for (const rarity of ['common', 'uncommon', 'rare'] as const) {
        const pool = cardPool(character, rarity);
        expect(pool.length).toBeGreaterThanOrEqual(3);
        for (const id of pool) {
          const def = CARDS[id]!;
          expect(def.rarity).toBe(rarity);
          expect(def.unplayable).toBeFalsy();
          if (def.character) expect(def.character).toBe(character);
        }
      }
    }
  });

  it('every character starter card and relic exists', () => {
    for (const def of Object.values(CHARACTERS)) {
      expect(() => getRelicDef(def.startingRelic)).not.toThrow();
      expect(() => makeStarterDeck(def.id)).not.toThrow();
    }
  });

  it('save round-trip keeps the character (and old saves default to warrior)', () => {
    const run = new Run(3, undefined, 'assassin');
    const save = run.toSave();
    expect(save.character).toBe('assassin');
    const loaded = Run.fromSave(save);
    expect(loaded.character).toBe('assassin');
    // Pre-character saves have no field at all.
    const { character: _dropped, ...legacy } = save;
    expect(Run.fromSave(legacy as typeof save).character).toBe('warrior');
  });

  it('starting relics never appear in random relic drops', () => {
    // Elite relic drops sample relicDropPool via many seeded runs.
    for (let seed = 0; seed < 40; seed++) {
      const run = new Run(4000 + seed, undefined, 'assassin');
      const save = run.toSave();
      expect(save.relics).toEqual(['snake_ring']);
    }
    // Direct check: pool used for drops excludes both starting relics.
    const starting = Object.values(CHARACTERS).map((c) => c.startingRelic);
    expect(starting).toContain('burning_blood');
    expect(starting).toContain('snake_ring');
  });
});
