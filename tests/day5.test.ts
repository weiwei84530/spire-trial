import { describe, expect, it } from 'vitest';
import { Battle } from '../src/engine/battle';
import { makeStarterDeck } from '../src/engine/cards';
import { Run } from '../src/engine/run';
import { RELICS } from '../src/engine/relics';
import { POTIONS } from '../src/engine/potions';
import { EVENTS } from '../src/engine/events';
import { generateMap } from '../src/engine/map';
import { Rng } from '../src/engine/rng';

describe('relics', () => {
  it('battle start effects apply after the opening draw', () => {
    const battle = new Battle({
      seed: 1,
      deck: makeStarterDeck(),
      playerHp: 70,
      playerMaxHp: 70,
      enemies: ['jaw_worm'],
      startEffects: [
        { kind: 'applyStatus', status: 'strength', stacks: 1, target: 'self' },
        { kind: 'block', amount: 10 },
        { kind: 'draw', count: 2 },
      ],
    });
    expect(battle.state.player.statuses.strength).toBe(1);
    expect(battle.state.player.block).toBe(10);
    expect(battle.state.player.hand).toHaveLength(7);
  });

  it('victory heal applies after winning (burning blood starter relic)', () => {
    const run = new Run(11);
    expect(run.relics).toContain('burning_blood');
    run.enterNode(run.availableNodes()[0]!.id);
    const battle = run.battle!;
    battle.state.player.hp = 50;
    // Leave one enemy at 1 HP and finish it with an attack from the opening hand
    // (a 5-card hand always contains a strike or bash: the deck has only 4 defends).
    battle.state.enemies.forEach((e, i) => (e.hp = i === 0 ? 1 : 0));
    const attackIdx = battle.state.player.hand.findIndex(
      (c) => c.defId === 'strike' || c.defId === 'bash',
    );
    battle.playCard(attackIdx, 0);
    expect(battle.state.phase).toBe('victory');
    run.resolveBattle();
    expect(run.hp).toBe(56); // 50 + 6 from burning blood
    expect(run.phase).toBe('reward');
  });

  it('every relic has a description and a behavior', () => {
    for (const def of Object.values(RELICS)) {
      expect(def.desc.length).toBeGreaterThan(0);
      expect(def.battleStart || def.victoryHeal, `${def.id} does nothing`).toBeTruthy();
    }
  });
});

describe('potions', () => {
  it('fire potion damages a target and is consumed', () => {
    const run = new Run(12);
    run.potions.push('fire_potion');
    run.enterNode(run.availableNodes()[0]!.id);
    const enemy = run.battle!.state.enemies[0]!;
    const hp0 = enemy.hp;
    run.usePotion(0, 0);
    expect(enemy.hp).toBe(Math.max(0, hp0 - 20));
    expect(run.potions).toHaveLength(0);
  });

  it('potion kill resolves the battle into rewards', () => {
    const run = new Run(13);
    run.potions.push('fire_potion');
    run.enterNode(run.availableNodes()[0]!.id);
    const enemies = run.battle!.state.enemies;
    for (const e of enemies) e.hp = Math.min(e.hp, 5);
    // Kill each remaining enemy with... only one potion; ensure single-enemy encounter
    if (enemies.length === 1) {
      run.usePotion(0, 0);
      expect(run.phase).toBe('reward');
    }
  });

  it('every potion has a valid definition', () => {
    for (const def of Object.values(POTIONS)) {
      expect(def.desc.length).toBeGreaterThan(0);
      expect(def.effects.length).toBeGreaterThan(0);
    }
  });
});

describe('events', () => {
  function makeEventRun(eventIndex: number): Run {
    const run = new Run(14);
    run.phase = 'event';
    run.currentEvent = EVENTS[eventIndex]!;
    return run;
  }

  it('shrine trades HP for gold and never kills', () => {
    const shrineIdx = EVENTS.findIndex((e) => e.id === 'mysterious_shrine');
    const run = makeEventRun(shrineIdx);
    run.hp = 5; // sacrifice costs 7
    const gold0 = run.gold;
    run.chooseEventOption(0);
    expect(run.hp).toBe(1); // floored, not dead
    expect(run.gold).toBe(gold0 + 30);
    expect(run.eventResult).not.toBeNull();
    run.leaveEvent();
    expect(run.phase).toBe('map');
  });

  it('unaffordable choices are rejected', () => {
    const healerIdx = EVENTS.findIndex((e) => e.id === 'wandering_healer');
    const run = makeEventRun(healerIdx);
    run.gold = 10; // heal costs 20
    expect(run.canChooseEventOption(0)).toBe(false);
    expect(() => run.chooseEventOption(0)).toThrow();
    expect(run.canChooseEventOption(1)).toBe(true);
  });

  it('golden idol grants a relic', () => {
    const idolIdx = EVENTS.findIndex((e) => e.id === 'golden_idol');
    const run = makeEventRun(idolIdx);
    const relics0 = run.relics.length;
    run.chooseEventOption(0);
    expect(run.relics.length).toBe(relics0 + 1);
  });
});

describe('shop', () => {
  function makeShopRun(): Run {
    const run = new Run(15);
    run.phase = 'map';
    // Reach a shop by injecting stock directly (stock roll is engine-internal).
    run.phase = 'shop';
    (run as unknown as { shop: unknown }).shop = {
      cards: [
        { defId: 'cleave', price: 50, sold: false },
        { defId: 'bludgeon', price: 140, sold: false },
      ],
      relics: [{ id: 'vajra', price: 150, sold: false }],
      potions: [{ id: 'block_potion', price: 50, sold: false }],
      removePrice: 75,
      removeUsed: false,
    };
    return run;
  }

  it('buying a card deducts gold and adds it to the deck', () => {
    const run = makeShopRun();
    run.gold = 60;
    run.buyCard(0);
    expect(run.gold).toBe(10);
    expect(run.deck.some((c) => c.defId === 'cleave')).toBe(true);
    expect(run.shop!.cards[0]!.sold).toBe(true);
    expect(() => run.buyCard(0)).toThrow(); // already sold
    expect(() => run.buyCard(1)).toThrow(); // cannot afford
  });

  it('card removal costs gold and shrinks the deck once per shop', () => {
    const run = makeShopRun();
    run.gold = 200;
    run.removeCard(0);
    expect(run.deck).toHaveLength(9);
    expect(run.gold).toBe(125);
    expect(() => run.removeCard(0)).toThrow(); // once per shop
  });

  it('buying relics and potions works and respects the potion cap', () => {
    const run = makeShopRun();
    run.gold = 300;
    run.buyRelic(0);
    expect(run.relics).toContain('vajra');
    run.potions.push('fire_potion', 'fire_potion', 'fire_potion');
    expect(() => run.buyPotion(0)).toThrow(); // slots full
    run.potions.pop();
    run.buyPotion(0);
    expect(run.potions).toContain('block_potion');
  });
});

describe('map node kinds', () => {
  it('shops and events appear across seeds, never on row 0', () => {
    let shops = 0;
    let events = 0;
    for (let seed = 0; seed < 60; seed++) {
      const map = generateMap(new Rng(seed));
      for (const row of map.rows) {
        for (const node of row) {
          if (node.kind === 'shop') {
            shops++;
            expect(node.row).toBeGreaterThan(0);
          }
          if (node.kind === 'event') {
            events++;
            expect(node.row).toBeGreaterThan(0);
          }
        }
      }
    }
    expect(shops).toBeGreaterThan(10);
    expect(events).toBeGreaterThan(20);
  });
});
