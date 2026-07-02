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

export function getRelicDef(id: string): RelicDef {
  const def = RELICS[id];
  if (!def) throw new Error(`Unknown relic: ${id}`);
  return def;
}
