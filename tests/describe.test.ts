import { describe, expect, it } from 'vitest';
import { cardText, intentText } from '../src/ui/describe';
import { getCardDef, resolveCard, makeCard } from '../src/engine/cards';

describe('cardText', () => {
  it('describes a simple attack', () => {
    expect(cardText(getCardDef('strike'))).toBe('造成 6 點傷害。');
  });

  it('describes multi-part cards in order', () => {
    expect(cardText(getCardDef('bash'))).toBe('造成 8 點傷害。施加 2 層易傷。');
    expect(cardText(getCardDef('shrug_it_off'))).toBe('獲得 8 點格擋。抽 1 張牌。');
  });

  it('describes X-cost, AoE and multi-hit', () => {
    expect(cardText(getCardDef('whirlwind'))).toBe('對所有敵人造成 5 點傷害 X 次。');
    expect(cardText(getCardDef('twin_strike'))).toBe('造成 5 點傷害 2 次。');
  });

  it('describes powers with exhaust and self statuses', () => {
    expect(cardText(getCardDef('inflame'))).toBe('獲得 2 層力量。消耗。');
  });

  it('describes unplayable and end-of-turn damage', () => {
    expect(cardText(getCardDef('burn'))).toBe('無法打出。回合結束時若在手牌，受到 2 點傷害。');
  });

  it('uses upgraded values for upgraded instances', () => {
    expect(cardText(resolveCard(makeCard('strike', true)))).toBe('造成 9 點傷害。');
  });
});

describe('intentText', () => {
  it('formats attack intents with hits', () => {
    expect(intentText({ kind: 'attack', damage: 9, hits: 1 })).toBe('⚔ 9');
    expect(intentText({ kind: 'attack', damage: 5, hits: 2 })).toBe('⚔ 5×2');
  });

  it('formats non-attack intents', () => {
    expect(intentText({ kind: 'buff' })).toBe('↑ 強化');
    expect(intentText({ kind: 'debuff' })).toBe('↓ 弱化');
  });
});
