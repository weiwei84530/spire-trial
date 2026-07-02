import type { EnemyDef, EnemyMove, EnemyState } from './types';
import type { Rng } from './rng';

/** Enemy database. Data-driven, same philosophy as cards.ts. */
export const ENEMIES: Record<string, EnemyDef> = {};

function define(def: EnemyDef): void {
  if (ENEMIES[def.id]) throw new Error(`Duplicate enemy id: ${def.id}`);
  ENEMIES[def.id] = def;
}

define({
  id: 'jaw_worm',
  name: 'Jaw Worm',
  hp: [40, 44],
  moves: [
    { id: 'chomp', intent: 'attack', effects: [{ kind: 'damage', amount: 11 }] },
    {
      id: 'thrash',
      intent: 'attack',
      effects: [
        { kind: 'damage', amount: 7 },
        { kind: 'block', amount: 5 },
      ],
    },
    {
      id: 'bellow',
      intent: 'buff',
      effects: [
        { kind: 'applyStatus', status: 'strength', stacks: 3, target: 'self' },
        { kind: 'block', amount: 6 },
      ],
    },
  ],
  ai: {
    type: 'weighted',
    choices: [
      { move: 'chomp', weight: 25, maxRepeat: 1 },
      { move: 'thrash', weight: 30, maxRepeat: 2 },
      { move: 'bellow', weight: 45, maxRepeat: 1 },
    ],
  },
});

define({
  id: 'cultist',
  name: 'Cultist',
  hp: [48, 54],
  moves: [
    {
      id: 'incantation',
      intent: 'buff',
      effects: [{ kind: 'applyStatus', status: 'ritual', stacks: 3, target: 'self' }],
    },
    { id: 'dark_strike', intent: 'attack', effects: [{ kind: 'damage', amount: 6 }] },
  ],
  // Incantation once, then Dark Strike forever.
  ai: { type: 'sequence', moves: ['incantation', 'dark_strike'], loopFrom: 1 },
});

define({
  id: 'acid_slime',
  name: 'Acid Slime',
  hp: [28, 32],
  moves: [
    { id: 'tackle', intent: 'attack', effects: [{ kind: 'damage', amount: 10 }] },
    {
      id: 'corrosive_spit',
      intent: 'attack',
      effects: [
        { kind: 'damage', amount: 7 },
        { kind: 'applyStatus', status: 'weak', stacks: 1, target: 'enemy' },
      ],
    },
    {
      id: 'lick',
      intent: 'debuff',
      effects: [{ kind: 'applyStatus', status: 'weak', stacks: 2, target: 'enemy' }],
    },
  ],
  ai: {
    type: 'weighted',
    choices: [
      { move: 'tackle', weight: 30, maxRepeat: 2 },
      { move: 'corrosive_spit', weight: 40, maxRepeat: 2 },
      { move: 'lick', weight: 30, maxRepeat: 1 },
    ],
  },
});

export function getEnemyDef(defId: string): EnemyDef {
  const def = ENEMIES[defId];
  if (!def) throw new Error(`Unknown enemy: ${defId}`);
  return def;
}

export function getMove(def: EnemyDef, moveId: string): EnemyMove {
  const move = def.moves.find((m) => m.id === moveId);
  if (!move) throw new Error(`Enemy ${def.id} has no move ${moveId}`);
  return move;
}

/** Counts how many times the newest entries of history repeat the given move consecutively. */
function tailRepeats(history: string[], moveId: string): number {
  let count = 0;
  for (let i = history.length - 1; i >= 0 && history[i] === moveId; i--) count++;
  return count;
}

/** Picks the enemy's next move according to its AI pattern. */
export function chooseMove(def: EnemyDef, history: string[], rng: Rng): string {
  const ai = def.ai;
  if (ai.type === 'sequence') {
    const idx = history.length;
    if (idx < ai.moves.length) return ai.moves[idx]!;
    const loopFrom = ai.loopFrom ?? 0;
    const loopLen = ai.moves.length - loopFrom;
    return ai.moves[loopFrom + ((idx - loopFrom) % loopLen)]!;
  }

  const eligible = ai.choices.filter(
    (c) => c.maxRepeat === undefined || tailRepeats(history, c.move) < c.maxRepeat,
  );
  const pool = eligible.length > 0 ? eligible : ai.choices;
  const total = pool.reduce((sum, c) => sum + c.weight, 0);
  let roll = rng.next() * total;
  for (const choice of pool) {
    roll -= choice.weight;
    if (roll < 0) return choice.move;
  }
  return pool[pool.length - 1]!.move;
}

export function spawnEnemy(defId: string, rng: Rng): EnemyState {
  const def = getEnemyDef(defId);
  const hp = rng.int(def.hp[0], def.hp[1]);
  const enemy: EnemyState = {
    defId,
    name: def.name,
    hp,
    maxHp: hp,
    block: 0,
    statuses: {},
    nextMoveId: '',
    moveHistory: [],
  };
  enemy.nextMoveId = chooseMove(def, enemy.moveHistory, rng);
  return enemy;
}
