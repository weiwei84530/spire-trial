import { describe, expect, it } from 'vitest';
import { Battle } from '../src/engine/battle';
import { makeCard } from '../src/engine/cards';

function battleVs(enemies: string[], seed = 1): Battle {
  return new Battle({
    seed,
    deck: Array(10)
      .fill('strike')
      .map((id: string) => makeCard(id)),
    playerHp: 90,
    playerMaxHp: 90,
    enemies,
    enemyHpScale: 10,
  });
}

describe('infiniteEnergy cheat (v3)', () => {
  it('plays any number of cards without spending energy', () => {
    const battle = new Battle({
      seed: 3,
      deck: Array(10)
        .fill('strike')
        .map((id: string) => makeCard(id)),
      playerHp: 90,
      playerMaxHp: 90,
      enemies: ['jaw_worm'],
      enemyHpScale: 10,
    });
    battle.cheats.infiniteEnergy = true;
    const startEnergy = battle.state.player.energy;
    const plays = battle.state.player.hand.length;
    for (let i = 0; i < plays; i++) {
      expect(battle.canPlay(0, 0)).toBe(true);
      battle.playCard(0, 0);
    }
    expect(battle.state.player.energy).toBe(startEnergy);
    // No energy events should have been emitted for the free plays.
    expect(battle.state.events.some((e) => e.type === 'energy' && e.delta < 0)).toBe(false);
  });

  it('still enforces energy when the cheat is off', () => {
    const battle = battleVs(['jaw_worm']);
    const max = battle.state.player.maxEnergy;
    for (let i = 0; i < max; i++) battle.playCard(0, 0);
    expect(battle.state.player.energy).toBe(0);
    expect(battle.canPlay(0, 0)).toBe(false);
  });
});
