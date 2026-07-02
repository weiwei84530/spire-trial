import { Battle } from '../engine/battle';
import type { CardInstance } from '../engine/types';
import { greedyPolicy, type Policy } from './policy';

export interface SimOptions {
  /** Factory so every run gets fresh card instances. */
  deck: () => CardInstance[];
  enemies: string[];
  runs: number;
  playerHp?: number;
  policy?: Policy;
  baseSeed?: number;
}

export interface SimResult {
  runs: number;
  winRate: number;
  /** Average HP lost per run (max HP on defeat). */
  avgHpLoss: number;
  avgTurns: number;
}

const MAX_ACTIONS_PER_RUN = 2000;

/** Plays `runs` battles with the given policy and aggregates outcome stats. */
export function simulate(opts: SimOptions): SimResult {
  const policy = opts.policy ?? greedyPolicy;
  const playerHp = opts.playerHp ?? 80;
  const baseSeed = opts.baseSeed ?? 1;

  let wins = 0;
  let totalHpLoss = 0;
  let totalTurns = 0;

  for (let run = 0; run < opts.runs; run++) {
    const battle = new Battle({
      seed: baseSeed + run * 7919, // spread seeds; any odd prime stride works
      deck: opts.deck(),
      playerHp,
      playerMaxHp: playerHp,
      enemies: opts.enemies,
    });

    let safety = MAX_ACTIONS_PER_RUN;
    while (battle.state.phase === 'playerTurn' && safety-- > 0) {
      const action = policy(battle);
      if (action.type === 'end') battle.endTurn();
      else battle.playCard(action.index, action.target);
    }
    if (safety <= 0) throw new Error(`Simulation did not terminate (run ${run})`);

    if (battle.state.phase === 'victory') {
      wins++;
      totalHpLoss += playerHp - battle.state.player.hp;
    } else {
      totalHpLoss += playerHp;
    }
    totalTurns += battle.state.turn;
  }

  return {
    runs: opts.runs,
    winRate: wins / opts.runs,
    avgHpLoss: totalHpLoss / opts.runs,
    avgTurns: totalTurns / opts.runs,
  };
}
