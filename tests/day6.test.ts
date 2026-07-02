import { describe, expect, it } from 'vitest';
import { generateMap } from '../src/engine/map';
import { Rng } from '../src/engine/rng';
import { Run } from '../src/engine/run';
import { greedyPolicy } from '../src/sim/policy';

function autoBattle(run: Run): void {
  const battle = run.battle!;
  let safety = 1000;
  while (battle.state.phase === 'playerTurn' && safety-- > 0) {
    const action = greedyPolicy(battle);
    if (action.type === 'end') battle.endTurn();
    else battle.playCard(action.index, action.target);
  }
  run.resolveBattle();
}

describe('rng state persistence', () => {
  it('resumes the exact sequence from a saved state', () => {
    const a = new Rng(123);
    for (let i = 0; i < 57; i++) a.next();
    const b = new Rng(a.getState());
    for (let i = 0; i < 100; i++) expect(b.next()).toBe(a.next());
  });
});

describe('run save/load', () => {
  it('round-trips all fields through JSON', () => {
    const run = new Run(21);
    run.enterNode(run.availableNodes()[0]!.id);
    autoBattle(run);
    if (run.phase === 'reward') run.pickReward(run.reward!.cards[0] ?? null);
    if (run.phase !== 'map') return; // rare early defeat: nothing to save

    run.potions.push('fire_potion');
    run.gold = 123;
    const save = JSON.parse(JSON.stringify(run.toSave()));
    const loaded = Run.fromSave(save);

    expect(loaded.phase).toBe('map');
    expect(loaded.hp).toBe(run.hp);
    expect(loaded.gold).toBe(123);
    expect(loaded.deck.map((c) => c.defId)).toEqual(run.deck.map((c) => c.defId));
    expect(loaded.relics).toEqual(run.relics);
    expect(loaded.potions).toEqual(run.potions);
    expect(loaded.currentNodeId).toBe(run.currentNodeId);
    expect(loaded.visited).toEqual(run.visited);
    expect(loaded.stats).toEqual(run.stats);
    expect(loaded.map.rows.length).toBe(run.map.rows.length);
  });

  it('a loaded run behaves identically to the original (same rng stream)', () => {
    const makeAdvanced = () => {
      const run = new Run(22);
      run.enterNode(run.availableNodes()[0]!.id);
      autoBattle(run);
      if (run.phase === 'reward') run.pickReward(null);
      return run;
    };
    const original = makeAdvanced();
    if (original.phase !== 'map') return;
    const loaded = Run.fromSave(JSON.parse(JSON.stringify(original.toSave())));

    // Entering the same node must produce the identical encounter and battle.
    const nodeId = original.availableNodes()[0]!.id;
    original.enterNode(nodeId);
    loaded.enterNode(nodeId);
    if (original.battle !== null) {
      expect(loaded.battle!.state.enemies.map((e) => [e.defId, e.hp])).toEqual(
        original.battle!.state.enemies.map((e) => [e.defId, e.hp]),
      );
      expect(loaded.battle!.state.player.hand.map((c) => c.defId)).toEqual(
        original.battle!.state.player.hand.map((c) => c.defId),
      );
    } else {
      expect(loaded.phase).toBe(original.phase);
    }
  });

  it('refuses to save mid-battle', () => {
    const run = new Run(23);
    run.enterNode(run.availableNodes()[0]!.id);
    expect(run.phase).toBe('battle');
    expect(() => run.toSave()).toThrow();
  });
});

describe('run stats', () => {
  it('accumulates battles, turns and damage', () => {
    const run = new Run(24);
    run.enterNode(run.availableNodes()[0]!.id);
    autoBattle(run);
    if (run.phase !== 'reward') return;
    expect(run.stats.battlesWon).toBe(1);
    expect(run.stats.turnsTotal).toBeGreaterThan(0);
    // All enemies died, so damage dealt covers their full max HP.
    expect(run.stats.damageDealt).toBeGreaterThan(0);
    expect(run.stats.damageTaken).toBeGreaterThanOrEqual(0);
  });
});

describe('map guarantees', () => {
  it('every act has at least one shop and one event', () => {
    for (let seed = 0; seed < 80; seed++) {
      const map = generateMap(new Rng(seed));
      const kinds = map.rows.flat().map((n) => n.kind);
      expect(kinds, `seed ${seed} lacks a shop`).toContain('shop');
      expect(kinds, `seed ${seed} lacks an event`).toContain('event');
    }
  });
});
