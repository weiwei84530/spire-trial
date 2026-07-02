/** Core data types for the battle engine. Everything here is UI-agnostic. */

export type StatusId =
  | 'vulnerable'
  | 'weak'
  | 'frail'
  | 'strength'
  | 'dexterity'
  | 'poison'
  | 'ritual'
  | 'metallicize'
  | 'thorns';

/** Target selector for effects. 'enemy' means the card's chosen target. */
export type EffectTarget = 'enemy' | 'allEnemies' | 'self';

/** Where a card created mid-battle is put. */
export type PileId = 'hand' | 'drawPile' | 'discardPile';

/** Atomic effects. Cards and enemy moves are compositions of these.
 * `times: 'x'` on damage repeats once per energy spent on an X-cost card. */
export type Effect =
  | { kind: 'damage'; amount: number; times?: number | 'x'; target?: 'enemy' | 'allEnemies' }
  | { kind: 'block'; amount: number }
  | { kind: 'applyStatus'; status: StatusId; stacks: number; target: EffectTarget }
  | { kind: 'draw'; count: number }
  | { kind: 'gainEnergy'; amount: number }
  | { kind: 'loseHp'; amount: number }
  | { kind: 'heal'; amount: number }
  | { kind: 'addCard'; card: string; count?: number; destination: PileId };

export type CardType = 'attack' | 'skill' | 'power' | 'status' | 'curse';
export type CardRarity = 'starter' | 'common' | 'uncommon' | 'rare' | 'special';

/** What the card needs selected when played. 'none' includes AoE and self-only cards. */
export type CardTarget = 'enemy' | 'none';

export interface CardDef {
  id: string;
  name: string;
  type: CardType;
  rarity: CardRarity;
  /** Energy cost. 'x' spends all remaining energy (see Effect times: 'x'). */
  cost: number | 'x';
  target: CardTarget;
  effects: Effect[];
  /** Removed from the battle deck after being played (powers always exhaust). */
  exhaust?: boolean;
  /** Card cannot be played at all (status/curse cards). */
  unplayable?: boolean;
  /** Always drawn in the opening hand. */
  innate?: boolean;
  /** If the card is in hand when the turn ends, the player takes this much damage (e.g. Burn). */
  selfDamageAtTurnEnd?: number;
  /** Overrides applied when the card is upgraded. Name gets a "+" suffix automatically. */
  upgrade?: Partial<Pick<CardDef, 'cost' | 'effects' | 'exhaust' | 'selfDamageAtTurnEnd'>>;
}

/** A concrete card in a deck (two Strikes are two instances of the same def). */
export interface CardInstance {
  instanceId: number;
  defId: string;
  upgraded: boolean;
}

export interface Actor {
  hp: number;
  maxHp: number;
  block: number;
  statuses: Partial<Record<StatusId, number>>;
}

export interface PlayerState extends Actor {
  energy: number;
  maxEnergy: number;
  hand: CardInstance[];
  drawPile: CardInstance[];
  discardPile: CardInstance[];
  exhaustPile: CardInstance[];
}

export type IntentKind = 'attack' | 'defend' | 'buff' | 'debuff';

export interface EnemyMove {
  id: string;
  intent: IntentKind;
  effects: Effect[];
}

/** AI pattern: fixed loop, or weighted random with a same-move repeat cap. */
export type EnemyAi =
  | { type: 'sequence'; moves: string[]; loopFrom?: number }
  | { type: 'weighted'; choices: { move: string; weight: number; maxRepeat?: number }[] };

export interface EnemyDef {
  id: string;
  name: string;
  hp: [min: number, max: number];
  moves: EnemyMove[];
  ai: EnemyAi;
}

export interface EnemyState extends Actor {
  defId: string;
  name: string;
  /** Id of the move this enemy will execute on its next turn (shown as intent). */
  nextMoveId: string;
  /** Recent move ids, newest last. Used by AI repeat constraints. */
  moveHistory: string[];
}

export type BattlePhase = 'playerTurn' | 'victory' | 'defeat';

export interface BattleState {
  turn: number;
  phase: BattlePhase;
  player: PlayerState;
  enemies: EnemyState[];
  /** Human-readable event log for UI and debugging. */
  log: string[];
}
