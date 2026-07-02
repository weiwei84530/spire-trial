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
        { kind: 'addCard', card: 'wound', count: 1, destination: 'discardPile' },
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

define({
  id: 'louse_red',
  name: 'Red Louse',
  hp: [16, 20],
  moves: [
    { id: 'bite', intent: 'attack', effects: [{ kind: 'damage', amount: 6 }] },
    {
      id: 'grow',
      intent: 'buff',
      effects: [{ kind: 'applyStatus', status: 'strength', stacks: 3, target: 'self' }],
    },
  ],
  ai: {
    type: 'weighted',
    choices: [
      { move: 'bite', weight: 75, maxRepeat: 2 },
      { move: 'grow', weight: 25, maxRepeat: 1 },
    ],
  },
});

define({
  id: 'spike_slime_m',
  name: 'Spike Slime',
  hp: [28, 32],
  moves: [
    {
      id: 'flame_tackle',
      intent: 'attack',
      effects: [
        { kind: 'damage', amount: 8 },
        { kind: 'addCard', card: 'wound', count: 1, destination: 'discardPile' },
      ],
    },
    {
      id: 'lick',
      intent: 'debuff',
      effects: [{ kind: 'applyStatus', status: 'frail', stacks: 1, target: 'enemy' }],
    },
  ],
  ai: {
    type: 'weighted',
    choices: [
      { move: 'flame_tackle', weight: 30, maxRepeat: 2 },
      { move: 'lick', weight: 70, maxRepeat: 2 },
    ],
  },
});

// --- Act 2 roster ---

define({
  id: 'shelled_parasite',
  name: 'Shelled Parasite',
  hp: [40, 44],
  moves: [
    { id: 'double_strike', intent: 'attack', effects: [{ kind: 'damage', amount: 6, times: 2 }] },
    {
      id: 'harden',
      intent: 'defend',
      effects: [
        { kind: 'block', amount: 8 },
        { kind: 'applyStatus', status: 'metallicize', stacks: 2, target: 'self' },
      ],
    },
  ],
  ai: {
    type: 'weighted',
    choices: [
      { move: 'double_strike', weight: 60, maxRepeat: 2 },
      { move: 'harden', weight: 40, maxRepeat: 1 },
    ],
  },
});

define({
  id: 'byrd',
  name: 'Byrd',
  hp: [26, 30],
  moves: [
    { id: 'peck', intent: 'attack', effects: [{ kind: 'damage', amount: 1, times: 5 }] },
    { id: 'swoop', intent: 'attack', effects: [{ kind: 'damage', amount: 12 }] },
    {
      id: 'caw',
      intent: 'buff',
      effects: [{ kind: 'applyStatus', status: 'strength', stacks: 1, target: 'self' }],
    },
  ],
  ai: {
    type: 'weighted',
    choices: [
      { move: 'peck', weight: 50, maxRepeat: 2 },
      { move: 'swoop', weight: 25, maxRepeat: 1 },
      { move: 'caw', weight: 25, maxRepeat: 1 },
    ],
  },
});

define({
  id: 'chosen',
  name: 'Chosen',
  hp: [50, 55],
  moves: [
    { id: 'zap', intent: 'attack', effects: [{ kind: 'damage', amount: 14 }] },
    {
      id: 'debilitate',
      intent: 'debuff',
      effects: [
        { kind: 'applyStatus', status: 'weak', stacks: 2, target: 'enemy' },
        { kind: 'applyStatus', status: 'frail', stacks: 2, target: 'enemy' },
      ],
    },
    {
      id: 'drain',
      intent: 'buff',
      effects: [
        { kind: 'applyStatus', status: 'weak', stacks: 2, target: 'enemy' },
        { kind: 'heal', amount: 10 },
      ],
    },
  ],
  ai: { type: 'sequence', moves: ['debilitate', 'zap', 'drain', 'zap'], loopFrom: 1 },
});

define({
  id: 'snake_plant',
  name: 'Snake Plant',
  hp: [60, 65],
  moves: [
    { id: 'chomp', intent: 'attack', effects: [{ kind: 'damage', amount: 7, times: 3 }] },
    {
      id: 'enfeebling_spores',
      intent: 'debuff',
      effects: [
        { kind: 'applyStatus', status: 'frail', stacks: 2, target: 'enemy' },
        { kind: 'applyStatus', status: 'weak', stacks: 2, target: 'enemy' },
      ],
    },
  ],
  ai: {
    type: 'weighted',
    choices: [
      { move: 'chomp', weight: 65, maxRepeat: 2 },
      { move: 'enfeebling_spores', weight: 35, maxRepeat: 1 },
    ],
  },
});

define({
  id: 'centurion',
  name: 'Centurion',
  hp: [56, 60],
  moves: [
    { id: 'slash', intent: 'attack', effects: [{ kind: 'damage', amount: 12 }] },
    { id: 'heavy_slash', intent: 'attack', effects: [{ kind: 'damage', amount: 16 }] },
    { id: 'fury', intent: 'defend', effects: [{ kind: 'block', amount: 15 }] },
  ],
  ai: {
    type: 'weighted',
    choices: [
      { move: 'slash', weight: 45, maxRepeat: 2 },
      { move: 'heavy_slash', weight: 25, maxRepeat: 1 },
      { move: 'fury', weight: 30, maxRepeat: 1 },
    ],
  },
});

define({
  // Act 2 elite.
  id: 'gremlin_nob',
  name: 'Gremlin Nob',
  hp: [82, 86],
  moves: [
    {
      id: 'bellow',
      intent: 'buff',
      effects: [{ kind: 'applyStatus', status: 'ritual', stacks: 2, target: 'self' }],
    },
    { id: 'rush', intent: 'attack', effects: [{ kind: 'damage', amount: 14 }] },
    {
      id: 'skull_bash',
      intent: 'attack',
      effects: [
        { kind: 'damage', amount: 6 },
        { kind: 'applyStatus', status: 'vulnerable', stacks: 2, target: 'enemy' },
      ],
    },
  ],
  ai: { type: 'sequence', moves: ['bellow', 'skull_bash', 'rush', 'rush'], loopFrom: 1 },
});

define({
  // Act 2 boss: killing it splits it into two smaller slimes.
  id: 'slime_king',
  name: 'Slime King',
  hp: [95, 100],
  moves: [
    {
      id: 'goop_spray',
      intent: 'debuff',
      effects: [{ kind: 'addCard', card: 'wound', count: 2, destination: 'discardPile' }],
    },
    { id: 'crush', intent: 'attack', effects: [{ kind: 'damage', amount: 18 }] },
    {
      id: 'body_slam',
      intent: 'attack',
      effects: [
        { kind: 'damage', amount: 10 },
        { kind: 'block', amount: 10 },
      ],
    },
  ],
  ai: { type: 'sequence', moves: ['goop_spray', 'crush', 'body_slam'] },
  onDeath: { spawn: ['acid_slime', 'spike_slime_m'] },
});

define({
  // Placeholder Act 3 boss; the real one lands on Day 9.
  id: 'boss_maw',
  name: 'The Maw',
  hp: [88, 92],
  moves: [
    {
      id: 'roar',
      intent: 'buff',
      effects: [
        { kind: 'applyStatus', status: 'strength', stacks: 2, target: 'self' },
        { kind: 'block', amount: 9 },
      ],
    },
    { id: 'slam', intent: 'attack', effects: [{ kind: 'damage', amount: 14 }] },
    { id: 'double_bite', intent: 'attack', effects: [{ kind: 'damage', amount: 6, times: 2 }] },
  ],
  ai: { type: 'sequence', moves: ['roar', 'slam', 'double_bite'] },
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
