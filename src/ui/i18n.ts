/**
 * UI-layer localization. The engine stays language-free where possible:
 * enemy/relic/potion names live in engine data as canonical English, engine
 * relic/potion descs and events are the zh-TW source text, and this module
 * overlays the other language. Card and relic/potion names are treated as
 * English proper nouns in both locales (a Day-3 design decision).
 *
 * The locale is persisted in localStorage and defaults to English.
 */

export type Locale = 'en' | 'zh';

const LOCALE_KEY = 'cardgame_locale';

let current: Locale = 'en';
try {
  const saved = localStorage.getItem(LOCALE_KEY);
  if (saved === 'zh' || saved === 'en') current = saved;
} catch {
  /* storage unavailable: default to English */
}

export function locale(): Locale {
  return current;
}

export function setLocale(l: Locale): void {
  current = l;
  try {
    localStorage.setItem(LOCALE_KEY, l);
  } catch {
    /* ignore */
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = l === 'zh' ? 'zh-Hant' : 'en';
  }
}

// --- Generic UI strings ({0}, {1}... are positional params) ---

const STR = {
  // Title screen
  saveInfo: {
    en: 'Adventure in progress: Act {0}, floor {1}/{2} — HP {3}/{4}, {5} gold, {6} cards',
    zh: '發現進行中的冒險：第 {0} 幕・樓層 {1}／{2}，生命 {3}/{4}，金幣 {5}，牌組 {6} 張',
  },
  resume: { en: 'Continue adventure', zh: '繼續冒險' },
  abandon: { en: 'Abandon save and restart', zh: '放棄存檔，重新開始' },
  start: { en: 'Begin the climb', zh: '開始冒險' },
  subtitle: { en: 'Deck-building · Three-act dungeon · One life', zh: '卡牌構築・三幕地城・一次生命' },
  // Top bar
  hp: { en: 'HP', zh: '生命' },
  gold: { en: 'Gold', zh: '金幣' },
  deck: { en: 'Deck', zh: '牌組' },
  floor: { en: 'Floor', zh: '樓層' },
  actFloor: { en: 'Act {0} · {1}/{2}', zh: '第 {0} 幕・{1}/{2}' },
  soundToggle: { en: 'Sound on/off', zh: '音效／音樂開關' },
  pauseTitle: { en: 'Menu', zh: '選單' },
  clickToUse: { en: ' (click to use)', zh: '（點擊使用）' },
  // Map
  chooseNode: { en: 'Choose your path', zh: '選擇下一個地點' },
  // Battle
  turn: { en: 'Turn {0}', zh: '回合 {0}' },
  you: { en: 'You', zh: '你' },
  energy: { en: 'Energy', zh: '能量' },
  endTurn: { en: 'End turn', zh: '結束回合' },
  enemyTurn: { en: 'Enemy Turn', zh: '敵方回合' },
  yourTurn: { en: 'Your Turn', zh: '你的回合' },
  endTurnEnergy: { en: 'End turn ({0} energy left)', zh: '結束回合（剩 {0} 能量）' },
  playableLeft: { en: 'You can still play cards', zh: '還有可打出的卡牌' },
  battleLog: { en: 'Battle log', zh: '戰鬥紀錄' },
  drawPile: { en: 'Draw pile', zh: '抽牌堆' },
  discardPile: { en: 'Discard pile', zh: '棄牌堆' },
  exhaustPile: { en: 'Exhaust pile', zh: '消耗堆' },
  pileCount: { en: '{0} ({1} cards)', zh: '{0}（{1} 張）' },
  empty: { en: '(empty)', zh: '（空）' },
  close: { en: 'Close', zh: '關閉' },
  intentDefend: { en: 'Defend', zh: '防禦' },
  intentBuff: { en: 'Buff', zh: '強化' },
  intentDebuff: { en: 'Debuff', zh: '弱化' },
  // Rewards / act transition
  victoryHeading: { en: 'Victory!', zh: '勝利！' },
  goldReward: { en: '+{0} gold', zh: '+{0} 金幣' },
  chooseCard: { en: 'Choose a card:', zh: '選擇一張卡牌：' },
  skipCard: { en: 'Skip the card', zh: '跳過卡牌' },
  actDone: { en: 'Act {0} complete!', zh: '第 {0} 幕完成！' },
  actHeal: { en: 'Fully healed when entering the next act', zh: '進入下一幕時完全回復生命' },
  actChooseCard: { en: 'Choose a card, then descend into Act {0}:', zh: '選擇一張卡牌，然後前往第 {0} 幕：' },
  actSkip: { en: 'Skip the card and move on', zh: '跳過卡牌，直接前進' },
  // Event
  continue: { en: 'Continue', zh: '繼續' },
  // Shop
  shop: { en: 'Shop', zh: '商店' },
  sold: { en: 'Sold', zh: '已售出' },
  removeCard: { en: 'Remove a card', zh: '刪除一張卡牌' },
  removeUsed: { en: ' (used)', zh: '（已使用）' },
  pickRemove: { en: 'Pick a card to remove:', zh: '點選要刪除的卡牌：' },
  cancel: { en: 'Cancel', zh: '取消' },
  leaveShop: { en: 'Leave shop', zh: '離開商店' },
  // Rest
  campfire: { en: 'Campfire', zh: '營火' },
  restIntro: { en: 'Rest to heal {0} HP, or forge to upgrade a card.', zh: '休息回復 {0} HP，或鍛造升級一張卡牌。' },
  restHeal: { en: 'Rest (+{0} HP)', zh: '休息（+{0} HP）' },
  restUpgrade: { en: 'Or pick a card to upgrade:', zh: '或點選要升級的卡牌：' },
  // Result
  winTitle: { en: 'The Spire is conquered!', zh: '征服尖塔！' },
  loseTitle: { en: 'You died…', zh: '你死了…' },
  winText: { en: 'All three acts endured — the darkness atop the Spire is no more.', zh: '三幕試煉全數通過，塔頂的黑暗已被驅散。' },
  loseText: { en: 'Fell in Act {0}, floor {1}.', zh: '倒在第 {0} 幕・樓層 {1}。' },
  statFloor: { en: 'Floor reached', zh: '抵達樓層' },
  statWins: { en: 'Battles won', zh: '戰鬥勝場' },
  statTurns: { en: 'Total turns', zh: '戰鬥總回合' },
  statDealt: { en: 'Damage dealt', zh: '造成傷害' },
  statTaken: { en: 'Damage taken', zh: '承受傷害' },
  statDeck: { en: 'Final deck', zh: '最終牌組' },
  statRelics: { en: 'Relics', zh: '遺物' },
  statGold: { en: 'Gold left', zh: '剩餘金幣' },
  cardsCount: { en: '{0} cards', zh: '{0} 張' },
  none: { en: 'None', zh: '無' },
  newRun: { en: 'Start a new run', zh: '開始新的一輪' },
  // Pause menu
  paused: { en: 'Paused', zh: '暫停' },
  resumeGame: { en: 'Resume', zh: '繼續遊戲' },
  settings: { en: 'Settings', zh: '設定' },
  backToTitle: { en: 'Back to title', zh: '回到標題' },
  restartRun: { en: 'Restart run', zh: '重新開局' },
  restartConfirm: { en: 'Sure? Progress will be lost', zh: '確定？目前進度將清除' },
  // Settings menu
  language: { en: 'Language', zh: '語言' },
  musicVolume: { en: 'Music volume', zh: '音樂音量' },
  sfxVolume: { en: 'Sound effects volume', zh: '音效音量' },
  muteAll: { en: 'Mute all', zh: '全部靜音' },
  // Loading screen
  loading: { en: 'Loading', zh: '載入中' },
} satisfies Record<string, Record<Locale, string>>;

export function t(key: keyof typeof STR, ...args: (string | number)[]): string {
  let s = STR[key][current];
  args.forEach((a, i) => {
    s = s.replace(`{${i}}`, String(a));
  });
  return s;
}

// --- Status / card-type / node names ---

const STATUS: Record<string, Record<Locale, string>> = {
  vulnerable: { en: 'Vulnerable', zh: '易傷' },
  weak: { en: 'Weak', zh: '虛弱' },
  frail: { en: 'Frail', zh: '脆弱' },
  strength: { en: 'Strength', zh: '力量' },
  dexterity: { en: 'Dexterity', zh: '敏捷' },
  poison: { en: 'Poison', zh: '中毒' },
  ritual: { en: 'Ritual', zh: '儀式' },
  metallicize: { en: 'Metallicize', zh: '金屬化' },
  thorns: { en: 'Thorns', zh: '反傷' },
  energized: { en: 'Energized', zh: '蓄能' },
  barricade: { en: 'Barricade', zh: '屏障' },
  noxious: { en: 'Noxious Fumes', zh: '毒霧' },
};

export function statusName(id: string): string {
  return STATUS[id]?.[current] ?? id;
}

const CARD_TYPE: Record<string, Record<Locale, string>> = {
  attack: { en: 'Attack', zh: '攻擊' },
  skill: { en: 'Skill', zh: '技能' },
  power: { en: 'Power', zh: '能力' },
  status: { en: 'Status', zh: '狀態' },
  curse: { en: 'Curse', zh: '詛咒' },
};

export function cardTypeName(type: string): string {
  return CARD_TYPE[type]?.[current] ?? type;
}

const NODE: Record<string, Record<Locale, string>> = {
  battle: { en: 'Battle', zh: '戰鬥' },
  elite: { en: 'Elite', zh: '精英' },
  rest: { en: 'Campfire', zh: '營火' },
  event: { en: 'Event', zh: '事件' },
  shop: { en: 'Shop', zh: '商店' },
  boss: { en: 'Boss', zh: '頭目' },
};

export function nodeName(kind: string): string {
  return NODE[kind]?.[current] ?? kind;
}

// --- Enemy names (engine stores canonical English; zh overlaid here) ---

const ENEMY_ZH: Record<string, string> = {
  jaw_worm: '顎蟲',
  cultist: '教徒',
  acid_slime: '酸液史萊姆',
  louse_red: '紅蝨',
  spike_slime_m: '尖刺史萊姆',
  shelled_parasite: '帶殼寄生蟲',
  byrd: '怪鳥',
  chosen: '天選者',
  snake_plant: '蛇形魔草',
  centurion: '百夫長',
  gremlin_nob: '地精蠻王',
  slime_king: '史萊姆王',
  writhing_mass: '蠕動肉塊',
  orb_walker: '晶球行者',
  spire_growth: '尖塔荊棘',
  darkling: '闇靈',
  giant_head: '巨石之首',
  the_shadow: '暗影',
  boss_maw: '吞噬巨口',
};

/** Localized enemy display name; falls back to the engine (English) name. */
export function enemyName(defId: string, engineName: string): string {
  if (current === 'zh') return ENEMY_ZH[defId] ?? engineName;
  return engineName;
}

// --- Relic / potion descriptions (engine descs are the zh source) ---

const RELIC_DESC_EN: Record<string, string> = {
  burning_blood: 'After each combat victory, heal 6 HP.',
  vajra: 'At the start of each combat, gain 1 Strength.',
  anchor: 'At the start of each combat, gain 10 Block.',
  bag_of_preparation: 'At the start of each combat, draw 2 additional cards.',
  blood_vial: 'At the start of each combat, heal 2 HP.',
  bronze_scales: 'At the start of each combat, gain 3 Thorns.',
  oddly_smooth_stone: 'At the start of each combat, gain 1 Dexterity.',
};

export function relicDesc(id: string, zhDesc: string): string {
  return current === 'en' ? (RELIC_DESC_EN[id] ?? zhDesc) : zhDesc;
}

const POTION_DESC_EN: Record<string, string> = {
  fire_potion: 'Deal 20 damage to an enemy.',
  block_potion: 'Gain 12 Block.',
  strength_potion: 'Gain 2 Strength.',
  healing_potion: 'Heal 12 HP.',
  weak_potion: 'Apply 3 Weak to an enemy.',
};

export function potionDesc(id: string, zhDesc: string): string {
  return current === 'en' ? (POTION_DESC_EN[id] ?? zhDesc) : zhDesc;
}

// --- Events (engine text is the zh source; en overlaid by event id) ---

interface EventL10n {
  title: string;
  text: string;
  labels: string[];
  results: string[];
}

const EVENTS_EN: Record<string, EventL10n> = {
  golden_idol: {
    title: 'Golden Idol',
    text: 'A gleaming idol rests on an altar, its pedestal carved with warnings you cannot read.',
    labels: ['Take the idol (lose 8 HP, gain a relic)', 'Leave'],
    results: [
      'The moment you grab the idol, falling rocks graze your shoulder.',
      'You decide not to risk it.',
    ],
  },
  wandering_healer: {
    title: 'Wandering Healer',
    text: 'A cloaked healer offers their services. The instruments in the medicine chest look… mostly clean.',
    labels: ['Accept treatment (pay 20 gold, heal 25 HP)', 'Politely decline'],
    results: [
      'The potion is bitter, but the wounds truly close.',
      'The healer shrugs and vanishes into the mist.',
    ],
  },
  ancient_forge: {
    title: 'Ancient Forge',
    text: 'In an abandoned smithy, the forge still burns — its flames give off a strange blue light.',
    labels: ['Forge (upgrade a random card)', 'Leave'],
    results: [
      'The fire swallows a card and spits it back — sharper than before.',
      'You dare not touch that fire.',
    ],
  },
  mysterious_shrine: {
    title: 'Mysterious Shrine',
    text: 'A stone shrine with a blood groove down its center, gold coins scattered around. It seems to await an offering.',
    labels: ['Sacrifice (lose 7 HP, gain 30 gold)', 'Leave'],
    results: [
      'Blood runs into the groove; coins appear in your hand out of thin air.',
      'You keep a respectful distance from the shrine.',
    ],
  },
  abandoned_cart: {
    title: 'Abandoned Cart',
    text: 'An overturned merchant cart blocks the road, goods spilled everywhere. The owner is nowhere to be seen.',
    labels: ['Search the goods (a chance at 15 gold and a potion…)', 'Go around'],
    results: [
      'You find a small pouch of gold at the bottom of a crate.',
      'It might be a trap — you steer clear.',
    ],
  },
};

export function eventTitle(id: string, zhTitle: string): string {
  return current === 'en' ? (EVENTS_EN[id]?.title ?? zhTitle) : zhTitle;
}

export function eventText(id: string, zhText: string): string {
  return current === 'en' ? (EVENTS_EN[id]?.text ?? zhText) : zhText;
}

export function eventChoiceLabel(id: string, index: number, zhLabel: string): string {
  return current === 'en' ? (EVENTS_EN[id]?.labels[index] ?? zhLabel) : zhLabel;
}

/** The engine stores the chosen zh result string; map it back by index. */
export function eventResult(id: string, choiceResults: string[], zhResult: string): string {
  if (current !== 'en') return zhResult;
  const index = choiceResults.indexOf(zhResult);
  return EVENTS_EN[id]?.results[index] ?? zhResult;
}
