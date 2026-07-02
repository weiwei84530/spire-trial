import { describe, expect, it } from 'vitest';
import { Battle } from '../src/engine/battle';
import { makeCard, makeStarterDeck, resolveCard, CARDS } from '../src/engine/cards';
import { chooseMove, getEnemyDef, ENEMIES } from '../src/engine/enemies';
import { Rng } from '../src/engine/rng';
import { addStatus, calcAttackDamage, calcBlockGain, dealDamage } from '../src/engine/statuses';
import type { Actor } from '../src/engine/types';

function makeActor(hp = 50): Actor {
  return { hp, maxHp: hp, block: 0, statuses: {} };
}

/** Deck of n copies of one card, so the opening hand is fully known. */
function deckOf(defId: string, n = 5) {
  return Array.from({ length: n }, () => makeCard(defId));
}

function findInHand(battle: Battle, defId: string): number {
  const idx = battle.state.player.hand.findIndex((c) => c.defId === defId);
  if (idx < 0) throw new Error(`${defId} not in hand`);
  return idx;
}

describe('Rng', () => {
  it('is reproducible for the same seed', () => {
    const a = new Rng(123);
    const b = new Rng(123);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('int stays within bounds', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng.int(2, 5);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(5);
    }
  });
});

describe('damage and block formulas', () => {
  it('applies strength, weak, vulnerable in StS order', () => {
    const attacker = makeActor();
    const defender = makeActor();
    expect(calcAttackDamage(6, attacker, defender)).toBe(6);

    addStatus(attacker, 'strength', 3);
    expect(calcAttackDamage(6, attacker, defender)).toBe(9);

    addStatus(attacker, 'weak', 1);
    expect(calcAttackDamage(6, attacker, defender)).toBe(6); // floor(9 * 0.75)

    addStatus(defender, 'vulnerable', 1);
    expect(calcAttackDamage(6, attacker, defender)).toBe(9); // floor(6 * 1.5)
  });

  it('never returns negative damage', () => {
    const attacker = makeActor();
    addStatus(attacker, 'strength', -10);
    expect(calcAttackDamage(5, attacker, makeActor())).toBe(0);
  });

  it('block absorbs damage before HP', () => {
    const target = makeActor(20);
    target.block = 8;
    expect(dealDamage(target, 10)).toBe(2);
    expect(target.block).toBe(0);
    expect(target.hp).toBe(18);
  });

  it('dexterity and frail modify block gain', () => {
    const actor = makeActor();
    addStatus(actor, 'dexterity', 3);
    expect(calcBlockGain(5, actor)).toBe(8);
    addStatus(actor, 'frail', 1);
    expect(calcBlockGain(5, actor)).toBe(6); // floor(8 * 0.75)
  });
});

describe('card playing', () => {
  it('spends energy and moves the card to discard', () => {
    const battle = new Battle({
      seed: 1,
      deck: deckOf('strike'),
      playerHp: 70,
      playerMaxHp: 70,
      enemies: ['jaw_worm'],
    });
    const enemyHp = battle.state.enemies[0]!.hp;
    battle.playCard(0, 0);
    expect(battle.state.player.energy).toBe(2);
    expect(battle.state.enemies[0]!.hp).toBe(enemyHp - 6);
    expect(battle.state.player.discardPile).toHaveLength(1);
    expect(battle.state.player.hand).toHaveLength(4);
  });

  it('rejects plays without enough energy', () => {
    const battle = new Battle({
      seed: 1,
      deck: deckOf('bludgeon'), // cost 3
      playerHp: 70,
      playerMaxHp: 70,
      enemies: ['jaw_worm'],
    });
    battle.playCard(0, 0); // energy 3 -> 0
    expect(battle.canPlay(0, 0)).toBe(false);
    expect(() => battle.playCard(0, 0)).toThrow();
  });

  it('rejects targeting a dead enemy', () => {
    const battle = new Battle({
      seed: 1,
      deck: deckOf('strike'),
      playerHp: 70,
      playerMaxHp: 70,
      enemies: ['acid_slime', 'jaw_worm'],
    });
    battle.state.enemies[0]!.hp = 0;
    expect(battle.canPlay(0, 0)).toBe(false);
    expect(battle.canPlay(0, 1)).toBe(true);
  });

  it('bash makes the target take 150% follow-up damage', () => {
    const battle = new Battle({
      seed: 2,
      deck: [makeCard('bash'), ...deckOf('strike', 4)],
      playerHp: 70,
      playerMaxHp: 70,
      enemies: ['jaw_worm'],
    });
    const enemy = battle.state.enemies[0]!;
    const hp0 = enemy.hp;
    battle.playCard(findInHand(battle, 'bash'), 0);
    expect(enemy.hp).toBe(hp0 - 8);
    expect(enemy.statuses.vulnerable).toBe(2);
    battle.playCard(findInHand(battle, 'strike'), 0);
    expect(enemy.hp).toBe(hp0 - 8 - 9); // floor(6 * 1.5)
  });

  it('twin strike hits twice, cleave hits all enemies', () => {
    const battle = new Battle({
      seed: 3,
      deck: [makeCard('twin_strike'), makeCard('cleave'), ...deckOf('defend', 3)],
      playerHp: 70,
      playerMaxHp: 70,
      enemies: ['acid_slime', 'acid_slime'],
    });
    const [e0, e1] = battle.state.enemies as [any, any];
    const hp0 = e0.hp;
    const hp1 = e1.hp;
    battle.playCard(findInHand(battle, 'twin_strike'), 0);
    expect(e0.hp).toBe(hp0 - 10);
    battle.playCard(findInHand(battle, 'cleave'));
    expect(e0.hp).toBe(hp0 - 10 - 8);
    expect(e1.hp).toBe(hp1 - 8);
  });

  it('powers exhaust and their effect persists as a status', () => {
    const battle = new Battle({
      seed: 4,
      deck: [makeCard('inflame'), ...deckOf('strike', 4)],
      playerHp: 70,
      playerMaxHp: 70,
      enemies: ['jaw_worm'],
    });
    const enemy = battle.state.enemies[0]!;
    const hp0 = enemy.hp;
    battle.playCard(findInHand(battle, 'inflame'));
    expect(battle.state.player.exhaustPile).toHaveLength(1);
    expect(battle.state.player.statuses.strength).toBe(2);
    battle.playCard(findInHand(battle, 'strike'), 0);
    expect(enemy.hp).toBe(hp0 - 8);
  });

  it('offering trades HP for energy and cards', () => {
    const battle = new Battle({
      seed: 5,
      deck: [makeCard('offering'), ...deckOf('strike', 7)],
      playerHp: 70,
      playerMaxHp: 70,
      enemies: ['jaw_worm'],
    });
    battle.playCard(findInHand(battle, 'offering'));
    expect(battle.state.player.hp).toBe(64);
    expect(battle.state.player.energy).toBe(5); // 3 - 0 cost + 2
    expect(battle.state.player.hand).toHaveLength(7); // 5 - 1 played + 3 drawn
    expect(battle.state.player.exhaustPile).toHaveLength(1);
  });
});

describe('deck cycling', () => {
  it('reshuffles the discard pile when the draw pile runs out', () => {
    const battle = new Battle({
      seed: 6,
      deck: makeStarterDeck(), // 10 cards
      playerHp: 70,
      playerMaxHp: 70,
      enemies: ['cultist'],
    });
    battle.endTurn(); // discard 5, draw the remaining 5
    expect(battle.state.player.drawPile).toHaveLength(0);
    battle.endTurn(); // must reshuffle 10 discarded cards and draw 5
    expect(battle.state.player.hand).toHaveLength(5);
    expect(battle.state.player.drawPile).toHaveLength(5);
    const total =
      battle.state.player.hand.length +
      battle.state.player.drawPile.length +
      battle.state.player.discardPile.length;
    expect(total).toBe(10);
  });
});

describe('statuses over turns', () => {
  it('poison ticks at the start of the enemy turn and decrements', () => {
    const battle = new Battle({
      seed: 7,
      deck: deckOf('deadly_venom'),
      playerHp: 70,
      playerMaxHp: 70,
      enemies: ['cultist'],
    });
    const enemy = battle.state.enemies[0]!;
    const hp0 = enemy.hp;
    battle.playCard(0, 0);
    expect(enemy.statuses.poison).toBe(5);
    battle.endTurn();
    expect(enemy.hp).toBe(hp0 - 5);
    expect(enemy.statuses.poison).toBe(4);
  });

  it('vulnerable wears off at the end of the owner turn', () => {
    const battle = new Battle({
      seed: 8,
      deck: [makeCard('bash'), ...deckOf('defend', 4)],
      playerHp: 70,
      playerMaxHp: 70,
      enemies: ['cultist'],
    });
    const enemy = battle.state.enemies[0]!;
    battle.playCard(findInHand(battle, 'bash'), 0);
    expect(enemy.statuses.vulnerable).toBe(2);
    battle.endTurn();
    expect(enemy.statuses.vulnerable).toBe(1);
    battle.endTurn();
    expect(enemy.statuses.vulnerable).toBeUndefined();
  });
});

describe('enemy AI', () => {
  it('cultist casts incantation once, then attacks with growing strength', () => {
    const battle = new Battle({
      seed: 9,
      deck: deckOf('defend'),
      playerHp: 70,
      playerMaxHp: 70,
      enemies: ['cultist'],
    });
    const enemy = battle.state.enemies[0]!;
    expect(enemy.nextMoveId).toBe('incantation');

    battle.endTurn(); // incantation: ritual 3, then ritual grants 3 strength
    expect(enemy.statuses.ritual).toBe(3);
    expect(enemy.statuses.strength).toBe(3);
    expect(enemy.nextMoveId).toBe('dark_strike');

    const hp0 = battle.state.player.hp;
    battle.endTurn(); // dark strike: 6 + 3 strength = 9
    expect(battle.state.player.hp).toBe(hp0 - 9);
    expect(enemy.statuses.strength).toBe(6);
    expect(enemy.nextMoveId).toBe('dark_strike');
  });

  it('weighted AI respects maxRepeat', () => {
    const def = getEnemyDef('jaw_worm');
    for (let seed = 0; seed < 200; seed++) {
      // chomp has maxRepeat 1, so after one chomp it can never repeat
      expect(chooseMove(def, ['chomp'], new Rng(seed))).not.toBe('chomp');
      // thrash has maxRepeat 2
      expect(chooseMove(def, ['thrash', 'thrash'], new Rng(seed))).not.toBe('thrash');
    }
  });
});

describe('battle end', () => {
  it('detects victory when all enemies die', () => {
    const battle = new Battle({
      seed: 10,
      deck: deckOf('bludgeon'),
      playerHp: 70,
      playerMaxHp: 70,
      enemies: ['acid_slime'], // 28-32 HP, one bludgeon leaves it low
    });
    battle.state.enemies[0]!.hp = 20;
    battle.playCard(0, 0);
    expect(battle.state.phase).toBe('victory');
  });

  it('detects defeat when the player dies', () => {
    const battle = new Battle({
      seed: 11,
      deck: deckOf('defend'),
      playerHp: 3,
      playerMaxHp: 70,
      enemies: ['cultist'],
    });
    battle.endTurn(); // incantation, no damage yet
    battle.endTurn(); // dark strike 9 > 3 HP
    expect(battle.state.phase).toBe('defeat');
  });
});

describe('card upgrades', () => {
  it('resolveCard applies upgrade overrides and renames', () => {
    const upgraded = resolveCard(makeCard('strike', true));
    expect(upgraded.name).toBe('Strike+');
    expect(upgraded.effects).toEqual([{ kind: 'damage', amount: 9 }]);
    // Base def must not be mutated by resolution.
    expect(CARDS.strike!.effects).toEqual([{ kind: 'damage', amount: 6 }]);
  });

  it('every playable card has an upgrade', () => {
    for (const def of Object.values(CARDS)) {
      if (def.unplayable) continue; // status/curse cards do not upgrade
      expect(def.upgrade, `${def.id} needs an upgrade`).toBeDefined();
    }
  });
});

describe('Day 2 mechanics', () => {
  it('unplayable status/curse cards cannot be played', () => {
    const battle = new Battle({
      seed: 20,
      deck: [makeCard('wound'), makeCard('injury'), ...deckOf('strike', 3)],
      playerHp: 70,
      playerMaxHp: 70,
      enemies: ['jaw_worm'],
    });
    const woundIdx = findInHand(battle, 'wound');
    const injuryIdx = findInHand(battle, 'injury');
    expect(battle.canPlay(woundIdx, 0)).toBe(false);
    expect(battle.canPlay(injuryIdx, 0)).toBe(false);
    expect(() => battle.playCard(woundIdx, 0)).toThrow();
  });

  it('burn deals 2 damage (respecting block) if held at end of turn', () => {
    const battle = new Battle({
      seed: 21,
      deck: [makeCard('burn'), ...deckOf('defend', 4)],
      playerHp: 70,
      playerMaxHp: 70,
      enemies: ['cultist'], // turn 1: incantation, no attack
    });
    battle.endTurn();
    expect(battle.state.player.hp).toBe(68);
  });

  it('whirlwind spends all energy and hits once per point', () => {
    const battle = new Battle({
      seed: 22,
      deck: [makeCard('whirlwind'), ...deckOf('defend', 4)],
      playerHp: 70,
      playerMaxHp: 70,
      enemies: ['jaw_worm'],
    });
    const enemy = battle.state.enemies[0]!;
    const hp0 = enemy.hp;
    const idx = findInHand(battle, 'whirlwind');
    expect(battle.canPlay(idx)).toBe(true); // x-cost is always affordable
    battle.playCard(idx);
    expect(battle.state.player.energy).toBe(0);
    expect(enemy.hp).toBe(hp0 - 15); // 5 damage x 3 energy
  });

  it('innate cards are always in the opening hand', () => {
    for (let seed = 0; seed < 30; seed++) {
      const battle = new Battle({
        seed,
        deck: [...makeStarterDeck(), makeCard('dramatic_entrance')], // 11 cards, draw 5
        playerHp: 70,
        playerMaxHp: 70,
        enemies: ['jaw_worm'],
      });
      expect(battle.state.player.hand.some((c) => c.defId === 'dramatic_entrance')).toBe(true);
    }
  });

  it('metallicize grants block at end of turn that survives into the enemy turn', () => {
    const battle = new Battle({
      seed: 23,
      deck: [makeCard('metallicize'), ...deckOf('defend', 4)],
      playerHp: 70,
      playerMaxHp: 70,
      enemies: ['cultist'],
    });
    battle.playCard(findInHand(battle, 'metallicize'));
    battle.endTurn(); // metallicize: +3 block; cultist casts incantation (no damage)
    const hp0 = battle.state.player.hp;
    battle.endTurn(); // +3 block again, dark strike hits 6+3=9 -> 6 HP through block
    expect(battle.state.player.hp).toBe(hp0 - 6);
  });

  it('thorns damages the attacker once per hit', () => {
    const battle = new Battle({
      seed: 24,
      deck: [makeCard('twin_strike'), ...deckOf('defend', 4)],
      playerHp: 70,
      playerMaxHp: 70,
      enemies: ['jaw_worm'],
    });
    addStatus(battle.state.enemies[0]!, 'thorns', 3);
    battle.playCard(findInHand(battle, 'twin_strike'), 0);
    expect(battle.state.player.hp).toBe(70 - 6); // 3 thorns x 2 hits
  });

  it('corrosive spit adds a wound to the discard pile', () => {
    const battle = new Battle({
      seed: 25,
      // 10 cards so the next draw does not reshuffle the discard pile away.
      deck: deckOf('defend', 10),
      playerHp: 70,
      playerMaxHp: 70,
      enemies: ['acid_slime'],
    });
    battle.state.enemies[0]!.nextMoveId = 'corrosive_spit';
    battle.endTurn();
    expect(battle.state.player.discardPile.some((c) => c.defId === 'wound')).toBe(true);
  });

  it('intentOf previews modified attack damage', () => {
    const battle = new Battle({
      seed: 26,
      deck: deckOf('defend'),
      playerHp: 70,
      playerMaxHp: 70,
      enemies: ['cultist'],
    });
    const enemy = battle.state.enemies[0]!;
    expect(battle.intentOf(enemy)).toEqual({ kind: 'buff' }); // incantation
    battle.endTurn();
    // dark strike: 6 base + 3 strength from ritual
    expect(battle.intentOf(enemy)).toEqual({ kind: 'attack', damage: 9, hits: 1 });
  });
});

describe('balance simulator', () => {
  it('greedy policy reliably beats a single weak enemy', async () => {
    const { simulate } = await import('../src/sim/simulate');
    const result = simulate({
      deck: makeStarterDeck,
      enemies: ['jaw_worm'],
      runs: 100,
      baseSeed: 42,
    });
    expect(result.winRate).toBeGreaterThan(0.95);
    expect(result.avgTurns).toBeGreaterThan(1);
    expect(result.avgHpLoss).toBeLessThan(40);
  });
});

describe('simulation smoke test', () => {
  it('random-policy battles always terminate with consistent state', () => {
    const enemyIds = Object.keys(ENEMIES);
    for (let seed = 0; seed < 200; seed++) {
      const rng = new Rng(seed * 31 + 7);
      const deck = makeStarterDeck();
      const battle = new Battle({
        seed,
        deck,
        playerHp: 80,
        playerMaxHp: 80,
        enemies: [rng.pick(enemyIds), rng.pick(enemyIds)],
      });

      let safety = 500;
      while (battle.state.phase === 'playerTurn' && safety-- > 0) {
        const plays: [number, number | undefined][] = [];
        const alive = battle.state.enemies.findIndex((e) => e.hp > 0);
        for (let i = 0; i < battle.state.player.hand.length; i++) {
          if (battle.canPlay(i, alive)) plays.push([i, alive]);
          else if (battle.canPlay(i)) plays.push([i, undefined]);
        }
        if (plays.length === 0 || rng.next() < 0.2) {
          battle.endTurn();
        } else {
          const [idx, target] = rng.pick(plays);
          battle.playCard(idx, target);
        }
      }

      expect(safety).toBeGreaterThan(0);
      expect(['victory', 'defeat']).toContain(battle.state.phase);

      const p = battle.state.player;
      // Card conservation: cards may be added mid-battle (wounds) but never lost.
      expect(
        p.hand.length + p.drawPile.length + p.discardPile.length + p.exhaustPile.length,
      ).toBeGreaterThanOrEqual(10);
      expect(p.hp).toBeGreaterThanOrEqual(0);
      expect(p.energy).toBeGreaterThanOrEqual(0);
      for (const e of battle.state.enemies) {
        expect(e.hp).toBeGreaterThanOrEqual(0);
        expect(e.hp).toBeLessThanOrEqual(e.maxHp);
      }
    }
  });
});
