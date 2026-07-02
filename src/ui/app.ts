/**
 * Battle screen controller: owns the Battle instance and UI state
 * (card selection), and re-renders the whole screen after every action.
 * Engine stays headless; this file is the only place that touches the DOM
 * together with main.ts.
 */
import { Battle } from '../engine/battle';
import { makeCard, makeStarterDeck, resolveCard } from '../engine/cards';
import type { CardInstance, EnemyState } from '../engine/types';
import { cardText, CARD_TYPE_NAMES, intentText, STATUS_NAMES } from './describe';

/** Starter deck plus a sampler of Day 1-2 cards so the demo shows every mechanic. */
function demoDeck(): CardInstance[] {
  return [
    ...makeStarterDeck(),
    makeCard('pommel_strike'),
    makeCard('shrug_it_off'),
    makeCard('cleave'),
    makeCard('twin_strike'),
    makeCard('whirlwind'),
    makeCard('metallicize'),
    makeCard('dramatic_entrance'),
  ];
}

const ENCOUNTERS: string[][] = [
  ['jaw_worm'],
  ['cultist'],
  ['acid_slime', 'spike_slime_m'],
  ['louse_red', 'louse_red'],
  ['jaw_worm', 'cultist'],
];

/** Flat-color SVG art per enemy family. Placeholder-quality but consistent. */
function enemyArt(defId: string): string {
  if (defId.includes('slime')) {
    return `<svg viewBox="0 0 80 60"><ellipse cx="40" cy="42" rx="32" ry="18" fill="var(--art)"/>
      <ellipse cx="40" cy="30" rx="22" ry="16" fill="var(--art)" opacity="0.85"/>
      <circle cx="33" cy="28" r="3" fill="#111"/><circle cx="48" cy="28" r="3" fill="#111"/></svg>`;
  }
  if (defId.includes('worm')) {
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
  // cultist and default: hooded figure
  return `<svg viewBox="0 0 80 60"><path d="M40 8 L62 56 L18 56 Z" fill="var(--art)"/>
    <circle cx="40" cy="26" r="9" fill="#111" opacity="0.6"/>
    <circle cx="37" cy="25" r="2" fill="#e8d44d"/><circle cx="44" cy="25" r="2" fill="#e8d44d"/></svg>`;
}

const ENEMY_COLORS: Record<string, string> = {
  jaw_worm: '#7aa35c',
  cultist: '#8a5fb0',
  acid_slime: '#5fb08a',
  spike_slime_m: '#b05f6b',
  louse_red: '#c26d4f',
};

export class App {
  private battle!: Battle;
  private selected: number | null = null;
  private readonly root: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.newBattle();
  }

  private newBattle(): void {
    const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    const encounter = ENCOUNTERS[Math.floor(Math.random() * ENCOUNTERS.length)]!;
    this.battle = new Battle({
      seed,
      deck: demoDeck(),
      playerHp: 80,
      playerMaxHp: 80,
      enemies: encounter,
    });
    this.selected = null;
    this.render();
  }

  private onCardClick(index: number): void {
    const card = this.battle.state.player.hand[index];
    if (!card) return;
    const def = resolveCard(card);
    if (def.target === 'enemy') {
      // Toggle targeting mode; the actual play happens on enemy click.
      this.selected = this.selected === index ? null : index;
      this.render();
      return;
    }
    if (this.battle.canPlay(index)) {
      this.selected = null;
      this.battle.playCard(index);
      this.render();
    }
  }

  private onEnemyClick(enemyIndex: number): void {
    if (this.selected === null) return;
    if (this.battle.canPlay(this.selected, enemyIndex)) {
      this.battle.playCard(this.selected, enemyIndex);
      this.selected = null;
      this.render();
    }
  }

  private onEndTurn(): void {
    if (this.battle.state.phase !== 'playerTurn') return;
    this.selected = null;
    this.battle.endTurn();
    this.render();
  }

  // --- rendering ---

  private render(): void {
    const { player, enemies, phase, turn } = this.battle.state;
    this.root.innerHTML = `
      <div class="battle">
        <div class="top-bar"><span>回合 ${turn}</span></div>
        <div class="enemies-row">${enemies.map((e, i) => this.enemyHtml(e, i)).join('')}</div>
        <div class="player-row">
          <div class="player-panel">
            <div class="actor-name">你</div>
            ${this.hpBarHtml(player.hp, player.maxHp, player.block)}
            <div class="statuses">${this.statusesHtml(player.statuses)}</div>
          </div>
          <div class="energy-orb" title="能量">${player.energy}/${player.maxEnergy}</div>
          <div class="piles">
            <span>抽牌 ${player.drawPile.length}</span>
            <span>棄牌 ${player.discardPile.length}</span>
            <span>消耗 ${player.exhaustPile.length}</span>
          </div>
          <button class="end-turn" ${phase !== 'playerTurn' ? 'disabled' : ''}>結束回合</button>
        </div>
        <div class="hand">${player.hand.map((c, i) => this.cardHtml(c, i)).join('')}</div>
        <div class="log-panel">${this.battle.state.log.slice(-40).map((l) => `<div>${l}</div>`).join('')}</div>
        ${phase !== 'playerTurn' ? this.overlayHtml(phase) : ''}
      </div>`;
    this.bind();
  }

  private enemyHtml(enemy: EnemyState, index: number): string {
    const dead = enemy.hp <= 0;
    const intent = dead ? '' : `<div class="intent">${intentText(this.battle.intentOf(enemy))}</div>`;
    const targetable = this.selected !== null && !dead;
    return `
      <div class="enemy ${dead ? 'dead' : ''} ${targetable ? 'targetable' : ''}" data-enemy="${index}"
           style="--art:${ENEMY_COLORS[enemy.defId] ?? '#888'}">
        ${intent}
        <div class="enemy-art">${enemyArt(enemy.defId)}</div>
        <div class="actor-name">${enemy.name}</div>
        ${this.hpBarHtml(enemy.hp, enemy.maxHp, enemy.block)}
        <div class="statuses">${this.statusesHtml(enemy.statuses)}</div>
      </div>`;
  }

  private cardHtml(card: CardInstance, index: number): string {
    const def = resolveCard(card);
    const playable =
      this.battle.canPlay(index) ||
      this.battle.state.enemies.some((e, i) => e.hp > 0 && this.battle.canPlay(index, i));
    const cost = def.cost === 'x' ? 'X' : String(def.cost);
    return `
      <div class="card type-${def.type} ${playable ? 'playable' : 'unplayable'} ${this.selected === index ? 'selected' : ''}"
           data-card="${index}">
        <div class="cost">${cost}</div>
        <div class="card-name">${def.name}</div>
        <div class="card-type">${CARD_TYPE_NAMES[def.type]}</div>
        <div class="card-text">${cardText(def)}</div>
      </div>`;
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

  private overlayHtml(phase: 'victory' | 'defeat'): string {
    return `
      <div class="overlay">
        <div class="overlay-box">
          <h2>${phase === 'victory' ? '勝利！' : '戰敗…'}</h2>
          <button class="restart">再來一場</button>
        </div>
      </div>`;
  }

  private bind(): void {
    this.root.querySelectorAll<HTMLElement>('[data-card]').forEach((el) => {
      el.addEventListener('click', () => this.onCardClick(Number(el.dataset.card)));
    });
    this.root.querySelectorAll<HTMLElement>('[data-enemy]').forEach((el) => {
      el.addEventListener('click', () => this.onEnemyClick(Number(el.dataset.enemy)));
    });
    this.root.querySelector('.end-turn')?.addEventListener('click', () => this.onEndTurn());
    this.root.querySelector('.restart')?.addEventListener('click', () => this.newBattle());
    // Auto-scroll the log to the latest entry.
    const log = this.root.querySelector('.log-panel');
    if (log) log.scrollTop = log.scrollHeight;
  }
}
