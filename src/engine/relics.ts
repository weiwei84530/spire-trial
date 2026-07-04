import type { Effect } from './types';

/**
 * Relic database. Current trigger points: battle start effects and
 * post-victory healing. More trigger kinds (turn start, on damage, etc.)
 * will be added when a relic needs them.
 */
export interface RelicDef {
  id: string;
  name: string;
  /** zh-TW display text (bespoke per relic; not auto-generated like card text). */
  desc: string;
  /** Player-sourced effects applied once at battle start. */
  battleStart?: Effect[];
  /** HP restored after every battle victory. */
  victoryHeal?: number;
  /** Max HP gained once when the relic is picked up. */
  maxHpBonus?: number;
  /** Random deck cards upgraded once when the relic is picked up. */
  upgradeOnPickup?: number;
  /** Extra potion slots while owned. */
  potionSlots?: number;
}

export const RELICS: Record<string, RelicDef> = {};

function define(def: RelicDef): void {
  if (RELICS[def.id]) throw new Error(`Duplicate relic id: ${def.id}`);
  RELICS[def.id] = def;
}

define({
  id: 'burning_blood',
  name: 'Burning Blood',
  desc: '每場戰鬥勝利後，回復 6 點生命。',
  victoryHeal: 6,
});

define({
  id: 'vajra',
  name: 'Vajra',
  desc: '每場戰鬥開始時，獲得 1 層力量。',
  battleStart: [{ kind: 'applyStatus', status: 'strength', stacks: 1, target: 'self' }],
});

define({
  id: 'anchor',
  name: 'Anchor',
  desc: '每場戰鬥開始時，獲得 10 點格擋。',
  battleStart: [{ kind: 'block', amount: 10 }],
});

define({
  id: 'bag_of_preparation',
  name: 'Bag of Preparation',
  desc: '每場戰鬥開始時，額外抽 2 張牌。',
  battleStart: [{ kind: 'draw', count: 2 }],
});

define({
  id: 'blood_vial',
  name: 'Blood Vial',
  desc: '每場戰鬥開始時，回復 2 點生命。',
  battleStart: [{ kind: 'heal', amount: 2 }],
});

define({
  id: 'bronze_scales',
  name: 'Bronze Scales',
  desc: '每場戰鬥開始時，獲得 3 層反傷。',
  battleStart: [{ kind: 'applyStatus', status: 'thorns', stacks: 3, target: 'self' }],
});

define({
  id: 'oddly_smooth_stone',
  name: 'Oddly Smooth Stone',
  desc: '每場戰鬥開始時，獲得 1 層敏捷。',
  battleStart: [{ kind: 'applyStatus', status: 'dexterity', stacks: 1, target: 'self' }],
});

define({
  id: 'lantern',
  name: 'Lantern',
  desc: '每場戰鬥開始時，獲得 1 點能量。',
  battleStart: [{ kind: 'gainEnergy', amount: 1 }],
});

define({
  id: 'bag_of_marbles',
  name: 'Bag of Marbles',
  desc: '每場戰鬥開始時，對所有敵人施加 1 層易傷。',
  battleStart: [{ kind: 'applyStatus', status: 'vulnerable', stacks: 1, target: 'allEnemies' }],
});

define({
  id: 'red_mask',
  name: 'Red Mask',
  desc: '每場戰鬥開始時，對所有敵人施加 1 層虛弱。',
  battleStart: [{ kind: 'applyStatus', status: 'weak', stacks: 1, target: 'allEnemies' }],
});

define({
  id: 'thread_and_needle',
  name: 'Thread and Needle',
  desc: '每場戰鬥開始時，獲得 2 層金屬化。',
  battleStart: [{ kind: 'applyStatus', status: 'metallicize', stacks: 2, target: 'self' }],
});

define({
  id: 'twisted_funnel',
  name: 'Twisted Funnel',
  desc: '每場戰鬥開始時，對所有敵人施加 4 層中毒。',
  battleStart: [{ kind: 'applyStatus', status: 'poison', stacks: 4, target: 'allEnemies' }],
});

define({
  id: 'strawberry',
  name: 'Strawberry',
  desc: '獲得時，生命上限提升 7 點。',
  maxHpBonus: 7,
});

define({
  id: 'mango',
  name: 'Mango',
  desc: '獲得時，生命上限提升 14 點。',
  maxHpBonus: 14,
});

define({
  id: 'whetstone',
  name: 'Whetstone',
  desc: '獲得時，隨機升級 1 張牌。',
  upgradeOnPickup: 1,
});

define({
  id: 'potion_belt',
  name: 'Potion Belt',
  desc: '藥水欄位增加 2 格。',
  potionSlots: 2,
});

define({
  id: 'meat_on_the_bone',
  name: 'Meat on the Bone',
  desc: '每場戰鬥勝利後，回復 4 點生命。',
  victoryHeal: 4,
});

export function getRelicDef(id: string): RelicDef {
  const def = RELICS[id];
  if (!def) throw new Error(`Unknown relic: ${id}`);
  return def;
}
