/**
 * Full-run simulator: plays complete three-act runs with the greedy battle
 * policy plus simple meta heuristics (pathing, rewards, campfires, shops).
 * Measures the number that actually matters for balance: clear rate.
 */
import { getCardDef } from '../engine/cards';
import { Run } from '../engine/run';
import { greedyPolicy } from './policy';

export interface RunSimResult {
  runs: number;
  clearRate: number;
  avgActReached: number;
  avgFloorsEntered: number;
  avgFinalDeckSize: number;
  deathsByAct: Record<number, number>;
}

const RARITY_SCORE: Record<string, number> = { rare: 3, uncommon: 2, common: 1 };

/** Picks the offered card with the highest rarity (simple but serviceable). */
function pickBestReward(cards: string[]): string | null {
  if (cards.length === 0) return null;
  return [...cards].sort(
    (a, b) => (RARITY_SCORE[getCardDef(b).rarity] ?? 0) - (RARITY_SCORE[getCardDef(a).rarity] ?? 0),
  )[0]!;
}

function playBattle(run: Run): void {
  const battle = run.battle!;
  let safety = 2000;
  while (battle.state.phase === 'playerTurn' && safety-- > 0) {
    const action = greedyPolicy(battle);
    if (action.type === 'end') battle.endTurn();
    else battle.playCard(action.index, action.target);
  }
  if (safety <= 0) throw new Error('battle did not terminate');
  run.resolveBattle();
}

export function simulateFullRuns(runs: number, baseSeed = 1): RunSimResult {
  let clears = 0;
  let totalActs = 0;
  let totalFloors = 0;
  let totalDeck = 0;
  const deathsByAct: Record<number, number> = { 1: 0, 2: 0, 3: 0 };

  for (let i = 0; i < runs; i++) {
    const run = new Run(baseSeed + i * 104729);
    let floors = 0;
    let guard = 1000;

    while (run.phase !== 'victory' && run.phase !== 'defeat' && guard-- > 0) {
      switch (run.phase) {
        case 'map': {
          const options = run.availableNodes();
          // Prefer a campfire when hurt; avoid elites when weak.
          const hurt = run.hp < run.maxHp * 0.5;
          const weak = run.hp < run.maxHp * 0.4;
          const pick =
            (hurt && options.find((n) => n.kind === 'rest')) ||
            (weak && options.find((n) => n.kind !== 'elite')) ||
            run.rng.pick(options);
          run.enterNode(pick.id);
          floors++;
          break;
        }
        case 'battle':
          playBattle(run);
          break;
        case 'reward':
        case 'actTransition':
          run.pickReward(pickBestReward(run.reward!.cards));
          break;
        case 'rest': {
          const upIdx = run.deck.findIndex((_, j) => run.canUpgrade(j));
          if (run.hp < run.maxHp * 0.65 || upIdx < 0) run.restHeal();
          else run.restUpgrade(upIdx);
          break;
        }
        case 'event': {
          const idx = run.currentEvent!.choices.findIndex((_, j) => run.canChooseEventOption(j));
          run.chooseEventOption(idx);
          run.leaveEvent();
          break;
        }
        case 'shop': {
          const buy = run.shop!.cards.findIndex((c) => !c.sold && run.gold >= c.price);
          if (buy >= 0) run.buyCard(buy);
          if (!run.shop!.removeUsed && run.gold >= run.shop!.removePrice + 40) {
            // Thin the deck: remove a basic strike if one is left.
            const strike = run.deck.findIndex((c) => c.defId === 'strike' && !c.upgraded);
            if (strike >= 0) run.removeCard(strike);
          }
          run.leaveShop();
          break;
        }
      }
    }
    if (guard <= 0) throw new Error(`run ${i} did not terminate`);

    if (run.phase === 'victory') clears++;
    else deathsByAct[run.act] = (deathsByAct[run.act] ?? 0) + 1;
    totalActs += run.act;
    totalFloors += floors;
    totalDeck += run.deck.length;
  }

  return {
    runs,
    clearRate: clears / runs,
    avgActReached: totalActs / runs,
    avgFloorsEntered: totalFloors / runs,
    avgFinalDeckSize: totalDeck / runs,
    deathsByAct,
  };
}
