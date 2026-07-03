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
import type { IntentPreview } from '../engine/battle';
import { cardText } from './describe';
import {
  cardTypeName,
  enemyName,
  eventChoiceLabel,
  eventResult,
  eventText,
  eventTitle,
  locale,
  nodeName,
  potionDesc,
  relicDesc,
  setLocale,
  statusName,
  t,
  type Locale,
} from './i18n';
import { sound } from './sound';
import { clearSave, loadRun, saveRun } from './storage';

/** Pre-action HP/block snapshot, diffed after the action to drive hit FX. */
interface BattleSnapshot {
  enemies: { hp: number; block: number }[];
  playerHp: number;
  playerBlock: number;
}

/** Generated assets (scripts/generate-art.ts) served from public/art/. */
function artUrl(
  dir: 'cards' | 'enemies' | 'relics' | 'potions' | 'bg' | 'icons' | 'events' | 'frames',
  id: string
): string {
  // BASE_URL keeps assets working under a sub-path deploy (GitHub Pages).
  return `${import.meta.env.BASE_URL}art/${dir}/${id}.webp`;
}

/** Small inline icon img. */
function iconHtml(id: string, cls = 'chip-icon', alt = ''): string {
  return `<img class="${cls}" src="${artUrl('icons', id)}" alt="${alt}" draggable="false">`;
}

/** Ambient drifting ember particles (title screen). */
function emberHtml(n: number): string {
  let out = '';
  for (let i = 0; i < n; i++) {
    const left = Math.random() * 100;
    const size = 2 + Math.random() * 4;
    const dur = 6 + Math.random() * 9;
    const delay = -Math.random() * 15;
    out += `<span class="ember" style="left:${left}%;width:${size}px;height:${size}px;animation-duration:${dur}s;animation-delay:${delay}s"></span>`;
  }
  return out;
}

const NODE_ICON: Record<NodeKind, string> = {
  battle: 'node_battle',
  elite: 'node_elite',
  rest: 'node_rest',
  event: 'node_event',
  shop: 'node_shop',
  boss: 'node_boss',
};

/** Enemies rendered at a larger scale (bosses and elites). */
const BIG_ENEMIES = new Set(['boss_maw', 'slime_king', 'the_shadow', 'gremlin_nob', 'giant_head']);

/** Card face background texture per card type. */
const CARD_FRAME: Record<string, string> = {
  attack: 'frame_attack',
  skill: 'frame_skill',
  power: 'frame_power',
  status: 'frame_neutral',
  curse: 'frame_neutral',
};

/** Shared card face used by the hand, rewards, and the campfire deck list. */
function cardFaceHtml(def: CardDef, extraClass = '', dataAttr = '', styleExtra = ''): string {
  const cost = def.cost === 'x' ? 'X' : String(def.cost);
  const upgraded = def.name.endsWith('+') ? 'upgraded' : '';
  return `
    <div class="card type-${def.type} rarity-${def.rarity} ${upgraded} ${extraClass}" ${dataAttr}
         style="background-image:url('${artUrl('frames', CARD_FRAME[def.type] ?? 'frame_neutral')}');${styleExtra}">
      <div class="cost">${cost}</div>
      <div class="card-head">
        <div class="card-name">${def.name}</div>
        <div class="card-type">${cardTypeName(def.type)}</div>
      </div>
      <div class="card-art"><img src="${artUrl('cards', def.id)}" alt="" draggable="false"></div>
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
  /** Battle log panel visibility (debug-ish; collapsed by default). */
  private logOpen = false;
  /** A save found at startup, awaiting the player's resume/restart decision. */
  private pendingResume: RunSave | null = null;
  /** Previous run phase; a change triggers the screen-enter transition. */
  private lastPhase: string | null = null;
  /** Whether the title screen (not the run) is currently shown. */
  private onTitle = true;
  private settingsOpen = false;
  private pauseOpen = false;
  /** Restart in the pause menu needs a second confirming click. */
  private restartArmed = false;
  private readonly root: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    // Dev hook: lets browser-side tests drive the app without physical clicks.
    (window as unknown as { __app: App }).__app = this;
    setLocale(locale()); // sync <html lang> with the persisted locale
    this.pendingResume = loadRun();
    this.renderTitle();
  }

  /** Re-renders whichever screen is showing (title or run). */
  private rerender(): void {
    if (this.onTitle) this.renderTitle();
    else this.render();
  }

  /** Title screen; doubles as the resume prompt when a save exists. */
  private renderTitle(): void {
    this.onTitle = true;
    const save = this.pendingResume;
    const saveInfo = save
      ? `<p class="save-info">${t('saveInfo', save.act, save.visited.length, save.map.rows.length, save.hp, save.maxHp, save.gold, save.deck.length)}</p>`
      : '';
    const buttons = save
      ? `<button class="primary-btn" data-resume>${t('resume')}</button>
         <button class="ghost-btn" data-abandon>${t('abandon')}</button>`
      : `<button class="primary-btn" data-start>${t('start')}</button>`;
    document.body.dataset.phase = 'title';
    sound.setPhase('title');
    this.root.innerHTML = `
      <div class="game">
        <div class="dialog-screen center title-screen screen-enter">
          <div class="embers">${emberHtml(16)}</div>
          <img class="logo-img" src="${artUrl('bg', locale() === 'zh' ? 'logo' : 'logo_en')}" alt="Spire Trial" draggable="false">
          <p class="game-subtitle">${t('subtitle')}</p>
          ${saveInfo}
          ${buttons}
          <button class="ghost-btn title-settings" data-open-settings>
            ${iconHtml('ui_menu', 'inline-icon')} ${t('settings')}
          </button>
        </div>
        ${this.settingsOpen ? this.settingsOverlayHtml() : ''}
      </div>`;
    this.root.querySelector('[data-start]')?.addEventListener('click', () => {
      sound.play('click');
      this.newRun();
    });
    this.root.querySelector('[data-resume]')?.addEventListener('click', () => {
      sound.play('click');
      this.run = Run.fromSave(this.pendingResume!);
      this.pendingResume = null;
      this.render();
    });
    this.root.querySelector('[data-abandon]')?.addEventListener('click', () => {
      this.pendingResume = null;
      clearSave();
      this.newRun();
    });
    this.bindMenus();
  }

  private newRun(): void {
    clearSave();
    this.run = new Run((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
    this.selected = null;
    this.potionSelected = null;
    this.removeMode = false;
    this.pileView = null;
    this.pendingResume = null;
    this.pauseOpen = false;
    this.settingsOpen = false;
    this.restartArmed = false;
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
    // Run-ending victory/defeat is carried by the music stinger instead.
    if (ended === 'victory' && this.run.phase !== 'victory') sound.play('victory');
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
        this.burst(el, 'dmg', Math.min(14, 5 + Math.floor(lost / 3)));
      }
    });
    if (anyHit) sound.play('hit');

    const player = battle.state.player;
    const panel = this.root.querySelector('.player-panel');
    if (!panel) return;
    const lostHp = before.playerHp - player.hp;
    if (lostHp > 0) {
      panel.classList.add('hit');
      this.root.querySelector('.hero-side')?.classList.add('hit');
      this.floatText(panel, `-${lostHp}`, 'dmg');
      sound.play('hurt');
      // Big hits rattle the whole arena.
      if (lostHp >= 15) this.root.querySelector('.battle')?.classList.add('shake');
    } else if (lostHp < 0) {
      this.floatText(panel, `+${-lostHp}`, 'heal');
      this.burst(panel, 'heal', 8);
      sound.play('heal');
    }
    const gainedBlock = player.block - before.playerBlock;
    if (gainedBlock > 0) {
      this.floatText(panel, `+${gainedBlock}`, 'block');
      this.burst(panel, 'block', 7);
      sound.play('block');
    }
  }

  private floatText(host: Element, text: string, kind: 'dmg' | 'block' | 'heal'): void {
    const span = document.createElement('span');
    span.className = `float-text ${kind}`;
    span.textContent = text;
    host.appendChild(span);
  }

  /** Short-lived burst of particle sparks centered on the host element. */
  private burst(host: Element, kind: 'dmg' | 'block' | 'heal', count: number): void {
    for (let i = 0; i < count; i++) {
      const p = document.createElement('span');
      p.className = `burst ${kind}`;
      const angle = Math.random() * Math.PI * 2;
      const dist = 28 + Math.random() * 55;
      p.style.setProperty('--dx', `${(Math.cos(angle) * dist).toFixed(0)}px`);
      p.style.setProperty('--dy', `${(Math.sin(angle) * dist - 22).toFixed(0)}px`);
      p.style.animationDelay = `${(Math.random() * 90).toFixed(0)}ms`;
      p.addEventListener('animationend', () => p.remove());
      host.appendChild(p);
    }
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
    else if (this.run.phase === 'reward' || this.run.phase === 'actTransition') sound.play('victory');
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
    // A survived enemy turn ends with the next hand being dealt.
    if (this.run.phase === 'battle') sound.play('draw');
  }

  /** Whether the node being played right now is the act boss. */
  private isBossNode(): boolean {
    const id = this.run.currentNodeId;
    if (!id) return false;
    return findNode(this.run.map.rows, id).kind === 'boss';
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
    this.onTitle = false;
    // Per-phase full-bleed background image, applied at the body level.
    document.body.dataset.phase = this.run.phase;
    const bossBattle = this.run.phase === 'battle' && this.isBossNode();
    sound.setPhase(this.run.phase, bossBattle);
    const overlays = `${this.pauseOpen ? this.pauseOverlayHtml() : ''}${this.settingsOpen ? this.settingsOverlayHtml() : ''}`;
    this.root.innerHTML = `<div class="game">${this.topBarHtml()}${screen}${overlays}</div>`;
    // Slide-and-fade the screen in whenever the run phase changes.
    if (this.run.phase !== this.lastPhase) {
      this.root.querySelector('.game > :nth-child(2)')?.classList.add('screen-enter');
      if (bossBattle && this.lastPhase !== 'battle') sound.play('boss');
      this.lastPhase = this.run.phase;
    }
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
        return `<span class="relic-chip" title="${def.name}: ${relicDesc(id, def.desc)}"><img class="chip-icon" src="${artUrl('relics', id)}" alt="${def.name}"></span>`;
      })
      .join('');
    const inBattle = this.run.phase === 'battle';
    const potions = this.run.potions
      .map((id, i) => {
        const def = getPotionDef(id);
        const cls = `potion-chip ${inBattle ? 'usable' : ''} ${this.potionSelected === i ? 'selected' : ''}`;
        return `<span class="${cls}" data-potion="${i}" title="${def.name}: ${potionDesc(id, def.desc)}${inBattle ? t('clickToUse') : ''}"><img class="chip-icon" src="${artUrl('potions', id)}" alt="${def.name}"></span>`;
      })
      .join('');
    return `
      <div class="top-bar">
        <span class="stat">${iconHtml('ui_hp', 'chip-icon', t('hp'))} ${this.run.hp}/${this.run.maxHp}</span>
        <span class="stat">${iconHtml('ui_gold', 'chip-icon', t('gold'))} ${this.run.gold}</span>
        <span class="stat" title="${t('deck')}">${iconHtml('ui_deck', 'chip-icon', t('deck'))} ${this.run.deck.length}</span>
        <span class="chip-group">${relics}</span>
        <span class="chip-group">${potions}</span>
        <span class="top-bar-right">
          <span class="mute-chip" data-mute title="${t('soundToggle')}">${iconHtml(sound.muted ? 'ui_sound_off' : 'ui_sound_on')}</span>
          <span class="mute-chip" data-pause title="${t('pauseTitle')}">${iconHtml('ui_menu')}</span>
          <span class="stat">${iconHtml('ui_floor', 'chip-icon', t('floor'))} ${t('actFloor', this.run.act, floor, this.run.map.rows.length)}</span>
        </span>
      </div>`;
  }

  // --- pause & settings overlays ---

  private pauseOverlayHtml(): string {
    return `
      <div class="overlay">
        <div class="overlay-box menu-box">
          <h2>${t('paused')}</h2>
          <button class="primary-btn" data-resume-game>${t('resumeGame')}</button>
          <button class="ghost-btn" data-open-settings>${t('settings')}</button>
          <button class="ghost-btn" data-back-title>${t('backToTitle')}</button>
          <button class="ghost-btn ${this.restartArmed ? 'danger' : ''}" data-restart>
            ${this.restartArmed ? t('restartConfirm') : t('restartRun')}
          </button>
        </div>
      </div>`;
  }

  private settingsOverlayHtml(): string {
    const langBtn = (l: Locale, label: string) =>
      `<button class="ghost-btn lang-btn ${locale() === l ? 'active' : ''}" data-lang="${l}">${label}</button>`;
    return `
      <div class="overlay">
        <div class="overlay-box menu-box settings-box">
          <h2>${t('settings')}</h2>
          <div class="setting-row">
            <span>${t('language')}</span>
            <span>${langBtn('en', 'English')}${langBtn('zh', '中文')}</span>
          </div>
          <div class="setting-row">
            <span>${t('musicVolume')}</span>
            <input type="range" min="0" max="100" value="${Math.round(sound.musicVolume * 100)}" data-vol="music">
          </div>
          <div class="setting-row">
            <span>${t('sfxVolume')}</span>
            <input type="range" min="0" max="100" value="${Math.round(sound.sfxVolume * 100)}" data-vol="sfx">
          </div>
          <div class="setting-row">
            <span>${t('muteAll')}</span>
            <button class="ghost-btn lang-btn ${sound.muted ? 'active' : ''}" data-mute-toggle>
              ${iconHtml(sound.muted ? 'ui_sound_off' : 'ui_sound_on', 'inline-icon')}
            </button>
          </div>
          <button class="primary-btn" data-close-settings>${t('close')}</button>
        </div>
      </div>`;
  }

  /** Handlers for the pause/settings overlays and their openers (title + run). */
  private bindMenus(): void {
    const on = (selector: string, fn: (el: HTMLElement) => void) => {
      this.root.querySelectorAll<HTMLElement>(selector).forEach((el) => {
        el.addEventListener('click', () => fn(el));
      });
    };
    on('[data-pause]', () => {
      sound.play('click');
      this.pauseOpen = true;
      this.restartArmed = false;
      this.rerender();
    });
    on('[data-resume-game]', () => {
      sound.play('click');
      this.pauseOpen = false;
      this.restartArmed = false;
      this.rerender();
    });
    on('[data-open-settings]', () => {
      sound.play('click');
      this.settingsOpen = true;
      this.rerender();
    });
    on('[data-close-settings]', () => {
      sound.play('click');
      this.settingsOpen = false;
      this.rerender();
    });
    on('[data-back-title]', () => {
      sound.play('click');
      this.pauseOpen = false;
      this.settingsOpen = false;
      this.restartArmed = false;
      this.pendingResume = loadRun();
      this.renderTitle();
    });
    on('[data-restart]', () => {
      sound.play('click');
      if (!this.restartArmed) {
        this.restartArmed = true;
        this.rerender();
        return;
      }
      this.newRun();
    });
    on('[data-lang]', (el) => {
      sound.play('click');
      setLocale(el.dataset.lang as Locale);
      this.rerender();
    });
    on('[data-mute-toggle]', () => {
      sound.toggle();
      this.rerender();
    });
    this.root.querySelectorAll<HTMLInputElement>('[data-vol]').forEach((el) => {
      el.addEventListener('input', () => {
        const v = Number(el.value) / 100;
        if (el.dataset.vol === 'music') sound.setMusicVolume(v);
        else sound.setSfxVolume(v);
      });
      // Let go of the slider = hear the new SFX level immediately.
      if (el.dataset.vol === 'sfx') el.addEventListener('change', () => sound.play('click'));
    });
  }

  private actTransitionScreen(): string {
    const reward = this.run.reward!;
    const extras: string[] = [
      `${iconHtml('ui_gold', 'inline-icon')} ${t('goldReward', reward.gold)}`,
      `${iconHtml('ui_hp', 'inline-icon')} ${t('actHeal')}`,
    ];
    if (reward.relic) {
      const def = getRelicDef(reward.relic);
      extras.push(`<img class="inline-icon" src="${artUrl('relics', reward.relic)}" alt=""> ${def.name} — ${relicDesc(reward.relic, def.desc)}`);
    }
    const cards = reward.cards
      .map((id) => cardFaceHtml(getCardDef(id), 'pickable', `data-reward="${id}"`))
      .join('');
    return `
      <div class="dialog-screen">
        <h2>${t('actDone', this.run.act)}</h2>
        <div class="reward-extras">${extras.map((e) => `<div>${e}</div>`).join('')}</div>
        <h3>${t('actChooseCard', this.run.act + 1)}</h3>
        <div class="card-row">${cards}</div>
        <button class="ghost-btn" data-skip-reward>${t('actSkip')}</button>
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
        const r = node.kind === 'boss' ? 32 : 24;
        const s = r * 1.55;
        nodes += `
          <g class="${cls}" data-node="${node.id}" transform="translate(${x(node.col)},${y(node.row)})">
            <circle r="${r}"/>
            <image href="${artUrl('icons', NODE_ICON[node.kind])}" x="${-s / 2}" y="${-s / 2}" width="${s}" height="${s}"/>
            <title>${nodeName(node.kind)}</title>
          </g>`;
      }
    }

    return `
      <div class="map-screen">
        <h2>${t('chooseNode')}</h2>
        <svg viewBox="0 0 ${width} ${height}" class="map-svg">${edges}${nodes}</svg>
      </div>`;
  }

  // --- battle screen (structure shared with Day 3) ---

  private battleScreen(): string {
    const battle = this.run.battle!;
    const { player, enemies, turn } = battle.state;
    const log = this.logOpen
      ? `<div class="log-panel">${battle.state.log.slice(-60).map((l) => `<div>${l}</div>`).join('')}</div>`
      : '';
    return `
      <div class="battle">
        <div class="turn-label">${t('turn', turn)}</div>
        <div class="arena">
          <div class="hero-side">
            <img src="${artUrl('bg', 'hero')}" alt="${t('you')}" draggable="false">
          </div>
          <div class="enemies-row">${enemies.map((e, i) => this.enemyHtml(e, i)).join('')}</div>
        </div>
        <div class="player-row">
          <div class="player-panel">
            <div class="actor-name">${t('you')}</div>
            ${this.hpBarHtml(player.hp, player.maxHp, player.block)}
            <div class="statuses">${this.statusesHtml(player.statuses)}</div>
          </div>
          <div class="energy-orb" title="${t('energy')}" style="background-image:url('${artUrl('frames', 'energy_orb')}')">
            <span>${player.energy}/${player.maxEnergy}</span>
          </div>
          <div class="piles">
            <span class="pile-link" data-pile="drawPile">${iconHtml('ui_draw', 'pile-icon', t('drawPile'))} ${player.drawPile.length}</span>
            <span class="pile-link" data-pile="discardPile">${iconHtml('ui_discard', 'pile-icon', t('discardPile'))} ${player.discardPile.length}</span>
            <span class="pile-link" data-pile="exhaustPile">${iconHtml('ui_exhaust', 'pile-icon', t('exhaustPile'))} ${player.exhaustPile.length}</span>
          </div>
          ${this.endTurnButtonHtml()}
        </div>
        <div class="hand">${player.hand.map((c, i) => this.handCardHtml(c, i, player.hand.length)).join('')}</div>
        <button class="log-toggle ${this.logOpen ? 'open' : ''}" data-toggle-log>${t('battleLog')}</button>
        ${log}
        ${this.pileView ? this.pileOverlayHtml() : ''}
      </div>`;
  }

  /** Warns when ending the turn would waste energy on still-playable cards. */
  private endTurnButtonHtml(): string {
    const battle = this.run.battle!;
    const player = battle.state.player;
    const wouldWaste =
      player.energy > 0 && player.hand.some((_, i) => this.isHandCardPlayable(i));
    if (!wouldWaste) return `<button class="end-turn">${t('endTurn')}</button>`;
    return `<button class="end-turn warn" title="${t('playableLeft')}">${t('endTurnEnergy', player.energy)}</button>`;
  }

  private pileOverlayHtml(): string {
    const battle = this.run.battle!;
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
          <h2>${t('pileCount', t(this.pileView!), pile.length)}</h2>
          <div class="card-row wrap">${cards || `<p>${t('empty')}</p>`}</div>
          <button class="ghost-btn" data-close-pile>${t('close')}</button>
        </div>
      </div>`;
  }

  private enemyHtml(enemy: EnemyState, index: number): string {
    const dead = enemy.hp <= 0;
    const battle = this.run.battle!;
    const intent = dead ? '' : `<div class="intent">${this.intentHtml(battle.intentOf(enemy))}</div>`;
    const targetable = (this.selected !== null || this.potionSelected !== null) && !dead;
    const big = BIG_ENEMIES.has(enemy.defId) ? 'big' : '';
    const name = enemyName(enemy.defId, enemy.name);
    return `
      <div class="enemy ${big} ${dead ? 'dead' : ''} ${targetable ? 'targetable' : ''}" data-enemy="${index}">
        ${intent}
        <div class="enemy-art"><img src="${artUrl('enemies', enemy.defId)}" alt="${name}" draggable="false"></div>
        <div class="actor-name">${name}</div>
        ${this.hpBarHtml(enemy.hp, enemy.maxHp, enemy.block)}
        <div class="statuses">${this.statusesHtml(enemy.statuses)}</div>
      </div>`;
  }

  /** Icon + short text version of the enemy intent line. */
  private intentHtml(intent: IntentPreview): string {
    const icon = iconHtml(`intent_${intent.kind === 'defend' ? 'defend' : intent.kind}`, 'intent-icon');
    switch (intent.kind) {
      case 'attack': {
        const hits = intent.hits && intent.hits > 1 ? `×${intent.hits}` : '';
        return `${icon} ${intent.damage}${hits}`;
      }
      case 'defend':
        return `${icon} ${t('intentDefend')}`;
      case 'buff':
        return `${icon} ${t('intentBuff')}`;
      case 'debuff':
        return `${icon} ${t('intentDebuff')}`;
    }
  }

  /** Fanned hand layout: rotation/lift computed per card, applied via CSS vars. */
  private handCardHtml(card: CardInstance, index: number, total: number): string {
    const def = resolveCard(card);
    const playable = this.isHandCardPlayable(index);
    const cls = `${playable ? 'playable' : 'not-playable'} ${this.selected === index ? 'selected' : ''}`;
    const mid = (total - 1) / 2;
    const off = index - mid;
    const rot = off * Math.min(4, 34 / Math.max(total, 1));
    const lift = Math.abs(off) * Math.abs(off) * 5;
    const style = `--rot:${rot.toFixed(2)}deg;--lift:${lift.toFixed(1)}px;--deal:${index * 55}ms;`;
    return cardFaceHtml(def, `in-hand ${cls}`, `data-card="${index}"`, style);
  }

  private hpBarHtml(hp: number, maxHp: number, block: number): string {
    const pct = Math.max(0, (hp / maxHp) * 100);
    const blockChip = block > 0 ? `<span class="block-chip">${block}</span>` : '';
    return `
      <div class="hp-bar">
        <div class="hp-fill" style="width:${pct}%"></div>
        <span class="hp-text">${hp}/${maxHp}</span>${blockChip}
      </div>`;
  }

  private statusesHtml(statuses: Record<string, number | undefined>): string {
    return Object.entries(statuses)
      .filter(([, v]) => v !== undefined && v !== 0)
      .map(([k, v]) => `<span class="status-chip">${statusName(k)} ${v}</span>`)
      .join('');
  }

  // --- reward / rest / result screens ---

  private rewardScreen(): string {
    const reward = this.run.reward!;
    const cards = reward.cards
      .map((id) => cardFaceHtml(getCardDef(id), 'pickable', `data-reward="${id}"`))
      .join('');
    const extras: string[] = [`${iconHtml('ui_gold', 'inline-icon')} ${t('goldReward', reward.gold)}`];
    if (reward.relic) {
      const def = getRelicDef(reward.relic);
      extras.push(`<img class="inline-icon" src="${artUrl('relics', reward.relic)}" alt=""> ${def.name} — ${relicDesc(reward.relic, def.desc)}`);
    }
    if (reward.potion) {
      const def = getPotionDef(reward.potion);
      extras.push(`<img class="inline-icon" src="${artUrl('potions', reward.potion)}" alt=""> ${def.name} — ${potionDesc(reward.potion, def.desc)}`);
    }
    return `
      <div class="dialog-screen">
        <h2>${t('victoryHeading')}</h2>
        <div class="reward-extras">${extras.map((e) => `<div>${e}</div>`).join('')}</div>
        <h3>${t('chooseCard')}</h3>
        <div class="card-row">${cards}</div>
        <button class="ghost-btn" data-skip-reward>${t('skipCard')}</button>
      </div>`;
  }

  private eventScreen(): string {
    const event = this.run.currentEvent!;
    const art = `<img class="event-art" src="${artUrl('events', event.id)}" alt="" draggable="false">`;
    if (this.run.eventResult !== null) {
      const result = eventResult(event.id, event.choices.map((c) => c.result), this.run.eventResult);
      return `
        <div class="dialog-screen center">
          <h2>${eventTitle(event.id, event.title)}</h2>
          ${art}
          <p class="event-text">${result}</p>
          <button class="primary-btn" data-leave-event>${t('continue')}</button>
        </div>`;
    }
    const choices = event.choices
      .map((c, i) => {
        const ok = this.run.canChooseEventOption(i);
        return `<button class="choice-btn" data-event-choice="${i}" ${ok ? '' : 'disabled'}>${eventChoiceLabel(event.id, i, c.label)}</button>`;
      })
      .join('');
    return `
      <div class="dialog-screen center">
        <h2>${eventTitle(event.id, event.title)}</h2>
        ${art}
        <p class="event-text">${eventText(event.id, event.text)}</p>
        <div class="choice-list">${choices}</div>
      </div>`;
  }

  private shopScreen(): string {
    const shop = this.run.shop!;
    const cardItems = shop.cards
      .map((item, i) => {
        if (item.sold) return `<div class="shop-item sold">${t('sold')}</div>`;
        const afford = this.run.gold >= item.price;
        return `
          <div class="shop-item">
            ${cardFaceHtml(getCardDef(item.defId), afford ? 'pickable' : 'dimmed', afford ? `data-buy-card="${i}"` : '')}
            <div class="price-tag">${iconHtml('ui_gold', 'inline-icon')} ${item.price}</div>
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
            <img class="inline-icon" src="${artUrl('relics', item.id)}" alt=""> ${def.name} — ${relicDesc(item.id, def.desc)} <span class="price-tag">${iconHtml('ui_gold', 'inline-icon')} ${item.price}</span>
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
            <img class="inline-icon" src="${artUrl('potions', item.id)}" alt=""> ${def.name} — ${potionDesc(item.id, def.desc)} <span class="price-tag">${iconHtml('ui_gold', 'inline-icon')} ${item.price}</span>
          </button>`;
      })
      .join('');
    const removeAfford = !shop.removeUsed && this.run.gold >= shop.removePrice;
    const removeSection = this.removeMode
      ? `<h3>${t('pickRemove')}</h3>
         <div class="card-row wrap">${this.run.deck
           .map((card, i) => cardFaceHtml(resolveCard(card), 'pickable', `data-remove-card="${i}"`))
           .join('')}</div>
         <button class="ghost-btn" data-cancel-remove>${t('cancel')}</button>`
      : `<button class="shop-row ${removeAfford ? '' : 'dimmed'}" data-remove-mode ${removeAfford ? '' : 'disabled'}>
           ${t('removeCard')} <span class="price-tag">${iconHtml('ui_gold', 'inline-icon')} ${shop.removePrice}</span>${shop.removeUsed ? t('removeUsed') : ''}
         </button>`;
    return `
      <div class="dialog-screen">
        <h2>${iconHtml('node_shop', 'heading-icon')} ${t('shop')}</h2>
        <div class="card-row">${cardItems}</div>
        <div class="shop-rows">${relicItems}${potionItems}${removeSection}</div>
        <button class="ghost-btn" data-leave-shop>${t('leaveShop')}</button>
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
        <h2>${iconHtml('node_rest', 'heading-icon')} ${t('campfire')}</h2>
        <p>${t('restIntro', heal)}</p>
        <button class="primary-btn" data-rest-heal>${t('restHeal', heal)}</button>
        <h3>${t('restUpgrade')}</h3>
        <div class="card-row wrap">${deckList}</div>
      </div>`;
  }

  private resultScreen(phase: 'victory' | 'defeat'): string {
    const s = this.run.stats;
    const listSep = locale() === 'zh' ? '、' : ', ';
    const rows: [string, string | number][] = [
      [t('statFloor'), `${this.run.visited.length}/${this.run.map.rows.length}`],
      [t('statWins'), s.battlesWon],
      [t('statTurns'), s.turnsTotal],
      [t('statDealt'), s.damageDealt],
      [t('statTaken'), s.damageTaken],
      [t('statDeck'), t('cardsCount', this.run.deck.length)],
      [t('statRelics'), this.run.relics.map((id) => getRelicDef(id).name).join(listSep) || t('none')],
      [t('statGold'), this.run.gold],
    ];
    return `
      <div class="dialog-screen center">
        <h2>${phase === 'victory' ? t('winTitle') : t('loseTitle')}</h2>
        <p>${phase === 'victory' ? t('winText') : t('loseText', this.run.act, this.run.visited.length)}</p>
        <table class="stats-table">
          ${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}
        </table>
        <button class="primary-btn" data-new-run>${t('newRun')}</button>
      </div>`;
  }

  private bind(): void {
    const on = (selector: string, fn: (el: HTMLElement) => void) => {
      this.root.querySelectorAll<HTMLElement>(selector).forEach((el) => {
        el.addEventListener('click', () => fn(el));
      });
    };
    on('[data-node]', (el) => {
      sound.play('node');
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
      sound.play('heal');
      this.run.restHeal();
      this.render();
    });
    on('[data-upgrade]', (el) => {
      sound.play('upgrade');
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
      sound.play('gold');
      this.run.buyCard(Number(el.dataset.buyCard));
      this.render();
    });
    on('[data-buy-relic]', (el) => {
      sound.play('gold');
      this.run.buyRelic(Number(el.dataset.buyRelic));
      this.render();
    });
    on('[data-buy-potion]', (el) => {
      sound.play('gold');
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
    on('[data-toggle-log]', () => {
      this.logOpen = !this.logOpen;
      this.render();
    });
    on('[data-new-run]', () => this.newRun());
    this.bindMenus();
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
