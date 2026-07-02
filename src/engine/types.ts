/** Core data types for the battle engine. Everything here is UI-agnostic. */

export type StatusId =
  | 'vulnerable'
  | 'weak'
  | 'frail'
  | 'strength'
  | 'dexterity'
  | 'poison'
  | 'ritual';

/** Target selector for effects. 'enemy' means the card's chosen target. */
export type EffectTarget = 'enemy' | 'allEnemies' | 'self';

/** Atomic effects. Cards and enemy moves are compositions of these. */
export type Effect =
  | { kind: 'damage'; amount: number; times?: number; target?: 'enemy' | 'allEnemies' }
  | { kind: 'block'; amount: number }
  | { kind: 'applyStatus'; status: StatusId; stacks: number; target: EffectTarget }
  | { kind: 'draw'; count: number }
  | { kind: 'gainEnergy'; amount: number }
  | { kind: 'loseHp'; amount: number };

export type CardType = 'attack' | 'skill' | 'power';
export type CardRarity = 'starter' | 'common' | 'uncommon' | 'rare';

/** What the card needs selected when played. 'none' includes AoE and self-only cards. */
export type CardTarget = 'enemy' | 'none';

export interface CardDef {
  id: string;
  name: string;
  type: CardType;
  rarity: CardRarity;
  cost: number;
  target: CardTarget;
  effects: Effect[];
  /** Removed from the battle deck after being played (powers always exhaust). */
  exhaust?: boolean;
  /** Overrides applied when the card is upgraded. Name gets a "+" suffix automatically. */
  upgrade?: Partial<Pick<CardDef, 'cost' | 'effects' | 'exhaust'>>;
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
