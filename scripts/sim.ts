/**
 * Balance simulation CLI: runs the greedy policy over benchmark encounters
 * and prints win rate / average HP loss / average turns.
 *
 * Usage: npm run sim [-- --runs 2000]
 */
import { makeStarterDeck } from '../src/engine/cards';
import { simulate } from '../src/sim/simulate';

const runsArg = process.argv.indexOf('--runs');
const runs = runsArg >= 0 ? Number(process.argv[runsArg + 1]) : 1000;

const encounters: string[][] = [
  ['jaw_worm'],
  ['cultist'],
  ['acid_slime'],
  ['acid_slime', 'acid_slime'],
  ['jaw_worm', 'cultist'],
];

console.log(`Starter deck vs benchmark encounters (${runs} runs each, player HP 80)\n`);
console.log('encounter                     winRate   avgHpLoss   avgTurns');
console.log('-'.repeat(62));

for (const enemies of encounters) {
  const result = simulate({ deck: makeStarterDeck, enemies, runs, baseSeed: 42 });
  const name = enemies.join(' + ').padEnd(28);
  const winRate = `${(result.winRate * 100).toFixed(1)}%`.padStart(7);
  const hpLoss = result.avgHpLoss.toFixed(1).padStart(9);
  const turns = result.avgTurns.toFixed(1).padStart(8);
  console.log(`${name}  ${winRate}   ${hpLoss}   ${turns}`);
}
