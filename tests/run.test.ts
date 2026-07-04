import { describe, expect, it } from 'vitest';
import { getCardDef } from '../src/engine/cards';
import { generateMap, getNode } from '../src/engine/map';
import { Run } from '../src/engine/run';
import { Rng } from '../src/engine/rng';
import { greedyPolicy } from '../src/sim/policy';

/** Plays the current battle to completion with the greedy policy. */
function autoBattle(run: Run): void {
  const battle = run.battle!;
  let safety = 1000;
  while (battle.state.phase === 'playerTurn' && safety-- > 0) {
    const action = greedyPolicy(battle);
    if (action.type === 'end') battle.endTurn();
    else battle.playCard(action.index, action.target);
  }
  expect(safety).toBeGreaterThan(0);
  run.resolveBattle();
}

describe('map generation', () => {
  it('produces a well-formed act map for many seeds', () => {
    for (let seed = 0; seed < 50; seed++) {
      const map = generateMap(new Rng(seed));
      const rowCount = map.rows.length;

      // Single boss on the last row, guaranteed rest row before it.
      expect(map.rows[rowCount - 1]).toHaveLength(1);
      expect(map.rows[rowCount - 1]![0]!.kind).toBe('boss');
      for (const node of map.rows[rowCount - 2]!) expect(node.kind).toBe('rest');
      for (const node of map.rows[0]!) expect(node.kind).toBe('battle');

      const inbound = new Set<string>();
      for (let r = 0; r < rowCount; r++) {
        for (const node of map.rows[r]!) {
          // No elites before the minimum row.
          if (r < 3) expect(node.kind).not.toBe('elite');
          if (r < rowCount - 1) {
            // Every non-boss node leads somewhere on the next row.
            expect(node.next.length).toBeGreaterThan(0);
            for (const id of node.next) {
              expect(getNode(map, id).row).toBe(r + 1);
              inbound.add(id);
            }
          } else {
            expect(node.next).toHaveLength(0);
          }
          // Every non-start node is reachable.
          if (r > 0) expect(inbound.has(node.id)).toBe(true);
        }
      }
    }
  });

  it('follows the StS room rules: forked start, no chained specials, no rest under the campfire row', () => {
    for (let seed = 0; seed < 50; seed++) {
      const map = generateMap(new Rng(seed));
      const rowCount = map.rows.length;

      // At least two distinct starting nodes (the first two walks fork).
      expect(map.rows[0]!.length).toBeGreaterThanOrEqual(2);

      // The row right below the guaranteed campfire row never has a rest site.
      for (const node of map.rows[rowCount - 3]!) expect(node.kind).not.toBe('rest');

      // Elite / shop / rest never directly follow the same kind along a path.
      for (let r = 0; r < rowCount - 2; r++) {
        for (const node of map.rows[r]!) {
          if (!['elite', 'shop', 'rest'].includes(node.kind)) continue;
          if (r + 1 === rowCount - 2) continue; // next row is the forced campfire row
          for (const id of node.next) {
            expect(getNode(map, id).kind).not.toBe(node.kind);
          }
        }
      }
    }
  });

  it('edges never cross between adjacent rows', () => {
    for (let seed = 0; seed < 50; seed++) {
      const map = generateMap(new Rng(seed));
      for (let r = 0; r < map.rows.length - 1; r++) {
        const edges: [number, number][] = [];
        for (const node of map.rows[r]!) {
          for (const id of node.next) edges.push([node.col, getNode(map, id).col]);
        }
        for (const [a1, b1] of edges) {
          for (const [a2, b2] of edges) {
            const crossing = (a1 < a2 && b1 > b2) || (a1 > a2 && b1 < b2);
            expect(crossing).toBe(false);
          }
        }
      }
    }
  });
});

describe('run flow', () => {
  it('carries HP and deck through a battle and offers rewards', () => {
    const run = new Run(5);
    expect(run.phase).toBe('map');
    expect(run.deck).toHaveLength(10);

    const first = run.availableNodes()[0]!;
    run.enterNode(first.id);
    expect(run.phase).toBe('battle');

    autoBattle(run);
    expect(run.phase).toBe('reward');
    expect(run.hp).toBeLessThanOrEqual(80);
    expect(run.hp).toBeGreaterThan(0);
    expect(run.reward!.cards).toHaveLength(3);
    expect(run.reward!.gold).toBeGreaterThan(0);

    const pick = run.reward!.cards[0]!;
    run.pickReward(pick);
    expect(run.deck).toHaveLength(11);
    expect(run.deck[10]!.defId).toBe(pick);
    expect(run.phase).toBe('map');

    // Next choices come from the entered node's edges.
    const next = run.availableNodes();
    expect(next.length).toBeGreaterThan(0);
    expect(getNode(run.map, first.id).next).toContain(next[0]!.id);
  });

  it('skipping a reward keeps the deck unchanged', () => {
    const run = new Run(6);
    run.enterNode(run.availableNodes()[0]!.id);
    autoBattle(run);
    run.pickReward(null);
    expect(run.deck).toHaveLength(10);
    expect(run.phase).toBe('map');
  });

  it('reward cards are distinct and never unplayable or starter', () => {
    for (let seed = 0; seed < 30; seed++) {
      const run = new Run(100 + seed);
      run.enterNode(run.availableNodes()[0]!.id);
      autoBattle(run);
      if (run.phase !== 'reward') continue; // rare defeat, skip
      const rewards = run.reward!.cards;
      expect(new Set(rewards).size).toBe(rewards.length);
      for (const id of rewards) {
        const def = getCardDef(id);
        expect(def.unplayable).toBeFalsy();
        expect(def.rarity).not.toBe('starter');
        expect(def.rarity).not.toBe('special');
      }
    }
  });

  it('campfire heals 30% capped at max HP', () => {
    const run = new Run(7);
    run.phase = 'rest';
    run.hp = 40;
    run.restHeal();
    expect(run.hp).toBe(64);
    expect(run.phase).toBe('map');

    run.phase = 'rest';
    run.hp = 70;
    run.restHeal();
    expect(run.hp).toBe(80);
  });

  it('campfire upgrade marks the card and rejects double upgrades', () => {
    const run = new Run(8);
    run.phase = 'rest';
    expect(run.canUpgrade(0)).toBe(true);
    run.restUpgrade(0);
    expect(run.deck[0]!.upgraded).toBe(true);
    expect(run.phase).toBe('map');

    run.phase = 'rest';
    expect(run.canUpgrade(0)).toBe(false);
    expect(() => run.restUpgrade(0)).toThrow();
  });

  it('full runs always terminate in victory or defeat', () => {
    let maxAct = 1;
    for (let seed = 0; seed < 20; seed++) {
      const run = new Run(1000 + seed);
      let guard = 400;
      while (run.phase !== 'victory' && run.phase !== 'defeat' && guard-- > 0) {
        maxAct = Math.max(maxAct, run.act);
        switch (run.phase) {
          case 'map':
            run.enterNode(run.rng.pick(run.availableNodes()).id);
            break;
          case 'battle':
            autoBattle(run);
            break;
          case 'reward':
          case 'actTransition':
            run.pickReward(run.reward!.cards[0] ?? null);
            break;
          case 'rest': {
            const upIdx = run.deck.findIndex((_, i) => run.canUpgrade(i));
            if (run.hp < run.maxHp * 0.6 || upIdx < 0) run.restHeal();
            else run.restUpgrade(upIdx);
            break;
          }
          case 'event': {
            const idx = run.currentEvent!.choices.findIndex((_, i) => run.canChooseEventOption(i));
            run.chooseEventOption(idx);
            run.leaveEvent();
            break;
          }
          case 'shop': {
            // Buy the first affordable card, then leave.
            const buyable = run.shop!.cards.findIndex((c) => !c.sold && run.gold >= c.price);
            if (buyable >= 0) run.buyCard(buyable);
            run.leaveShop();
            break;
          }
        }
      }
      expect(guard).toBeGreaterThan(0);
    }
    // The greedy policy should at least clear act 1 sometimes.
    expect(maxAct).toBeGreaterThanOrEqual(2);
  });
});
