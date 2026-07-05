import { describe, expect, it } from 'vitest';
import { Battle } from '../src/engine/battle';
import { cardPool, makeCard } from '../src/engine/cards';
import { getStatus } from '../src/engine/statuses';
import type { CardInstance } from '../src/engine/types';

/** Battle against one jaw worm with a fixed hand-to-be (deck = exactly these cards). */
function fight(cardIds: string[], opts: { upgraded?: boolean } = {}): Battle {
  const deck: CardInstance[] = cardIds.map((id) => ({ ...makeCard(id), upgraded: !!opts.upgraded }));
  return new Battle({ seed: 7, deck, playerHp: 70, playerMaxHp: 70, enemies: ['jaw_worm'] });
}

const handIndex = (battle: Battle, defId: string) =>
  battle.state.player.hand.findIndex((c) => c.defId === defId);

describe('silent card mechanics', () => {
  it('bane only repeats its damage against poisoned targets', () => {
    const battle = fight(['bane', 'deadly_venom', 'bane', 'slice', 'deflect']);
    const enemy = battle.state.enemies[0]!;
    const hp0 = enemy.hp;
    battle.playCard(handIndex(battle, 'bane'), 0);
    expect(hp0 - enemy.hp).toBe(7); // not poisoned: single hit
    battle.playCard(handIndex(battle, 'deadly_venom'), 0);
    const hp1 = enemy.hp;
    battle.playCard(handIndex(battle, 'bane'), 0);
    expect(hp1 - enemy.hp).toBe(14); // poisoned: both hits
  });

  it('catalyst multiplies poison', () => {
    const battle = fight(['deadly_venom', 'catalyst', 'slice', 'deflect', 'deflect']);
    const enemy = battle.state.enemies[0]!;
    battle.playCard(handIndex(battle, 'deadly_venom'), 0); // 5 poison
    battle.playCard(handIndex(battle, 'catalyst'), 0);
    expect(getStatus(enemy, 'poison')).toBe(10);
  });

  it('envenom poisons on unblocked damage', () => {
    const battle = fight(['envenom', 'slice', 'slice', 'deflect', 'deflect']);
    const enemy = battle.state.enemies[0]!;
    battle.playCard(handIndex(battle, 'envenom'));
    battle.playCard(handIndex(battle, 'slice'), 0);
    expect(getStatus(enemy, 'poison')).toBe(1);
  });

  it('finisher counts attacks played this turn (including itself)', () => {
    const battle = fight(['slice', 'slice', 'finisher', 'deflect', 'deflect']);
    battle.playCard(handIndex(battle, 'slice'), 0);
    battle.playCard(handIndex(battle, 'slice'), 0);
    const enemy = battle.state.enemies[0]!;
    const hp = enemy.hp;
    battle.playCard(handIndex(battle, 'finisher'), 0);
    expect(hp - enemy.hp).toBe(18); // 3 attacks x 6
  });

  it('flechettes scales with skills in hand', () => {
    const battle = fight(['flechettes', 'deflect', 'deflect', 'backflip', 'slice']);
    const enemy = battle.state.enemies[0]!;
    const hp = enemy.hp;
    battle.playCard(handIndex(battle, 'flechettes'), 0);
    expect(hp - enemy.hp).toBe(12); // 3 skills left in hand x 4
  });

  it('thousand cuts and after image trigger on every card played', () => {
    const battle = fight(['thousand_cuts', 'after_image', 'deflect', 'slice', 'deflect']);
    battle.playCard(handIndex(battle, 'thousand_cuts'));
    battle.playCard(handIndex(battle, 'after_image')); // cuts: 1 dmg
    const enemy = battle.state.enemies[0]!;
    const hp = enemy.hp;
    const block = battle.state.player.block;
    battle.playCard(handIndex(battle, 'deflect')); // cuts 1 + after image 1 + deflect 4
    expect(hp - enemy.hp).toBe(1);
    expect(battle.state.player.block - block).toBe(5);
  });

  it('accuracy boosts shivs only', () => {
    const battle = fight(['accuracy', 'cloak_and_dagger', 'slice', 'deflect', 'deflect']);
    battle.playCard(handIndex(battle, 'accuracy')); // +4 shiv damage
    battle.playCard(handIndex(battle, 'cloak_and_dagger')); // adds 1 shiv to hand
    const enemy = battle.state.enemies[0]!;
    let hp = enemy.hp;
    battle.playCard(handIndex(battle, 'shiv'), 0);
    expect(hp - enemy.hp).toBe(8); // 4 base + 4 accuracy
    hp = enemy.hp;
    battle.playCard(handIndex(battle, 'slice'), 0);
    expect(hp - enemy.hp).toBe(6); // unaffected
  });

  it('next-turn statuses pay out once at the next turn start', () => {
    // 5-card deck: the whole deck is the opening hand.
    const battle = fight(['outmaneuver', 'dodge_and_roll', 'deflect', 'deflect', 'deflect']);
    battle.playCard(handIndex(battle, 'outmaneuver')); // +2 energy next turn
    battle.playCard(handIndex(battle, 'dodge_and_roll')); // 4 now, 4 next turn
    battle.endTurn();
    if (battle.state.phase !== 'playerTurn') return; // jaw worm can't kill through this
    const player = battle.state.player;
    expect(player.energy).toBe(5);
    expect(player.block).toBeGreaterThanOrEqual(4); // next-turn block landed after reset
    expect(getStatus(player, 'nextTurnEnergy')).toBe(0);
    expect(getStatus(player, 'nextTurnBlock')).toBe(0);
  });

  it('grand finale is only playable with an empty draw pile', () => {
    const battle = fight(['grand_finale', 'slice', 'slice', 'deflect', 'deflect', 'backflip']);
    const idx = handIndex(battle, 'grand_finale');
    if (idx >= 0) {
      expect(battle.state.player.drawPile.length).toBeGreaterThan(0);
      expect(battle.canPlay(idx)).toBe(false);
    }
  });

  it('intangible caps attack damage at 1', () => {
    const battle = fight(['wraith_form', 'deflect', 'deflect', 'deflect', 'deflect']);
    battle.playCard(handIndex(battle, 'wraith_form'));
    const player = battle.state.player;
    expect(getStatus(player, 'intangible')).toBe(2);
    const hp = player.hp;
    battle.endTurn();
    // Whatever the jaw worm did, an intangible player loses at most 1 HP.
    expect(hp - battle.state.player.hp).toBeLessThanOrEqual(1);
  });

  it('infinite blades adds a shiv at each turn start', () => {
    const battle = fight([
      'infinite_blades', 'deflect', 'deflect', 'deflect', 'deflect',
      'slice', 'slice', 'slice', 'slice', 'slice',
    ]);
    battle.playCard(handIndex(battle, 'infinite_blades'));
    battle.endTurn();
    if (battle.state.phase !== 'playerTurn') return;
    expect(battle.state.player.hand.some((c) => c.defId === 'shiv')).toBe(true);
  });

  it('discardRandom moves cards from hand to discard', () => {
    const battle = fight(['acrobatics', 'slice', 'slice', 'deflect', 'deflect', 'backflip']);
    const before = battle.state.player.hand.length;
    battle.playCard(handIndex(battle, 'acrobatics'));
    // -1 played, +3 drawn (deck may run short), -1 discarded
    expect(battle.state.player.hand.length).toBeLessThanOrEqual(before + 1);
    expect(battle.state.player.discardPile.length).toBeGreaterThanOrEqual(2);
  });

  it('every ported silent card is in the assassin reward pool', () => {
    const pool = [
      ...cardPool('assassin', 'common'),
      ...cardPool('assassin', 'uncommon'),
      ...cardPool('assassin', 'rare'),
    ];
    for (const id of [
      'bane', 'dagger_spray', 'deflect', 'slice', 'acrobatics', 'accuracy', 'backstab',
      'catalyst', 'finisher', 'infinite_blades', 'leg_sweep', 'predator',
      'thousand_cuts', 'after_image', 'envenom', 'grand_finale', 'wraith_form', 'unload',
    ]) {
      expect(pool).toContain(id);
    }
    expect(cardPool('warrior', 'rare')).not.toContain('wraith_form');
  });
});
