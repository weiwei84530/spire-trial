import type { Battle } from '../engine/battle';
import { resolveCard } from '../engine/cards';
import { calcAttackDamage, calcBlockGain } from '../engine/statuses';
import type { EnemyState } from '../engine/types';

export type Action = { type: 'play'; index: number; target?: number } | { type: 'end' };

export type Policy = (battle: Battle) => Action;

/** Rough value of one stack of each status when applied by a card. */
const STATUS_VALUE: Record<string, number> = {
  vulnerable: 4,
  weak: 3,
  poison: 3,
  strength: 6,
  dexterity: 5,
  metallicize: 6,
  thorns: 3,
  ritual: 9,
  energized: 9,
};

/** Total damage the enemies intend to deal this turn. */
export function incomingDamage(battle: Battle): number {
  let total = 0;
  for (const enemy of battle.aliveEnemies()) {
    const intent = battle.intentOf(enemy);
    if (intent.damage !== undefined) total += intent.damage * (intent.hits ?? 1);
  }
  return total;
}

/** Picks the alive enemy with the lowest HP (kill priority). */
function pickTarget(battle: Battle): number {
  let best = -1;
  let bestHp = Infinity;
  battle.state.enemies.forEach((e, i) => {
    if (e.hp > 0 && e.hp < bestHp) {
      best = i;
      bestHp = e.hp;
    }
  });
  return best;
}

function scoreCard(battle: Battle, handIndex: number, target: number): number {
  const def = resolveCard(battle.state.player.hand[handIndex]!);
  const player = battle.state.player;
  const enemy = battle.state.enemies[target] as EnemyState | undefined;
  const unblocked = Math.max(0, incomingDamage(battle) - player.block);
  const x = def.cost === 'x' ? player.energy : 0;
  let score = 0;

  for (const effect of def.effects) {
    switch (effect.kind) {
      case 'damage': {
        const times = effect.times === 'x' ? x : (effect.times ?? 1);
        const targets = effect.target === 'allEnemies' ? battle.aliveEnemies() : enemy ? [enemy] : [];
        for (const t of targets) {
          const dmg = calcAttackDamage(effect.amount, player, t) * times;
          score += Math.min(dmg, t.hp + t.block);
          if (dmg >= t.hp + t.block) score += 15; // kill bonus: stops future damage
        }
        break;
      }
      case 'block': {
        // Block is only worth what it actually prevents this turn; when the
        // player is low it becomes worth more than trading damage.
        const pressure = player.hp <= player.maxHp * 0.4 ? 1.8 : 1.2;
        score += Math.min(calcBlockGain(effect.amount, player), unblocked) * pressure;
        break;
      }
      case 'applyStatus':
        score += (STATUS_VALUE[effect.status] ?? 2) * Math.abs(effect.stacks);
        break;
      case 'draw':
        score += effect.count * 2;
        break;
      case 'gainEnergy':
        score += effect.amount * 3;
        break;
      case 'loseHp':
        score -= effect.amount * (player.hp < 20 ? 4 : 1);
        break;
      case 'heal':
        score += Math.min(effect.amount, player.maxHp - player.hp) * 0.8;
        break;
      case 'healPercent':
        score +=
          Math.min(Math.floor((player.maxHp * effect.percent) / 100), player.maxHp - player.hp) * 0.8;
        break;
      case 'doubleBlock':
        score += Math.min(player.block, unblocked) * 1.2;
        break;
      case 'addCard':
        break;
    }
  }
  return score;
}

/**
 * Baseline heuristic player for balance simulations: plays the highest-value
 * affordable card until nothing scores above zero, then ends the turn.
 */
export const greedyPolicy: Policy = (battle) => {
  const target = pickTarget(battle);
  let best: Action = { type: 'end' };
  let bestScore = 0;

  for (let i = 0; i < battle.state.player.hand.length; i++) {
    // canPlay ignores the target for non-targeted cards, so passing it is always safe.
    if (!battle.canPlay(i, target)) continue;
    const score = scoreCard(battle, i, target);
    if (score > bestScore) {
      bestScore = score;
      best = { type: 'play', index: i, target };
    }
  }
  return best;
};
