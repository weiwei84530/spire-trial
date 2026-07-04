import { describe, expect, it } from 'vitest';
import { Battle } from '../src/engine/battle';
import { makeCard } from '../src/engine/cards';
import type { ActorRef, BattleEvent } from '../src/engine/types';

/** Deck of n copies of one card, so the opening hand is fully known. */
function deckOf(defId: string, n = 5) {
  return Array.from({ length: n }, () => makeCard(defId));
}

function sameRef(a: ActorRef, b: ActorRef): boolean {
  if (a === 'player' || b === 'player') return a === b;
  return a.enemy === b.enemy;
}

/** Plays hand[0] into the first living enemy while legal, then ends the turn. */
function scriptTurns(battle: Battle, turns: number): void {
  for (let i = 0; i < turns && battle.state.phase === 'playerTurn'; i++) {
    for (;;) {
      const target = battle.state.enemies.findIndex((e) => e.hp > 0);
      if (target < 0 || !battle.canPlay(0, target)) break;
      battle.playCard(0, target);
      if (battle.state.phase !== 'playerTurn') return;
    }
    if (battle.state.phase === 'playerTurn') battle.endTurn();
  }
}

describe('battle event stream', () => {
  it('card play emits playerActionStart, energy spend, then damage with correct accounting', () => {
    const battle = new Battle({
      seed: 1,
      deck: deckOf('strike'),
      playerHp: 70,
      playerMaxHp: 70,
      enemies: ['jaw_worm'],
    });
    const enemy = battle.state.enemies[0]!;
    const hpBefore = enemy.hp;
    const cursor = battle.state.events.length;
    battle.playCard(0, 0);

    const evs = battle.state.events.slice(cursor);
    expect(evs[0]).toEqual({
      type: 'playerActionStart',
      cardDefId: 'strike',
      cardType: 'attack',
      target: 0,
    });
    expect(evs[1]).toEqual({ type: 'energy', delta: -1, total: 2 });
    const dmg = evs.filter((e) => e.type === 'damage');
    expect(dmg).toHaveLength(1);
    expect(dmg[0]).toEqual({
      type: 'damage',
      source: 'player',
      target: { enemy: 0 },
      cause: 'attack',
      amount: 6,
      blocked: 0,
      hpLoss: 6,
      hpAfter: hpBefore - 6,
      blockAfter: 0,
    });
  });

  it('multi-hit attacks emit one damage event per hit with decreasing hpAfter', () => {
    const battle = new Battle({
      seed: 2,
      deck: deckOf('twin_strike'),
      playerHp: 70,
      playerMaxHp: 70,
      enemies: ['jaw_worm'],
    });
    const cursor = battle.state.events.length;
    battle.playCard(0, 0);
    const hits = battle.state.events
      .slice(cursor)
      .filter((e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage');
    expect(hits).toHaveLength(2);
    expect(hits[1]!.hpAfter).toBeLessThan(hits[0]!.hpAfter);
    expect(hits[0]!.hpAfter - hits[1]!.hpLoss).toBe(hits[1]!.hpAfter);
  });

  it('player block absorbs enemy damage with exact blocked/hpLoss split', () => {
    const battle = new Battle({
      seed: 26,
      deck: deckOf('defend'),
      playerHp: 70,
      playerMaxHp: 70,
      enemies: ['cultist'],
    });
    battle.endTurn(); // cultist casts incantation (ritual 3 -> +3 strength at turn end)

    const cursor = battle.state.events.length;
    battle.playCard(0); // Defend: 5 block
    const blockEv = battle.state.events
      .slice(cursor)
      .find((e) => e.type === 'blockGain');
    expect(blockEv).toEqual({ type: 'blockGain', target: 'player', amount: 5, blockAfter: 5 });

    battle.endTurn(); // dark strike: 6 base + 3 strength = 9 into 5 block
    const hit = battle.state.events
      .slice(cursor)
      .find(
        (e): e is Extract<BattleEvent, { type: 'damage' }> =>
          e.type === 'damage' && sameRef(e.target, 'player') && e.cause === 'attack',
      );
    expect(hit).toBeDefined();
    expect(hit!.amount).toBe(9);
    expect(hit!.blocked).toBe(5);
    expect(hit!.hpLoss).toBe(4);
    expect(hit!.hpAfter).toBe(66);
    expect(hit!.blockAfter).toBe(0);
  });

  it('enemy turn emits per-enemy action anchors in order, then the next turnStart and draw', () => {
    const battle = new Battle({
      seed: 5,
      deck: deckOf('defend'),
      playerHp: 70,
      playerMaxHp: 70,
      enemies: ['cultist', 'cultist'],
    });
    const cursor = battle.state.events.length;
    battle.endTurn();
    const evs = battle.state.events.slice(cursor);

    const anchors = evs.filter((e) =>
      ['discardHand', 'enemyActionStart', 'turnStart'].includes(e.type),
    );
    expect(anchors.map((e) => e.type)).toEqual([
      'discardHand',
      'enemyActionStart',
      'enemyActionStart',
      'turnStart',
    ]);
    expect((anchors[1] as { enemy: number }).enemy).toBe(0);
    expect((anchors[2] as { enemy: number }).enemy).toBe(1);

    const turnStartIdx = evs.findIndex((e) => e.type === 'turnStart');
    const drawIdx = evs.findIndex((e) => e.type === 'draw');
    expect(drawIdx).toBeGreaterThan(turnStartIdx);
  });

  it('a kill emits exactly one enemyDeath and battleEnd victory last', () => {
    const battle = new Battle({
      seed: 3,
      deck: deckOf('strike'),
      playerHp: 70,
      playerMaxHp: 70,
      enemies: ['jaw_worm'],
    });
    battle.state.enemies[0]!.hp = 5;
    const cursor = battle.state.events.length;
    battle.playCard(0, 0);

    const evs = battle.state.events.slice(cursor);
    expect(evs.filter((e) => e.type === 'enemyDeath')).toHaveLength(1);
    expect(evs[evs.length - 1]).toEqual({ type: 'battleEnd', result: 'victory' });
  });

  it('death-trigger spawns emit enemySpawn with the new indices', () => {
    const battle = new Battle({
      seed: 4,
      deck: deckOf('strike'),
      playerHp: 80,
      playerMaxHp: 80,
      enemies: ['slime_king'],
    });
    battle.state.enemies[0]!.hp = 1;
    const cursor = battle.state.events.length;
    battle.playCard(0, 0);

    const evs = battle.state.events.slice(cursor);
    expect(evs.some((e) => e.type === 'enemyDeath' && e.enemy === 0)).toBe(true);
    const spawns = evs.filter(
      (e): e is Extract<BattleEvent, { type: 'enemySpawn' }> => e.type === 'enemySpawn',
    );
    expect(spawns.map((s) => [s.enemy, s.defId])).toEqual([
      [1, 'acid_slime'],
      [2, 'spike_slime_m'],
    ]);
    expect(evs.some((e) => e.type === 'battleEnd')).toBe(false);
    expect(battle.state.enemies).toHaveLength(3);
  });

  it('the last hpAfter-bearing event per actor matches final state after a scripted run', () => {
    const battle = new Battle({
      seed: 77,
      deck: [...deckOf('strike', 6), ...deckOf('defend', 4)],
      playerHp: 70,
      playerMaxHp: 70,
      enemies: ['cultist', 'jaw_worm'],
    });
    scriptTurns(battle, 3);

    const lastHp = new Map<string, number>();
    for (const ev of battle.state.events) {
      if (ev.type === 'damage') lastHp.set(JSON.stringify(ev.target), ev.hpAfter);
      if (ev.type === 'heal') lastHp.set(JSON.stringify(ev.target), ev.hpAfter);
    }
    const playerLast = lastHp.get(JSON.stringify('player'));
    if (playerLast !== undefined) expect(playerLast).toBe(battle.state.player.hp);
    battle.state.enemies.forEach((enemy, i) => {
      const last = lastHp.get(JSON.stringify({ enemy: i }));
      if (last !== undefined) expect(last).toBe(enemy.hp);
    });
  });

  it('same seed and script produce identical event streams', () => {
    const build = () => {
      const battle = new Battle({
        seed: 99,
        deck: [...deckOf('strike', 6), ...deckOf('defend', 4)],
        playerHp: 70,
        playerMaxHp: 70,
        enemies: ['cultist', 'jaw_worm'],
      });
      scriptTurns(battle, 3);
      return battle;
    };
    expect(build().state.events).toEqual(build().state.events);
  });

  it('intentOf previews block amounts and statuses for defend/buff moves', () => {
    const battle = new Battle({
      seed: 6,
      deck: deckOf('strike'),
      playerHp: 70,
      playerMaxHp: 70,
      enemies: ['writhing_mass'],
    });
    const enemy = battle.state.enemies[0]!;
    enemy.nextMoveId = 'malleable';
    expect(battle.intentOf(enemy)).toEqual({
      kind: 'defend',
      block: 11,
      statuses: [{ id: 'thorns', stacks: 2, onSelf: true }],
    });
  });

  it('keeps the human-readable string log alongside events', () => {
    const battle = new Battle({
      seed: 7,
      deck: deckOf('strike'),
      playerHp: 70,
      playerMaxHp: 70,
      enemies: ['jaw_worm'],
    });
    battle.playCard(0, 0);
    expect(battle.state.log.some((line) => line.includes('Player plays Strike'))).toBe(true);
  });
});
