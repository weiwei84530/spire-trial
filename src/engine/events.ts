/**
 * Text events for '?' map nodes. Outcomes are declarative fields applied by
 * Run.chooseEventOption. Events never kill: HP loss floors at 1.
 */
export interface EventChoice {
  label: string;
  /** Shown after choosing, e.g. what happened. */
  result: string;
  /** Gold delta; negative = cost (choice disabled when unaffordable). */
  gold?: number;
  /** HP delta; healing caps at max HP, loss floors at 1 HP. */
  hp?: number;
  /** Gain a random relic the player does not own. */
  gainRelic?: boolean;
  /** Add this card to the deck. */
  gainCard?: string;
  /** Upgrade a random upgradable card, if any. */
  upgradeRandom?: boolean;
  /** Chance (0-1) to also find a random potion (skipped when slots are full). */
  gainPotion?: number;
}

export interface EventDef {
  id: string;
  title: string;
  text: string;
  choices: EventChoice[];
}

export const EVENTS: EventDef[] = [
  {
    id: 'golden_idol',
    title: '金色神像',
    text: '祭壇上放著一尊閃閃發光的神像，底座刻著看不懂的警告文字。',
    choices: [
      {
        label: '拿走神像（失去 8 HP，獲得一件遺物）',
        result: '你抓起神像的瞬間，天花板的落石擦過了你的肩膀。',
        hp: -8,
        gainRelic: true,
      },
      { label: '離開', result: '你決定不冒險。' },
    ],
  },
  {
    id: 'wandering_healer',
    title: '流浪醫者',
    text: '一位披著斗篷的醫者向你兜售治療服務，藥箱裡的器具看起來……大致乾淨。',
    choices: [
      {
        label: '接受治療（花費 20 金幣，回復 25 HP）',
        result: '藥水很苦，但傷口確實癒合了。',
        gold: -20,
        hp: 25,
      },
      { label: '婉拒', result: '醫者聳聳肩，消失在霧中。' },
    ],
  },
  {
    id: 'ancient_forge',
    title: '古老熔爐',
    text: '廢棄的鍛造間裡，熔爐竟然還燒著。爐火散發出奇異的藍光。',
    choices: [
      {
        label: '鍛造（隨機升級一張卡牌）',
        result: '爐火吞沒卡牌又吐出——它變得更鋒利了。',
        upgradeRandom: true,
      },
      { label: '離開', result: '你不敢碰那爐火。' },
    ],
  },
  {
    id: 'mysterious_shrine',
    title: '神秘祭壇',
    text: '石造祭壇中央有一道血槽，旁邊散落著金幣。似乎在等待獻祭。',
    choices: [
      {
        label: '獻祭（失去 7 HP，獲得 30 金幣）',
        result: '血流入石槽，金幣憑空出現在你手中。',
        hp: -7,
        gold: 30,
      },
      { label: '離開', result: '你對祭壇敬而遠之。' },
    ],
  },
  {
    id: 'abandoned_cart',
    title: '被遺棄的貨車',
    text: '一輛翻覆的商隊貨車橫在路中，貨物散落一地，主人不知去向。',
    choices: [
      {
        label: '翻找貨物（獲得 15 金幣與一瓶藥水……的機會）',
        result: '你在木箱底找到一小袋金幣。',
        gold: 15,
        gainPotion: 0.5,
      },
      { label: '繞道而行', result: '說不定是陷阱，你選擇繞開。' },
    ],
  },
];
