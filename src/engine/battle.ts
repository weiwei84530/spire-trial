import { Rng } from './rng';
import type { BattleState, CardInstance, Effect, EnemyState, IntentKind, PlayerState } from './types';
import { makeCard, resolveCard } from './cards';
import { chooseMove, getEnemyDef, getMove, spawnEnemy } from './enemies';
import {
  addStatus,
  calcAttackDamage,
  calcBlockGain,
  dealDamage,
  decayStatuses,
  getStatus,
  tickMetallicize,
  tickPoison,
} from './statuses';

/** What an enemy is about to do, with damage precomputed for display and AI. */
export interface IntentPreview {
  kind: IntentKind;
  /** Damage per hit after all modifiers, if the move attacks. */
  damage?: number;
  hits?: number;
}

export interface BattleConfig {
  seed: number;
  deck: CardInstance[];
  playerHp: number;
  playerMaxHp: number;
  maxEnergy?: number;
  /** Enemy def ids, left to right. */
  enemies: string[];
}

const HAND_SIZE = 5;
const MAX_HAND = 10;

/**
 * Headless battle engine. All mutations go through playCard/endTurn;
 * the UI layer renders `state` and calls these methods.
 */
export class Battle {
  readonly state: BattleState;
  private readonly rng: Rng;

  constructor(config: BattleConfig) {
    this.rng = new Rng(config.seed);
    const player: PlayerState = {
      hp: config.playerHp,
      maxHp: config.playerMaxHp,
      block: 0,
      statuses: {},
      energy: 0,
      maxEnergy: config.maxEnergy ?? 3,
      hand: [],
      drawPile: this.rng.shuffle([...config.deck]),
      discardPile: [],
      exhaustPile: [],
    };
    // Innate cards go on top of the draw pile (drawn from the end).
    player.drawPile.sort(
      (a, b) => Number(resolveCard(a).innate ?? false) - Number(resolveCard(b).innate ?? false),
    );
    const enemies = config.enemies.map((id) => spawnEnemy(id, this.rng));
    this.state = { turn: 1, phase: 'playerTurn', player, enemies, log: [] };
    this.startPlayerTurn();
  }

  /** Resolves an enemy's next move into display/AI-friendly numbers. */
  intentOf(enemy: EnemyState): IntentPreview {
    const move = getMove(getEnemyDef(enemy.defId), enemy.nextMoveId);
    for (const effect of move.effects) {
      if (effect.kind === 'damage') {
        const times = effect.times === 'x' ? 1 : (effect.times ?? 1);
        return {
          kind: move.intent,
          damage: calcAttackDamage(effect.amount, enemy, this.state.player),
          hits: times,
        };
      }
    }
    return { kind: move.intent };
  }

  aliveEnemies(): EnemyState[] {
    return this.state.enemies.filter((e) => e.hp > 0);
  }

  /** True if the card at handIndex can legally be played right now. */
  canPlay(handIndex: number, targetIndex?: number): boolean {
    if (this.state.phase !== 'playerTurn') return false;
    const card = this.state.player.hand[handIndex];
    if (!card) return false;
    const def = resolveCard(card);
    if (def.unplayable) return false;
    if (def.cost !== 'x' && def.cost > this.state.player.energy) return false;
    if (def.target === 'enemy') {
      if (targetIndex === undefined) return false;
      const target = this.state.enemies[targetIndex];
      if (!target || target.hp <= 0) return false;
    }
    return true;
  }

  playCard(handIndex: number, targetIndex?: number): void {
    if (!this.canPlay(handIndex, targetIndex)) {
      throw new Error(`Illegal play: hand[${handIndex}] target=${targetIndex}`);
    }
    const { player } = this.state;
    const card = player.hand[handIndex]!;
    const def = resolveCard(card);

    // X-cost cards consume all remaining energy; x feeds effects with times: 'x'.
    const x = def.cost === 'x' ? player.energy : 0;
    player.energy -= def.cost === 'x' ? x : def.cost;
    player.hand.splice(handIndex, 1);
    this.log(`Player plays ${def.name}`);

    const target = def.target === 'enemy' ? this.state.enemies[targetIndex!]! : undefined;
    this.executeEffects(def.effects, player, target, x);

    // Powers leave the deck for the rest of the battle; their effect persists as statuses.
    if (def.exhaust || def.type === 'power') {
      player.exhaustPile.push(card);
    } else {
      player.discardPile.push(card);
    }
    this.checkBattleEnd();
  }

  endTurn(): void {
    if (this.state.phase !== 'playerTurn') throw new Error('Not player turn');
    const { player } = this.state;

    // Burn-style cards punish being held until end of turn (damage respects block).
    for (const card of player.hand) {
      const burn = resolveCard(card).selfDamageAtTurnEnd;
      if (burn) {
        const hpLoss = dealDamage(player, burn);
        this.log(`Player takes ${burn} (${hpLoss} HP) from ${resolveCard(card).name}`);
      }
    }
    if (this.checkBattleEnd()) return;

    player.discardPile.push(...player.hand);
    player.hand = [];
    decayStatuses(player);
    const metal = tickMetallicize(player);
    if (metal > 0) this.log(`Player gains ${metal} block from metallicize`);

    for (const enemy of this.state.enemies) {
      if (enemy.hp <= 0) continue;
      this.runEnemyTurn(enemy);
      if (this.checkBattleEnd()) return;
    }

    this.state.turn++;
    this.startPlayerTurn();
  }

  private startPlayerTurn(): void {
    const { player } = this.state;
    player.block = 0;
    const poison = tickPoison(player);
    if (poison > 0) this.log(`Player takes ${poison} poison damage`);
    if (this.checkBattleEnd()) return;
    player.energy = player.maxEnergy;
    this.drawCards(HAND_SIZE);
  }

  private runEnemyTurn(enemy: EnemyState): void {
    enemy.block = 0;
    const poison = tickPoison(enemy);
    if (poison > 0) this.log(`${enemy.name} takes ${poison} poison damage`);
    if (enemy.hp <= 0) return;

    const def = getEnemyDef(enemy.defId);
    const move = getMove(def, enemy.nextMoveId);
    this.log(`${enemy.name} uses ${move.id}`);
    this.executeEffects(move.effects, enemy, undefined);

    decayStatuses(enemy);
    const ritual = getStatus(enemy, 'ritual');
    if (ritual > 0) {
      addStatus(enemy, 'strength', ritual);
      this.log(`${enemy.name} gains ${ritual} strength from ritual`);
    }
    tickMetallicize(enemy);

    enemy.moveHistory.push(enemy.nextMoveId);
    enemy.nextMoveId = chooseMove(def, enemy.moveHistory, this.rng);
  }

  /**
   * Executes an effect list from `source`'s perspective.
   * For the player, `chosenEnemy` is the card's selected target; for enemies,
   * offensive effects always target the player.
   */
  private executeEffects(
    effects: Effect[],
    source: PlayerState | EnemyState,
    chosenEnemy?: EnemyState,
    x = 0,
  ): void {
    const isPlayer = source === this.state.player;

    for (const effect of effects) {
      // Thorns may kill the attacker mid-effect; stop resolving the rest.
      if (source.hp <= 0) return;
      switch (effect.kind) {
        case 'damage': {
          const targets: (PlayerState | EnemyState)[] = isPlayer
            ? effect.target === 'allEnemies'
              ? this.aliveEnemies()
              : [chosenEnemy!]
            : [this.state.player];
          const times = effect.times === 'x' ? x : (effect.times ?? 1);
          for (const target of targets) {
            for (let i = 0; i < times; i++) {
              if (source.hp <= 0) return;
              const dmg = calcAttackDamage(effect.amount, source, target);
              const hpLoss = dealDamage(target, dmg);
              this.log(`${this.nameOf(source)} hits ${this.nameOf(target)} for ${dmg} (${hpLoss} HP)`);
              const thorns = getStatus(target, 'thorns');
              if (thorns > 0 && target.hp > 0) {
                const thornLoss = dealDamage(source, thorns);
                this.log(`${this.nameOf(source)} takes ${thorns} (${thornLoss} HP) thorns`);
              }
            }
          }
          break;
        }
        case 'block': {
          const gained = calcBlockGain(effect.amount, source);
          source.block += gained;
          this.log(`${this.nameOf(source)} gains ${gained} block`);
          break;
        }
        case 'applyStatus': {
          let targets: (PlayerState | EnemyState)[];
          if (effect.target === 'self') {
            targets = [source];
          } else if (effect.target === 'allEnemies') {
            targets = isPlayer ? this.aliveEnemies() : [this.state.player];
          } else {
            targets = isPlayer ? [chosenEnemy!] : [this.state.player];
          }
          for (const target of targets) {
            addStatus(target, effect.status, effect.stacks);
            this.log(`${this.nameOf(target)} gets ${effect.stacks} ${effect.status}`);
          }
          break;
        }
        case 'draw':
          // Only meaningful for the player; enemies have no deck.
          if (isPlayer) this.drawCards(effect.count);
          break;
        case 'gainEnergy':
          if (isPlayer) this.state.player.energy += effect.amount;
          break;
        case 'loseHp': {
          source.hp = Math.max(0, source.hp - effect.amount);
          this.log(`${this.nameOf(source)} loses ${effect.amount} HP`);
          break;
        }
        case 'addCard': {
          // Cards created mid-battle (Wounds from slimes, etc.) always go to the player's piles.
          const count = effect.count ?? 1;
          const { player } = this.state;
          for (let i = 0; i < count; i++) {
            const created = makeCard(effect.card);
            if (effect.destination === 'hand' && player.hand.length < MAX_HAND) {
              player.hand.push(created);
            } else if (effect.destination === 'drawPile') {
              // Shuffled into a random position.
              player.drawPile.splice(this.rng.int(0, player.drawPile.length), 0, created);
            } else {
              player.discardPile.push(created);
            }
            this.log(`${resolveCard(created).name} added to ${effect.destination}`);
          }
          break;
        }
      }
    }
  }

  private drawCards(count: number): void {
    const { player } = this.state;
    for (let i = 0; i < count; i++) {
      if (player.hand.length >= MAX_HAND) return;
      if (player.drawPile.length === 0) {
        if (player.discardPile.length === 0) return;
        player.drawPile = this.rng.shuffle(player.discardPile);
        player.discardPile = [];
      }
      player.hand.push(player.drawPile.pop()!);
    }
  }

  private checkBattleEnd(): boolean {
    if (this.state.phase !== 'playerTurn') return true;
    if (this.state.player.hp <= 0) {
      this.state.phase = 'defeat';
      this.log('Defeat');
      return true;
    }
    if (this.aliveEnemies().length === 0) {
      this.state.phase = 'victory';
      this.log('Victory');
      return true;
    }
    return false;
  }

  private nameOf(actor: PlayerState | EnemyState): string {
    return actor === this.state.player ? 'Player' : (actor as EnemyState).name;
  }

  private log(message: string): void {
    this.state.log.push(`[T${this.state.turn}] ${message}`);
  }
}

/** Convenience re-export for callers that need a card instance target index. */
export type { BattleState, CardInstance };
