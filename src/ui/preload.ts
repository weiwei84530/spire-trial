/**
 * Boot-time asset preloader. Builds the full asset manifest from the engine
 * data tables (cards/enemies/relics/potions/events) plus the fixed UI asset
 * lists, so new content is picked up automatically. Images are warmed into
 * the browser cache; audio bytes are handed straight to the sound manager
 * so battles never wait on a fetch.
 */
import { CARDS } from '../engine/cards';
import { ENEMIES } from '../engine/enemies';
import { EVENTS } from '../engine/events';
import { POTIONS } from '../engine/potions';
import { RELICS } from '../engine/relics';
import { sound, type SfxName } from './sound';

const BASE = import.meta.env.BASE_URL;

const ICONS = [
  'node_battle', 'node_elite', 'node_rest', 'node_event', 'node_shop', 'node_boss', 'node_ring',
  'ui_hp', 'ui_gold', 'ui_deck', 'ui_floor', 'ui_menu', 'ui_sound_on', 'ui_sound_off',
  'ui_draw', 'ui_discard', 'ui_exhaust', 'block_shield',
  'intent_attack', 'intent_defend', 'intent_buff', 'intent_debuff',
  'status_vulnerable', 'status_weak', 'status_frail', 'status_strength', 'status_dexterity',
  'status_poison', 'status_ritual', 'status_metallicize', 'status_thorns', 'status_energized',
  'status_barricade', 'status_noxious',
  'status_nextTurnBlock', 'status_nextTurnEnergy', 'status_nextTurnDraw', 'status_blur',
  'status_accuracy', 'status_infiniteBlades', 'status_toolsOfTrade', 'status_thousandCuts',
  'status_afterImage', 'status_envenom', 'status_intangible', 'status_wraithForm',
];
/** Character-specific art variants of shared cards (see CHAR_CARD_ART in app.ts). */
const CARD_VARIANTS = ['strike_assassin', 'defend_assassin'];
const BACKGROUNDS = ['title', 'battle', 'battle_city', 'battle_beyond', 'map', 'rest', 'shop', 'hero', 'hero_assassin', 'logo', 'logo_en'];
const FRAMES = ['btn_stone', 'energy_orb', 'panel_stone', 'frame_attack', 'frame_skill', 'frame_power', 'frame_neutral'];
const SFX: SfxName[] = [
  'click', 'card', 'draw', 'hit', 'block', 'hurt', 'heal', 'potion',
  'gold', 'upgrade', 'node', 'boss', 'victory', 'defeat',
];
const MUSIC = [
  'music_title', 'music_map', 'music_battle', 'music_battle_city', 'music_battle_beyond',
  'music_boss', 'stinger_victory', 'stinger_defeat',
];

function imageUrls(): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const def of Object.values(CARDS)) {
    if (seen.has(def.id)) continue;
    seen.add(def.id);
    urls.push(`${BASE}art/cards/${def.id}.webp`);
  }
  for (const id of CARD_VARIANTS) urls.push(`${BASE}art/cards/${id}.webp`);
  for (const id of Object.keys(ENEMIES)) urls.push(`${BASE}art/enemies/${id}.webp`);
  for (const id of Object.keys(RELICS)) urls.push(`${BASE}art/relics/${id}.webp`);
  for (const id of Object.keys(POTIONS)) urls.push(`${BASE}art/potions/${id}.webp`);
  for (const e of EVENTS) urls.push(`${BASE}art/events/${e.id}.webp`);
  for (const id of ICONS) urls.push(`${BASE}art/icons/${id}.webp`);
  for (const id of BACKGROUNDS) urls.push(`${BASE}art/bg/${id}.webp`);
  for (const id of FRAMES) urls.push(`${BASE}art/frames/${id}.webp`);
  return urls;
}

function loadImage(url: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve(); // a missing asset must never stall boot
    img.src = url;
  });
}

async function loadAudio(path: string): Promise<void> {
  try {
    const res = await fetch(`${BASE}audio/${path}.mp3`);
    if (res.ok) sound.prime(path, await res.arrayBuffer());
  } catch {
    /* offline or missing: the sound manager will just stay silent */
  }
}

/**
 * Preloads every game asset, reporting progress as loaded/total counts.
 * Runs with limited concurrency so the progress bar moves smoothly instead
 * of jumping when the browser drains its request queue.
 */
export async function preloadAll(onProgress: (loaded: number, total: number) => void): Promise<void> {
  const jobs: (() => Promise<void>)[] = [
    ...imageUrls().map((url) => () => loadImage(url)),
    ...SFX.map((name) => () => loadAudio(`sfx/${name}`)),
    ...MUSIC.map((name) => () => loadAudio(`music/${name}`)),
  ];
  const total = jobs.length;
  let loaded = 0;
  onProgress(0, total);
  const queue = [...jobs];
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        await job();
        loaded++;
        onProgress(loaded, total);
      }
    })
  );
}
