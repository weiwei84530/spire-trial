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
import type { ActorRef, BattleEvent, CardDef, CardInstance, EnemyState } from '../engine/types';
import type { IntentPreview } from '../engine/battle';
import { cardText } from './describe';
import {
  cardName,
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
  statusDesc,
  statusName,
  t,
  type Locale,
} from './i18n';
import { preloadAll } from './preload';
import { sound } from './sound';
import { clearSave, loadRun, saveRun } from './storage';

/**
 * One presentation "beat" of the event replay: an anchor (who acts) plus the
 * effect events that land while that actor's animation plays.
 */
interface Beat {
  anchor: BattleEvent | null;
  fx: BattleEvent[];
}

/** Groups an engine event slice into replayable beats keyed on action anchors. */
function compileBeats(events: BattleEvent[]): Beat[] {
  const beats: Beat[] = [];
  let current: Beat = { anchor: null, fx: [] };
  const push = () => {
    if (current.anchor || current.fx.length > 0) beats.push(current);
  };
  for (const ev of events) {
    if (ev.type === 'enemyActionStart' || ev.type === 'playerActionStart' || ev.type === 'turnStart') {
      push();
      current = { anchor: ev, fx: [] };
    } else {
      current.fx.push(ev);
    }
  }
  push();
  return beats;
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

/** Escapes text for safe embedding inside a double-quoted HTML attribute. */
function attr(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** data-tip attribute for the custom instant tooltip (title + optional body). */
function tipAttr(title: string, body = ''): string {
  const html = `<b>${title}</b>${body ? `<span>${body}</span>` : ''}`;
  return `data-tip="${attr(html)}"`;
}

/** Shared card face used by the hand, rewards, and the campfire deck list. */
function cardFaceHtml(def: CardDef, extraClass = '', dataAttr = '', styleExtra = ''): string {
  const cost = def.cost === 'x' ? 'X' : String(def.cost);
  const upgraded = def.name.endsWith('+') ? 'upgraded' : '';
  return `
    <div class="card type-${def.type} rarity-${def.rarity} ${upgraded} ${extraClass}" ${dataAttr}
         style="background-image:url('${artUrl('frames', CARD_FRAME[def.type] ?? 'frame_neutral')}');${styleExtra}">
      <div class="cost">${cost}</div>
      <div class="card-head">
        <div class="card-name">${cardName(def)}</div>
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
  /** Cosmetic enemy-turn sequence in progress: input locked, hand hidden. */
  private enemyPhase = false;
  /** One-shot turn banner text, rendered once then cleared. */
  private turnBanner: string | null = null;
  /** Short input lock while a played card flies out. */
  private playLock = false;
  /** Event replay in progress: input locked, DOM patched incrementally. */
  private replaying = false;
  /** Pending timeouts of the active replay, cleared on cancel. */
  private replayTimers: number[] = [];
  /** Hand card instanceIds already dealt in, so re-renders don't replay deal-in. */
  private readonly handSeen = new Set<number>();
  /** Deck overlay (opened from the top bar) visibility. */
  private deckOpen = false;
  /** Abandon-save confirmation dialog visibility (title screen). */
  private abandonConfirm = false;
  /** Cheat menu overlay visibility. */
  private cheatOpen = false;
  /** Cheat toggles chosen before a run exists; copied onto each new/resumed run. */
  private readonly cheatDefaults = { oneHitKill: false, infiniteGold: false, infiniteHp: false };
  /** Campfire: deck index awaiting upgrade confirmation in the preview overlay. */
  private upgradePreview: number | null = null;
  private readonly root: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    // Dev hook: lets browser-side tests drive the app without physical clicks.
    (window as unknown as { __app: App }).__app = this;
    setLocale(locale()); // sync <html lang> with the persisted locale
    this.pendingResume = loadRun();
    this.initTooltip();
    void this.boot();
  }

  /**
   * Custom tooltip that shows instantly on hover (the native title attribute
   * takes ~1s and shows a help cursor, which testers found unintuitive).
   */
  private initTooltip(): void {
    const tip = document.createElement('div');
    tip.className = 'tooltip';
    document.body.appendChild(tip);
    document.addEventListener('mouseover', (e) => {
      const host = (e.target as HTMLElement).closest?.('[data-tip]');
      if (!(host instanceof HTMLElement) || !host.dataset.tip) return;
      tip.innerHTML = host.dataset.tip;
      tip.classList.add('show');
      const r = host.getBoundingClientRect();
      tip.style.left = `${Math.max(10, Math.min(window.innerWidth - 10, r.left + r.width / 2))}px`;
      tip.style.top = `${r.bottom + 8}px`;
      // Flip above / clamp inside the viewport once measured.
      const tr = tip.getBoundingClientRect();
      if (tr.bottom > window.innerHeight - 8) tip.style.top = `${r.top - tr.height - 8}px`;
      if (tr.right > window.innerWidth - 8) {
        tip.style.left = `${window.innerWidth - tr.width / 2 - 10}px`;
      } else if (tr.left < 8) {
        tip.style.left = `${tr.width / 2 + 10}px`;
      }
    });
    document.addEventListener('mouseout', (e) => {
      if ((e.target as HTMLElement).closest?.('[data-tip]')) tip.classList.remove('show');
    });
  }

  /** Loading screen: preload every asset behind a progress bar, then title. */
  private async boot(): Promise<void> {
    document.body.dataset.phase = 'loading';
    this.root.innerHTML = `
      <div class="game">
        <div class="dialog-screen center loading-screen">
          <h1 class="loading-title">Spire Trial</h1>
          <div class="loading-bar"><div class="loading-fill" style="width:0%"></div></div>
          <p class="loading-label">${t('loading')} 0%</p>
        </div>
      </div>`;
    const fill = this.root.querySelector<HTMLElement>('.loading-fill');
    const label = this.root.querySelector<HTMLElement>('.loading-label');
    await preloadAll((loaded, total) => {
      const pct = total === 0 ? 100 : Math.round((loaded / total) * 100);
      if (fill) fill.style.width = `${pct}%`;
      if (label) label.textContent = `${t('loading')} ${pct}%`;
    });
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
          <div class="title-links">
            <button class="ghost-btn title-settings" data-open-settings>
              ${iconHtml('ui_menu', 'inline-icon')} ${t('settings')}
            </button>
            <button class="ghost-btn title-settings" data-open-cheats>${t('cheatMenu')}</button>
          </div>
        </div>
        ${this.settingsOpen ? this.settingsOverlayHtml() : ''}
        ${this.cheatOpen ? this.cheatOverlayHtml() : ''}
        ${this.abandonConfirm ? this.abandonOverlayHtml() : ''}
      </div>`;
    this.root.querySelector('[data-start]')?.addEventListener('click', () => {
      sound.play('click');
      this.newRun();
    });
    this.root.querySelector('[data-resume]')?.addEventListener('click', () => {
      sound.play('click');
      this.run = Run.fromSave(this.pendingResume!);
      Object.assign(this.run.cheats, this.cheatDefaults);
      this.pendingResume = null;
      this.render();
    });
    // Deleting a save is irreversible: always ask first.
    this.root.querySelector('[data-abandon]')?.addEventListener('click', () => {
      sound.play('click');
      this.abandonConfirm = true;
      this.renderTitle();
    });
    this.root.querySelector('[data-confirm-abandon]')?.addEventListener('click', () => {
      sound.play('click');
      this.abandonConfirm = false;
      this.pendingResume = null;
      clearSave();
      this.newRun();
    });
    this.root.querySelector('[data-cancel-abandon]')?.addEventListener('click', () => {
      sound.play('click');
      this.abandonConfirm = false;
      this.renderTitle();
    });
    this.bindMenus();
  }

  private abandonOverlayHtml(): string {
    return `
      <div class="overlay">
        <div class="overlay-box menu-box">
          <h2>${t('confirmAbandonTitle')}</h2>
          <p class="confirm-text">${t('confirmAbandonText')}</p>
          <button class="ghost-btn danger" data-confirm-abandon>${t('confirmAbandon')}</button>
          <button class="primary-btn" data-cancel-abandon>${t('cancel')}</button>
        </div>
      </div>`;
  }

  /** Testing cheats: three toggles living on the run (or queued for the next one). */
  private cheatOverlayHtml(): string {
    const cheats = this.run?.cheats ?? this.cheatDefaults;
    const row = (key: keyof typeof this.cheatDefaults, label: string) => `
      <div class="setting-row">
        <span>${label}</span>
        <button class="ghost-btn lang-btn ${cheats[key] ? 'active' : ''}" data-cheat="${key}">
          ${cheats[key] ? 'ON' : 'OFF'}
        </button>
      </div>`;
    return `
      <div class="overlay">
        <div class="overlay-box menu-box settings-box">
          <h2>${t('cheatMenu')}</h2>
          <p class="confirm-text">${t('cheatHint')}</p>
          ${row('oneHitKill', t('cheatOneHit'))}
          ${row('infiniteGold', t('cheatGold'))}
          ${row('infiniteHp', t('cheatHp'))}
          <button class="primary-btn" data-close-cheats>${t('close')}</button>
        </div>
      </div>`;
  }

  private newRun(): void {
    this.cancelReplay();
    clearSave();
    this.run = new Run((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
    Object.assign(this.run.cheats, this.cheatDefaults);
    this.selected = null;
    this.potionSelected = null;
    this.removeMode = false;
    this.pileView = null;
    this.pendingResume = null;
    this.pauseOpen = false;
    this.settingsOpen = false;
    this.restartArmed = false;
    this.enemyPhase = false;
    this.turnBanner = null;
    this.playLock = false;
    this.deckOpen = false;
    this.abandonConfirm = false;
    this.cheatOpen = false;
    this.upgradePreview = null;
    this.render();
  }

  // --- event handlers ---

  private onNodeClick(id: string): void {
    if (!this.run.availableNodes().some((n) => n.id === id)) return;
    this.run.enterNode(id);
    this.render();
  }

  // --- event replay: the engine resolves instantly, the UI replays its events ---

  /** Stops an active replay and jumps the presentation to the final state. */
  private cancelReplay(): void {
    for (const id of this.replayTimers) window.clearTimeout(id);
    this.replayTimers = [];
    if (!this.replaying) return;
    this.replaying = false;
    this.enemyPhase = false;
    const battle = this.run.battle;
    if (battle && battle.state.phase !== 'playerTurn' && this.run.phase === 'battle') {
      const ended = battle.state.phase;
      this.run.resolveBattle();
      // resolveBattle mutates run.phase; re-read it untracked by the narrowing above.
      const phaseAfter: string = this.run.phase;
      if (ended === 'victory' && phaseAfter !== 'victory') sound.play('victory');
    }
  }

  private scheduleReplay(ms: number, fn: () => void): void {
    this.replayTimers.push(
      window.setTimeout(() => {
        if (this.replaying && !this.onTitle) fn();
      }, ms),
    );
  }

  /**
   * Replays a slice of engine events against the (pre-action) DOM: each acting
   * enemy lunges with its intent hidden, its damage lands mid-animation, and
   * only then do HP bars, floats and sounds update. A full render reconciles
   * everything at the end. Input stays locked via `replaying`/`enemyPhase`.
   */
  private replay(events: BattleEvent[], opts: { banner?: string; onDone: () => void }): void {
    this.cancelReplay();
    this.replaying = true;
    const beats = compileBeats(events);
    if (opts.banner) {
      this.enemyPhase = true;
      this.root.querySelector('.battle')?.classList.add('enemy-phase');
      this.root.querySelector('.end-turn')?.setAttribute('disabled', '');
      this.showBanner(opts.banner);
    }
    const impactMs = 230;
    let at = opts.banner ? 700 : 40;
    for (const beat of beats) {
      const anchor = beat.anchor;
      this.scheduleReplay(at, () => this.startBeatAnimation(anchor));
      // Damage events within one beat stagger so multi-hits read as separate thumps.
      let fxDelay = 0;
      for (const ev of beat.fx) {
        this.scheduleReplay(at + impactMs + fxDelay, () => this.applyEventFx(ev));
        if (ev.type === 'damage') fxDelay += 120;
      }
      const beatLength =
        anchor?.type === 'enemyActionStart'
          ? Math.max(700, impactMs + fxDelay + 450)
          : Math.max(320, impactMs + fxDelay + 90);
      at += beatLength;
    }
    this.scheduleReplay(at, () => this.finishReplay(opts.onDone));
  }

  /** Kicks the acting actor's animation and hides its intent as it moves. */
  private startBeatAnimation(anchor: BattleEvent | null): void {
    if (!anchor) return;
    if (anchor.type === 'enemyActionStart') {
      const el = this.root.querySelector<HTMLElement>(`[data-enemy="${anchor.enemy}"]`);
      if (!el) return;
      const intentEl = el.querySelector<HTMLElement>('.intent');
      if (intentEl) intentEl.style.opacity = '0';
      el.classList.remove('lunge', 'act');
      void el.offsetWidth; // restart the CSS animation on rapid consecutive beats
      el.classList.add(anchor.intent === 'attack' ? 'lunge' : 'act');
    } else if (anchor.type === 'playerActionStart' && anchor.cardType === 'attack') {
      const hero = this.root.querySelector<HTMLElement>('.hero');
      if (!hero) return;
      hero.classList.remove('lunge');
      void hero.offsetWidth;
      hero.classList.add('lunge');
    }
  }

  /** Applies one event's visible consequences to the live DOM (no re-render). */
  private applyEventFx(ev: BattleEvent): void {
    switch (ev.type) {
      case 'damage': {
        const el = this.elOf(ev.target);
        if (!el) return;
        this.patchHp(el, ev.target, ev.hpAfter, ev.blockAfter);
        if (ev.hpLoss > 0) {
          el.classList.remove('hit');
          void (el as HTMLElement).offsetWidth;
          el.classList.add('hit');
          this.floatText(el, `-${ev.hpLoss}`, 'dmg');
          this.burst(el, 'dmg', Math.min(14, 5 + Math.floor(ev.hpLoss / 3)));
          sound.play(ev.target === 'player' ? 'hurt' : 'hit');
          if (ev.target === 'player' && ev.hpLoss >= 15) {
            this.root.querySelector('.battle')?.classList.add('shake');
          }
        } else if (ev.blocked > 0) {
          // Fully absorbed: show the shield soaking it instead of a damage number.
          this.floatText(el, `${ev.blocked}`, 'block');
          this.burst(el, 'block', 5);
          sound.play('block');
        }
        break;
      }
      case 'blockGain': {
        const el = this.elOf(ev.target);
        if (!el || ev.amount <= 0) return;
        this.patchBlock(el, ev.blockAfter);
        this.floatText(el, `+${ev.amount}`, 'block');
        this.burst(el, 'block', 7);
        sound.play('block');
        break;
      }
      case 'heal': {
        const el = this.elOf(ev.target);
        if (!el || ev.amount <= 0) return;
        this.patchHp(el, ev.target, ev.hpAfter, this.blockShownFor(ev.target));
        this.floatText(el, `+${ev.amount}`, 'heal');
        this.burst(el, 'heal', 8);
        sound.play('heal');
        break;
      }
      case 'statusChange': {
        const el = this.elOf(ev.target);
        if (el) this.patchStatus(el, ev.status, ev.total, ev.delta);
        break;
      }
      case 'energy': {
        const orb = this.root.querySelector('.energy-orb span');
        const battle = this.run.battle;
        if (orb && battle) orb.textContent = `${ev.total}/${battle.state.player.maxEnergy}`;
        break;
      }
      case 'enemyDeath': {
        const el = this.root.querySelector(`[data-enemy="${ev.enemy}"]`);
        el?.classList.add('just-died');
        break;
      }
      // Pile/hand bookkeeping is reconciled by the full render at replay end.
      default:
        break;
    }
  }

  private elOf(ref: ActorRef): Element | null {
    return ref === 'player'
      ? this.root.querySelector('.hero')
      : this.root.querySelector(`[data-enemy="${ref.enemy}"]`);
  }

  private blockShownFor(ref: ActorRef): number {
    const battle = this.run.battle;
    if (!battle) return 0;
    return ref === 'player'
      ? battle.state.player.block
      : (battle.state.enemies[ref.enemy]?.block ?? 0);
  }

  /** Sets an actor's HP bar and block chip to absolute values from an event. */
  private patchHp(el: Element, ref: ActorRef, hp: number, block: number): void {
    const battle = this.run.battle;
    if (!battle) return;
    const maxHp =
      ref === 'player' ? battle.state.player.maxHp : (battle.state.enemies[ref.enemy]?.maxHp ?? 1);
    const fill = el.querySelector<HTMLElement>('.hp-fill');
    if (fill) fill.style.width = `${Math.max(0, (hp / maxHp) * 100)}%`;
    const text = el.querySelector('.hp-text');
    if (text) text.textContent = `${hp}/${maxHp}`;
    this.patchBlock(el, block);
  }

  private patchBlock(el: Element, block: number): void {
    const bar = el.querySelector('.hp-bar');
    if (!bar) return;
    let chip = bar.querySelector('.block-chip');
    if (block <= 0) {
      chip?.remove();
      return;
    }
    if (!chip) {
      chip = document.createElement('span');
      chip.className = 'block-chip';
      bar.appendChild(chip);
    }
    chip.textContent = String(block);
  }

  /** Adds/updates/removes one status chip; gained stacks pop in visibly. */
  private patchStatus(el: Element, status: string, total: number, delta: number): void {
    const wrap = el.querySelector('.statuses');
    if (!wrap) return;
    let chip = wrap.querySelector<HTMLElement>(`[data-status="${status}"]`);
    if (total === 0) {
      chip?.remove();
      return;
    }
    if (!chip) {
      chip = document.createElement('span');
      chip.className = 'status-chip';
      chip.setAttribute('data-status', status);
      wrap.appendChild(chip);
    }
    chip.innerHTML = `${iconHtml(`status_${status}`, 'status-icon', statusName(status))}${total}`;
    chip.setAttribute('data-tip', `<b>${statusName(status)}</b><span>${statusDesc(status, total)}</span>`);
    if (delta > 0) {
      chip.classList.remove('chip-in');
      void chip.offsetWidth;
      chip.classList.add('chip-in');
    }
  }

  /** Injects the turn banner without a full re-render (it animates out on its own). */
  private showBanner(text: string): void {
    const host = this.root.querySelector('.battle');
    if (!host) return;
    const div = document.createElement('div');
    div.className = 'turn-banner';
    div.textContent = text;
    host.appendChild(div);
    window.setTimeout(() => div.remove(), 1400);
  }

  /**
   * Ends a replay. If the battle finished, hold for a second so the killing
   * blow (either direction) stays on screen before the phase switch.
   */
  private finishReplay(onDone: () => void): void {
    this.replayTimers = [];
    const battle = this.run.battle;
    const battleOver =
      !battle || battle.state.phase !== 'playerTurn' || this.run.phase !== 'battle';
    if (battleOver) {
      this.enemyPhase = true; // keep input locked during the hold
      this.replayTimers.push(
        window.setTimeout(() => {
          if (this.onTitle) return;
          this.replaying = false;
          this.enemyPhase = false;
          const b = this.run.battle;
          if (b && b.state.phase !== 'playerTurn' && this.run.phase === 'battle') {
            const ended = b.state.phase;
            this.run.resolveBattle();
            const phaseAfter: string = this.run.phase;
            if (ended === 'victory' && phaseAfter !== 'victory') sound.play('victory');
          } else if (this.run.phase === 'reward' || this.run.phase === 'actTransition') {
            sound.play('victory');
          }
          this.render();
        }, 1000),
      );
      return;
    }
    this.replaying = false;
    this.enemyPhase = false;
    onDone();
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
    if (!battle || this.enemyPhase || this.playLock || this.replaying) return;
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
      this.resolveCardPlay(index);
    }
  }

  /** Plays a card after a short fly-toward-the-discard animation on its DOM node. */
  private resolveCardPlay(index: number, target?: number): void {
    const battle = this.run.battle!;
    sound.play('card');
    const doPlay = () => {
      this.playLock = false;
      if (this.run.phase !== 'battle' || this.onTitle) return;
      const cursor = battle.state.events.length;
      battle.playCard(index, target);
      this.replay(battle.state.events.slice(cursor), { onDone: () => this.render() });
    };
    const el = this.root.querySelector(`[data-card="${index}"]`);
    if (!el) {
      doPlay();
      return;
    }
    el.classList.add('fly-out');
    this.playLock = true;
    window.setTimeout(doPlay, 180);
  }

  private onEnemyClick(enemyIndex: number): void {
    const battle = this.run.battle;
    if (!battle || this.enemyPhase || this.playLock || this.replaying) return;
    if (this.potionSelected !== null) {
      const enemy = battle.state.enemies[enemyIndex];
      if (enemy && enemy.hp > 0) {
        sound.play('potion');
        const cursor = battle.state.events.length;
        this.run.usePotion(this.potionSelected, enemyIndex);
        this.potionSelected = null;
        this.replay(battle.state.events.slice(cursor), { onDone: () => this.render() });
      }
      return;
    }
    if (this.selected === null) return;
    if (battle.canPlay(this.selected, enemyIndex)) {
      const index = this.selected;
      this.selected = null;
      this.resolveCardPlay(index, enemyIndex);
    }
  }

  private onPotionClick(index: number): void {
    if (this.run.phase !== 'battle' || this.enemyPhase || this.playLock || this.replaying) return;
    const battle = this.run.battle!;
    const id = this.run.potions[index];
    if (!id) return;
    if (getPotionDef(id).target === 'enemy') {
      // Toggle potion targeting mode (cancels card selection).
      this.selected = null;
      this.potionSelected = this.potionSelected === index ? null : index;
      this.render();
      return;
    }
    sound.play('potion');
    const cursor = battle.state.events.length;
    this.run.usePotion(index);
    this.potionSelected = null;
    this.replay(battle.state.events.slice(cursor), { onDone: () => this.render() });
  }

  private onEndTurn(): void {
    const battle = this.run.battle;
    if (!battle || battle.state.phase !== 'playerTurn') return;
    if (this.enemyPhase || this.playLock || this.replaying) return;
    this.selected = null;
    this.potionSelected = null;
    const cursor = battle.state.events.length;
    battle.endTurn();
    // Every card in the new hand should deal in fresh after the enemy turn.
    this.handSeen.clear();
    this.replay(battle.state.events.slice(cursor), {
      banner: t('enemyTurn'),
      onDone: () => {
        this.turnBanner = t('yourTurn');
        this.render();
        sound.play('draw');
      },
    });
  }

  /** Whether the node being played right now is the act boss. */
  private isBossNode(): boolean {
    const id = this.run.currentNodeId;
    if (!id) return false;
    return findNode(this.run.map.rows, id).kind === 'boss';
  }

  // --- rendering ---

  private render(): void {
    // A full render always shows the true final state; abandon any mid-replay patching.
    this.cancelReplay();
    // Entering a battle opens on the player's turn banner with a fresh deal.
    if (this.run.phase === 'battle' && this.lastPhase !== 'battle') {
      this.turnBanner = t('yourTurn');
      this.handSeen.clear();
    }
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
    const overlays = `${this.deckOpen ? this.deckOverlayHtml() : ''}${this.pauseOpen ? this.pauseOverlayHtml() : ''}${this.settingsOpen ? this.settingsOverlayHtml() : ''}${this.cheatOpen ? this.cheatOverlayHtml() : ''}${this.upgradePreview !== null ? this.upgradeOverlayHtml() : ''}`;
    this.root.innerHTML = `<div class="game">${this.topBarHtml()}${screen}${overlays}</div>`;
    this.turnBanner = null; // one-shot: the banner animates out and never re-renders
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
        return `<span class="relic-chip" ${tipAttr(def.name, relicDesc(id, def.desc))}><img class="chip-icon" src="${artUrl('relics', id)}" alt="${def.name}"></span>`;
      })
      .join('');
    const inBattle = this.run.phase === 'battle';
    const potions = this.run.potions
      .map((id, i) => {
        const def = getPotionDef(id);
        const cls = `potion-chip ${inBattle ? 'usable' : ''} ${this.potionSelected === i ? 'selected' : ''}`;
        const body = `${potionDesc(id, def.desc)}${inBattle ? t('clickToUse') : ''}`;
        return `<span class="${cls}" data-potion="${i}" ${tipAttr(def.name, body)}><img class="chip-icon" src="${artUrl('potions', id)}" alt="${def.name}"></span>`;
      })
      .join('');
    // Two rows like the original: stats strip on top, relics on their own row.
    return `
      <div class="top-bar">
        <div class="top-bar-main">
          <span class="stat hp-stat">${iconHtml('ui_hp', 'chip-icon', t('hp'))} ${this.run.hp}/${this.run.maxHp}</span>
          <span class="stat gold-stat">${iconHtml('ui_gold', 'chip-icon', t('gold'))} ${this.run.gold}</span>
          <span class="chip-group">${potions}</span>
          <span class="top-bar-center">${iconHtml('ui_floor', 'chip-icon', t('floor'))} ${t('actFloor', this.run.act, floor, this.run.map.rows.length)}</span>
          <span class="top-bar-right">
            <span class="stat deck-chip" data-deck-view title="${t('deck')}">${iconHtml('ui_deck', 'chip-icon', t('deck'))} ${this.run.deck.length}</span>
            <span class="mute-chip" data-mute title="${t('soundToggle')}">${iconHtml(sound.muted ? 'ui_sound_off' : 'ui_sound_on')}</span>
            <span class="mute-chip" data-pause title="${t('pauseTitle')}">${iconHtml('ui_menu')}</span>
          </span>
        </div>
        <div class="relic-row">${relics}</div>
      </div>`;
  }

  /** Full-deck overlay, opened from the top bar (matches the pile overlay look). */
  private deckOverlayHtml(): string {
    const cards = [...this.run.deck]
      .map((c) => resolveCard(c))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((def) => cardFaceHtml(def))
      .join('');
    return `
      <div class="overlay" data-close-deck>
        <div class="overlay-box pile-box">
          <h2>${t('pileCount', t('deck'), this.run.deck.length)}</h2>
          <div class="card-row wrap">${cards || `<p>${t('empty')}</p>`}</div>
          <button class="ghost-btn" data-close-deck>${t('close')}</button>
        </div>
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
          <button class="ghost-btn" data-open-cheats>${t('cheatMenu')}</button>
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
      this.cancelReplay();
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
    on('[data-open-cheats]', () => {
      sound.play('click');
      this.cheatOpen = true;
      this.rerender();
    });
    on('[data-close-cheats]', () => {
      sound.play('click');
      this.cheatOpen = false;
      this.rerender();
    });
    on('[data-cheat]', (el) => {
      sound.play('click');
      const key = el.dataset.cheat as keyof typeof this.cheatDefaults;
      this.cheatDefaults[key] = !this.cheatDefaults[key];
      if (this.run) this.run.cheats[key] = this.cheatDefaults[key];
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
    const cards = reward.cards
      .map((id) => cardFaceHtml(getCardDef(id), 'pickable', `data-reward="${id}"`))
      .join('');
    return `
      <div class="dialog-screen">
        <h2>${t('actDone', this.run.act)}</h2>
        <div class="reward-extras">${extras.map((e) => `<div>${e}</div>`).join('')}</div>
        ${this.relicChoiceHtml(reward)}
        <h3>${t('actChooseCard', this.run.act + 1)}</h3>
        <div class="card-row">${cards}</div>
        <button class="ghost-btn" data-skip-reward>${t('actSkip')}</button>
      </div>`;
  }

  /** Boss loot: pick-one-of-three relic row (shows a confirmation once claimed). */
  private relicChoiceHtml(reward: NonNullable<Run['reward']>): string {
    if (!reward.relicChoices) return '';
    const choices = reward.relicChoices
      .map((id) => {
        const def = getRelicDef(id);
        return `
          <button class="relic-choice" data-pick-relic="${id}">
            <img class="relic-choice-img" src="${artUrl('relics', id)}" alt="${def.name}">
            <span class="relic-choice-name">${def.name}</span>
            <span class="relic-choice-desc">${relicDesc(id, def.desc)}</span>
          </button>`;
      })
      .join('');
    return `
      <h3>${t('chooseRelic')}</h3>
      <div class="relic-choice-row">${choices}</div>
      <button class="ghost-btn small" data-skip-relic>${t('skipRelic')}</button>`;
  }

  // --- map screen ---

  private mapScreen(): string {
    const rows = this.run.map.rows;
    const rowCount = rows.length;
    // Column span follows the widest row of the generated grid (7-col StS-style).
    const maxCol = Math.max(...rows.flat().map((n) => n.col));
    const width = 1000;
    const rowGap = 66;
    const height = rowCount * rowGap + 30;
    const colGap = maxCol > 0 ? (width - 160) / maxCol : 0;
    const x = (col: number) => 80 + col * colGap;
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
        const r = node.kind === 'boss' ? 38 : 28;
        const ring = r * 2.6;
        const s = r * 1.6;
        nodes += `
          <g class="${cls}" data-node="${node.id}" transform="translate(${x(node.col)},${y(node.row)})" ${tipAttr(nodeName(node.kind))}>
            <circle r="${r}"/>
            <image class="node-ring" href="${artUrl('icons', 'node_ring')}" x="${-ring / 2}" y="${-ring / 2}" width="${ring}" height="${ring}"/>
            <image href="${artUrl('icons', NODE_ICON[node.kind])}" x="${-s / 2}" y="${-s / 2}" width="${s}" height="${s}"/>
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

  /**
   * Original-style combat layout: energy orb + draw pile in the bottom-left
   * corner, discard (and a smaller exhaust) in the bottom-right, end-turn
   * button above the discard, hero HP anchored under the sprite, hand fanned
   * across the bottom centre.
   */
  private battleScreen(): string {
    const battle = this.run.battle!;
    const { player, enemies, turn } = battle.state;
    const log = this.logOpen
      ? `<div class="log-panel">${battle.state.log.slice(-60).map((l) => `<div>${l}</div>`).join('')}</div>`
      : '';
    const pileBtn = (
      pile: 'drawPile' | 'discardPile' | 'exhaustPile',
      icon: string,
      cls: string,
      label: string
    ) => `
      <button class="pile-corner ${cls}" data-pile="${pile}" title="${label} (${player[pile].length})">
        ${iconHtml(icon, 'pile-img', label)}
        <span class="pile-count">${player[pile].length}</span>
      </button>`;
    const banner = this.turnBanner ? `<div class="turn-banner">${this.turnBanner}</div>` : '';
    // Only cards not yet seen this hand play the deal-in animation (C4).
    let dealSeq = 0;
    const handHtml = player.hand
      .map((c, i) =>
        this.handCardHtml(c, i, player.hand.length, this.handSeen.has(c.instanceId) ? -1 : dealSeq++),
      )
      .join('');
    for (const c of player.hand) this.handSeen.add(c.instanceId);
    return `
      <div class="battle ${this.enemyPhase ? 'enemy-phase' : ''}">
        <div class="arena" data-enemy-count="${enemies.length}">
          <div class="hero">
            <div class="hero-art"><img src="${artUrl('bg', 'hero')}" alt="${t('you')}" draggable="false"></div>
            <div class="actor-name">${t('you')}</div>
            ${this.hpBarHtml(player.hp, player.maxHp, player.block)}
            <div class="statuses">${this.statusesHtml(player.statuses)}</div>
          </div>
          <div class="enemies-row">${enemies.map((e, i) => this.enemyHtml(e, i)).join('')}</div>
        </div>
        ${banner}
        <div class="hand">${handHtml}</div>
        <div class="energy-orb" title="${t('energy')}" style="background-image:url('${artUrl('frames', 'energy_orb')}')">
          <span>${player.energy}/${player.maxEnergy}</span>
        </div>
        ${pileBtn('drawPile', 'ui_draw', 'draw', t('drawPile'))}
        ${pileBtn('exhaustPile', 'ui_exhaust', 'exhaust', t('exhaustPile'))}
        ${pileBtn('discardPile', 'ui_discard', 'discard', t('discardPile'))}
        <div class="end-turn-wrap">
          ${this.endTurnButtonHtml()}
          <div class="turn-num">${t('turn', turn)}</div>
        </div>
        <button class="log-toggle ${this.logOpen ? 'open' : ''}" data-toggle-log>${t('battleLog')}</button>
        ${log}
        ${this.pileView ? this.pileOverlayHtml() : ''}
      </div>`;
  }

  /** Warns when ending the turn would waste energy on still-playable cards. */
  private endTurnButtonHtml(): string {
    if (this.enemyPhase) return `<button class="end-turn" disabled>${t('enemyTurn')}</button>`;
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
    // The intent row is always present so death never shifts the column height.
    const preview = dead ? null : battle.intentOf(enemy);
    const intent = `<div class="intent" ${preview ? this.intentTip(preview) : ''}>${preview ? this.intentHtml(preview) : ''}</div>`;
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

  /** Instant-tooltip attribute explaining what the enemy is about to do. */
  private intentTip(intent: IntentPreview): string {
    const sep = locale() === 'zh' ? '、' : ', ';
    const statuses = (intent.statuses ?? [])
      .map((s) => `${statusName(s.id)} ${s.stacks}`)
      .join(sep);
    switch (intent.kind) {
      case 'attack': {
        const hits = intent.hits && intent.hits > 1 ? `×${intent.hits}` : '';
        return tipAttr(t('intentAttackTip', `${intent.damage}${hits}`));
      }
      case 'defend':
        return tipAttr(t('intentDefendTip', intent.block ?? 0));
      case 'buff':
        return tipAttr(t('intentBuffTip', statuses || t('intentBuff')));
      case 'debuff':
        return tipAttr(t('intentDebuffTip', statuses || t('intentDebuff')));
    }
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
        // Shield icon + the block number, like the original (not a generic label).
        return `${icon} ${intent.block ?? ''}`.trimEnd();
      case 'buff':
      case 'debuff': {
        // Show the actual ability icons the move will apply, not a "Buff" label (C14).
        const parts = (intent.statuses ?? []).map(
          (s) => `${iconHtml(`status_${s.id}`, 'intent-icon', statusName(s.id))}${s.stacks}`,
        );
        return parts.length > 0
          ? parts.join(' ')
          : `${icon} ${intent.kind === 'buff' ? t('intentBuff') : t('intentDebuff')}`;
      }
    }
  }

  /**
   * Fanned hand layout: rotation/lift computed per card, applied via CSS vars.
   * `dealOrder` >= 0 marks a freshly drawn card that plays the staggered
   * deal-in animation; -1 renders it already settled (no re-deal on re-renders).
   */
  private handCardHtml(card: CardInstance, index: number, total: number, dealOrder: number): string {
    const def = resolveCard(card);
    const playable = this.isHandCardPlayable(index);
    const dealt = dealOrder >= 0 ? 'dealt' : '';
    const cls = `${playable ? 'playable' : 'not-playable'} ${this.selected === index ? 'selected' : ''} ${dealt}`;
    const mid = (total - 1) / 2;
    const off = index - mid;
    const rot = off * Math.min(4, 34 / Math.max(total, 1));
    const lift = Math.abs(off) * Math.abs(off) * 5;
    // Big hands squeeze tighter so they stay clear of the corner HUD.
    const overlap = total > 6 ? -16 - (total - 6) * 8 : -16;
    const deal = dealOrder >= 0 ? `--deal:${dealOrder * 55}ms;` : '';
    const style = `--rot:${rot.toFixed(2)}deg;--lift:${lift.toFixed(1)}px;${deal}margin:0 ${overlap}px;`;
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

  /** Icon + stack count per status; name and rules text live in the tooltip (C14). */
  private statusesHtml(statuses: Record<string, number | undefined>): string {
    return Object.entries(statuses)
      .filter(([, v]) => v !== undefined && v !== 0)
      .map(
        ([k, v]) =>
          `<span class="status-chip" data-status="${k}" ${tipAttr(statusName(k), statusDesc(k, v!))}>${iconHtml(`status_${k}`, 'status-icon', statusName(k))}${v}</span>`,
      )
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
        const afford = this.run.canAfford(item.price);
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
        const afford = this.run.canAfford(item.price);
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
        const afford = this.run.canAfford(item.price) && this.run.potions.length < this.run.maxPotions;
        return `
          <button class="shop-row ${afford ? '' : 'dimmed'}" data-buy-potion="${i}" ${afford ? '' : 'disabled'}>
            <img class="inline-icon" src="${artUrl('potions', item.id)}" alt=""> ${def.name} — ${potionDesc(item.id, def.desc)} <span class="price-tag">${iconHtml('ui_gold', 'inline-icon')} ${item.price}</span>
          </button>`;
      })
      .join('');
    const removeAfford = !shop.removeUsed && this.run.canAfford(shop.removePrice);
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

  /** Campfire upgrade: side-by-side before/after preview with confirm/cancel (B7). */
  private upgradeOverlayHtml(): string {
    const idx = this.upgradePreview!;
    const card = this.run.deck[idx];
    if (!card) return '';
    const before = resolveCard(card);
    const after = resolveCard({ ...card, upgraded: true });
    return `
      <div class="overlay">
        <div class="overlay-box upgrade-box">
          <h2>${t('upgradePreviewTitle')}</h2>
          <div class="upgrade-compare">
            ${cardFaceHtml(before)}
            <span class="upgrade-arrow">➜</span>
            ${cardFaceHtml(after)}
          </div>
          <div class="upgrade-actions">
            <button class="primary-btn" data-confirm-upgrade="${idx}">${t('confirmUpgrade')}</button>
            <button class="ghost-btn" data-cancel-upgrade>${t('cancel')}</button>
          </div>
        </div>
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
    on('[data-pick-relic]', (el) => {
      sound.play('gold');
      this.run.pickRewardRelic(el.dataset.pickRelic!);
      this.render();
    });
    on('[data-skip-relic]', () => {
      sound.play('click');
      this.run.pickRewardRelic(null);
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
    // Campfire upgrades go through a preview overlay before committing (B7).
    on('[data-upgrade]', (el) => {
      sound.play('click');
      this.upgradePreview = Number(el.dataset.upgrade);
      this.render();
    });
    on('[data-confirm-upgrade]', (el) => {
      sound.play('upgrade');
      this.upgradePreview = null;
      this.run.restUpgrade(Number(el.dataset.confirmUpgrade));
      this.render();
    });
    on('[data-cancel-upgrade]', () => {
      sound.play('click');
      this.upgradePreview = null;
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
    on('[data-deck-view]', () => {
      sound.play('click');
      this.deckOpen = true;
      this.render();
    });
    on('[data-close-deck]', () => {
      this.deckOpen = false;
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
