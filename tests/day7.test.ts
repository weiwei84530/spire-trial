import { describe, expect, it } from 'vitest';
import { Battle } from '../src/engine/battle';
import { CARDS, makeCard } from '../src/engine/cards';
import { ACT_COUNT, actHpScale, Run } from '../src/engine/run';
import type { CardRarity } from '../src/engine/types';

function battleWith(deck: string[], enemies: string[] = ['jaw_worm'], seed = 1): Battle {
  return new Battle({
    seed,
    deck: deck.map((id) => makeCard(id)),
    playerHp: 70,
    playerMaxHp: 70,
    enemies,
  });
}

function handIdx(battle: Battle, defId: string): number {
  const i = battle.state.player.hand.findIndex((c) => c.defId === defId);
  if (i < 0) throw new Error(`${defId} not in hand`);
  return i;
}

describe('day 7 cards', () => {
  it('anger adds a copy of itself to the discard pile', () => {
    const battle = battleWith(['anger', 'defend', 'defend', 'defend', 'defend']);
    battle.playCard(handIdx(battle, 'anger'), 0);
    const angers = battle.state.player.discardPile.filter((c) => c.defId === 'anger');
    expect(angers).toHaveLength(2); // the played card + the created copy
  });

  it('blade dance puts shivs directly into hand and they exhaust', () => {
    const battle = battleWith(['blade_dance', 'defend', 'defend', 'defend', 'defend']);
    battle.playCard(handIdx(battle, 'blade_dance'));
    const shivs = battle.state.player.hand.filter((c) => c.defId === 'shiv');
    expect(shivs).toHaveLength(3);
    const enemy = battle.state.enemies[0]!;
    const hp0 = enemy.hp;
    battle.playCard(handIdx(battle, 'shiv'), 0);
    expect(enemy.hp).toBe(hp0 - 4);
    expect(battle.state.player.exhaustPile.some((c) => c.defId === 'shiv')).toBe(true);
  });

  it('demon form grants strength at the end of every player turn', () => {
    const battle = battleWith(['demon_form', 'defend', 'defend', 'defend', 'defend'], ['cultist']);
    battle.playCard(handIdx(battle, 'demon_form'));
    expect(battle.state.player.statuses.ritual).toBe(2);
    battle.endTurn();
    expect(battle.state.player.statuses.strength).toBe(2);
    battle.endTurn();
    expect(battle.state.player.statuses.strength).toBe(4);
  });

  it('berserk gives extra energy every turn at the cost of vulnerable', () => {
    const battle = battleWith(['berserk', 'defend', 'defend', 'defend', 'defend'], ['cultist']);
    battle.playCard(handIdx(battle, 'berserk'));
    expect(battle.state.player.statuses.vulnerable).toBe(2);
    battle.endTurn();
    expect(battle.state.player.energy).toBe(4); // 3 + 1 energized
  });

  it('wild strike shuffles a wound into the draw pile', () => {
    const battle = battleWith(['wild_strike', ...Array(9).fill('defend')]);
    battle.playCard(handIdx(battle, 'wild_strike'), 0);
    expect(battle.state.player.drawPile.some((c) => c.defId === 'wound')).toBe(true);
  });

  it('disarm reduces enemy strength below zero', () => {
    const battle = battleWith(['disarm', 'defend', 'defend', 'defend', 'defend']);
    battle.playCard(handIdx(battle, 'disarm'), 0);
    expect(battle.state.enemies[0]!.statuses.strength).toBe(-2);
    expect(battle.state.player.exhaustPile).toHaveLength(1);
  });

  it('card pool has reached 40 playable cards with sane rarities', () => {
    const playable = Object.values(CARDS).filter((c) => !c.unplayable);
    expect(playable.length).toBeGreaterThanOrEqual(40);
    const rarities: Record<string, number> = {};
    for (const c of playable) rarities[c.rarity] = (rarities[c.rarity] ?? 0) + 1;
    expect(rarities.common).toBeGreaterThanOrEqual(12);
    expect(rarities.uncommon).toBeGreaterThanOrEqual(10);
    expect(rarities.rare as number).toBeGreaterThanOrEqual(5);
    const rewardable: CardRarity[] = ['common', 'uncommon', 'rare'];
    // Shivs and other special cards must stay out of the reward pool.
    for (const c of playable) {
      if (c.rarity === 'special' || c.rarity === 'starter') {
        expect(rewardable).not.toContain(c.rarity);
      }
    }
  });
});

describe('multi-act runs', () => {
  it('act HP scaling is neutral (all acts have native rosters) but the hook works', () => {
    expect(actHpScale(1)).toBe(1);
    expect(actHpScale(2)).toBe(1);
    expect(actHpScale(3)).toBe(1);
    const b1 = new Battle({
      seed: 5,
      deck: ['strike', 'strike', 'strike', 'strike', 'strike'].map((id) => makeCard(id)),
      playerHp: 70,
      playerMaxHp: 70,
      enemies: ['jaw_worm'],
      enemyHpScale: 2,
    });
    expect(b1.state.enemies[0]!.maxHp).toBeGreaterThanOrEqual(80); // 40-44 doubled
  });

  it('beating a non-final boss transitions to the next act with full HP and a fresh map', () => {
    const run = new Run(31);
    // Teleport to the boss: enter a first node legitimately, then jump.
    run.enterNode(run.availableNodes()[0]!.id);
    const battle = run.battle!;
    // Point the current node at the boss and force a win.
    const bossId = run.map.rows[run.map.rows.length - 1]![0]!.id;
    run.currentNodeId = bossId;
    run.hp = 40;
    battle.state.player.hp = 40;
    for (const e of battle.state.enemies) e.hp = 0;
    battle.endTurn(); // triggers victory check via enemy turn skip
    expect(battle.state.phase).toBe('victory');
    const oldMap = run.map;
    run.resolveBattle();
    expect(run.phase).toBe('actTransition');
    expect(run.reward!.relic).not.toBeNull();

    run.pickReward(run.reward!.cards[0]!);
    expect(run.act).toBe(2);
    expect(run.hp).toBe(run.maxHp); // full heal between acts
    expect(run.currentNodeId).toBeNull();
    expect(run.visited).toHaveLength(0);
    expect(run.phase).toBe('map');
    expect(run.availableNodes().length).toBeGreaterThan(0);
    expect(run.map).not.toBe(oldMap); // a fresh map object was generated
  });

  it('the final act boss ends the run in victory', () => {
    const run = new Run(32);
    run.act = ACT_COUNT;
    run.enterNode(run.availableNodes()[0]!.id);
    const bossId = run.map.rows[run.map.rows.length - 1]![0]!.id;
    run.currentNodeId = bossId;
    for (const e of run.battle!.state.enemies) e.hp = 0;
    run.battle!.endTurn();
    run.resolveBattle();
    expect(run.phase).toBe('victory');
  });

  it('act is preserved through save/load', () => {
    const run = new Run(33);
    run.act = 2;
    const loaded = Run.fromSave(JSON.parse(JSON.stringify(run.toSave())));
    expect(loaded.act).toBe(2);
  });
});
