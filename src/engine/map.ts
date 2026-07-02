import type { Rng } from './rng';

export type NodeKind = 'battle' | 'elite' | 'rest' | 'boss';

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
  rows?: number;
  cols?: number;
}

const ELITE_MIN_ROW = 3;
const ELITE_CHANCE = 0.16;
const REST_CHANCE = 0.14;

function kindFor(row: number, rowCount: number, rng: Rng): NodeKind {
  if (row === 0) return 'battle';
  if (row === rowCount - 1) return 'boss';
  if (row === rowCount - 2) return 'rest'; // guaranteed campfire before the boss
  if (row >= ELITE_MIN_ROW && rng.next() < ELITE_CHANCE) return 'elite';
  if (row >= 2 && rng.next() < REST_CHANCE) return 'rest';
  return 'battle';
}

/**
 * Generates a branching act map, StS-style but simplified:
 * 2-3 nodes per row, monotone (non-crossing) edges between adjacent rows,
 * single boss node on top. Every node is reachable from row 0 and every
 * path ends at the boss, by construction.
 */
export function generateMap(rng: Rng, opts: MapOptions = {}): GameMap {
  const rowCount = opts.rows ?? 10;
  const colCount = opts.cols ?? 4;

  const rows: MapNode[][] = [];
  for (let r = 0; r < rowCount; r++) {
    let activeCols: number[];
    if (r === rowCount - 1) {
      activeCols = [Math.floor(colCount / 2)];
    } else {
      const count = rng.int(2, Math.min(3, colCount));
      const all = Array.from({ length: colCount }, (_, i) => i);
      rng.shuffle(all);
      activeCols = all.slice(0, count).sort((a, b) => a - b);
    }
    rows.push(
      activeCols.map((col) => ({
        id: `r${r}c${col}`,
        row: r,
        col,
        kind: kindFor(r, rowCount, rng),
        next: [],
      })),
    );
  }

  // Monotone two-pointer merge between adjacent rows: covers every node on
  // both rows with no crossing edges.
  for (let r = 0; r < rowCount - 1; r++) {
    const a = rows[r]!;
    const b = rows[r + 1]!;
    let i = 0;
    let j = 0;
    a[i]!.next.push(b[j]!.id);
    while (i < a.length - 1 || j < b.length - 1) {
      const na = a.length === 1 ? 1 : i / (a.length - 1);
      const nb = b.length === 1 ? 1 : j / (b.length - 1);
      if (j < b.length - 1 && (nb <= na || i === a.length - 1)) j++;
      else i++;
      a[i]!.next.push(b[j]!.id);
    }
  }

  return { rows };
}

export function getNode(map: GameMap, id: string): MapNode {
  for (const row of map.rows) {
    const node = row.find((n) => n.id === id);
    if (node) return node;
  }
  throw new Error(`Unknown map node: ${id}`);
}
