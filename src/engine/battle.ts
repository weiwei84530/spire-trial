import { Rng } from './rng';
import type {
  ActorRef,
  BattleEvent,
  BattleState,
  CardInstance,
  DamageCause,
  Effect,
  EnemyState,
  IntentKind,
  PlayerState,
  StatusId,
} from './types';
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
  /** Total block the move will gain (after modifiers), if any. */
  block?: number;
  /** Statuses the move will apply, so the UI can show the actual ability icons. */
  statuses?: { id: StatusId; stacks: number; onSelf: boolean }[];
}

export interface BattleConfig {
  seed: number;
  deck: CardInstance[];
  playerHp: number;
  playerMaxHp: number;
  maxEnergy?: number;
  /** Enemy def ids, left to right. */
  enemies: string[];
  /** Player-sourced effects run once at battle start, after the opening draw (relics). */
  startEffects?: Effect[];
  /** Multiplies enemy max HP (act difficulty scaling). */
  enemyHpScale?: number;
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
  /** Kept for scaling enemies spawned mid-battle (death triggers). */
  private readonly hpScale: number;
  /** Enemies whose `enemyDeath` event has been emitted (dedupes multi-cause deaths). */
  private readonly deathEmitted = new Set<EnemyState>();
  /** Attack cards played this turn, including the one resolving (Finisher). */
  private attacksThisTurn = 0;
  /** Testing cheats, shared by reference with the owning Run. */
  cheats: { oneHitKill?: boolean; infiniteHp?: boolean; infiniteEnergy?: boolean } = {};

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
    this.hpScale = config.enemyHpScale ?? 1;
    const enemies = config.enemies.map((id) => this.spawnScaled(id));
    this.state = { turn: 1, phase: 'playerTurn', player, enemies, log: [], events: [] };
    this.startPlayerTurn();
    if (config.startEffects && config.startEffects.length > 0) {
      this.log('Relics trigger');
      this.executeEffects(config.startEffects, player);
    }
  }

  /** Applies a potion's effects (no energy cost). Consumption is the caller's job. */
  usePotion(effects: Effect[], targetIndex?: number): void {
    if (this.state.phase !== 'playerTurn') throw new Error('Battle is over');
    let target: EnemyState | undefined;
    if (targetIndex !== undefined) {
      target = this.state.enemies[targetIndex];
      if (!target || target.hp <= 0) throw new Error('Invalid potion target');
    }
    this.executeEffects(effects, this.state.player, target);
    this.checkBattleEnd();
  }

  /** Resolves an enemy's next move into display/AI-friendly numbers. */
  intentOf(enemy: EnemyState): IntentPreview {
    const move = getMove(getEnemyDef(enemy.defId), enemy.nextMoveId);
    const preview: IntentPreview = { kind: move.intent };
    for (const effect of move.effects) {
      if (effect.kind === 'damage' && preview.damage === undefined) {
        // Enemy moves only ever use fixed hit counts.
        const times = typeof effect.times === 'number' ? effect.times : 1;
        preview.damage = calcAttackDamage(effect.amount, enemy, this.state.player);
        preview.hits = times;
      } else if (effect.kind === 'block') {
        preview.block = (preview.block ?? 0) + calcBlockGain(effect.amount, enemy);
      } else if (effect.kind === 'applyStatus') {
        (preview.statuses ??= []).push({
          id: effect.status,
          stacks: effect.stacks,
          onSelf: effect.target === 'self',
        });
      }
    }
    return preview;
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
    if (def.playCondition === 'drawPileEmpty' && this.state.player.drawPile.length > 0) return false;
    if (!this.cheats.infiniteEnergy && def.cost !== 'x' && def.cost > this.state.player.energy)
      return false;
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
    // The infiniteEnergy cheat keeps X scaling but skips the deduction entirely.
    const x = def.cost === 'x' ? player.energy : 0;
    const spent = this.cheats.infiniteEnergy ? 0 : def.cost === 'x' ? x : def.cost;
    player.energy -= spent;
    player.hand.splice(handIndex, 1);
    this.log(`Player plays ${def.name}`);
    this.emit({ type: 'playerActionStart', cardDefId: def.id, cardType: def.type, target: targetIndex });
    if (spent !== 0) this.emit({ type: 'energy', delta: -spent, total: player.energy });

    if (def.type === 'attack') this.attacksThisTurn++;
    const target = def.target === 'enemy' ? this.state.enemies[targetIndex!]! : undefined;
    this.executeEffects(def.effects, player, target, x, def.id);

    // Powers leave the deck for the rest of the battle; their effect persists as statuses.
    if (def.exhaust || def.type === 'power') {
      player.exhaustPile.push(card);
    } else {
      player.discardPile.push(card);
    }
    this.onCardPlayedTriggers();
    this.checkBattleEnd();
  }

  /** Per-card-played powers: Thousand Cuts (damage all) and After Image (block). */
  private onCardPlayedTriggers(): void {
    const { player } = this.state;
    const cuts = getStatus(player, 'thousandCuts');
    if (cuts > 0) {
      for (const enemy of this.aliveEnemies()) {
        // Flat power damage: unmodified by strength/weak/vulnerable.
        this.applyDamage(player, enemy, cuts, 'attack');
      }
      this.log(`Thousand cuts hits all enemies for ${cuts}`);
    }
    const image = getStatus(player, 'afterImage');
    if (image > 0) {
      player.block += image;
      this.emit({ type: 'blockGain', target: 'player', amount: image, blockAfter: player.block });
      this.log(`After image grants ${image} block`);
    }
  }

  endTurn(): void {
    if (this.state.phase !== 'playerTurn') throw new Error('Not player turn');
    const { player } = this.state;

    // Burn-style cards punish being held until end of turn (damage respects block).
    for (const card of player.hand) {
      const burn = resolveCard(card).selfDamageAtTurnEnd;
      if (burn) {
        const hpLoss = this.applyDamage(player, player, burn, 'burn');
        this.log(`Player takes ${burn} (${hpLoss} HP) from ${resolveCard(card).name}`);
      }
    }
    if (this.checkBattleEnd()) return;

    if (player.hand.length > 0) this.emit({ type: 'discardHand', count: player.hand.length });
    player.discardPile.push(...player.hand);
    player.hand = [];
    const statusesBeforeDecay = { ...player.statuses };
    decayStatuses(player);
    this.emitStatusDiff(player, statusesBeforeDecay);
    const metal = tickMetallicize(player);
    if (metal > 0) {
      this.emit({ type: 'blockGain', target: 'player', amount: metal, blockAfter: player.block });
      this.log(`Player gains ${metal} block from metallicize`);
    }
    // Player-side ritual (Demon Form style powers), mirroring the enemy rule.
    const playerRitual = getStatus(player, 'ritual');
    if (playerRitual > 0) {
      addStatus(player, 'strength', playerRitual);
      this.emit({
        type: 'statusChange',
        target: 'player',
        status: 'strength',
        delta: playerRitual,
        total: getStatus(player, 'strength'),
      });
      this.log(`Player gains ${playerRitual} strength from ritual`);
    }
    // Wraith Form's price: dexterity bleeds away at the end of every turn.
    const wraith = getStatus(player, 'wraithForm');
    if (wraith > 0) {
      addStatus(player, 'dexterity', -wraith);
      this.emit({
        type: 'statusChange',
        target: 'player',
        status: 'dexterity',
        delta: -wraith,
        total: getStatus(player, 'dexterity'),
      });
      this.log(`Player loses ${wraith} dexterity from wraith form`);
    }

    // Snapshot: enemies spawned this turn (death triggers) act from the next turn on.
    for (const enemy of [...this.state.enemies]) {
      if (enemy.hp <= 0) continue;
      this.runEnemyTurn(enemy);
      if (this.checkBattleEnd()) return;
    }

    this.state.turn++;
    this.startPlayerTurn();
  }

  private startPlayerTurn(): void {
    const { player } = this.state;
    this.attacksThisTurn = 0;
    this.emit({ type: 'turnStart', turn: this.state.turn });
    // Barricade (permanent) or Blur (N turns) keeps block between turns.
    if (getStatus(player, 'barricade') === 0 && getStatus(player, 'blur') === 0) {
      player.block = 0;
    } else if (getStatus(player, 'blur') > 0) {
      addStatus(player, 'blur', -1);
      this.emit({
        type: 'statusChange',
        target: 'player',
        status: 'blur',
        delta: -1,
        total: getStatus(player, 'blur'),
      });
    }
    const poison = this.tickPoisonWithEvents(player);
    if (poison > 0) this.log(`Player takes ${poison} poison damage`);
    if (this.checkBattleEnd()) return;
    const energyBefore = player.energy;
    player.energy = player.maxEnergy + getStatus(player, 'energized') + getStatus(player, 'nextTurnEnergy');
    this.consumeStatus(player, 'nextTurnEnergy');
    if (player.energy !== energyBefore) {
      this.emit({ type: 'energy', delta: player.energy - energyBefore, total: player.energy });
    }
    // One-shot block promised last turn (Dodge and Roll): flat, no dexterity.
    const savedBlock = getStatus(player, 'nextTurnBlock');
    if (savedBlock > 0) {
      player.block += savedBlock;
      this.emit({ type: 'blockGain', target: 'player', amount: savedBlock, blockAfter: player.block });
      this.consumeStatus(player, 'nextTurnBlock');
    }
    // Infinite Blades: fresh Shivs in hand before the draw.
    const blades = getStatus(player, 'infiniteBlades');
    if (blades > 0) {
      this.executeEffects(
        [{ kind: 'addCard', card: 'shiv', count: blades, destination: 'hand' }],
        player,
      );
    }
    // Noxious fumes: poison every living enemy at the start of each player turn.
    const noxious = getStatus(player, 'noxious');
    if (noxious > 0) {
      for (const enemy of this.aliveEnemies()) {
        addStatus(enemy, 'poison', noxious);
        this.emit({
          type: 'statusChange',
          target: this.refOf(enemy),
          status: 'poison',
          delta: noxious,
          total: getStatus(enemy, 'poison'),
        });
      }
      this.log(`Noxious fumes poison all enemies (${noxious})`);
    }
    this.drawCards(HAND_SIZE + getStatus(player, 'nextTurnDraw'));
    this.consumeStatus(player, 'nextTurnDraw');
    // Tools of the Trade: extra churn after the regular draw.
    const tools = getStatus(player, 'toolsOfTrade');
    if (tools > 0) {
      this.drawCards(tools);
      this.discardRandom(tools);
    }
  }

  /** Zeroes a one-shot status, emitting the change if it was set. */
  private consumeStatus(actor: PlayerState | EnemyState, id: StatusId): void {
    const stacks = getStatus(actor, id);
    if (stacks === 0) return;
    addStatus(actor, id, -stacks);
    this.emit({ type: 'statusChange', target: this.refOf(actor), status: id, delta: -stacks, total: 0 });
  }

  /** Discards up to `count` random cards from the player's hand. */
  private discardRandom(count: number): void {
    const { player } = this.state;
    let discarded = 0;
    for (let i = 0; i < count && player.hand.length > 0; i++) {
      const idx = this.rng.int(0, player.hand.length - 1);
      const [card] = player.hand.splice(idx, 1);
      player.discardPile.push(card!);
      this.log(`Player discards ${resolveCard(card!).name}`);
      discarded++;
    }
    if (discarded > 0) this.emit({ type: 'discardHand', count: discarded });
  }

  /** Poison tick that emits the block-ignoring damage plus the stack decay. */
  private tickPoisonWithEvents(actor: PlayerState | EnemyState): number {
    const stacks = getStatus(actor, 'poison');
    if (stacks <= 0) return 0;
    const hpBefore = actor.hp;
    tickPoison(actor);
    if (this.cheats.infiniteHp && actor === this.state.player) actor.hp = hpBefore;
    this.emit({
      type: 'damage',
      source: this.refOf(actor),
      target: this.refOf(actor),
      cause: 'poison',
      amount: stacks,
      blocked: 0,
      hpLoss: hpBefore - actor.hp,
      hpAfter: actor.hp,
      blockAfter: actor.block,
    });
    this.emit({
      type: 'statusChange',
      target: this.refOf(actor),
      status: 'poison',
      delta: -1,
      total: getStatus(actor, 'poison'),
    });
    this.checkDeathEmit(actor);
    return stacks;
  }

  private runEnemyTurn(enemy: EnemyState): void {
    enemy.block = 0;
    const poison = this.tickPoisonWithEvents(enemy);
    if (poison > 0) this.log(`${enemy.name} takes ${poison} poison damage`);
    if (enemy.hp <= 0) return;

    const def = getEnemyDef(enemy.defId);
    const move = getMove(def, enemy.nextMoveId);
    this.log(`${enemy.name} uses ${move.id}`);
    this.emit({
      type: 'enemyActionStart',
      enemy: this.state.enemies.indexOf(enemy),
      moveId: move.id,
      intent: move.intent,
    });
    this.executeEffects(move.effects, enemy, undefined);

    const statusesBeforeDecay = { ...enemy.statuses };
    decayStatuses(enemy);
    this.emitStatusDiff(enemy, statusesBeforeDecay);
    const ritual = getStatus(enemy, 'ritual');
    if (ritual > 0) {
      addStatus(enemy, 'strength', ritual);
      this.emit({
        type: 'statusChange',
        target: this.refOf(enemy),
        status: 'strength',
        delta: ritual,
        total: getStatus(enemy, 'strength'),
      });
      this.log(`${enemy.name} gains ${ritual} strength from ritual`);
    }
    const enemyMetal = tickMetallicize(enemy);
    if (enemyMetal > 0) {
      this.emit({ type: 'blockGain', target: this.refOf(enemy), amount: enemyMetal, blockAfter: enemy.block });
    }

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
    cardDefId?: string,
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
          const times =
            effect.times === 'x'
              ? x
              : effect.times === 'attacksThisTurn'
                ? this.attacksThisTurn
                : effect.times === 'skillsInHand'
                  ? this.state.player.hand.filter((c) => resolveCard(c).type === 'skill').length
                  : (effect.times ?? 1);
          // Accuracy boosts Shivs at the base-damage level (before strength/weak).
          const accuracy = isPlayer && cardDefId === 'shiv' ? getStatus(source, 'accuracy') : 0;
          for (const target of targets) {
            if (effect.onlyIfTargetPoisoned && getStatus(target, 'poison') <= 0) continue;
            for (let i = 0; i < times; i++) {
              if (source.hp <= 0) return;
              const dmg = calcAttackDamage(effect.amount + accuracy, source, target);
              const hpLoss = this.applyDamage(source, target, dmg, 'attack');
              this.log(`${this.nameOf(source)} hits ${this.nameOf(target)} for ${dmg} (${hpLoss} HP)`);
              // Envenom: unblocked player attack damage poisons the enemy.
              const envenom = isPlayer ? getStatus(source, 'envenom') : 0;
              if (envenom > 0 && hpLoss > 0 && target !== this.state.player && target.hp > 0) {
                addStatus(target, 'poison', envenom);
                this.emit({
                  type: 'statusChange',
                  target: this.refOf(target),
                  status: 'poison',
                  delta: envenom,
                  total: getStatus(target, 'poison'),
                });
              }
              const thorns = getStatus(target, 'thorns');
              if (thorns > 0 && target.hp > 0) {
                const thornLoss = this.applyDamage(target, source, thorns, 'thorns');
                this.log(`${this.nameOf(source)} takes ${thorns} (${thornLoss} HP) thorns`);
              }
            }
          }
          break;
        }
        case 'block': {
          const gained = calcBlockGain(effect.amount, source);
          source.block += gained;
          this.emit({ type: 'blockGain', target: this.refOf(source), amount: gained, blockAfter: source.block });
          this.log(`${this.nameOf(source)} gains ${gained} block`);
          break;
        }
        case 'applyStatus': {
          let targets: (PlayerState | EnemyState)[];
          if (effect.target === 'self') {
            targets = [source];
          } else if (effect.target === 'allEnemies') {
            targets = isPlayer ? this.aliveEnemies() : [this.state.player];
          } else if (effect.target === 'randomEnemy') {
            const alive = this.aliveEnemies();
            targets = isPlayer && alive.length > 0 ? [this.rng.pick(alive)] : isPlayer ? [] : [this.state.player];
          } else {
            targets = isPlayer ? [chosenEnemy!] : [this.state.player];
          }
          for (const target of targets) {
            addStatus(target, effect.status, effect.stacks);
            this.emit({
              type: 'statusChange',
              target: this.refOf(target),
              status: effect.status,
              delta: effect.stacks,
              total: getStatus(target, effect.status),
            });
            this.log(`${this.nameOf(target)} gets ${effect.stacks} ${effect.status}`);
          }
          break;
        }
        case 'draw':
          // Only meaningful for the player; enemies have no deck.
          if (isPlayer) this.drawCards(effect.count);
          break;
        case 'gainEnergy':
          if (isPlayer) {
            this.state.player.energy += effect.amount;
            this.emit({ type: 'energy', delta: effect.amount, total: this.state.player.energy });
          }
          break;
        case 'loseHp': {
          const cheatProof = this.cheats.infiniteHp && source === this.state.player;
          const hpLoss = cheatProof ? 0 : Math.min(source.hp, effect.amount);
          source.hp -= hpLoss;
          this.emit({
            type: 'damage',
            source: this.refOf(source),
            target: this.refOf(source),
            cause: 'loseHp',
            amount: effect.amount,
            blocked: 0,
            hpLoss,
            hpAfter: source.hp,
            blockAfter: source.block,
          });
          this.checkDeathEmit(source);
          this.log(`${this.nameOf(source)} loses ${effect.amount} HP`);
          break;
        }
        case 'heal': {
          const healed = Math.min(source.maxHp - source.hp, effect.amount);
          source.hp += healed;
          this.emit({ type: 'heal', target: this.refOf(source), amount: healed, hpAfter: source.hp });
          this.log(`${this.nameOf(source)} heals ${effect.amount}`);
          break;
        }
        case 'healPercent': {
          const amount = Math.floor((source.maxHp * effect.percent) / 100);
          const healed = Math.min(source.maxHp - source.hp, amount);
          source.hp += healed;
          this.emit({ type: 'heal', target: this.refOf(source), amount: healed, hpAfter: source.hp });
          this.log(`${this.nameOf(source)} heals ${amount}`);
          break;
        }
        case 'doubleBlock': {
          const added = source.block;
          source.block *= 2;
          this.emit({ type: 'blockGain', target: this.refOf(source), amount: added, blockAfter: source.block });
          this.log(`${this.nameOf(source)} doubles block to ${source.block}`);
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
          this.emit({ type: 'addCard', cardDefId: effect.card, destination: effect.destination, count });
          break;
        }
        case 'discardRandom':
          if (isPlayer) this.discardRandom(effect.count);
          break;
        case 'discardNonAttacks': {
          if (!isPlayer) break;
          const { player } = this.state;
          const keep: CardInstance[] = [];
          let discarded = 0;
          for (const card of player.hand) {
            if (resolveCard(card).type === 'attack') {
              keep.push(card);
            } else {
              player.discardPile.push(card);
              discarded++;
            }
          }
          player.hand = keep;
          if (discarded > 0) {
            this.emit({ type: 'discardHand', count: discarded });
            this.log(`Player discards ${discarded} non-attack cards`);
          }
          break;
        }
        case 'multiplyStatus': {
          const target = isPlayer ? chosenEnemy : this.state.player;
          if (!target) break;
          const current = getStatus(target, effect.status);
          const added = current * (effect.factor - 1);
          if (added > 0) {
            addStatus(target, effect.status, added);
            this.emit({
              type: 'statusChange',
              target: this.refOf(target),
              status: effect.status,
              delta: added,
              total: getStatus(target, effect.status),
            });
            this.log(`${this.nameOf(target)}'s ${effect.status} multiplied to ${current + added}`);
          }
          break;
        }
      }
    }
  }

  private drawCards(count: number): void {
    const { player } = this.state;
    let drawn = 0;
    for (let i = 0; i < count; i++) {
      if (player.hand.length >= MAX_HAND) break;
      if (player.drawPile.length === 0) {
        if (player.discardPile.length === 0) break;
        player.drawPile = this.rng.shuffle(player.discardPile);
        player.discardPile = [];
      }
      player.hand.push(player.drawPile.pop()!);
      drawn++;
    }
    if (drawn > 0) this.emit({ type: 'draw', count: drawn, handSize: player.hand.length });
  }

  private spawnScaled(defId: string): EnemyState {
    const enemy = spawnEnemy(defId, this.rng);
    if (this.hpScale !== 1) {
      enemy.maxHp = Math.round(enemy.maxHp * this.hpScale);
      enemy.hp = enemy.maxHp;
    }
    return enemy;
  }

  /** Fires each dead enemy's death trigger exactly once (may spawn reinforcements). */
  private processDeaths(): void {
    for (const enemy of [...this.state.enemies]) {
      if (enemy.hp > 0 || enemy.deathProcessed) continue;
      enemy.deathProcessed = true;
      const def = getEnemyDef(enemy.defId);
      if (def.onDeath?.spawn) {
        for (const id of def.onDeath.spawn) {
          const spawned = this.spawnScaled(id);
          this.state.enemies.push(spawned);
          this.emit({ type: 'enemySpawn', enemy: this.state.enemies.length - 1, defId: id });
          this.log(`${spawned.name} emerges from ${enemy.name}!`);
        }
      }
    }
  }

  /** Fires half-HP phase changes (boss enrage) exactly once per enemy. */
  private processPhaseTriggers(): void {
    for (const enemy of this.state.enemies) {
      if (enemy.hp <= 0 || enemy.phaseTriggered) continue;
      const def = getEnemyDef(enemy.defId);
      if (!def.onHalfHp || enemy.hp > enemy.maxHp / 2) continue;
      enemy.phaseTriggered = true;
      this.emit({ type: 'phaseTrigger', enemy: this.state.enemies.indexOf(enemy) });
      this.log(`${enemy.name} enters a frenzy!`);
      this.executeEffects(def.onHalfHp.effects, enemy);
      if (def.onHalfHp.setMove) enemy.nextMoveId = def.onHalfHp.setMove;
    }
  }

  private checkBattleEnd(): boolean {
    if (this.state.phase !== 'playerTurn') return true;
    this.processDeaths();
    this.processPhaseTriggers();
    if (this.state.player.hp <= 0) {
      this.state.phase = 'defeat';
      this.emit({ type: 'battleEnd', result: 'defeat' });
      this.log('Defeat');
      return true;
    }
    if (this.aliveEnemies().length === 0) {
      this.state.phase = 'victory';
      this.emit({ type: 'battleEnd', result: 'victory' });
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

  private emit(event: BattleEvent): void {
    this.state.events.push(event);
  }

  private refOf(actor: PlayerState | EnemyState): ActorRef {
    return actor === this.state.player
      ? 'player'
      : { enemy: this.state.enemies.indexOf(actor as EnemyState) };
  }

  /** Emits `enemyDeath` the moment an enemy's HP first hits 0, whatever the cause. */
  private checkDeathEmit(actor: PlayerState | EnemyState): void {
    if (actor === this.state.player) return;
    const enemy = actor as EnemyState;
    if (enemy.hp <= 0 && !this.deathEmitted.has(enemy)) {
      this.deathEmitted.add(enemy);
      this.emit({ type: 'enemyDeath', enemy: this.state.enemies.indexOf(enemy) });
    }
  }

  /** Block-respecting damage funnel: applies, emits, and flags deaths. Returns HP lost. */
  private applyDamage(
    source: PlayerState | EnemyState,
    target: PlayerState | EnemyState,
    amount: number,
    cause: DamageCause,
  ): number {
    if (this.cheats.oneHitKill && cause === 'attack' && source === this.state.player) {
      amount = target.block + target.hp;
    }
    // Intangible caps any block-respecting damage at 1 (poison bypasses this funnel).
    if (getStatus(target, 'intangible') > 0) amount = Math.min(amount, 1);
    if (this.cheats.infiniteHp && target === this.state.player) amount = 0;
    const blocked = Math.min(target.block, amount);
    const hpLoss = dealDamage(target, amount);
    this.emit({
      type: 'damage',
      source: this.refOf(source),
      target: this.refOf(target),
      cause,
      amount,
      blocked,
      hpLoss,
      hpAfter: target.hp,
      blockAfter: target.block,
    });
    this.checkDeathEmit(target);
    return hpLoss;
  }

  /** Emits one statusChange per status whose stacks differ from `before` (for decay ticks). */
  private emitStatusDiff(
    actor: PlayerState | EnemyState,
    before: Partial<Record<StatusId, number>>,
  ): void {
    const ids = new Set([...Object.keys(before), ...Object.keys(actor.statuses)]) as Set<StatusId>;
    for (const id of ids) {
      const prev = before[id] ?? 0;
      const now = actor.statuses[id] ?? 0;
      if (now !== prev) {
        this.emit({
          type: 'statusChange',
          target: this.refOf(actor),
          status: id,
          delta: now - prev,
          total: now,
        });
      }
    }
  }
}

/** Convenience re-export for callers that need a card instance target index. */
export type { BattleState, CardInstance };
