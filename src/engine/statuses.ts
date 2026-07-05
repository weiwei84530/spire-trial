import type { Actor, StatusId } from './types';

/** Statuses that count down by 1 at the end of their owner's turn. */
const DECAYING: readonly StatusId[] = ['vulnerable', 'weak', 'frail', 'intangible'];

/** Statuses where negative stacks are meaningful (e.g. strength loss from Disarm-like cards). */
const SIGNED: readonly StatusId[] = ['strength', 'dexterity'];

/**
 * End-of-turn block from metallicize. Flat gain: not modified by dexterity
 * or frail (documented in docs/DESIGN.md).
 */
export function tickMetallicize(actor: Actor): number {
  const stacks = getStatus(actor, 'metallicize');
  if (stacks > 0) actor.block += stacks;
  return stacks;
}

export function getStatus(actor: Actor, id: StatusId): number {
  return actor.statuses[id] ?? 0;
}

export function addStatus(actor: Actor, id: StatusId, stacks: number): void {
  const next = getStatus(actor, id) + stacks;
  if (next === 0 || (next < 0 && !SIGNED.includes(id))) {
    delete actor.statuses[id];
  } else {
    actor.statuses[id] = next;
  }
}

/** End-of-turn countdown for duration-based debuffs. */
export function decayStatuses(actor: Actor): void {
  for (const id of DECAYING) {
    if (getStatus(actor, id) > 0) addStatus(actor, id, -1);
  }
}

/** Poison ticks at the start of the owner's turn: lose stacks HP (ignores block), then stacks - 1. */
export function tickPoison(actor: Actor): number {
  const stacks = getStatus(actor, 'poison');
  if (stacks <= 0) return 0;
  actor.hp = Math.max(0, actor.hp - stacks);
  addStatus(actor, 'poison', -1);
  return stacks;
}

/** Attack damage after strength, weak (attacker) and vulnerable (defender) modifiers. */
export function calcAttackDamage(base: number, attacker: Actor, defender: Actor): number {
  let dmg = base + getStatus(attacker, 'strength');
  if (getStatus(attacker, 'weak') > 0) dmg = Math.floor(dmg * 0.75);
  if (getStatus(defender, 'vulnerable') > 0) dmg = Math.floor(dmg * 1.5);
  return Math.max(0, dmg);
}

/** Block gained after dexterity and frail modifiers. */
export function calcBlockGain(base: number, actor: Actor): number {
  let block = base + getStatus(actor, 'dexterity');
  if (getStatus(actor, 'frail') > 0) block = Math.floor(block * 0.75);
  return Math.max(0, block);
}

/** Applies attack damage to block first, then HP. Returns HP actually lost. */
export function dealDamage(target: Actor, amount: number): number {
  const blocked = Math.min(target.block, amount);
  target.block -= blocked;
  const hpLoss = Math.min(target.hp, amount - blocked);
  target.hp -= hpLoss;
  return hpLoss;
}
