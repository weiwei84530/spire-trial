import { afterEach, describe, expect, it } from 'vitest';
import { cardText } from '../src/ui/describe';
import { setLocale } from '../src/ui/i18n';
import { getCardDef, resolveCard, makeCard } from '../src/engine/cards';

afterEach(() => setLocale('en'));

describe('cardText (zh)', () => {
  it('describes cards in Traditional Chinese', () => {
    setLocale('zh');
    expect(cardText(getCardDef('strike'))).toBe('造成 6 點傷害。');
    expect(cardText(getCardDef('bash'))).toBe('造成 8 點傷害。施加 2 層易傷。');
    expect(cardText(getCardDef('shrug_it_off'))).toBe('獲得 8 點格擋。抽 1 張牌。');
    expect(cardText(getCardDef('whirlwind'))).toBe('對所有敵人造成 5 點傷害 X 次。');
    expect(cardText(getCardDef('twin_strike'))).toBe('造成 5 點傷害 2 次。');
    expect(cardText(getCardDef('inflame'))).toBe('獲得 2 層力量。消耗。');
    expect(cardText(getCardDef('burn'))).toBe('無法打出。回合結束時若在手牌，受到 2 點傷害。');
  });

  it('uses upgraded values for upgraded instances', () => {
    setLocale('zh');
    expect(cardText(resolveCard(makeCard('strike', true)))).toBe('造成 9 點傷害。');
  });
});

describe('cardText (en)', () => {
  it('describes cards in English', () => {
    setLocale('en');
    expect(cardText(getCardDef('strike'))).toBe('Deal 6 damage.');
    expect(cardText(getCardDef('bash'))).toBe('Deal 8 damage. Apply 2 Vulnerable.');
    expect(cardText(getCardDef('shrug_it_off'))).toBe('Gain 8 Block. Draw 1 card.');
    expect(cardText(getCardDef('whirlwind'))).toBe('Deal 5 damage to ALL enemies X times.');
    expect(cardText(getCardDef('twin_strike'))).toBe('Deal 5 damage 2 times.');
    expect(cardText(getCardDef('inflame'))).toBe('Gain 2 Strength. Exhaust.');
    expect(cardText(getCardDef('burn'))).toBe(
      'Unplayable. At the end of your turn, if this is in your hand, take 2 damage.'
    );
  });
});
