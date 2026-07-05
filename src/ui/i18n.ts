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

/** First launch: Chinese browsers get the zh UI, everyone else English (C1). */
function detectLocale(): Locale {
  try {
    if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('zh')) {
      return 'zh';
    }
  } catch {
    /* no navigator (tests): default to English */
  }
  return 'en';
}

let current: Locale = detectLocale();
try {
  const saved = localStorage.getItem(LOCALE_KEY);
  if (saved === 'zh' || saved === 'en') current = saved;
} catch {
  /* storage unavailable: keep the detected default */
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
  abandon: { en: 'Restart', zh: '重新開始' },
  start: { en: 'Begin the climb', zh: '開始冒險' },
  // Character select
  chooseCharacter: { en: 'Choose your character', zh: '選擇你的角色' },
  embark: { en: 'Embark', zh: '出發' },
  back: { en: 'Back', zh: '返回' },
  charMaxHp: { en: 'Max HP {0}', zh: '生命上限 {0}' },
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
  energyLeft: { en: '{0} energy left', zh: '剩 {0} 能量' },
  playableLeft: { en: 'You can still play cards', zh: '還有可打出的卡牌' },
  exhaustDesc: {
    en: 'When played, this card is removed from the rest of the combat.',
    zh: '打出後，這張卡在本場戰鬥中被移除。',
  },
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
  chooseRelic: { en: 'Choose a relic:', zh: '選擇一件遺物：' },
  skipRelic: { en: 'Skip the relics', zh: '跳過遺物' },
  relicTaken: { en: 'Relic claimed!', zh: '已取得遺物！' },
  // Event
  continue: { en: 'Continue', zh: '繼續' },
  // Event outcome summary (real gains/losses shown under the result text)
  outcomeHpLoss: { en: 'Lost {0} HP', zh: '失去 {0} 點生命' },
  outcomeHpGain: { en: 'Recovered {0} HP', zh: '回復 {0} 點生命' },
  outcomeGoldGain: { en: 'Gained {0} gold', zh: '獲得 {0} 金幣' },
  outcomeGoldLoss: { en: 'Spent {0} gold', zh: '花費 {0} 金幣' },
  outcomeRelic: { en: 'Relic gained: {0}', zh: '獲得遺物：{0}' },
  outcomeUpgrade: { en: 'Card upgraded: {0}', zh: '卡牌升級：{0}' },
  outcomePotion: { en: 'Potion found: {0}', zh: '獲得藥水：{0}' },
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
  restartRun: { en: 'Restart', zh: '重新開始' },
  // Settings menu
  language: { en: 'Language', zh: '語言' },
  musicVolume: { en: 'Music volume', zh: '音樂音量' },
  sfxVolume: { en: 'Sound effects volume', zh: '音效音量' },
  muteAll: { en: 'Mute all', zh: '全部靜音' },
  clearData: { en: 'Clear data and restart', zh: '清除資料並重啟' },
  confirmClearTitle: { en: 'Clear all data?', zh: '清除所有資料？' },
  confirmClearText: {
    en: 'All saved progress and settings will be wiped, and the game will reload as if opened for the first time.',
    zh: '所有玩家儲存資料與設定將被移除，遊戲會重新載入為初次開啟的狀態。',
  },
  confirmClear: { en: 'Wipe and reload', zh: '確認清除' },
  // Loading screen
  loading: { en: 'Loading', zh: '載入中' },
  // Abandon-save confirmation
  confirmAbandonTitle: { en: 'Abandon this run?', zh: '放棄這輪冒險？' },
  confirmAbandonText: {
    en: 'The saved adventure will be deleted permanently.',
    zh: '已儲存的冒險進度將被永久刪除。',
  },
  confirmAbandon: { en: 'Abandon it', zh: '確認放棄' },
  // Campfire upgrade preview
  upgradePreviewTitle: { en: 'Upgrade preview', zh: '升級預覽' },
  confirmUpgrade: { en: 'Upgrade this card', zh: '升級這張卡' },
  // Cheat menu
  cheatMenu: { en: 'Cheat menu', zh: '作弊選單' },
  cheatHint: {
    en: 'Testing helpers. They disable nothing and save nothing.',
    zh: '測試用功能，開關不會被存檔。' },
  cheatOneHit: { en: 'One-hit kills', zh: '玩家攻擊一擊必殺' },
  cheatGold: { en: 'Unlimited gold', zh: '金錢無上限' },
  cheatHp: { en: 'Invincible', zh: '生命值無限' },
  cheatEnergy: { en: 'Unlimited energy', zh: '能量無限' },
  // Intent tooltips
  intentAttackTip: { en: 'Intends to attack for {0} damage', zh: '意圖攻擊：{0} 點傷害' },
  intentDefendTip: { en: 'Intends to gain {0} Block', zh: '意圖獲得 {0} 點格擋' },
  intentBuffTip: { en: 'Intends to gain: {0}', zh: '意圖獲得：{0}' },
  intentDebuffTip: { en: 'Intends to inflict: {0}', zh: '意圖對你施加：{0}' },
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
  nextTurnBlock: { en: 'Reinforced', zh: '蓄勢格擋' },
  nextTurnEnergy: { en: 'Surge', zh: '湧能' },
  nextTurnDraw: { en: 'Foresight', zh: '預備抽牌' },
  blur: { en: 'Blur', zh: '殘影' },
  accuracy: { en: 'Accuracy', zh: '精準' },
  infiniteBlades: { en: 'Infinite Blades', zh: '無盡刀刃' },
  toolsOfTrade: { en: 'Tools of the Trade', zh: '慣竊工具' },
  thousandCuts: { en: 'Thousand Cuts', zh: '千刀萬剮' },
  afterImage: { en: 'After Image', zh: '殘像' },
  envenom: { en: 'Envenom', zh: '淬毒' },
  intangible: { en: 'Intangible', zh: '虛無' },
  wraithForm: { en: 'Wraith Form', zh: '幽魂形態' },
};

export function statusName(id: string): string {
  return STATUS[id]?.[current] ?? id;
}

/** Rules text for status tooltips (N = current stacks). */
const STATUS_DESC: Record<string, Record<Locale, string>> = {
  vulnerable: { en: 'Takes 50% more attack damage.', zh: '受到的攻擊傷害增加 50%。' },
  weak: { en: 'Deals 25% less attack damage.', zh: '造成的攻擊傷害減少 25%。' },
  frail: { en: 'Gains 25% less Block.', zh: '獲得的格擋減少 25%。' },
  strength: { en: 'Attacks deal +N damage.', zh: '攻擊傷害 +N。' },
  dexterity: { en: 'Gain +N Block from cards.', zh: '卡牌獲得的格擋 +N。' },
  poison: { en: 'Loses N HP at the start of its turn, then N drops by 1.', zh: '回合開始時失去 N 點生命，之後層數減 1。' },
  ritual: { en: 'Gains N Strength at the end of its turn.', zh: '回合結束時獲得 N 層力量。' },
  metallicize: { en: 'Gains N Block at the end of its turn.', zh: '回合結束時獲得 N 點格擋。' },
  thorns: { en: 'Attackers take N damage.', zh: '攻擊者受到 N 點傷害。' },
  energized: { en: 'Gains N extra energy each turn.', zh: '每回合額外獲得 N 點能量。' },
  barricade: { en: 'Block is not removed at the start of the turn.', zh: '格擋不再於回合開始時消失。' },
  noxious: { en: 'Applies N Poison to all enemies each turn.', zh: '每回合對所有敵人施加 N 層中毒。' },
  nextTurnBlock: { en: 'Gains N Block at the start of the next turn.', zh: '下回合開始時獲得 N 點格擋。' },
  nextTurnEnergy: { en: 'Gains N extra Energy next turn.', zh: '下回合獲得 N 點額外能量。' },
  nextTurnDraw: { en: 'Draws N additional cards next turn.', zh: '下回合額外抽 N 張牌。' },
  blur: {
    en: 'Block is not removed at the start of the next N turns.',
    zh: '接下來 N 回合開始時，格擋不會消失。',
  },
  accuracy: { en: 'Shivs deal N additional damage.', zh: '小刀造成的傷害 +N。' },
  infiniteBlades: { en: 'Adds N Shivs to your hand at the start of each turn.', zh: '每回合開始時，將 N 張小刀加入手牌。' },
  toolsOfTrade: {
    en: 'At the start of each turn, draw N cards, then discard N cards at random.',
    zh: '每回合開始時抽 N 張牌，然後隨機棄 N 張。',
  },
  thousandCuts: {
    en: 'Whenever you play a card, deal N damage to all enemies.',
    zh: '每打出一張牌，對所有敵人造成 N 點傷害。',
  },
  afterImage: { en: 'Whenever you play a card, gain N Block.', zh: '每打出一張牌，獲得 N 點格擋。' },
  envenom: {
    en: 'Whenever an attack deals unblocked damage, apply N Poison.',
    zh: '攻擊造成生命傷害時，施加 N 層中毒。',
  },
  intangible: { en: 'Damage taken is reduced to 1 for N turns.', zh: '接下來 N 回合，受到的傷害至多為 1。' },
  wraithForm: { en: 'Loses N Dexterity at the end of each turn.', zh: '每回合結束時失去 N 點敏捷。' },
};

export function statusDesc(id: string, stacks: number): string {
  const text = STATUS_DESC[id]?.[current];
  return text ? text.replace(/N/g, String(stacks)) : '';
}

/** zh-TW card names (engine names stay English; an upgraded card keeps its "+"). */
const CARD_ZH: Record<string, string> = {
  strike: '打擊',
  defend: '防禦',
  bash: '痛擊',
  cleave: '順劈',
  pommel_strike: '劍柄打擊',
  twin_strike: '雙重打擊',
  iron_wave: '鐵斬波',
  shrug_it_off: '不痛不癢',
  deadly_venom: '致命毒液',
  inflame: '燃心',
  bludgeon: '重毆',
  offering: '獻祭',
  anger: '憤怒',
  sucker_punch: '偷襲重拳',
  wild_strike: '狂野打擊',
  reckless_charge: '魯莽衝鋒',
  backflip: '後空翻',
  heavy_armor: '重型鎧甲',
  bloodletting: '放血',
  battle_trance: '戰鬥專注',
  clothesline: '金勾臂',
  uppercut: '上勾拳',
  hemokinesis: '御血術',
  pummel: '連環重擊',
  venom_strike: '淬毒突刺',
  dash: '疾衝',
  disarm: '繳械',
  flex: '屈伸',
  shockwave: '震盪波',
  terror: '恐懼',
  shiv: '小刀',
  blade_dance: '劍刃之舞',
  cloak_and_dagger: '斗篷與匕首',
  adrenaline: '腎上腺素',
  impervious: '無懈可擊',
  demon_form: '惡魔形態',
  berserk: '狂暴',
  quick_slash: '迅捷斬擊',
  flurry: '疾風連斬',
  heavy_blade: '沉重之刃',
  trip: '絆倒',
  emergency_guard: '緊急防護',
  intimidate: '威嚇',
  noxious_blast: '劇毒爆裂',
  skewer: '穿刺連擊',
  entrench: '固守',
  seeing_red: '目露凶光',
  footwork: '靈巧步法',
  caltrops: '鐵蒺藜',
  die_die_die: '去死去死去死',
  barricade: '路障',
  noxious_fumes: '劇毒煙霧',
  wound: '傷口',
  burn: '燒傷',
  injury: '創傷',
  whirlwind: '旋風斬',
  metallicize: '金屬化',
  dramatic_entrance: '華麗登場',
  neutralize: '無力化',
  survivor: '生存者',
  crippling_cloud: '致殘毒雲',
  twin_fangs: '雙蛇之牙',
  bane: '禍根',
  dagger_spray: '飛刀齊射',
  dagger_throw: '飛刀投擲',
  deflect: '偏斜',
  dodge_and_roll: '翻滾閃避',
  flying_knee: '飛膝擊',
  outmaneuver: '聲東擊西',
  piercing_wail: '刺耳哀嚎',
  slice: '切割',
  acrobatics: '雜技身法',
  prepared: '蓄勢待發',
  accuracy: '精準',
  all_out_attack: '全力進攻',
  backstab: '背刺',
  blur: '殘影',
  bouncing_flask: '彈跳毒瓶',
  catalyst: '催化劑',
  finisher: '終結技',
  flechettes: '鏢雨',
  infinite_blades: '無盡刀刃',
  leg_sweep: '掃堂腿',
  predator: '掠食者',
  riddle_with_holes: '千瘡百孔',
  thousand_cuts: '千刀萬剮',
  after_image: '殘像',
  envenom: '淬毒',
  grand_finale: '終幕',
  tools_of_the_trade: '慣竊工具',
  unload: '傾囊而出',
  wraith_form: '幽魂形態',
};

/** Localized display name for a resolved card def (keeps the upgrade "+"). */
export function cardName(def: { id: string; name: string }): string {
  if (current !== 'zh') return def.name;
  const zh = CARD_ZH[def.id];
  if (!zh) return def.name;
  return def.name.endsWith('+') ? `${zh}+` : zh;
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

// --- Characters (engine names are canonical English; zh + blurbs overlaid) ---

const CHARACTER_L10N: Record<string, { name: Record<Locale, string>; desc: Record<Locale, string> }> = {
  warrior: {
    name: { en: 'The Wanderer', zh: '流浪劍士' },
    desc: {
      en: 'A sword-and-board fighter who crushes foes with Strength and Block.',
      zh: '攻守兼備的劍盾戰士，以力量與格擋正面壓制敵人。',
    },
  },
  assassin: {
    name: { en: 'The Night Blade', zh: '夜刃刺客' },
    desc: {
      en: 'A deadly assassin who wins through poison, daggers and swift footwork.',
      zh: '致命的女刺客，靠毒素、飛刀與靈巧步法置敵於死地。',
    },
  },
};

export function characterName(id: string, engineName: string): string {
  return CHARACTER_L10N[id]?.name[current] ?? engineName;
}

export function characterDesc(id: string): string {
  return CHARACTER_L10N[id]?.desc[current] ?? '';
}

/** Localized enemy display name; falls back to the engine (English) name. */
export function enemyName(defId: string, engineName: string): string {
  if (current === 'zh') return ENEMY_ZH[defId] ?? engineName;
  return engineName;
}

// --- Relic / potion names (engine names are canonical English; zh overlaid) ---

const RELIC_ZH: Record<string, string> = {
  burning_blood: '燃燒之血',
  snake_ring: '蛇之戒',
  vajra: '金剛杵',
  anchor: '船錨',
  bag_of_preparation: '準備背包',
  blood_vial: '血瓶',
  bronze_scales: '青銅鱗片',
  oddly_smooth_stone: '異常光滑的石頭',
  lantern: '提燈',
  bag_of_marbles: '彈珠袋',
  red_mask: '紅色面具',
  thread_and_needle: '針與線',
  twisted_funnel: '扭曲漏斗',
  strawberry: '草莓',
  mango: '芒果',
  whetstone: '磨刀石',
  potion_belt: '藥水腰帶',
  meat_on_the_bone: '帶骨肉',
};

/** Localized relic display name; falls back to the engine (English) name. */
export function relicName(id: string, engineName: string): string {
  return current === 'zh' ? (RELIC_ZH[id] ?? engineName) : engineName;
}

const POTION_ZH: Record<string, string> = {
  fire_potion: '火焰藥水',
  block_potion: '格擋藥水',
  strength_potion: '力量藥水',
  healing_potion: '血液藥水',
  weak_potion: '虛弱藥水',
};

/** Localized potion display name; falls back to the engine (English) name. */
export function potionName(id: string, engineName: string): string {
  return current === 'zh' ? (POTION_ZH[id] ?? engineName) : engineName;
}

// --- Relic / potion descriptions (engine descs are the zh source) ---

const RELIC_DESC_EN: Record<string, string> = {
  burning_blood: 'After each combat victory, heal 6 HP.',
  snake_ring: 'At the start of each combat, draw 2 additional cards.',
  vajra: 'At the start of each combat, gain 1 Strength.',
  anchor: 'At the start of each combat, gain 10 Block.',
  bag_of_preparation: 'At the start of each combat, draw 2 additional cards.',
  blood_vial: 'At the start of each combat, heal 2 HP.',
  bronze_scales: 'At the start of each combat, gain 3 Thorns.',
  oddly_smooth_stone: 'At the start of each combat, gain 1 Dexterity.',
  lantern: 'At the start of each combat, gain 1 Energy.',
  bag_of_marbles: 'At the start of each combat, apply 1 Vulnerable to all enemies.',
  red_mask: 'At the start of each combat, apply 1 Weak to all enemies.',
  thread_and_needle: 'At the start of each combat, gain 4 Metallicize.',
  twisted_funnel: 'At the start of each combat, apply 4 Poison to all enemies.',
  strawberry: 'On pickup, raise your max HP by 7.',
  mango: 'On pickup, raise your max HP by 14.',
  whetstone: 'On pickup, upgrade 2 random Attacks.',
  potion_belt: 'Gain 2 extra potion slots.',
  meat_on_the_bone: 'If your HP is at or below 50% after a victory, heal 12 HP.',
};

export function relicDesc(id: string, zhDesc: string): string {
  return current === 'en' ? (RELIC_DESC_EN[id] ?? zhDesc) : zhDesc;
}

const POTION_DESC_EN: Record<string, string> = {
  fire_potion: 'Deal 20 damage to an enemy.',
  block_potion: 'Gain 12 Block.',
  strength_potion: 'Gain 2 Strength.',
  healing_potion: 'Heal for 20% of your Max HP.',
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
