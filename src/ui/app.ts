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
import { clearSave, loadRun, saveRun } from './storage';

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
  boss_maw: '#a83f57',
};

/** Shared card face used by the hand, rewards, and the campfire deck list. */
function cardFaceHtml(def: CardDef, extraClass = '', dataAttr = ''): string {
  const cost = def.cost === 'x' ? 'X' : String(def.cost);
  return `
    <div class="card type-${def.type} ${extraClass}" ${dataAttr}>
      <div class="cost">${cost}</div>
      <div class="card-name">${def.name}</div>
      <div class="card-type">${CARD_TYPE_NAMES[def.type]}</div>
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

  private battleActionDone(): void {
    if (this.run.battle && this.run.battle.state.phase !== 'playerTurn') {
      this.run.resolveBattle();
    }
    this.render();
  }

  private onCardClick(index: number): void {
    const battle = this.run.battle;
    if (!battle) return;
    const card = battle.state.player.hand[index];
    if (!card) return;
    if (resolveCard(card).target === 'enemy') {
      this.selected = this.selected === index ? null : index;
      this.render();
      return;
    }
    if (battle.canPlay(index)) {
      this.selected = null;
      battle.playCard(index);
      this.battleActionDone();
    }
  }

  private onEnemyClick(enemyIndex: number): void {
    const battle = this.run.battle;
    if (!battle) return;
    if (this.potionSelected !== null) {
      const enemy = battle.state.enemies[enemyIndex];
      if (enemy && enemy.hp > 0) {
        this.run.usePotion(this.potionSelected, enemyIndex);
        this.potionSelected = null;
        this.render();
      }
      return;
    }
    if (this.selected === null) return;
    if (battle.canPlay(this.selected, enemyIndex)) {
      battle.playCard(this.selected, enemyIndex);
      this.selected = null;
      this.battleActionDone();
    }
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
    this.run.usePotion(index);
    this.potionSelected = null;
    this.render();
  }

  private onEndTurn(): void {
    const battle = this.run.battle;
    if (!battle || battle.state.phase !== 'playerTurn') return;
    this.selected = null;
    battle.endTurn();
    this.battleActionDone();
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
        <span class="top-bar-right">第 ${this.run.act} 幕・樓層 ${floor}/${this.run.map.rows.length}</span>
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
          available.has(node.id) ? 'available' : '',
          visited.has(node.id) ? 'visited' : '',
          node.id === this.run.currentNodeId ? 'current' : '',
        ].join(' ');
        nodes += `
          <g class="${cls}" data-node="${node.id}" transform="translate(${x(node.col)},${y(node.row)})">
            <circle r="22"/>
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
          <button class="end-turn">結束回合</button>
        </div>
        <div class="hand">${player.hand.map((c, i) => this.handCardHtml(c, i)).join('')}</div>
        <div class="log-panel">${battle.state.log.slice(-40).map((l) => `<div>${l}</div>`).join('')}</div>
        ${this.pileView ? this.pileOverlayHtml() : ''}
      </div>`;
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

  private handCardHtml(card: CardInstance, index: number): string {
    const battle = this.run.battle!;
    const def = resolveCard(card);
    const playable =
      battle.canPlay(index) ||
      battle.state.enemies.some((e, i) => e.hp > 0 && battle.canPlay(index, i));
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
    on('[data-node]', (el) => this.onNodeClick(el.dataset.node!));
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
