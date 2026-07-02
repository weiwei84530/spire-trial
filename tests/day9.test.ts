import { describe, expect, it } from 'vitest';
import { Battle } from '../src/engine/battle';
import { CARDS, makeCard } from '../src/engine/cards';
import { Run } from '../src/engine/run';
import { simulateFullRuns } from '../src/sim/runSim';

function battleWith(deck: string[], enemies: string[], seed = 1): Battle {
  return new Battle({
    seed,
    deck: deck.map((id) => makeCard(id)),
    playerHp: 90,
    playerMaxHp: 90,
    enemies,
  });
}

function handIdx(battle: Battle, defId: string): number {
  const i = battle.state.player.hand.findIndex((c) => c.defId === defId);
  if (i < 0) throw new Error(`${defId} not in hand`);
  return i;
}

describe('day 9 mechanics', () => {
  it('barricade keeps block across turns', () => {
    const battle = battleWith(
      ['barricade', 'defend', 'defend', 'defend', 'defend'],
      ['cultist'], // incantation first: no attack on turn 1
    );
    battle.state.player.energy = 5;
    battle.playCard(handIdx(battle, 'barricade'));
    battle.playCard(handIdx(battle, 'defend'));
    expect(battle.state.player.block).toBe(5);
    battle.endTurn();
    expect(battle.state.player.block).toBe(5); // survived into the next turn
  });

  it('entrench doubles current block', () => {
    const battle = battleWith(['entrench', 'defend', 'defend', 'defend', 'defend'], ['cultist']);
    battle.playCard(handIdx(battle, 'defend'));
    battle.playCard(handIdx(battle, 'entrench'));
    expect(battle.state.player.block).toBe(10);
  });

  it('noxious fumes poisons every enemy at the start of each player turn', () => {
    const battle = battleWith(
      ['noxious_fumes', 'defend', 'defend', 'defend', 'defend'],
      ['cultist', 'jaw_worm'],
    );
    battle.playCard(handIdx(battle, 'noxious_fumes'));
    battle.endTurn();
    for (const enemy of battle.aliveEnemies()) {
      // 2 stacks applied at turn start, then each enemy's own poison tick happened on its turn.
      expect(enemy.statuses.poison ?? 0).toBeGreaterThanOrEqual(1);
    }
  });

  it('the shadow enrages exactly once at half HP', () => {
    const battle = battleWith(
      ['strike', 'strike', 'strike', 'strike', 'strike'],
      ['the_shadow'],
      3,
    );
    const boss = battle.state.enemies[0]!;
    expect(boss.maxHp).toBeGreaterThanOrEqual(150);
    boss.hp = Math.floor(boss.maxHp / 2) + 4;
    battle.playCard(0, 0); // strike drops it to/below half
    expect(boss.phaseTriggered).toBe(true);
    expect(boss.statuses.strength).toBe(4);
    expect(boss.statuses.ritual).toBe(2);
    expect(boss.nextMoveId).toBe('oblivion');
    const strengthAfterFirst = boss.statuses.strength;
    battle.playCard(0, 0); // hitting again must not re-trigger
    expect(boss.statuses.strength).toBe(strengthAfterFirst);
  });

  it('card pool has reached 55 playable cards', () => {
    const playable = Object.values(CARDS).filter((c) => !c.unplayable);
    expect(playable.length).toBeGreaterThanOrEqual(55);
  });

  it('act 3 battles draw from the act 3 roster', () => {
    const act3Ids = new Set([
      'writhing_mass',
      'orb_walker',
      'spire_growth',
      'darkling',
      'giant_head',
      'the_shadow',
    ]);
    for (let seed = 0; seed < 10; seed++) {
      const run = new Run(900 + seed);
      run.act = 3;
      run.enterNode(run.availableNodes()[0]!.id);
      for (const enemy of run.battle!.state.enemies) {
        expect(act3Ids.has(enemy.defId), `${enemy.defId} is not act 3`).toBe(true);
      }
    }
  });
});

describe('full-run simulator', () => {
  it('runs terminate and produce sane aggregate stats', () => {
    const result = simulateFullRuns(15, 7);
    expect(result.runs).toBe(15);
    expect(result.clearRate).toBeGreaterThanOrEqual(0);
    expect(result.clearRate).toBeLessThanOrEqual(1);
    expect(result.avgActReached).toBeGreaterThanOrEqual(1);
    expect(result.avgFloorsEntered).toBeGreaterThan(3);
    const deaths = Object.values(result.deathsByAct).reduce((a, b) => a + b, 0);
    expect(deaths + Math.round(result.clearRate * result.runs)).toBe(result.runs);
  });
});
