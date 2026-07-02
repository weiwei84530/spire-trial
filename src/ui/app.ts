/**
 * Run-level UI controller: renders one screen per run phase
 * (map / battle / reward / rest / result) and forwards clicks to the
 * headless Run + Battle engines. This file and main.ts are the only
 * places that touch the DOM.
 */
import { resolveCard, getCardDef } from '../engine/cards';
import { getPotionDef } from '../engine/potions';
import { getRelicDef } from '../engine/relics';
import { Run, type RunSave } from '../engine/run';
import type { MapNode, NodeKind } from '../engine/map';
import type { CardDef, CardInstance, EnemyState } from '../engine/types';
import { cardText, CARD_TYPE_NAMES, intentText, STATUS_NAMES } from './describe';
import { sound } from './sound';
import { clearSave, loadRun, saveRun } from './storage';

/** Pre-action HP/block snapshot, diffed after the action to drive hit FX. */
interface BattleSnapshot {
  enemies: { hp: number; block: number }[];
  playerHp: number;
  playerBlock: number;
}

const NODE_ICONS: Record<NodeKind, string> = {
  battle: '⚔',
  elite: '💀',
  rest: '🔥',
  event: '❓',
  shop: '🛒',
  boss: '👑',
};

const NODE_NAMES: Record<NodeKind, string> = {
  battle: '戰鬥',
  elite: '精英',
  rest: '營火',
  event: '事件',
  shop: '商店',
  boss: '頭目',
};

/** Flat-color SVG art per enemy family. Placeholder-quality but consistent. */
function enemyArt(defId: string): string {
  if (defId.includes('slime')) {
    return `<svg viewBox="0 0 80 60"><ellipse cx="40" cy="42" rx="32" ry="18" fill="var(--art)"/>
      <ellipse cx="40" cy="30" rx="22" ry="16" fill="var(--art)" opacity="0.85"/>
      <circle cx="33" cy="28" r="3" fill="#111"/><circle cx="48" cy="28" r="3" fill="#111"/></svg>`;
  }
  if (defId.includes('worm') || defId === 'boss_maw') {
    return `<svg viewBox="0 0 80 60"><circle cx="20" cy="45" r="12" fill="var(--art)" opacity="0.7"/>
      <circle cx="38" cy="38" r="14" fill="var(--art)" opacity="0.85"/>
      <circle cx="56" cy="28" r="16" fill="var(--art)"/>
      <circle cx="60" cy="24" r="3" fill="#111"/><path d="M50 36 q8 6 16 2" stroke="#111" stroke-width="2" fill="none"/></svg>`;
  }
  if (defId.includes('louse')) {
    return `<svg viewBox="0 0 80 60"><ellipse cx="40" cy="35" rx="24" ry="18" fill="var(--art)"/>
      <path d="M20 30 l-10 -8 M25 22 l-8 -12 M60 30 l10 -8 M55 22 l8 -12" stroke="var(--art)" stroke-width="3"/>
      <circle cx="34" cy="32" r="3" fill="#111"/><circle cx="46" cy="32" r="3" fill="#111"/></svg>`;
  }
  if (defId === 'byrd') {
    return `<svg viewBox="0 0 80 60"><ellipse cx="40" cy="38" rx="16" ry="13" fill="var(--art)"/>
      <path d="M26 34 q-14 -12 -4 -20 q2 10 8 14 M54 34 q14 -12 4 -20 q-2 10 -8 14" fill="var(--art)"/>
      <path d="M40 30 l6 4 l-6 3 Z" fill="#e8b93b"/><circle cx="35" cy="32" r="2.5" fill="#111"/></svg>`;
  }
  if (defId === 'writhing_mass' || defId === 'darkling') {
    return `<svg viewBox="0 0 80 60"><ellipse cx="40" cy="38" rx="26" ry="20" fill="var(--art)"/>
      <ellipse cx="28" cy="30" rx="8" ry="6" fill="var(--art)" opacity="0.7"/>
      <ellipse cx="54" cy="26" rx="7" ry="5" fill="var(--art)" opacity="0.7"/>
      <circle cx="36" cy="36" r="3" fill="#111"/><circle cx="48" cy="34" r="2" fill="#111"/><circle cx="42" cy="44" r="2" fill="#111"/></svg>`;
  }
  if (defId === 'snake_plant' || defId === 'spire_growth') {
    return `<svg viewBox="0 0 80 60"><path d="M38 58 q-4 -26 2 -44 q8 14 4 44 Z" fill="var(--art)"/>
      <path d="M30 52 q-14 -10 -10 -26 q10 6 12 24 M50 52 q14 -10 10 -26 q-10 6 -12 24" fill="var(--art)" opacity="0.8"/>
      <circle cx="41" cy="20" r="4" fill="#111" opacity="0.5"/></svg>`;
  }
  if (defId === 'cultist' || defId === 'chosen') {
    // Hooded robe with glowing eyes.
    return `<svg viewBox="0 0 80 60"><path d="M40 4 q18 8 20 52 L20 56 q2 -44 20 -52 Z" fill="var(--art)"/>
      <path d="M40 8 q11 6 13 22 L27 30 q2 -16 13 -22 Z" fill="#111" opacity="0.55"/>
      <circle cx="35" cy="22" r="2.4" fill="#ffd75e"/><circle cx="45" cy="22" r="2.4" fill="#ffd75e"/>
      <path d="M28 44 q12 6 24 0" stroke="#111" stroke-width="2" fill="none" opacity="0.4"/></svg>`;
  }
  if (defId === 'gremlin_nob' || defId === 'centurion') {
    // Bulky warrior silhouette with a raised weapon.
    return `<svg viewBox="0 0 80 60"><ellipse cx="38" cy="40" rx="20" ry="17" fill="var(--art)"/>
      <circle cx="38" cy="18" r="10" fill="var(--art)"/>
      <rect x="60" y="10" width="5" height="34" rx="2" fill="#8a8578"/>
      <rect x="54" y="8" width="17" height="7" rx="2" fill="#b8b3a4"/>
      <circle cx="34" cy="16" r="2.2" fill="#111"/><circle cx="42" cy="16" r="2.2" fill="#111"/>
      <path d="M31 24 q7 4 14 0" stroke="#111" stroke-width="2" fill="none" opacity="0.6"/></svg>`;
  }
  if (defId === 'orb_walker') {
    // Floating orb with a single lens and spindly legs.
    return `<svg viewBox="0 0 80 60"><circle cx="40" cy="26" r="17" fill="var(--art)"/>
      <circle cx="40" cy="26" r="8" fill="#111" opacity="0.6"/><circle cx="40" cy="26" r="3.5" fill="#ffd75e"/>
      <path d="M28 38 L20 56 M40 43 L40 58 M52 38 L60 56" stroke="var(--art)" stroke-width="3" fill="none"/></svg>`;
  }
  if (defId === 'giant_head') {
    // A colossal stone face.
    return `<svg viewBox="0 0 80 60"><ellipse cx="40" cy="32" rx="28" ry="26" fill="var(--art)"/>
      <ellipse cx="30" cy="26" rx="6" ry="4" fill="#111" opacity="0.75"/>
      <ellipse cx="50" cy="26" rx="6" ry="4" fill="#111" opacity="0.75"/>
      <circle cx="30" cy="26" r="1.8" fill="#ffd75e"/><circle cx="50" cy="26" r="1.8" fill="#ffd75e"/>
      <path d="M28 46 q12 -6 24 0" stroke="#111" stroke-width="3" fill="none" opacity="0.6"/>
      <path d="M14 18 L22 12 M66 18 L58 12" stroke="var(--art)" stroke-width="4"/></svg>`;
  }
  if (defId === 'the_shadow') {
    // Layered wisp with a trailing tail.
    return `<svg viewBox="0 0 80 60"><path d="M40 4 q22 10 18 34 q-2 16 -18 20 q-16 -4 -18 -20 q-4 -24 18 -34 Z" fill="var(--art)"/>
      <path d="M40 10 q15 8 12 26 q-2 12 -12 15 q-10 -3 -12 -15 q-3 -18 12 -26 Z" fill="#111" opacity="0.35"/>
      <circle cx="33" cy="26" r="3" fill="#c9b6ff"/><circle cx="47" cy="26" r="3" fill="#c9b6ff"/>
      <path d="M26 52 q-6 6 -12 4 M54 52 q6 6 12 4" stroke="var(--art)" stroke-width="3" fill="none" opacity="0.7"/></svg>`;
  }
  if (defId === 'shelled_parasite') {
    // Segmented shell with a soft underside.
    return `<svg viewBox="0 0 80 60"><path d="M12 44 q28 -40 56 0 Z" fill="var(--art)"/>
      <path d="M22 40 q18 -24 36 0 M30 42 q10 -14 20 0" stroke="#111" stroke-width="2" fill="none" opacity="0.35"/>
      <ellipse cx="40" cy="48" rx="26" ry="7" fill="var(--art)" opacity="0.6"/>
      <circle cx="34" cy="47" r="2" fill="#111"/><circle cx="46" cy="47" r="2" fill="#111"/></svg>`;
  }
  return `<svg viewBox="0 0 80 60"><path d="M40 8 L62 56 L18 56 Z" fill="var(--art)"/>
    <circle cx="40" cy="26" r="9" fill="#111" opacity="0.6"/>
    <circle cx="37" cy="25" r="2" fill="#e8d44d"/><circle cx="44" cy="25" r="2" fill="#e8d44d"/></svg>`;
}

/** Enemies rendered at a larger scale (bosses and elites). */
const BIG_ENEMIES = new Set(['boss_maw', 'slime_king', 'the_shadow', 'gremlin_nob', 'giant_head']);

const ENEMY_COLORS: Record<string, string> = {
  jaw_worm: '#7aa35c',
  cultist: '#8a5fb0',
  acid_slime: '#5fb08a',
  spike_slime_m: '#b05f6b',
  louse_red: '#c26d4f',
  boss_maw: '#a83f57',
  shelled_parasite: '#8f9a5c',
  byrd: '#5c8fb0',
  chosen: '#b05c9a',
  snake_plant: '#4f9a4f',
  centurion: '#9a6f4f',
  gremlin_nob: '#b0455c',
  slime_king: '#3f8a6a',
  writhing_mass: '#6a5a7a',
  orb_walker: '#b09a3e',
  spire_growth: '#3e7a5a',
  darkling: '#4a4560',
  giant_head: '#8a7a6a',
  the_shadow: '#3a2f4f',
};

const CARD_TYPE_ICONS: Record<string, string> = {
  attack: '⚔',
  skill: '🛡',
  power: '✦',
  status: '☠',
  curse: '☠',
};

/** Shared card face used by the hand, rewards, and the campfire deck list. */
function cardFaceHtml(def: CardDef, extraClass = '', dataAttr = ''): string {
  const cost = def.cost === 'x' ? 'X' : String(def.cost);
  const upgraded = def.name.endsWith('+') ? 'upgraded' : '';
  const icon = CARD_TYPE_ICONS[def.type] ?? '❖';
  return `
    <div class="card type-${def.type} rarity-${def.rarity} ${upgraded} ${extraClass}" ${dataAttr}>
      <div class="cost">${cost}</div>
      <div class="card-head">
        <div class="card-name">${def.name}</div>
        <div class="card-type">${icon} ${CARD_TYPE_NAMES[def.type]}</div>
      </div>
      <div class="card-watermark">${icon}</div>
      <div class="card-text">${cardText(def)}</div>
    </div>`;
}

export class App {
  private run!: Run;
  private selected: number | null = null;
  /** Potion index waiting for an enemy target. */
  private potionSelected: number | null = null;
  /** Shop: when true, clicking a deck card removes it (after paying). */
  private removeMode = false;
  /** Battle: which pile's contents are shown in the overlay. */
  private pileView: 'drawPile' | 'discardPile' | 'exhaustPile' | null = null;
  /** A save found at startup, awaiting the player's resume/restart decision. */
  private pendingResume: RunSave | null = null;
  private readonly root: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    // Dev hook: lets browser-side tests drive the app without physical clicks.
    (window as unknown as { __app: App }).__app = this;
    this.pendingResume = loadRun();
    if (this.pendingResume) {
      this.renderResumePrompt();
    } else {
      this.newRun();
    }
  }

  private renderResumePrompt(): void {
    const save = this.pendingResume!;
    this.root.innerHTML = `
      <div class="game">
        <div class="dialog-screen center">
          <h2>發現進行中的冒險</h2>
          <p>樓層 ${save.visited.length}／${save.map.rows.length}，❤ ${save.hp}/${save.maxHp}，💰 ${save.gold}，牌組 ${save.deck.length} 張</p>
          <button class="primary-btn" data-resume>繼續冒險</button>
          <button class="ghost-btn" data-abandon>放棄，重新開始</button>
        </div>
      </div>`;
    this.root.querySelector('[data-resume]')?.addEventListener('click', () => {
      this.run = Run.fromSave(this.pendingResume!);
      this.pendingResume = null;
      this.render();
    });
    this.root.querySelector('[data-abandon]')?.addEventListener('click', () => {
      this.pendingResume = null;
      clearSave();
      this.newRun();
    });
  }

  private newRun(): void {
    clearSave();
    this.run = new Run((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
    this.selected = null;
    this.potionSelected = null;
    this.removeMode = false;
    this.pileView = null;
    this.render();
  }

  // --- event handlers ---

  private onNodeClick(id: string): void {
    if (!this.run.availableNodes().some((n) => n.id === id)) return;
    this.run.enterNode(id);
    this.render();
  }

  private battleActionDone(before?: BattleSnapshot | null): void {
    const battle = this.run.battle;
    const ended = battle && battle.state.phase !== 'playerTurn' ? battle.state.phase : null;
    if (battle && ended) this.run.resolveBattle();
    this.render();
    if (before && !ended) this.playBattleFx(before);
    if (ended === 'victory') sound.play('victory');
    if (ended === 'defeat') sound.play('defeat');
  }

  private snapshotBattle(): BattleSnapshot | null {
    const battle = this.run.battle;
    if (!battle) return null;
    return {
      enemies: battle.state.enemies.map((e) => ({ hp: e.hp, block: e.block })),
      playerHp: battle.state.player.hp,
      playerBlock: battle.state.player.block,
    };
  }

  /** Diff the fresh DOM against the pre-action snapshot: floats, shakes, sounds. */
  private playBattleFx(before: BattleSnapshot): void {
    const battle = this.run.battle;
    if (!battle || this.run.phase !== 'battle') return;
    let anyHit = false;
    battle.state.enemies.forEach((e, i) => {
      const prev = before.enemies[i];
      const el = this.root.querySelector(`[data-enemy="${i}"]`);
      if (!prev || !el) return;
      const lost = prev.hp - e.hp;
      if (lost > 0) {
        anyHit = true;
        el.classList.add('hit');
        if (e.hp <= 0) el.classList.add('just-died');
        this.floatText(el, `-${lost}`, 'dmg');
      }
    });
    if (anyHit) sound.play('hit');

    const player = battle.state.player;
    const panel = this.root.querySelector('.player-panel');
    if (!panel) return;
    const lostHp = before.playerHp - player.hp;
    if (lostHp > 0) {
      panel.classList.add('hit');
      this.floatText(panel, `-${lostHp}`, 'dmg');
      sound.play('hurt');
      // Big hits rattle the whole arena.
      if (lostHp >= 15) this.root.querySelector('.battle')?.classList.add('shake');
    } else if (lostHp < 0) {
      this.floatText(panel, `+${-lostHp}`, 'heal');
      sound.play('heal');
    }
    const gainedBlock = player.block - before.playerBlock;
    if (gainedBlock > 0) {
      this.floatText(panel, `+${gainedBlock}`, 'block');
      sound.play('block');
    }
  }

  private floatText(host: Element, text: string, kind: 'dmg' | 'block' | 'heal'): void {
    const span = document.createElement('span');
    span.className = `float-text ${kind}`;
    span.textContent = text;
    host.appendChild(span);
  }

  /** UI-level playability: also greys out X-cost cards that would fizzle at 0 energy. */
  private isHandCardPlayable(index: number): boolean {
    const battle = this.run.battle;
    if (!battle) return false;
    const card = battle.state.player.hand[index];
    if (!card) return false;
    if (resolveCard(card).cost === 'x' && battle.state.player.energy === 0) return false;
    return (
      battle.canPlay(index) ||
      battle.state.enemies.some((e, i) => e.hp > 0 && battle.canPlay(index, i))
    );
  }

  private onCardClick(index: number): void {
    const battle = this.run.battle;
    if (!battle) return;
    const card = battle.state.player.hand[index];
    if (!card) return;
    if (!this.isHandCardPlayable(index)) return;
    if (resolveCard(card).target === 'enemy') {
      this.selected = this.selected === index ? null : index;
      this.render();
      return;
    }
    if (battle.canPlay(index)) {
      this.selected = null;
      const before = this.snapshotBattle();
      sound.play('card');
      battle.playCard(index);
      this.battleActionDone(before);
    }
  }

  private onEnemyClick(enemyIndex: number): void {
    const battle = this.run.battle;
    if (!battle) return;
    if (this.potionSelected !== null) {
      const enemy = battle.state.enemies[enemyIndex];
      if (enemy && enemy.hp > 0) {
        const before = this.snapshotBattle();
        sound.play('potion');
        this.run.usePotion(this.potionSelected, enemyIndex);
        this.potionSelected = null;
        this.afterPotion(before);
      }
      return;
    }
    if (this.selected === null) return;
    if (battle.canPlay(this.selected, enemyIndex)) {
      const before = this.snapshotBattle();
      sound.play('card');
      battle.playCard(this.selected, enemyIndex);
      this.selected = null;
      this.battleActionDone(before);
    }
  }

  /** Run.usePotion resolves finished battles itself, so render then diff. */
  private afterPotion(before: BattleSnapshot | null): void {
    this.render();
    if (this.run.phase === 'battle' && before) this.playBattleFx(before);
    else if (this.run.phase === 'defeat') sound.play('defeat');
    else if (this.run.phase !== 'battle') sound.play('victory');
  }

  private onPotionClick(index: number): void {
    if (this.run.phase !== 'battle') return;
    const id = this.run.potions[index];
    if (!id) return;
    if (getPotionDef(id).target === 'enemy') {
      // Toggle potion targeting mode (cancels card selection).
      this.selected = null;
      this.potionSelected = this.potionSelected === index ? null : index;
      this.render();
      return;
    }
    const before = this.snapshotBattle();
    sound.play('potion');
    this.run.usePotion(index);
    this.potionSelected = null;
    this.afterPotion(before);
  }

  private onEndTurn(): void {
    const battle = this.run.battle;
    if (!battle || battle.state.phase !== 'playerTurn') return;
    this.selected = null;
    const before = this.snapshotBattle();
    battle.endTurn();
    this.battleActionDone(before);
  }

  // --- rendering ---

  private render(): void {
    let screen: string;
    switch (this.run.phase) {
      case 'map':
        screen = this.mapScreen();
        break;
      case 'battle':
        screen = this.battleScreen();
        break;
      case 'reward':
        screen = this.rewardScreen();
        break;
      case 'actTransition':
        screen = this.actTransitionScreen();
        break;
      case 'rest':
        screen = this.restScreen();
        break;
      case 'event':
        screen = this.eventScreen();
        break;
      case 'shop':
        screen = this.shopScreen();
        break;
      case 'victory':
      case 'defeat':
        screen = this.resultScreen(this.run.phase);
        break;
    }
    this.root.innerHTML = `<div class="game">${this.topBarHtml()}${screen}</div>`;
    this.bind();

    // Autosave between nodes; a finished run clears the slot.
    if (this.run.phase === 'map') saveRun(this.run.toSave());
    else if (this.run.phase === 'victory' || this.run.phase === 'defeat') clearSave();
  }

  private topBarHtml(): string {
    const floor = this.run.currentNodeId ? getNodeRow(this.run, this.run.currentNodeId) + 1 : 0;
    const relics = this.run.relics
      .map((id) => {
        const def = getRelicDef(id);
        return `<span class="relic-chip" title="${def.name}：${def.desc}">🏺</span>`;
      })
      .join('');
    const inBattle = this.run.phase === 'battle';
    const potions = this.run.potions
      .map((id, i) => {
        const def = getPotionDef(id);
        const cls = `potion-chip ${inBattle ? 'usable' : ''} ${this.potionSelected === i ? 'selected' : ''}`;
        return `<span class="${cls}" data-potion="${i}" title="${def.name}：${def.desc}${inBattle ? '（點擊使用）' : ''}">🧪</span>`;
      })
      .join('');
    return `
      <div class="top-bar">
        <span>❤ ${this.run.hp}/${this.run.maxHp}</span>
        <span>💰 ${this.run.gold}</span>
        <span>🂠 牌組 ${this.run.deck.length}</span>
        <span class="chip-group">${relics}</span>
        <span class="chip-group">${potions}</span>
        <span class="top-bar-right">
          <span class="mute-chip" data-mute title="音效開關">${sound.muted ? '🔇' : '🔊'}</span>
          第 ${this.run.act} 幕・樓層 ${floor}/${this.run.map.rows.length}
        </span>
      </div>`;
  }

  private actTransitionScreen(): string {
    const reward = this.run.reward!;
    const extras: string[] = [`💰 +${reward.gold} 金幣`, '❤ 進入下一幕時完全回復生命'];
    if (reward.relic) {
      const def = getRelicDef(reward.relic);
      extras.push(`🏺 ${def.name} — ${def.desc}`);
    }
    const cards = reward.cards
      .map((id) => cardFaceHtml(getCardDef(id), 'pickable', `data-reward="${id}"`))
      .join('');
    return `
      <div class="dialog-screen">
        <h2>🎉 第 ${this.run.act} 幕完成！</h2>
        <div class="reward-extras">${extras.map((e) => `<div>${e}</div>`).join('')}</div>
        <h3>選擇一張卡牌，然後前往第 ${this.run.act + 1} 幕：</h3>
        <div class="card-row">${cards}</div>
        <button class="ghost-btn" data-skip-reward>跳過卡牌，直接前進</button>
      </div>`;
  }

  // --- map screen ---

  private mapScreen(): string {
    const rows = this.run.map.rows;
    const rowCount = rows.length;
    const width = 700;
    const rowGap = 68;
    const height = rowCount * rowGap + 30;
    const x = (col: number) => 120 + col * 155;
    const y = (row: number) => height - 40 - row * rowGap;
    const available = new Set(this.run.availableNodes().map((n) => n.id));
    const visited = new Set(this.run.visited);

    let edges = '';
    let nodes = '';
    for (const row of rows) {
      for (const node of row) {
        for (const nextId of node.next) {
          const to = findNode(rows, nextId);
          edges += `<line x1="${x(node.col)}" y1="${y(node.row)}" x2="${x(to.col)}" y2="${y(to.row)}"
            class="map-edge ${visited.has(node.id) && visited.has(nextId) ? 'walked' : ''}"/>`;
        }
        const cls = [
          'map-node',
          `kind-${node.kind}`,
          available.has(node.id) ? 'available' : '',
          visited.has(node.id) ? 'visited' : '',
          node.id === this.run.currentNodeId ? 'current' : '',
        ].join(' ');
        nodes += `
          <g class="${cls}" data-node="${node.id}" transform="translate(${x(node.col)},${y(node.row)})">
            <circle r="${node.kind === 'boss' ? 30 : 22}"/>
            <text y="7" text-anchor="middle">${NODE_ICONS[node.kind]}</text>
            <title>${NODE_NAMES[node.kind]}</title>
          </g>`;
      }
    }

    return `
      <div class="map-screen">
        <h2>選擇下一個地點</h2>
        <svg viewBox="0 0 ${width} ${height}" class="map-svg">${edges}${nodes}</svg>
      </div>`;
  }

  // --- battle screen (structure shared with Day 3) ---

  private battleScreen(): string {
    const battle = this.run.battle!;
    const { player, enemies, turn } = battle.state;
    return `
      <div class="battle">
        <div class="turn-label">回合 ${turn}</div>
        <div class="enemies-row">${enemies.map((e, i) => this.enemyHtml(e, i)).join('')}</div>
        <div class="player-row">
          <div class="player-panel">
            <div class="actor-name">你</div>
            ${this.hpBarHtml(player.hp, player.maxHp, player.block)}
            <div class="statuses">${this.statusesHtml(player.statuses)}</div>
          </div>
          <div class="energy-orb" title="能量">${player.energy}/${player.maxEnergy}</div>
          <div class="piles">
            <span class="pile-link" data-pile="drawPile">抽牌 ${player.drawPile.length}</span>
            <span class="pile-link" data-pile="discardPile">棄牌 ${player.discardPile.length}</span>
            <span class="pile-link" data-pile="exhaustPile">消耗 ${player.exhaustPile.length}</span>
          </div>
          ${this.endTurnButtonHtml()}
        </div>
        <div class="hand">${player.hand.map((c, i) => this.handCardHtml(c, i)).join('')}</div>
        <div class="log-panel">${battle.state.log.slice(-40).map((l) => `<div>${l}</div>`).join('')}</div>
        ${this.pileView ? this.pileOverlayHtml() : ''}
      </div>`;
  }

  /** Warns when ending the turn would waste energy on still-playable cards. */
  private endTurnButtonHtml(): string {
    const battle = this.run.battle!;
    const player = battle.state.player;
    const wouldWaste =
      player.energy > 0 && player.hand.some((_, i) => this.isHandCardPlayable(i));
    if (!wouldWaste) return '<button class="end-turn">結束回合</button>';
    return `<button class="end-turn warn" title="還有可打出的卡牌">結束回合（剩 ⚡${player.energy}）</button>`;
  }

  private pileOverlayHtml(): string {
    const battle = this.run.battle!;
    const pileNames = { drawPile: '抽牌堆', discardPile: '棄牌堆', exhaustPile: '消耗堆' } as const;
    const pile = battle.state.player[this.pileView!];
    // Sorted by name so the draw pile view does not leak draw order.
    const cards = [...pile]
      .map((c) => resolveCard(c))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((def) => cardFaceHtml(def))
      .join('');
    return `
      <div class="overlay" data-close-pile>
        <div class="overlay-box pile-box">
          <h2>${pileNames[this.pileView!]}（${pile.length} 張）</h2>
          <div class="card-row wrap">${cards || '<p>（空）</p>'}</div>
          <button class="ghost-btn" data-close-pile>關閉</button>
        </div>
      </div>`;
  }

  private enemyHtml(enemy: EnemyState, index: number): string {
    const dead = enemy.hp <= 0;
    const battle = this.run.battle!;
    const intent = dead ? '' : `<div class="intent">${intentText(battle.intentOf(enemy))}</div>`;
    const targetable = (this.selected !== null || this.potionSelected !== null) && !dead;
    const big = BIG_ENEMIES.has(enemy.defId) ? 'big' : '';
    return `
      <div class="enemy ${big} ${dead ? 'dead' : ''} ${targetable ? 'targetable' : ''}" data-enemy="${index}"
           style="--art:${ENEMY_COLORS[enemy.defId] ?? '#888'}">
        ${intent}
        <div class="enemy-art">${enemyArt(enemy.defId)}</div>
        <div class="actor-name">${enemy.name}</div>
        ${this.hpBarHtml(enemy.hp, enemy.maxHp, enemy.block)}
        <div class="statuses">${this.statusesHtml(enemy.statuses)}</div>
      </div>`;
  }

  private handCardHtml(card: CardInstance, index: number): string {
    const def = resolveCard(card);
    const playable = this.isHandCardPlayable(index);
    const cls = `${playable ? 'playable' : 'not-playable'} ${this.selected === index ? 'selected' : ''}`;
    return cardFaceHtml(def, cls, `data-card="${index}"`);
  }

  private hpBarHtml(hp: number, maxHp: number, block: number): string {
    const pct = Math.max(0, (hp / maxHp) * 100);
    const blockChip = block > 0 ? `<span class="block-chip">🛡${block}</span>` : '';
    return `
      <div class="hp-bar">
        <div class="hp-fill" style="width:${pct}%"></div>
        <span class="hp-text">${hp}/${maxHp}</span>${blockChip}
      </div>`;
  }

  private statusesHtml(statuses: Record<string, number | undefined>): string {
    return Object.entries(statuses)
      .filter(([, v]) => v !== undefined && v !== 0)
      .map(([k, v]) => `<span class="status-chip">${STATUS_NAMES[k as keyof typeof STATUS_NAMES] ?? k} ${v}</span>`)
      .join('');
  }

  // --- reward / rest / result screens ---

  private rewardScreen(): string {
    const reward = this.run.reward!;
    const cards = reward.cards
      .map((id) => cardFaceHtml(getCardDef(id), 'pickable', `data-reward="${id}"`))
      .join('');
    const extras: string[] = [`💰 +${reward.gold} 金幣`];
    if (reward.relic) {
      const def = getRelicDef(reward.relic);
      extras.push(`🏺 ${def.name} — ${def.desc}`);
    }
    if (reward.potion) {
      const def = getPotionDef(reward.potion);
      extras.push(`🧪 ${def.name} — ${def.desc}`);
    }
    return `
      <div class="dialog-screen">
        <h2>勝利！</h2>
        <div class="reward-extras">${extras.map((e) => `<div>${e}</div>`).join('')}</div>
        <h3>選擇一張卡牌：</h3>
        <div class="card-row">${cards}</div>
        <button class="ghost-btn" data-skip-reward>跳過卡牌</button>
      </div>`;
  }

  private eventScreen(): string {
    const event = this.run.currentEvent!;
    if (this.run.eventResult !== null) {
      return `
        <div class="dialog-screen center">
          <h2>❓ ${event.title}</h2>
          <p class="event-text">${this.run.eventResult}</p>
          <button class="primary-btn" data-leave-event>繼續</button>
        </div>`;
    }
    const choices = event.choices
      .map((c, i) => {
        const ok = this.run.canChooseEventOption(i);
        return `<button class="choice-btn" data-event-choice="${i}" ${ok ? '' : 'disabled'}>${c.label}</button>`;
      })
      .join('');
    return `
      <div class="dialog-screen center">
        <h2>❓ ${event.title}</h2>
        <p class="event-text">${event.text}</p>
        <div class="choice-list">${choices}</div>
      </div>`;
  }

  private shopScreen(): string {
    const shop = this.run.shop!;
    const cardItems = shop.cards
      .map((item, i) => {
        if (item.sold) return `<div class="shop-item sold">已售出</div>`;
        const afford = this.run.gold >= item.price;
        return `
          <div class="shop-item">
            ${cardFaceHtml(getCardDef(item.defId), afford ? 'pickable' : 'dimmed', afford ? `data-buy-card="${i}"` : '')}
            <div class="price-tag">💰 ${item.price}</div>
          </div>`;
      })
      .join('');
    const relicItems = shop.relics
      .map((item, i) => {
        if (item.sold) return '';
        const def = getRelicDef(item.id);
        const afford = this.run.gold >= item.price;
        return `
          <button class="shop-row ${afford ? '' : 'dimmed'}" data-buy-relic="${i}" ${afford ? '' : 'disabled'}>
            🏺 ${def.name} — ${def.desc} <span class="price-tag">💰 ${item.price}</span>
          </button>`;
      })
      .join('');
    const potionItems = shop.potions
      .map((item, i) => {
        if (item.sold) return '';
        const def = getPotionDef(item.id);
        const afford = this.run.gold >= item.price && this.run.potions.length < 3;
        return `
          <button class="shop-row ${afford ? '' : 'dimmed'}" data-buy-potion="${i}" ${afford ? '' : 'disabled'}>
            🧪 ${def.name} — ${def.desc} <span class="price-tag">💰 ${item.price}</span>
          </button>`;
      })
      .join('');
    const removeAfford = !shop.removeUsed && this.run.gold >= shop.removePrice;
    const removeSection = this.removeMode
      ? `<h3>點選要刪除的卡牌：</h3>
         <div class="card-row wrap">${this.run.deck
           .map((card, i) => cardFaceHtml(resolveCard(card), 'pickable', `data-remove-card="${i}"`))
           .join('')}</div>
         <button class="ghost-btn" data-cancel-remove>取消</button>`
      : `<button class="shop-row ${removeAfford ? '' : 'dimmed'}" data-remove-mode ${removeAfford ? '' : 'disabled'}>
           ✂ 刪除一張卡牌 <span class="price-tag">💰 ${shop.removePrice}</span>${shop.removeUsed ? '（已使用）' : ''}
         </button>`;
    return `
      <div class="dialog-screen">
        <h2>🛒 商店</h2>
        <div class="card-row">${cardItems}</div>
        <div class="shop-rows">${relicItems}${potionItems}${removeSection}</div>
        <button class="ghost-btn" data-leave-shop>離開商店</button>
      </div>`;
  }

  private restScreen(): string {
    const heal = Math.floor(this.run.maxHp * 0.3);
    const deckList = this.run.deck
      .map((card, i) => {
        const def = resolveCard(card);
        const canUp = this.run.canUpgrade(i);
        return cardFaceHtml(def, canUp ? 'pickable' : 'dimmed', canUp ? `data-upgrade="${i}"` : '');
      })
      .join('');
    return `
      <div class="dialog-screen">
        <h2>🔥 營火</h2>
        <p>休息回復 ${heal} HP，或鍛造升級一張卡牌。</p>
        <button class="primary-btn" data-rest-heal>休息（+${heal} HP）</button>
        <h3>或點選要升級的卡牌：</h3>
        <div class="card-row wrap">${deckList}</div>
      </div>`;
  }

  private resultScreen(phase: 'victory' | 'defeat'): string {
    const s = this.run.stats;
    const rows: [string, string | number][] = [
      ['抵達樓層', `${this.run.visited.length}/${this.run.map.rows.length}`],
      ['戰鬥勝場', s.battlesWon],
      ['戰鬥總回合', s.turnsTotal],
      ['造成傷害', s.damageDealt],
      ['承受傷害', s.damageTaken],
      ['最終牌組', `${this.run.deck.length} 張`],
      ['遺物', this.run.relics.map((id) => getRelicDef(id).name).join('、') || '無'],
      ['剩餘金幣', this.run.gold],
    ];
    return `
      <div class="dialog-screen center">
        <h2>${phase === 'victory' ? '🎉 通過第一幕！' : '💀 你死了…'}</h2>
        <p>${phase === 'victory' ? '擊敗頭目，本輪完成。' : `倒在樓層 ${this.run.visited.length}。`}</p>
        <table class="stats-table">
          ${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}
        </table>
        <button class="primary-btn" data-new-run>開始新的一輪</button>
      </div>`;
  }

  private bind(): void {
    const on = (selector: string, fn: (el: HTMLElement) => void) => {
      this.root.querySelectorAll<HTMLElement>(selector).forEach((el) => {
        el.addEventListener('click', () => fn(el));
      });
    };
    on('[data-node]', (el) => {
      sound.play('click');
      this.onNodeClick(el.dataset.node!);
    });
    on('[data-mute]', () => {
      sound.toggle();
      this.render();
    });
    on('[data-card]', (el) => this.onCardClick(Number(el.dataset.card)));
    on('[data-enemy]', (el) => this.onEnemyClick(Number(el.dataset.enemy)));
    on('.end-turn', () => this.onEndTurn());
    on('[data-reward]', (el) => {
      this.run.pickReward(el.dataset.reward!);
      this.render();
    });
    on('[data-skip-reward]', () => {
      this.run.pickReward(null);
      this.render();
    });
    on('[data-rest-heal]', () => {
      this.run.restHeal();
      this.render();
    });
    on('[data-upgrade]', (el) => {
      this.run.restUpgrade(Number(el.dataset.upgrade));
      this.render();
    });
    on('[data-potion]', (el) => this.onPotionClick(Number(el.dataset.potion)));
    on('[data-event-choice]', (el) => {
      this.run.chooseEventOption(Number(el.dataset.eventChoice));
      this.render();
    });
    on('[data-leave-event]', () => {
      this.run.leaveEvent();
      this.render();
    });
    on('[data-buy-card]', (el) => {
      this.run.buyCard(Number(el.dataset.buyCard));
      this.render();
    });
    on('[data-buy-relic]', (el) => {
      this.run.buyRelic(Number(el.dataset.buyRelic));
      this.render();
    });
    on('[data-buy-potion]', (el) => {
      this.run.buyPotion(Number(el.dataset.buyPotion));
      this.render();
    });
    on('[data-remove-mode]', () => {
      this.removeMode = true;
      this.render();
    });
    on('[data-cancel-remove]', () => {
      this.removeMode = false;
      this.render();
    });
    on('[data-remove-card]', (el) => {
      this.run.removeCard(Number(el.dataset.removeCard));
      this.removeMode = false;
      this.render();
    });
    on('[data-leave-shop]', () => {
      this.removeMode = false;
      this.run.leaveShop();
      this.render();
    });
    on('[data-pile]', (el) => {
      this.pileView = el.dataset.pile as 'drawPile' | 'discardPile' | 'exhaustPile';
      this.render();
    });
    on('[data-close-pile]', () => {
      this.pileView = null;
      this.render();
    });
    on('[data-new-run]', () => this.newRun());
    const log = this.root.querySelector('.log-panel');
    if (log) log.scrollTop = log.scrollHeight;
  }
}

function findNode(rows: MapNode[][], id: string): MapNode {
  for (const row of rows) {
    const node = row.find((n) => n.id === id);
    if (node) return node;
  }
  throw new Error(`Unknown node ${id}`);
}

function getNodeRow(run: Run, id: string): number {
  return findNode(run.map.rows, id).row;
}
