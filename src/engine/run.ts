/**
 * Run state machine: one act from map entrance to boss. Headless like the
 * battle engine — the UI only calls the public methods and renders state.
 */
import { Battle } from './battle';
import { CARDS, makeCard, makeStarterDeck } from './cards';
import { generateMap, getNode, type GameMap, type MapNode, type NodeKind } from './map';
import { Rng } from './rng';
import type { CardInstance, CardRarity } from './types';

export type RunPhase = 'map' | 'battle' | 'reward' | 'rest' | 'victory' | 'defeat';

/** Normal encounter pools by map depth (row <= maxRow picks that tier). */
const NORMAL_TIERS: { maxRow: number; pool: string[][] }[] = [
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
      ['jaw_worm', 'cultist'],
      ['acid_slime', 'acid_slime'],
      ['spike_slime_m', 'spike_slime_m'],
    ],
  },
];

const ELITE_POOL: string[][] = [
  ['jaw_worm', 'jaw_worm'],
  ['cultist', 'cultist'],
  ['louse_red', 'louse_red', 'louse_red'],
];

const BOSS_POOL: string[][] = [['boss_maw']];

const REST_HEAL_RATIO = 0.3;
const REWARD_CHOICES = 3;
const RARITY_WEIGHTS: [CardRarity, number][] = [
  ['common', 60],
  ['uncommon', 30],
  ['rare', 10],
];

export class Run {
  readonly rng: Rng;
  readonly map: GameMap;
  readonly deck: CardInstance[];
  hp: number;
  maxHp: number;
  phase: RunPhase = 'map';
  currentNodeId: string | null = null;
  /** Node ids already entered, for map rendering. */
  readonly visited: string[] = [];
  battle: Battle | null = null;
  /** Card def ids offered after the current battle victory. */
  cardRewards: string[] | null = null;

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.map = generateMap(this.rng);
    this.deck = makeStarterDeck();
    this.maxHp = 80;
    this.hp = 80;
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
    if (node.kind === 'rest') {
      this.phase = 'rest';
    } else {
      this.startBattle(node);
    }
  }

  private startBattle(node: MapNode): void {
    const enemies = this.rng.pick(this.encounterPool(node.kind, node.row));
    this.battle = new Battle({
      seed: this.rng.int(0, 2 ** 31 - 1),
      deck: this.deck,
      playerHp: this.hp,
      playerMaxHp: this.maxHp,
      enemies,
    });
    this.phase = 'battle';
  }

  private encounterPool(kind: NodeKind, row: number): string[][] {
    if (kind === 'boss') return BOSS_POOL;
    if (kind === 'elite') return ELITE_POOL;
    return NORMAL_TIERS.find((t) => row <= t.maxRow)!.pool;
  }

  /** Call after the battle reaches victory/defeat; moves the run forward. */
  resolveBattle(): void {
    if (this.phase !== 'battle' || !this.battle) throw new Error('No battle to resolve');
    const outcome = this.battle.state.phase;
    if (outcome === 'playerTurn') throw new Error('Battle still in progress');

    if (outcome === 'defeat') {
      this.hp = 0;
      this.phase = 'defeat';
      this.battle = null;
      return;
    }

    this.hp = this.battle.state.player.hp;
    const node = getNode(this.map, this.currentNodeId!);
    this.battle = null;
    if (node.kind === 'boss') {
      this.phase = 'victory';
    } else {
      this.cardRewards = this.rollCardRewards();
      this.phase = 'reward';
    }
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

  /** Take one offered card (or null to skip) and return to the map. */
  pickReward(defId: string | null): void {
    if (this.phase !== 'reward' || !this.cardRewards) throw new Error('No reward pending');
    if (defId !== null) {
      if (!this.cardRewards.includes(defId)) throw new Error(`${defId} was not offered`);
      this.deck.push(makeCard(defId));
    }
    this.cardRewards = null;
    this.phase = 'map';
  }

  restHeal(): void {
    if (this.phase !== 'rest') throw new Error('Not resting');
    this.hp = Math.min(this.maxHp, this.hp + Math.floor(this.maxHp * REST_HEAL_RATIO));
    this.phase = 'map';
  }

  /** Upgrade one deck card at the campfire instead of healing. */
  restUpgrade(deckIndex: number): void {
    if (this.phase !== 'rest') throw new Error('Not resting');
    const card = this.deck[deckIndex];
    if (!card) throw new Error(`No deck card at ${deckIndex}`);
    if (card.upgraded || !CARDS[card.defId]?.upgrade) throw new Error(`${card.defId} cannot upgrade`);
    card.upgraded = true;
    this.phase = 'map';
  }

  /** True if the deck card can be upgraded at a campfire. */
  canUpgrade(deckIndex: number): boolean {
    const card = this.deck[deckIndex];
    return !!card && !card.upgraded && !!CARDS[card.defId]?.upgrade;
  }
}
