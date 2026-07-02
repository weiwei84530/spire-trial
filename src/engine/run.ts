/**
 * Run state machine: one act from map entrance to boss. Headless like the
 * battle engine — the UI only calls the public methods and renders state.
 */
import { Battle } from './battle';
import { CARDS, ensureInstanceIdAbove, makeCard, makeStarterDeck } from './cards';
import { EVENTS, type EventDef } from './events';
import { generateMap, getNode, type GameMap, type MapNode, type NodeKind } from './map';
import { getPotionDef, POTION_IDS } from './potions';
import { RELICS, getRelicDef } from './relics';
import { Rng } from './rng';
import type { CardInstance, CardRarity } from './types';

export type RunPhase =
  | 'map'
  | 'battle'
  | 'reward'
  | 'rest'
  | 'event'
  | 'shop'
  | 'actTransition'
  | 'victory'
  | 'defeat';

export const ACT_COUNT = 3;

/**
 * Enemy max-HP multiplier per act. All acts now have native rosters, so this
 * is 1 everywhere; kept as the hook for future ascension-style difficulty.
 */
export function actHpScale(_act: number): number {
  return 1;
}

export interface RunStats {
  battlesWon: number;
  turnsTotal: number;
  damageDealt: number;
  damageTaken: number;
}

/** Snapshot of a run at map phase. Everything is plain JSON-able data. */
export interface RunSave {
  version: 1;
  rngState: number;
  act: number;
  map: GameMap;
  currentNodeId: string | null;
  visited: string[];
  deck: CardInstance[];
  hp: number;
  maxHp: number;
  gold: number;
  relics: string[];
  potions: string[];
  stats: RunStats;
}

interface ActEncounters {
  /** Normal pools by map depth (row <= maxRow picks that tier). */
  normal: { maxRow: number; pool: string[][] }[];
  elite: string[][];
  boss: string[][];
}

const ACT_1: ActEncounters = {
  normal: [
    { maxRow: 2, pool: [['jaw_worm'], ['cultist'], ['acid_slime'], ['louse_red'], ['spike_slime_m']] },
    {
      maxRow: 5,
      pool: [
        ['louse_red', 'louse_red'],
        ['acid_slime', 'spike_slime_m'],
        ['jaw_worm', 'louse_red'],
      ],
    },
    {
      maxRow: Infinity,
      pool: [
        ['louse_red', 'louse_red', 'louse_red'],
        ['acid_slime', 'acid_slime'],
        ['spike_slime_m', 'spike_slime_m'],
      ],
    },
  ],
  // Measured at 49-69 avg HP loss on a starter deck: real elite threats.
  elite: [
    ['jaw_worm', 'jaw_worm'],
    ['cultist', 'cultist'],
    ['jaw_worm', 'cultist'],
  ],
  boss: [['boss_maw']],
};

const ACT_2: ActEncounters = {
  normal: [
    { maxRow: 2, pool: [['shelled_parasite'], ['chosen'], ['byrd', 'byrd'], ['centurion']] },
    {
      maxRow: 5,
      pool: [
        ['byrd', 'byrd', 'byrd'],
        ['shelled_parasite', 'byrd'],
        ['snake_plant'],
        ['centurion', 'chosen'],
      ],
    },
    {
      maxRow: Infinity,
      pool: [
        ['snake_plant', 'byrd'],
        ['chosen', 'chosen'],
        ['shelled_parasite', 'centurion'],
      ],
    },
  ],
  // snake_plant x2 simulated at a 0% win rate — never ship that again.
  elite: [['gremlin_nob'], ['chosen', 'chosen']],
  boss: [['slime_king']],
};

const ACT_3: ActEncounters = {
  normal: [
    { maxRow: 2, pool: [['darkling'], ['orb_walker'], ['writhing_mass']] },
    {
      maxRow: 5,
      pool: [
        ['darkling', 'darkling'],
        ['spire_growth'],
        ['orb_walker', 'darkling'],
      ],
    },
    {
      maxRow: Infinity,
      pool: [
        ['writhing_mass', 'orb_walker'],
        ['spire_growth', 'darkling'],
      ],
    },
  ],
  elite: [['giant_head']],
  boss: [['the_shadow']],
};

const ACTS: Record<number, ActEncounters> = { 1: ACT_1, 2: ACT_2, 3: ACT_3 };

const REST_HEAL_RATIO = 0.3;
const REWARD_CHOICES = 3;
const MAX_POTIONS = 3;
const POTION_DROP_CHANCE = 0.3;
const CARD_REMOVE_PRICE = 75;
const RARITY_WEIGHTS: [CardRarity, number][] = [
  ['common', 60],
  ['uncommon', 30],
  ['rare', 10],
];
const CARD_PRICES: Record<string, [number, number]> = {
  common: [45, 55],
  uncommon: [68, 82],
  rare: [135, 150],
};

/** Everything gained from one battle victory; cards are pick-one. */
export interface RewardBundle {
  gold: number;
  cards: string[];
  relic: string | null;
  potion: string | null;
}

export interface ShopStock {
  cards: { defId: string; price: number; sold: boolean }[];
  relics: { id: string; price: number; sold: boolean }[];
  potions: { id: string; price: number; sold: boolean }[];
  removePrice: number;
  removeUsed: boolean;
}

export class Run {
  readonly rng: Rng;
  map: GameMap;
  act = 1;
  readonly deck: CardInstance[];
  hp: number;
  maxHp: number;
  gold = 99;
  readonly relics: string[] = ['burning_blood'];
  readonly potions: string[] = [];
  phase: RunPhase = 'map';
  currentNodeId: string | null = null;
  /** Node ids already entered, for map rendering. */
  readonly visited: string[] = [];
  readonly stats: RunStats = { battlesWon: 0, turnsTotal: 0, damageDealt: 0, damageTaken: 0 };
  battle: Battle | null = null;
  reward: RewardBundle | null = null;
  currentEvent: EventDef | null = null;
  /** Result text of the chosen event option, shown before returning to the map. */
  eventResult: string | null = null;
  shop: ShopStock | null = null;
  /** Player HP when the current battle started, for damage-taken stats. */
  private battleStartHp = 0;

  constructor(seed: number, save?: RunSave) {
    if (save) {
      this.rng = new Rng(save.rngState);
      this.act = save.act ?? 1;
      this.map = save.map;
      this.deck = save.deck;
      this.hp = save.hp;
      this.maxHp = save.maxHp;
      this.gold = save.gold;
      this.relics = [...save.relics];
      this.potions = [...save.potions];
      this.currentNodeId = save.currentNodeId;
      this.visited = [...save.visited];
      this.stats = { ...save.stats };
      ensureInstanceIdAbove(Math.max(0, ...save.deck.map((c) => c.instanceId)));
      return;
    }
    this.rng = new Rng(seed);
    this.map = generateMap(this.rng);
    this.deck = makeStarterDeck();
    this.maxHp = 80;
    this.hp = 80;
  }

  /** Snapshot for persistence. Only legal between nodes (map phase). */
  toSave(): RunSave {
    if (this.phase !== 'map') throw new Error('Can only save at the map');
    return {
      version: 1,
      rngState: this.rng.getState(),
      act: this.act,
      map: this.map,
      currentNodeId: this.currentNodeId,
      visited: [...this.visited],
      deck: this.deck.map((c) => ({ ...c })),
      hp: this.hp,
      maxHp: this.maxHp,
      gold: this.gold,
      relics: [...this.relics],
      potions: [...this.potions],
      stats: { ...this.stats },
    };
  }

  static fromSave(save: RunSave): Run {
    return new Run(0, save);
  }

  /** Nodes the player may enter right now (row 0 at start, else current node's edges). */
  availableNodes(): MapNode[] {
    if (this.phase !== 'map') return [];
    if (this.currentNodeId === null) return this.map.rows[0]!;
    return getNode(this.map, this.currentNodeId).next.map((id) => getNode(this.map, id));
  }

  enterNode(id: string): void {
    const node = this.availableNodes().find((n) => n.id === id);
    if (!node) throw new Error(`Node ${id} is not reachable now`);
    this.currentNodeId = id;
    this.visited.push(id);
    switch (node.kind) {
      case 'rest':
        this.phase = 'rest';
        break;
      case 'event':
        this.currentEvent = this.rng.pick(EVENTS);
        this.eventResult = null;
        this.phase = 'event';
        break;
      case 'shop':
        this.shop = this.rollShopStock();
        this.phase = 'shop';
        break;
      default:
        this.startBattle(node);
    }
  }

  // --- battle ---

  private startBattle(node: MapNode): void {
    this.battleStartHp = this.hp;
    const enemies = this.rng.pick(this.encounterPool(node.kind, node.row));
    const startEffects = this.relics.flatMap((id) => getRelicDef(id).battleStart ?? []);
    this.battle = new Battle({
      seed: this.rng.int(0, 2 ** 31 - 1),
      deck: this.deck,
      playerHp: this.hp,
      playerMaxHp: this.maxHp,
      enemies,
      startEffects,
      enemyHpScale: actHpScale(this.act),
    });
    this.phase = 'battle';
  }

  private encounterPool(kind: NodeKind, row: number): string[][] {
    const act = ACTS[this.act] ?? ACT_3;
    if (kind === 'boss') return act.boss;
    if (kind === 'elite') return act.elite;
    return act.normal.find((t) => row <= t.maxRow)!.pool;
  }

  /** Call after the battle reaches victory/defeat; moves the run forward. */
  resolveBattle(): void {
    if (this.phase !== 'battle' || !this.battle) throw new Error('No battle to resolve');
    const outcome = this.battle.state.phase;
    if (outcome === 'playerTurn') throw new Error('Battle still in progress');

    // Damage dealt = total enemy HP removed (includes poison and thorns).
    this.stats.turnsTotal += this.battle.state.turn;
    this.stats.damageDealt += this.battle.state.enemies.reduce(
      (sum, e) => sum + (e.maxHp - Math.max(0, e.hp)),
      0,
    );

    if (outcome === 'defeat') {
      this.stats.damageTaken += this.battleStartHp;
      this.hp = 0;
      this.phase = 'defeat';
      this.battle = null;
      return;
    }

    this.stats.battlesWon++;
    this.stats.damageTaken += Math.max(0, this.battleStartHp - this.battle.state.player.hp);
    this.hp = this.battle.state.player.hp;
    const victoryHeal = this.relics.reduce((sum, id) => sum + (getRelicDef(id).victoryHeal ?? 0), 0);
    this.hp = Math.min(this.maxHp, this.hp + victoryHeal);

    const node = getNode(this.map, this.currentNodeId!);
    this.battle = null;
    if (node.kind === 'boss') {
      if (this.act >= ACT_COUNT) {
        this.phase = 'victory';
        return;
      }
      // Act cleared: boss loot, then pickReward() advances to the next act.
      const bossGold = this.rng.int(60, 75);
      this.gold += bossGold;
      const relic = this.randomUnownedRelic();
      if (relic) this.relics.push(relic);
      this.reward = { gold: bossGold, cards: this.rollCardRewards(), relic, potion: null };
      this.phase = 'actTransition';
      return;
    }

    const isElite = node.kind === 'elite';
    const gold = isElite ? this.rng.int(28, 40) : this.rng.int(12, 20);
    this.gold += gold;
    let relic: string | null = null;
    if (isElite) {
      relic = this.randomUnownedRelic();
      if (relic) this.relics.push(relic);
    }
    let potion: string | null = null;
    if (this.rng.next() < POTION_DROP_CHANCE && this.potions.length < MAX_POTIONS) {
      potion = this.rng.pick(POTION_IDS);
      this.potions.push(potion);
    }
    this.reward = { gold, cards: this.rollCardRewards(), relic, potion };
    this.phase = 'reward';
  }

  /** Use a held potion during battle. Enemy-targeted potions need targetIndex. */
  usePotion(potionIndex: number, targetIndex?: number): void {
    if (this.phase !== 'battle' || !this.battle) throw new Error('Potions are battle-only');
    const id = this.potions[potionIndex];
    if (!id) throw new Error(`No potion at ${potionIndex}`);
    const def = getPotionDef(id);
    if (def.target === 'enemy' && targetIndex === undefined) throw new Error(`${id} needs a target`);
    this.battle.usePotion(def.effects, def.target === 'enemy' ? targetIndex : undefined);
    this.potions.splice(potionIndex, 1);
    if (this.battle.state.phase !== 'playerTurn') this.resolveBattle();
  }

  private rollCardRewards(): string[] {
    const byRarity = (rarity: CardRarity) =>
      Object.values(CARDS)
        .filter((c) => c.rarity === rarity && !c.unplayable)
        .map((c) => c.id);
    const totalWeight = RARITY_WEIGHTS.reduce((s, [, w]) => s + w, 0);
    const picks: string[] = [];
    let guard = 50;
    while (picks.length < REWARD_CHOICES && guard-- > 0) {
      let roll = this.rng.next() * totalWeight;
      let rarity: CardRarity = 'common';
      for (const [r, w] of RARITY_WEIGHTS) {
        roll -= w;
        if (roll < 0) {
          rarity = r;
          break;
        }
      }
      const pool = byRarity(rarity).filter((id) => !picks.includes(id));
      if (pool.length > 0) picks.push(this.rng.pick(pool));
    }
    return picks;
  }

  private randomUnownedRelic(): string | null {
    const pool = Object.keys(RELICS).filter((id) => !this.relics.includes(id));
    return pool.length > 0 ? this.rng.pick(pool) : null;
  }

  /** Take one offered card (or null to skip); returns to the map or starts the next act. */
  pickReward(defId: string | null): void {
    if ((this.phase !== 'reward' && this.phase !== 'actTransition') || !this.reward) {
      throw new Error('No reward pending');
    }
    if (defId !== null) {
      if (!this.reward.cards.includes(defId)) throw new Error(`${defId} was not offered`);
      this.deck.push(makeCard(defId));
    }
    const advancing = this.phase === 'actTransition';
    this.reward = null;
    if (advancing) this.advanceAct();
    else this.phase = 'map';
  }

  /** Full heal, fresh map, next act. */
  private advanceAct(): void {
    this.act++;
    this.hp = this.maxHp;
    this.map = generateMap(this.rng);
    this.currentNodeId = null;
    this.visited.length = 0;
    this.phase = 'map';
  }

  // --- rest ---

  restHeal(): void {
    if (this.phase !== 'rest') throw new Error('Not resting');
    this.hp = Math.min(this.maxHp, this.hp + Math.floor(this.maxHp * REST_HEAL_RATIO));
    this.phase = 'map';
  }

  /** Upgrade one deck card at the campfire instead of healing. */
  restUpgrade(deckIndex: number): void {
    if (this.phase !== 'rest') throw new Error('Not resting');
    if (!this.canUpgrade(deckIndex)) throw new Error(`Deck card ${deckIndex} cannot upgrade`);
    this.deck[deckIndex]!.upgraded = true;
    this.phase = 'map';
  }

  /** True if the deck card can be upgraded at a campfire. */
  canUpgrade(deckIndex: number): boolean {
    const card = this.deck[deckIndex];
    return !!card && !card.upgraded && !!CARDS[card.defId]?.upgrade;
  }

  // --- events ---

  canChooseEventOption(choiceIndex: number): boolean {
    const choice = this.currentEvent?.choices[choiceIndex];
    if (!choice) return false;
    return this.gold + (choice.gold ?? 0) >= 0;
  }

  chooseEventOption(choiceIndex: number): void {
    if (this.phase !== 'event' || !this.currentEvent) throw new Error('No event active');
    if (this.eventResult !== null) throw new Error('Event already resolved');
    if (!this.canChooseEventOption(choiceIndex)) throw new Error('Cannot afford this choice');
    const choice = this.currentEvent.choices[choiceIndex]!;

    if (choice.gold) this.gold += choice.gold;
    if (choice.hp) {
      // Events never kill: HP loss floors at 1.
      this.hp = Math.max(1, Math.min(this.maxHp, this.hp + choice.hp));
    }
    if (choice.gainRelic) {
      const relic = this.randomUnownedRelic();
      if (relic) this.relics.push(relic);
    }
    if (choice.gainCard) this.deck.push(makeCard(choice.gainCard));
    if (choice.upgradeRandom) {
      const upgradable = this.deck.map((_, i) => i).filter((i) => this.canUpgrade(i));
      if (upgradable.length > 0) this.deck[this.rng.pick(upgradable)]!.upgraded = true;
    }
    this.eventResult = choice.result;
  }

  /** Dismiss the event result text and return to the map. */
  leaveEvent(): void {
    if (this.phase !== 'event') throw new Error('No event active');
    this.currentEvent = null;
    this.eventResult = null;
    this.phase = 'map';
  }

  // --- shop ---

  private rollShopStock(): ShopStock {
    const cards: ShopStock['cards'] = [];
    let guard = 30;
    while (cards.length < 3 && guard-- > 0) {
      const picks = this.rollCardRewards();
      for (const defId of picks) {
        if (cards.length >= 3 || cards.some((c) => c.defId === defId)) continue;
        const [lo, hi] = CARD_PRICES[CARDS[defId]!.rarity] ?? [50, 60];
        cards.push({ defId, price: this.rng.int(lo, hi), sold: false });
      }
    }
    const relicId = this.randomUnownedRelic();
    return {
      cards,
      relics: relicId ? [{ id: relicId, price: this.rng.int(140, 160), sold: false }] : [],
      potions: [{ id: this.rng.pick(POTION_IDS), price: this.rng.int(48, 58), sold: false }],
      removePrice: CARD_REMOVE_PRICE,
      removeUsed: false,
    };
  }

  private spend(price: number): void {
    if (this.gold < price) throw new Error('Not enough gold');
    this.gold -= price;
  }

  buyCard(index: number): void {
    if (this.phase !== 'shop' || !this.shop) throw new Error('Not in shop');
    const item = this.shop.cards[index];
    if (!item || item.sold) throw new Error('Not for sale');
    this.spend(item.price);
    this.deck.push(makeCard(item.defId));
    item.sold = true;
  }

  buyRelic(index: number): void {
    if (this.phase !== 'shop' || !this.shop) throw new Error('Not in shop');
    const item = this.shop.relics[index];
    if (!item || item.sold) throw new Error('Not for sale');
    this.spend(item.price);
    this.relics.push(item.id);
    item.sold = true;
  }

  buyPotion(index: number): void {
    if (this.phase !== 'shop' || !this.shop) throw new Error('Not in shop');
    const item = this.shop.potions[index];
    if (!item || item.sold) throw new Error('Not for sale');
    if (this.potions.length >= MAX_POTIONS) throw new Error('Potion slots full');
    this.spend(item.price);
    this.potions.push(item.id);
    item.sold = true;
  }

  /** Pay to permanently remove one card from the deck (once per shop). */
  removeCard(deckIndex: number): void {
    if (this.phase !== 'shop' || !this.shop) throw new Error('Not in shop');
    if (this.shop.removeUsed) throw new Error('Removal already used');
    if (!this.deck[deckIndex]) throw new Error(`No deck card at ${deckIndex}`);
    this.spend(this.shop.removePrice);
    this.deck.splice(deckIndex, 1);
    this.shop.removeUsed = true;
  }

  leaveShop(): void {
    if (this.phase !== 'shop') throw new Error('Not in shop');
    this.shop = null;
    this.phase = 'map';
  }
}
