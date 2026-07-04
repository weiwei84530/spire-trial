import type { Rng } from './rng';

export type NodeKind = 'battle' | 'elite' | 'rest' | 'event' | 'shop' | 'boss';

export interface MapNode {
  id: string;
  row: number;
  col: number;
  kind: NodeKind;
  /** Ids of reachable nodes on the next row. Empty only for the boss node. */
  next: string[];
}

export interface GameMap {
  /** rows[0] is the act entrance; the last row is the single boss node. */
  rows: MapNode[][];
}

export interface MapOptions {
  /** Total rows including the boss row. */
  rows?: number;
  cols?: number;
  /** Number of bottom-to-top path walks carving the map. */
  walks?: number;
}

/**
 * Room-kind weights and constraints, scaled from the original game's
 * documented generator (7x15 grid, 6 walks; see docs/DESIGN.md for sources):
 * - Elites and rests never spawn in the early rows.
 * - The row right before the boss is always a campfire; the row below it never is.
 * - Elite / shop / rest rooms never chain along a path, and siblings from the
 *   same parent avoid duplicating a special kind.
 */
const ELITE_CHANCE = 0.1;
const REST_CHANCE = 0.13;
const SHOP_CHANCE = 0.06;
const EVENT_CHANCE = 0.22;
const SPECIAL_MIN_ROW_RATIO = 0.35; // elites/rests only past ~this fraction of the act
const NO_CHAIN: readonly NodeKind[] = ['elite', 'shop', 'rest'];

/** Entrances on row 0: always exactly this many distinct columns. */
export const START_NODE_COUNT = 5;

/** Default grid width; odd so the boss column (centre) is exact. The UI lays
    nodes out against this fixed span rather than the occupied extent, so the
    boss never drifts off-centre when edge columns happen to stay empty. */
export const GRID_COLS = 7;

/**
 * Generates a branching act map with the original game's algorithm, scaled
 * down: several random walks climb the grid one row at a time (steps of -1/0/+1
 * column), edges never cross, exactly START_NODE_COUNT distinct entrance
 * columns exist on row 0, and every top-row node feeds the single boss node
 * (always the centre column).
 */
export function generateMap(rng: Rng, opts: MapOptions = {}): GameMap {
  const rowCount = opts.rows ?? 10;
  const colCount = opts.cols ?? GRID_COLS;
  const gridRows = rowCount - 1; // walkable rows; the final row is the boss

  // Pre-pick the entrance columns; extra walks reuse one of them so the
  // bottom row never grows a sixth entrance (A4).
  const startCols: number[] = [];
  const colPool = Array.from({ length: colCount }, (_, i) => i);
  while (startCols.length < Math.min(START_NODE_COUNT, colCount)) {
    const idx = rng.int(0, colPool.length - 1);
    startCols.push(colPool.splice(idx, 1)[0]!);
  }
  const walkCount = Math.max(opts.walks ?? 6, startCols.length);

  const present: boolean[][] = Array.from({ length: gridRows }, () =>
    Array<boolean>(colCount).fill(false),
  );
  /** edges[r] holds [fromCol, toCol] pairs between grid rows r and r+1. */
  const edges: [number, number][][] = Array.from({ length: gridRows - 1 }, () => []);

  const hasEdge = (r: number, from: number, to: number) =>
    edges[r]!.some(([a, b]) => a === from && b === to);
  /** Two edges cross iff their column deltas straddle each other. */
  const crosses = (r: number, from: number, to: number) =>
    edges[r]!.some(([a, b]) => (a - from) * (b - to) < 0);

  for (let walk = 0; walk < walkCount; walk++) {
    let col = walk < startCols.length ? startCols[walk]! : rng.pick(startCols);
    present[0]![col] = true;
    for (let r = 0; r < gridRows - 1; r++) {
      const candidates = [col - 1, col, col + 1].filter(
        (c) => c >= 0 && c < colCount && !crosses(r, col, c),
      );
      // A straight step can never cross a +/-1 edge, so candidates is never empty.
      const to = candidates.length > 0 ? rng.pick(candidates) : col;
      if (!hasEdge(r, col, to)) edges[r]!.push([col, to]);
      present[r + 1]![to] = true;
      col = to;
    }
  }

  // Materialize nodes row by row (kinds assigned afterwards, top-down rules).
  const rows: MapNode[][] = [];
  for (let r = 0; r < gridRows; r++) {
    const rowNodes: MapNode[] = [];
    for (let c = 0; c < colCount; c++) {
      if (present[r]![c]) {
        rowNodes.push({ id: `r${r}c${c}`, row: r, col: c, kind: 'battle', next: [] });
      }
    }
    rows.push(rowNodes);
  }
  const bossCol = Math.floor(colCount / 2);
  const boss: MapNode = { id: `r${gridRows}c${bossCol}`, row: gridRows, col: bossCol, kind: 'boss', next: [] };
  rows.push([boss]);

  const nodeAt = (r: number, c: number) => rows[r]!.find((n) => n.col === c)!;
  for (let r = 0; r < gridRows - 1; r++) {
    for (const [from, to] of edges[r]!) {
      const node = nodeAt(r, from);
      const target = nodeAt(r + 1, to).id;
      if (!node.next.includes(target)) node.next.push(target);
    }
    for (const node of rows[r]!) node.next.sort();
  }
  for (const node of rows[gridRows - 1]!) node.next.push(boss.id);

  assignKinds(rows, gridRows, rng);
  return { rows };
}

function assignKinds(rows: MapNode[][], gridRows: number, rng: Rng): void {
  const specialMinRow = Math.max(2, Math.round(gridRows * SPECIAL_MIN_ROW_RATIO));
  const parentsOf = (node: MapNode, r: number): MapNode[] =>
    r === 0 ? [] : rows[r - 1]!.filter((p) => p.next.includes(node.id));

  const rollKind = (row: number): NodeKind => {
    if (row >= specialMinRow && rng.next() < ELITE_CHANCE) return 'elite';
    if (row >= specialMinRow && row !== gridRows - 2 && rng.next() < REST_CHANCE) return 'rest';
    if (rng.next() < SHOP_CHANCE) return 'shop';
    if (rng.next() < EVENT_CHANCE) return 'event';
    return 'battle';
  };

  for (let r = 0; r < gridRows; r++) {
    for (const node of rows[r]!) {
      if (r === 0) continue; // entrance row: battles only
      if (r === gridRows - 1) {
        node.kind = 'rest'; // guaranteed campfire right before the boss
        continue;
      }
      const parents = parentsOf(node, r);
      let kind = rollKind(r);
      for (let attempt = 0; attempt < 12; attempt++) {
        const chained =
          NO_CHAIN.includes(kind) && parents.some((p) => p.kind === kind);
        const siblingDup =
          kind !== 'battle' &&
          parents.some((p) =>
            p.next.some((id) => {
              const sibling = rows[r]!.find((n) => n.id === id);
              return sibling && sibling !== node && sibling.kind === kind;
            }),
          );
        if (!chained && !siblingDup) break;
        kind = rollKind(r);
      }
      node.kind = kind;
    }
  }

  // Guarantee at least one shop and one event per act by converting a random
  // middle-row battle node (never row 0, the pre-boss rest row, or the boss).
  const candidates = () =>
    rows
      .slice(1, gridRows - 1)
      .flat()
      .filter((n) => n.kind === 'battle');
  for (const kind of ['shop', 'event'] as const) {
    if (!rows.some((row) => row.some((n) => n.kind === kind))) {
      const pool = candidates();
      if (pool.length > 0) rng.pick(pool).kind = kind;
    }
  }
}

export function getNode(map: GameMap, id: string): MapNode {
  for (const row of map.rows) {
    const node = row.find((n) => n.id === id);
    if (node) return node;
  }
  throw new Error(`Unknown map node: ${id}`);
}
