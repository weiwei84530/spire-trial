/** Tests for the v2 correction batch: map entrances, event rules, potions. */
import { describe, expect, it } from 'vitest';
import { EVENTS, type EventDef } from '../src/engine/events';
import { generateMap, START_NODE_COUNT } from '../src/engine/map';
import { Rng } from '../src/engine/rng';
import { Run } from '../src/engine/run';

/** Puts a run into the event phase with a chosen event, bypassing the map. */
function forceEvent(run: Run, id: string): EventDef {
  const event = EVENTS.find((e) => e.id === id)!;
  run.phase = 'event';
  run.currentEvent = event;
  run.eventResult = null;
  run.eventOutcome = null;
  return event;
}

describe('map layout (A4)', () => {
  it('always generates exactly 5 entrances and a centered boss', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const map = generateMap(new Rng(seed));
      expect(map.rows[0]!.length).toBe(START_NODE_COUNT);
      const bossRow = map.rows[map.rows.length - 1]!;
      expect(bossRow).toHaveLength(1);
      expect(bossRow[0]!.kind).toBe('boss');
      expect(bossRow[0]!.col).toBe(3); // centre of the 7-column grid
    }
  });
});

describe('event drawing (A13)', () => {
  it('never repeats an event until the whole pool has been seen', () => {
    const run = new Run(42);
    const draw = () => (run as unknown as { pickEvent(): EventDef }).pickEvent();
    const firstCycle = Array.from({ length: EVENTS.length }, () => draw().id);
    expect(new Set(firstCycle).size).toBe(EVENTS.length);
  });

  it('never shows the same event twice in a row across pool resets', () => {
    const run = new Run(7);
    const draw = () => (run as unknown as { pickEvent(): EventDef }).pickEvent();
    let prev = draw().id;
    for (let i = 0; i < 40; i++) {
      const next = draw().id;
      expect(next).not.toBe(prev);
      prev = next;
    }
  });

  it('persists seen events through save/load', () => {
    const run = new Run(3);
    run.seenEvents.push('golden_idol', 'ancient_forge');
    const restored = Run.fromSave(run.toSave());
    expect(restored.seenEvents).toEqual(['golden_idol', 'ancient_forge']);
  });
});

describe('event outcomes (A13)', () => {
  it('reports the real HP/gold deltas and floors HP at 1', () => {
    const run = new Run(1);
    run.hp = 5;
    forceEvent(run, 'golden_idol');
    run.chooseEventOption(0); // lose 8 HP, gain a relic
    expect(run.hp).toBe(1); // floored, not dead
    expect(run.eventOutcome!.hp).toBe(-4); // the real loss, not the printed 8
    expect(run.eventOutcome!.relic).not.toBeNull();
    expect(run.relics).toContain(run.eventOutcome!.relic);
  });

  it('reports nothing for a pure "leave" choice', () => {
    const run = new Run(1);
    forceEvent(run, 'golden_idol');
    run.chooseEventOption(1);
    expect(run.eventOutcome).toEqual({
      hp: 0,
      gold: 0,
      relic: null,
      upgradedCard: null,
      potion: null,
    });
  });

  it('can roll a potion from the abandoned cart', () => {
    let found = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const run = new Run(seed);
      forceEvent(run, 'abandoned_cart');
      run.chooseEventOption(0);
      expect(run.gold).toBe(99 + 15);
      if (run.eventOutcome!.potion) {
        expect(run.potions).toContain(run.eventOutcome!.potion);
        found++;
      }
    }
    expect(found).toBeGreaterThan(0); // ~50% chance across 30 seeds
    expect(found).toBeLessThan(30);
  });
});

describe('potions outside battle (B13)', () => {
  it('heals 20% of max HP from the map and consumes the potion', () => {
    const run = new Run(5);
    run.hp = 50;
    run.potions.push('healing_potion');
    run.usePotion(0);
    expect(run.hp).toBe(50 + Math.floor(run.maxHp * 0.2));
    expect(run.potions).toHaveLength(0);
  });

  it('caps healing at max HP', () => {
    const run = new Run(5);
    run.hp = run.maxHp - 3;
    run.potions.push('healing_potion');
    run.usePotion(0);
    expect(run.hp).toBe(run.maxHp);
  });

  it('rejects battle-only potions outside battle', () => {
    const run = new Run(5);
    run.potions.push('fire_potion');
    expect(() => run.usePotion(0)).toThrow(/battle-only/);
    expect(run.potions).toHaveLength(1);
  });
});
