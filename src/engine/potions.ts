import type { Effect } from './types';

/** Potions: one-shot items. Reuse the same atomic effects as cards. */
export interface PotionDef {
  id: string;
  name: string;
  /** zh-TW display text. */
  desc: string;
  /** 'enemy' potions need a target selected in battle. */
  target: 'enemy' | 'none';
  /** Self-contained potions (e.g. healing) may also be drunk outside battle. */
  usableOutsideBattle?: boolean;
  effects: Effect[];
}

export const POTIONS: Record<string, PotionDef> = {};

function define(def: PotionDef): void {
  if (POTIONS[def.id]) throw new Error(`Duplicate potion id: ${def.id}`);
  POTIONS[def.id] = def;
}

define({
  id: 'fire_potion',
  name: 'Fire Potion',
  desc: '對一名敵人造成 20 點傷害。',
  target: 'enemy',
  effects: [{ kind: 'damage', amount: 20 }],
});

define({
  id: 'block_potion',
  name: 'Block Potion',
  desc: '獲得 12 點格擋。',
  target: 'none',
  effects: [{ kind: 'block', amount: 12 }],
});

define({
  id: 'strength_potion',
  name: 'Strength Potion',
  desc: '獲得 2 層力量。',
  target: 'none',
  effects: [{ kind: 'applyStatus', status: 'strength', stacks: 2, target: 'self' }],
});

define({
  // Matches the original Blood Potion (the id keeps the existing art asset).
  id: 'healing_potion',
  name: 'Blood Potion',
  desc: '回復最大生命的 20%。',
  target: 'none',
  usableOutsideBattle: true,
  effects: [{ kind: 'healPercent', percent: 20 }],
});

define({
  id: 'weak_potion',
  name: 'Weak Potion',
  desc: '對一名敵人施加 3 層虛弱。',
  target: 'enemy',
  effects: [{ kind: 'applyStatus', status: 'weak', stacks: 3, target: 'enemy' }],
});

export const POTION_IDS = Object.keys(POTIONS);

export function getPotionDef(id: string): PotionDef {
  const def = POTIONS[id];
  if (!def) throw new Error(`Unknown potion: ${id}`);
  return def;
}
