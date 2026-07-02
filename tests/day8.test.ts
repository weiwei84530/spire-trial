import { describe, expect, it } from 'vitest';
import { Battle } from '../src/engine/battle';
import { makeCard } from '../src/engine/cards';
import { ENEMIES } from '../src/engine/enemies';
import { Run } from '../src/engine/run';

function battleVs(enemies: string[], seed = 1, hpScale = 1): Battle {
  return new Battle({
    seed,
    deck: Array(10).fill('strike').map((id: string) => makeCard(id)),
    playerHp: 90,
    playerMaxHp: 90,
    enemies,
    enemyHpScale: hpScale,
  });
}

describe('enemy database validation', () => {
  it('every enemy has consistent moves, AI references and death triggers', () => {
    for (const def of Object.values(ENEMIES)) {
      expect(def.hp[0]).toBeLessThanOrEqual(def.hp[1]);
      expect(def.moves.length).toBeGreaterThan(0);
      const moveIds = new Set(def.moves.map((m) => m.id));
      if (def.ai.type === 'sequence') {
        for (const id of def.ai.moves) expect(moveIds.has(id), `${def.id}: ${id}`).toBe(true);
        if (def.ai.loopFrom !== undefined) {
          expect(def.ai.loopFrom).toBeLessThan(def.ai.moves.length);
        }
      } else {
        for (const c of def.ai.choices) {
          expect(moveIds.has(c.move), `${def.id}: ${c.move}`).toBe(true);
          expect(c.weight).toBeGreaterThan(0);
        }
      }
      for (const spawnId of def.onDeath?.spawn ?? []) {
        expect(ENEMIES[spawnId], `${def.id} spawns unknown ${spawnId}`).toBeDefined();
      }
    }
  });
});

describe('death triggers', () => {
  it('slime king splits into two slimes instead of ending the battle', () => {
    const battle = battleVs(['slime_king']);
    battle.state.enemies[0]!.hp = 1;
    battle.playCard(0, 0); // any strike kills it
    expect(battle.state.phase).toBe('playerTurn'); // battle continues
    const names = battle.state.enemies.map((e) => e.defId);
    expect(names).toEqual(['slime_king', 'acid_slime', 'spike_slime_m']);
    expect(battle.state.enemies[0]!.hp).toBe(0);
    expect(battle.aliveEnemies()).toHaveLength(2);
  });

  it('death trigger fires exactly once and spawns scale with act HP', () => {
    const battle = battleVs(['slime_king'], 2, 1.25);
    const king = battle.state.enemies[0]!;
    expect(king.maxHp).toBeGreaterThanOrEqual(119); // 95-100 x 1.25
    king.hp = 1;
    battle.playCard(0, 0);
    const spawned = battle.state.enemies.slice(1);
    expect(spawned).toHaveLength(2);
    // Acid slime base 28-32 -> scaled by 1.25
    expect(spawned[0]!.maxHp).toBeGreaterThanOrEqual(35);
    // Firing again must not duplicate spawns.
    battle.playCard(0, 1);
    battle.playCard(0, 1);
    expect(battle.state.enemies.filter((e) => e.defId === 'slime_king')).toHaveLength(1);
    expect(battle.state.enemies).toHaveLength(3);
  });

  it('killing the spawns wins the battle', () => {
    const battle = battleVs(['slime_king']);
    battle.state.enemies[0]!.hp = 1;
    battle.playCard(0, 0);
    for (const e of battle.state.enemies) e.hp = Math.min(e.hp, 1);
    battle.playCard(0, 1);
    battle.playCard(0, 2);
    expect(battle.state.phase).toBe('victory');
  });

  it('spawned enemies act on the following turn, not the turn they appear', () => {
    const battle = battleVs(['slime_king'], 7);
    // Poison the king so it dies during the enemy phase.
    battle.state.enemies[0]!.hp = 1;
    battle.state.enemies[0]!.statuses.poison = 5;
    const hp0 = battle.state.player.hp;
    battle.endTurn();
    // King died to poison at the start of its action; spawns appeared but did not attack.
    expect(battle.state.enemies).toHaveLength(3);
    expect(battle.state.player.hp).toBe(hp0);
  });
});

describe('act 2 roster', () => {
  it('chosen heals itself with drain', () => {
    const battle = battleVs(['chosen'], 3);
    const chosen = battle.state.enemies[0]!;
    chosen.hp = 20;
    // Force the drain move and run an enemy turn.
    chosen.nextMoveId = 'drain';
    battle.endTurn();
    expect(chosen.hp).toBe(30);
    expect(battle.state.player.statuses.weak).toBe(2);
  });

  it('act 2 battles draw from the act 2 pool', () => {
    const act2Ids = new Set([
      'shelled_parasite',
      'byrd',
      'chosen',
      'snake_plant',
      'centurion',
      'gremlin_nob',
      'slime_king',
    ]);
    for (let seed = 0; seed < 15; seed++) {
      const run = new Run(500 + seed);
      run.act = 2;
      run.enterNode(run.availableNodes()[0]!.id);
      for (const enemy of run.battle!.state.enemies) {
        expect(act2Ids.has(enemy.defId), `${enemy.defId} is not act 2`).toBe(true);
      }
    }
  });
});
