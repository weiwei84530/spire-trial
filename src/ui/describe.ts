/**
 * Generates card rule text from engine data in the active locale. Card names
 * stay in English (treated as proper nouns); all rule text is generated here
 * so data files never store display strings.
 */
import { getCardDef } from '../engine/cards';
import type { CardDef, Effect } from '../engine/types';
import { locale, statusName } from './i18n';

const PILE_NAMES = {
  hand: { en: 'hand', zh: '手牌' },
  drawPile: { en: 'draw pile', zh: '抽牌堆' },
  discardPile: { en: 'discard pile', zh: '棄牌堆' },
} as const;

function effectTextZh(effect: Effect): string {
  switch (effect.kind) {
    case 'damage': {
      const times = effect.times === 'x' ? ' X 次' : effect.times && effect.times > 1 ? ` ${effect.times} 次` : '';
      const scope = effect.target === 'allEnemies' ? '對所有敵人' : '';
      return `${scope}造成 ${effect.amount} 點傷害${times}`;
    }
    case 'block':
      return `獲得 ${effect.amount} 點格擋`;
    case 'applyStatus': {
      const name = statusName(effect.status);
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
      return `將 ${count} 張 ${getCardDef(effect.card).name} 加入${PILE_NAMES[effect.destination].zh}`;
    }
  }
}

function effectTextEn(effect: Effect): string {
  switch (effect.kind) {
    case 'damage': {
      const times = effect.times === 'x' ? ' X times' : effect.times && effect.times > 1 ? ` ${effect.times} times` : '';
      const scope = effect.target === 'allEnemies' ? ' to ALL enemies' : '';
      return `Deal ${effect.amount} damage${scope}${times}`;
    }
    case 'block':
      return `Gain ${effect.amount} Block`;
    case 'applyStatus': {
      const name = statusName(effect.status);
      if (effect.target === 'self') return `Gain ${effect.stacks} ${name}`;
      const scope = effect.target === 'allEnemies' ? ' to ALL enemies' : '';
      return `Apply ${effect.stacks} ${name}${scope}`;
    }
    case 'draw':
      return `Draw ${effect.count} ${effect.count === 1 ? 'card' : 'cards'}`;
    case 'gainEnergy':
      return `Gain ${effect.amount} Energy`;
    case 'loseHp':
      return `Lose ${effect.amount} HP`;
    case 'heal':
      return `Heal ${effect.amount} HP`;
    case 'doubleBlock':
      return 'Double your Block';
    case 'addCard': {
      const count = effect.count ?? 1;
      return `Add ${count} ${getCardDef(effect.card).name} to your ${PILE_NAMES[effect.destination].en}`;
    }
  }
}

/** Full rule text for a card face, in the active locale. */
export function cardText(def: CardDef): string {
  const zh = locale() === 'zh';
  const period = zh ? '。' : '. ';
  const parts: string[] = [];
  if (def.unplayable) parts.push(zh ? '無法打出' : 'Unplayable');
  if (def.innate) parts.push(zh ? '固有' : 'Innate');
  parts.push(...def.effects.map((e) => (zh ? effectTextZh(e) : effectTextEn(e))));
  if (def.selfDamageAtTurnEnd) {
    parts.push(
      zh
        ? `回合結束時若在手牌，受到 ${def.selfDamageAtTurnEnd} 點傷害`
        : `At the end of your turn, if this is in your hand, take ${def.selfDamageAtTurnEnd} damage`
    );
  }
  if (def.exhaust || def.type === 'power') parts.push(zh ? '消耗' : 'Exhaust');
  return parts.map((p) => `${p}${period}`).join('').trimEnd();
}
