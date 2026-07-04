import { afterEach, describe, expect, it } from 'vitest';
import { cardText } from '../src/ui/describe';
import { setLocale } from '../src/ui/i18n';
import { getCardDef, resolveCard, makeCard } from '../src/engine/cards';
import type { Actor } from '../src/engine/types';

afterEach(() => setLocale('en'));

/** cardText now emits HTML (keyword tooltips, live numbers); compare plain text. */
function plain(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

function actor(statuses: Record<string, number> = {}): Actor {
  return { hp: 50, maxHp: 50, block: 0, statuses } as Actor;
}

describe('cardText (zh)', () => {
  it('describes cards in Traditional Chinese', () => {
    setLocale('zh');
    expect(plain(cardText(getCardDef('strike')))).toBe('造成 6 點傷害。');
    expect(plain(cardText(getCardDef('bash')))).toBe('造成 8 點傷害。施加 2 層易傷。');
    expect(plain(cardText(getCardDef('shrug_it_off')))).toBe('獲得 8 點格擋。抽 1 張牌。');
    expect(plain(cardText(getCardDef('whirlwind')))).toBe('對所有敵人造成 5 點傷害 X 次。');
    expect(plain(cardText(getCardDef('twin_strike')))).toBe('造成 5 點傷害 2 次。');
    expect(plain(cardText(getCardDef('inflame')))).toBe('獲得 2 層力量。消耗。');
    expect(plain(cardText(getCardDef('burn')))).toBe('無法打出。回合結束時若在手牌，受到 2 點傷害。');
  });

  it('uses upgraded values for upgraded instances', () => {
    setLocale('zh');
    expect(plain(cardText(resolveCard(makeCard('strike', true))))).toBe('造成 9 點傷害。');
  });
});

describe('cardText (en)', () => {
  it('describes cards in English', () => {
    setLocale('en');
    expect(plain(cardText(getCardDef('strike')))).toBe('Deal 6 damage.');
    expect(plain(cardText(getCardDef('bash')))).toBe('Deal 8 damage. Apply 2 Vulnerable.');
    expect(plain(cardText(getCardDef('shrug_it_off')))).toBe('Gain 8 Block. Draw 1 card.');
    expect(plain(cardText(getCardDef('whirlwind')))).toBe('Deal 5 damage to ALL enemies X times.');
    expect(plain(cardText(getCardDef('twin_strike')))).toBe('Deal 5 damage 2 times.');
    expect(plain(cardText(getCardDef('inflame')))).toBe('Gain 2 Strength. Exhaust.');
    expect(plain(cardText(getCardDef('burn')))).toBe(
      'Unplayable. At the end of your turn, if this is in your hand, take 2 damage.'
    );
  });
});

describe('cardText live context (B7)', () => {
  it('recomputes damage with attacker strength and target vulnerable', () => {
    setLocale('en');
    const ctx = { attacker: actor({ strength: 2 }), defender: actor({ vulnerable: 1 }) };
    // (6 + 2) * 1.5 = 12
    expect(plain(cardText(getCardDef('strike'), ctx))).toBe('Deal 12 damage.');
    expect(cardText(getCardDef('strike'), ctx)).toContain('buffed');
  });

  it('marks weakened damage as nerfed', () => {
    setLocale('en');
    const ctx = { attacker: actor({ weak: 1 }) };
    // floor(6 * 0.75) = 4
    expect(plain(cardText(getCardDef('strike'), ctx))).toBe('Deal 4 damage.');
    expect(cardText(getCardDef('strike'), ctx)).toContain('nerfed');
  });

  it('shows printed values without a context', () => {
    setLocale('en');
    expect(cardText(getCardDef('strike'))).not.toContain('buffed');
  });
});
