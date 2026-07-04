/**
 * Generates card rule text from engine data in the active locale. Card names
 * stay in English (treated as proper nouns); all rule text is generated here
 * so data files never store display strings.
 *
 * The output is HTML: status keywords carry instant-tooltip attributes, and
 * damage/block numbers can be recomputed against a live battle context so the
 * card face always shows what the play would actually do (B6/B7).
 */
import { getCardDef } from '../engine/cards';
import { calcAttackDamage, calcBlockGain } from '../engine/statuses';
import type { Actor, CardDef, Effect } from '../engine/types';
import { locale, statusDesc, statusName, t } from './i18n';

/** Live battle context: numbers are recomputed against these actors. */
export interface CardTextCtx {
  attacker: Actor;
  /** Hovered/targeted enemy; omit to show attacker-only modifiers. */
  defender?: Actor | null;
}

/** A statuses-free stand-in so attacker-only modifiers can be previewed. */
const NEUTRAL_ACTOR = { hp: 1, maxHp: 1, block: 0, statuses: {} } as Actor;

const PILE_NAMES = {
  hand: { en: 'hand', zh: '手牌' },
  drawPile: { en: 'draw pile', zh: '抽牌堆' },
  discardPile: { en: 'discard pile', zh: '棄牌堆' },
} as const;

/** Escapes text for safe embedding inside a double-quoted HTML attribute. */
function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Status keyword with its rules text in the hover tooltip (B6). */
function kw(status: string, stacks: number): string {
  const tip = `<b>${statusName(status)}</b><span>${statusDesc(status, stacks)}</span>`;
  return `<span class="keyword" data-tip="${esc(tip)}">${statusName(status)}</span>`;
}

/** Exhaust keyword with its rules text in the hover tooltip. */
function kwExhaust(label: string): string {
  const tip = `<b>${label}</b><span>${t('exhaustDesc')}</span>`;
  return `<span class="keyword" data-tip="${esc(tip)}">${label}</span>`;
}

/** Number that may differ from the printed value; colored when modified (B7). */
function num(shown: number, base: number): string {
  const cls = shown > base ? ' buffed' : shown < base ? ' nerfed' : '';
  return `<span class="num${cls}">${shown}</span>`;
}

function shownDamage(effect: Effect & { kind: 'damage' }, ctx?: CardTextCtx): string {
  const value = ctx
    ? calcAttackDamage(effect.amount, ctx.attacker, ctx.defender ?? NEUTRAL_ACTOR)
    : effect.amount;
  return num(value, effect.amount);
}

function shownBlock(effect: Effect & { kind: 'block' }, ctx?: CardTextCtx): string {
  const value = ctx ? calcBlockGain(effect.amount, ctx.attacker) : effect.amount;
  return num(value, effect.amount);
}

function effectTextZh(effect: Effect, ctx?: CardTextCtx): string {
  switch (effect.kind) {
    case 'damage': {
      const times = effect.times === 'x' ? ' X 次' : effect.times && effect.times > 1 ? ` ${effect.times} 次` : '';
      const scope = effect.target === 'allEnemies' ? '對所有敵人' : '';
      return `${scope}造成 ${shownDamage(effect, ctx)} 點傷害${times}`;
    }
    case 'block':
      return `獲得 ${shownBlock(effect, ctx)} 點格擋`;
    case 'applyStatus': {
      const name = kw(effect.status, effect.stacks);
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
    case 'healPercent':
      return `回復最大生命的 ${effect.percent}%`;
    case 'doubleBlock':
      return '格擋翻倍';
    case 'addCard': {
      const count = effect.count ?? 1;
      return `將 ${count} 張 ${getCardDef(effect.card).name} 加入${PILE_NAMES[effect.destination].zh}`;
    }
  }
}

function effectTextEn(effect: Effect, ctx?: CardTextCtx): string {
  switch (effect.kind) {
    case 'damage': {
      const times = effect.times === 'x' ? ' X times' : effect.times && effect.times > 1 ? ` ${effect.times} times` : '';
      const scope = effect.target === 'allEnemies' ? ' to ALL enemies' : '';
      return `Deal ${shownDamage(effect, ctx)} damage${scope}${times}`;
    }
    case 'block':
      return `Gain ${shownBlock(effect, ctx)} Block`;
    case 'applyStatus': {
      const name = kw(effect.status, effect.stacks);
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
    case 'healPercent':
      return `Heal for ${effect.percent}% of your Max HP`;
    case 'doubleBlock':
      return 'Double your Block';
    case 'addCard': {
      const count = effect.count ?? 1;
      return `Add ${count} ${getCardDef(effect.card).name} to your ${PILE_NAMES[effect.destination].en}`;
    }
  }
}

/** Full rule text (HTML) for a card face, in the active locale. */
export function cardText(def: CardDef, ctx?: CardTextCtx): string {
  const zh = locale() === 'zh';
  const period = zh ? '。' : '. ';
  const parts: string[] = [];
  if (def.unplayable) parts.push(zh ? '無法打出' : 'Unplayable');
  if (def.innate) parts.push(zh ? '固有' : 'Innate');
  parts.push(...def.effects.map((e) => (zh ? effectTextZh(e, ctx) : effectTextEn(e, ctx))));
  if (def.selfDamageAtTurnEnd) {
    parts.push(
      zh
        ? `回合結束時若在手牌，受到 ${def.selfDamageAtTurnEnd} 點傷害`
        : `At the end of your turn, if this is in your hand, take ${def.selfDamageAtTurnEnd} damage`
    );
  }
  if (def.exhaust || def.type === 'power') parts.push(kwExhaust(zh ? '消耗' : 'Exhaust'));
  return parts.map((p) => `${p}${period}`).join('').trimEnd();
}
