/**
 * Full-run simulator: plays complete three-act runs with the greedy battle
 * policy plus simple meta heuristics (pathing, rewards, campfires, shops).
 * Measures the number that actually matters for balance: clear rate.
 */
import { getCardDef } from '../engine/cards';
import { Run } from '../engine/run';
import { greedyPolicy, incomingDamage } from './policy';

export interface RunSimResult {
  runs: number;
  clearRate: number;
  avgActReached: number;
  avgFloorsEntered: number;
  avgFinalDeckSize: number;
  deathsByAct: Record<number, number>;
}

const RARITY_SCORE: Record<string, number> = { rare: 3, uncommon: 2, common: 1 };

/**
 * How much each card improves a greedy-policy deck, on top of its rarity.
 * Positive: scaling/defense the policy uses well. Negative: cards it misplays
 * (self-damage, wound generators) or that dilute a small consistent deck.
 */
const PICK_BONUS: Record<string, number> = {
  inflame: 4,
  demon_form: 5,
  footwork: 4,
  metallicize: 4,
  impervious: 4,
  caltrops: 3,
  noxious_fumes: 3,
  shrug_it_off: 3,
  backflip: 3,
  disarm: 3,
  bludgeon: 3,
  uppercut: 3,
  dash: 3,
  iron_wave: 2,
  pommel_strike: 2,
  quick_slash: 2,
  shockwave: 2,
  anger: -1,
  whirlwind: -1,
  barricade: -2,
  berserk: -2,
  wild_strike: -2,
  reckless_charge: -2,
  hemokinesis: -2,
  bloodletting: -3,
};

/** Picks the best offered card, or skips when the deck is already big and the offer is weak. */
function pickBestReward(cards: string[], deckSize: number): string | null {
  let best: string | null = null;
  let bestScore = -Infinity;
  for (const id of cards) {
    const score = (RARITY_SCORE[getCardDef(id).rarity] ?? 0) + (PICK_BONUS[id] ?? 0);
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  // A bloated deck draws its engine cards less often; only take real upgrades.
  if (deckSize >= 22 && bestScore < 4) return null;
  return best;
}

/** Simple potion heuristics: spend them when they clearly swing the battle. */
function maybeUsePotions(run: Run): void {
  const battle = run.battle;
  if (!battle) return;
  for (let i = run.potions.length - 1; i >= 0; i--) {
    if (run.phase !== 'battle' || battle.state.phase !== 'playerTurn') return;
    const id = run.potions[i]!;
    const player = battle.state.player;
    const unblocked = Math.max(0, incomingDamage(battle) - player.block);
    const totalEnemyHp = battle.aliveEnemies().reduce((s, e) => s + e.hp, 0);
    const bigFight = totalEnemyHp >= 80;
    switch (id) {
      case 'healing_potion':
        if (player.hp <= player.maxHp * 0.35) run.usePotion(i);
        break;
      case 'block_potion':
        if (unblocked >= 10 && player.hp - unblocked <= player.maxHp * 0.35) run.usePotion(i);
        break;
      case 'strength_potion':
        if (bigFight && battle.state.turn <= 2) run.usePotion(i);
        break;
      case 'fire_potion': {
        const kill = battle.state.enemies.findIndex((e) => e.hp > 0 && e.hp + e.block <= 20);
        if (kill >= 0) {
          run.usePotion(i, kill);
        } else if (bigFight && player.hp <= player.maxHp * 0.5) {
          let idx = -1;
          let hi = 0;
          battle.state.enemies.forEach((e, j) => {
            if (e.hp > hi) {
              hi = e.hp;
              idx = j;
            }
          });
          run.usePotion(i, idx);
        }
        break;
      }
      case 'weak_potion': {
        // Shut down the hardest hitter, but only if it will live a while.
        let idx = -1;
        let hardest = 11;
        battle.state.enemies.forEach((e, j) => {
          if (e.hp <= 20) return;
          const intent = battle.intentOf(e);
          const dmg = (intent.damage ?? 0) * (intent.hits ?? 1);
          if (dmg > hardest) {
            hardest = dmg;
            idx = j;
          }
        });
        if (idx >= 0) run.usePotion(i, idx);
        break;
      }
    }
  }
}

function playBattle(run: Run): void {
  let safety = 2000;
  while (run.phase === 'battle' && safety-- > 0) {
    const battle = run.battle!;
    if (battle.state.phase !== 'playerTurn') {
      run.resolveBattle();
      return;
    }
    maybeUsePotions(run);
    if (run.phase !== 'battle' || battle.state.phase !== 'playerTurn') continue;
    const action = greedyPolicy(battle);
    if (action.type === 'end') battle.endTurn();
    else battle.playCard(action.index, action.target);
  }
  if (safety <= 0) throw new Error('battle did not terminate');
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
          run.pickReward(pickBestReward(run.reward!.cards, run.deck.length));
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
