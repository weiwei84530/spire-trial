/**
 * Generates zh-TW display text from engine data. Card names stay in English
 * (treated as proper nouns); all rule text is generated here so data files
 * never store display strings.
 */
import type { IntentPreview } from '../engine/battle';
import { getCardDef } from '../engine/cards';
import type { CardDef, Effect, StatusId } from '../engine/types';

export const STATUS_NAMES: Record<StatusId, string> = {
  vulnerable: '易傷',
  weak: '虛弱',
  frail: '脆弱',
  strength: '力量',
  dexterity: '敏捷',
  poison: '中毒',
  ritual: '儀式',
  metallicize: '金屬化',
  thorns: '反傷',
  energized: '蓄能',
  barricade: '屏障',
  noxious: '毒霧',
};

const PILE_NAMES: Record<string, string> = {
  hand: '手牌',
  drawPile: '抽牌堆',
  discardPile: '棄牌堆',
};

function effectText(effect: Effect): string {
  switch (effect.kind) {
    case 'damage': {
      const times = effect.times === 'x' ? ' X 次' : effect.times && effect.times > 1 ? ` ${effect.times} 次` : '';
      const scope = effect.target === 'allEnemies' ? '對所有敵人' : '';
      return `${scope}造成 ${effect.amount} 點傷害${times}`;
    }
    case 'block':
      return `獲得 ${effect.amount} 點格擋`;
    case 'applyStatus': {
      const name = STATUS_NAMES[effect.status];
      if (effect.target === 'self') return `獲得 ${effect.stacks} 層${name}`;
      const scope = effect.target === 'allEnemies' ? '對所有敵人' : '';
      return `${scope}施加 ${effect.stacks} 層${name}`;
    }
    case 'draw':
      return `抽 ${effect.count} 張牌`;
    case 'gainEnergy':
      return `獲得 ${effect.amount} 點能量`;
    case 'loseHp':
      return `失去 ${effect.amount} 點生命`;
    case 'heal':
      return `回復 ${effect.amount} 點生命`;
    case 'doubleBlock':
      return '格擋翻倍';
    case 'addCard': {
      const count = effect.count ?? 1;
      return `將 ${count} 張 ${getCardDef(effect.card).name} 加入${PILE_NAMES[effect.destination]}`;
    }
  }
}

/** Full rule text for a card face. */
export function cardText(def: CardDef): string {
  const parts: string[] = [];
  if (def.unplayable) parts.push('無法打出。');
  if (def.innate) parts.push('固有。');
  parts.push(...def.effects.map((e) => `${effectText(e)}。`));
  if (def.selfDamageAtTurnEnd) {
    parts.push(`回合結束時若在手牌，受到 ${def.selfDamageAtTurnEnd} 點傷害。`);
  }
  if (def.exhaust || def.type === 'power') parts.push('消耗。');
  return parts.join('');
}

export const CARD_TYPE_NAMES: Record<CardDef['type'], string> = {
  attack: '攻擊',
  skill: '技能',
  power: '能力',
  status: '狀態',
  curse: '詛咒',
};

/** Short intent line shown above an enemy, e.g. "⚔ 9×2". */
export function intentText(intent: IntentPreview): string {
  switch (intent.kind) {
    case 'attack': {
      const hits = intent.hits && intent.hits > 1 ? `×${intent.hits}` : '';
      return `⚔ ${intent.damage}${hits}`;
    }
    case 'defend':
      return '🛡 防禦';
    case 'buff':
      return '↑ 強化';
    case 'debuff':
      return '↓ 弱化';
  }
}
