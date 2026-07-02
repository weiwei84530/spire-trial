/**
 * Balance simulation CLI: runs the greedy policy over benchmark encounters
 * and prints win rate / average HP loss / average turns.
 *
 * Usage: npm run sim [-- --runs 2000 --full 1000]
 */
import { makeCard, makeStarterDeck } from '../src/engine/cards';
import type { CardInstance } from '../src/engine/types';
import { simulate } from '../src/sim/simulate';

const runsArg = process.argv.indexOf('--runs');
const runs = runsArg >= 0 ? Number(process.argv[runsArg + 1]) : 1000;
const fullArg = process.argv.indexOf('--full');
const fullRuns = fullArg >= 0 ? Number(process.argv[fullArg + 1]) : 300;

/** Rough act 2 deck: starter with upgrades plus a typical set of picked rewards. */
function midRunDeck(): CardInstance[] {
  const deck = makeStarterDeck();
  deck[0]!.upgraded = true; // strike+
  deck[5]!.upgraded = true; // defend+
  deck.push(
    makeCard('pommel_strike'),
    makeCard('shrug_it_off'),
    makeCard('uppercut'),
    makeCard('inflame'),
    makeCard('backflip', true),
  );
  return deck;
}

function table(title: string, deck: () => CardInstance[], playerHp: number, encounters: string[][]): void {
  console.log(`\n${title}（${runs} runs each, HP ${playerHp}）\n`);
  console.log('encounter                        winRate   avgHpLoss   avgTurns');
  console.log('-'.repeat(65));
  for (const enemies of encounters) {
    const result = simulate({ deck, enemies, runs, playerHp, baseSeed: 42 });
    const name = enemies.join(' + ').padEnd(31);
    const winRate = `${(result.winRate * 100).toFixed(1)}%`.padStart(7);
    const hpLoss = result.avgHpLoss.toFixed(1).padStart(9);
    const turns = result.avgTurns.toFixed(1).padStart(8);
    console.log(`${name}  ${winRate}   ${hpLoss}   ${turns}`);
  }
}

table('Act 1 — starter deck', makeStarterDeck, 80, [
  ['jaw_worm'],
  ['cultist'],
  ['acid_slime', 'spike_slime_m'],
  ['jaw_worm', 'cultist'],
  ['jaw_worm', 'jaw_worm'],
  ['cultist', 'cultist'],
  ['louse_red', 'louse_red', 'louse_red'],
  ['boss_maw'],
]);

table('Act 2 — mid-run deck', midRunDeck, 70, [
  ['shelled_parasite'],
  ['chosen'],
  ['chosen', 'chosen'],
  ['byrd', 'byrd', 'byrd'],
  ['snake_plant'],
  ['snake_plant', 'byrd'],
  ['snake_plant', 'snake_plant'],
  ['gremlin_nob'],
  ['slime_king'],
]);

table('Act 3 — mid-run deck', midRunDeck, 70, [
  ['writhing_mass'],
  ['spire_growth'],
  ['darkling', 'darkling'],
  ['giant_head'],
  ['the_shadow'],
]);

// --- Full-run clear rate ---
import('../src/sim/runSim').then(({ simulateFullRuns }) => {
  const result = simulateFullRuns(fullRuns, 42);
  console.log(`\nFull runs（${result.runs} runs）\n`);
  console.log(`clear rate      ${(result.clearRate * 100).toFixed(1)}%`);
  console.log(`avg act reached ${result.avgActReached.toFixed(2)}`);
  console.log(`avg floors      ${result.avgFloorsEntered.toFixed(1)}`);
  console.log(`avg deck size   ${result.avgFinalDeckSize.toFixed(1)}`);
  console.log(`deaths by act   1:${result.deathsByAct[1]}  2:${result.deathsByAct[2]}  3:${result.deathsByAct[3]}`);
});
