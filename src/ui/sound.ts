/**
 * Audio layer: file-based SFX and looping background music, both generated
 * by scripts/generate-audio.ts and served from public/audio/.
 *
 * Everything plays through one Web Audio graph:
 *   source -> (sfxGain | musicGain) -> masterGain -> destination
 * so the mute toggle is a single gain and music sits quieter than SFX.
 *
 * Browser autoplay policy: the AudioContext is only created inside a user
 * gesture. SFX calls always originate from click handlers; music requested
 * before the first gesture (the title screen renders on page load) is
 * queued and started by a one-time pointerdown listener.
 */

export type SfxName =
  | 'card'
  | 'draw'
  | 'hit'
  | 'block'
  | 'hurt'
  | 'heal'
  | 'potion'
  | 'gold'
  | 'upgrade'
  | 'node'
  | 'boss'
  | 'victory'
  | 'defeat'
  | 'click';

export type MusicName =
  | 'music_title'
  | 'music_map'
  | 'music_battle'
  | 'music_battle_city'
  | 'music_battle_beyond'
  | 'music_boss';

const MUTE_KEY = 'cardgame_muted';
const MUSIC_VOL_KEY = 'cardgame_music_vol';
const SFX_VOL_KEY = 'cardgame_sfx_vol';

const SFX_VOL = 0.9;
const MUSIC_VOL = 0.3;
const STINGER_VOL = 0.45;
const FADE_SECONDS = 1.2;

/**
 * Per-SFX gain applied on top of the SFX bus. Ear-levelled so no single
 * effect jumps out: sharp impacts and roars sit well below the UI ticks.
 */
const SFX_GAIN: Record<SfxName, number> = {
  click: 0.55,
  card: 0.7,
  draw: 0.7,
  hit: 0.6,
  block: 0.6,
  hurt: 0.55,
  heal: 0.75,
  potion: 0.7,
  gold: 0.6,
  upgrade: 0.65,
  node: 0.7,
  boss: 0.55,
  victory: 0.7,
  defeat: 0.7,
};

/** Per-act regular-battle themes; boss battles always use music_boss. */
const BATTLE_MUSIC: Record<number, MusicName> = {
  1: 'music_battle',
  2: 'music_battle_city',
  3: 'music_battle_beyond',
};

/** Run phases without a dedicated track share the map/camp theme. */
const PHASE_MUSIC: Record<string, MusicName> = {
  title: 'music_title',
  map: 'music_map',
  reward: 'music_map',
  actTransition: 'music_map',
  rest: 'music_map',
  event: 'music_map',
  shop: 'music_map',
};

class SoundManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  /** Raw bytes handed over by the boot preloader, decoded on first use. */
  private primed = new Map<string, ArrayBuffer>();
  /** Currently looping track: its source, per-track gain, and manifest key. */
  private current: { key: string; source: AudioBufferSourceNode; gain: GainNode } | null = null;
  /** Guards against out-of-order async track starts. */
  private musicSeq = 0;
  /** Music requested before the first user gesture unlocks the context. */
  private pendingKey: string | null = null;
  muted: boolean;
  /** User volume settings (0..1), multiplied onto the base bus levels. */
  musicVolume = 1;
  sfxVolume = 1;

  constructor() {
    let saved = false;
    try {
      saved = localStorage.getItem(MUTE_KEY) === '1';
      this.musicVolume = readVolume(MUSIC_VOL_KEY);
      this.sfxVolume = readVolume(SFX_VOL_KEY);
    } catch {
      /* storage unavailable: default to sound on */
    }
    this.muted = saved;
    if (typeof window !== 'undefined') {
      // Dev hook, mirrors window.__app: lets browser-side tests inspect audio state.
      (window as unknown as { __sound: SoundManager }).__sound = this;
      window.addEventListener('pointerdown', () => {
        this.ensure();
        this.flushPending();
      }, { once: true });
    }
  }

  toggle(): boolean {
    this.muted = !this.muted;
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (this.master && this.ctx) {
      this.master.gain.setValueAtTime(this.muted ? 0 : 1, this.ctx.currentTime);
    }
    return this.muted;
  }

  setMusicVolume(v: number): void {
    this.musicVolume = clamp01(v);
    try {
      localStorage.setItem(MUSIC_VOL_KEY, String(this.musicVolume));
    } catch {
      /* ignore */
    }
    if (this.musicBus && this.ctx) {
      this.musicBus.gain.setTargetAtTime(this.musicVolume, this.ctx.currentTime, 0.05);
    }
  }

  setSfxVolume(v: number): void {
    this.sfxVolume = clamp01(v);
    try {
      localStorage.setItem(SFX_VOL_KEY, String(this.sfxVolume));
    } catch {
      /* ignore */
    }
    if (this.sfxBus && this.ctx) {
      this.sfxBus.gain.setTargetAtTime(SFX_VOL * this.sfxVolume, this.ctx.currentTime, 0.05);
    }
  }

  /** Starts whatever music was queued while the context could not run yet. */
  private flushPending(): void {
    if (this.pendingKey === null) return;
    const key = this.pendingKey;
    this.pendingKey = null;
    this.startTrack(key, key.startsWith('stinger'));
  }

  private ensure(): AudioContext | null {
    if (this.ctx) {
      // Queued music must start once resume() actually completes; the state
      // check in setPhase can race a resume that is still in flight.
      if (this.ctx.state === 'suspended') void this.ctx.resume().then(() => this.flushPending());
      return this.ctx;
    }
    const Ctor = window.AudioContext ?? (window as never)['webkitAudioContext'];
    if (!Ctor) return null;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(this.ctx.destination);
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = SFX_VOL * this.sfxVolume;
    this.sfxBus.connect(this.master);
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = this.musicVolume;
    this.musicBus.connect(this.master);
    // Warm the SFX cache so the first battle sounds have no fetch latency.
    for (const name of ['click', 'card', 'hit', 'block', 'hurt', 'node'] as const) {
      void this.load(`sfx/${name}`);
    }
    return this.ctx;
  }

  /** Stores pre-fetched audio bytes so load() can skip the network entirely. */
  prime(path: string, data: ArrayBuffer): void {
    if (!this.buffers.has(path)) this.primed.set(path, data);
  }

  /** Fetch + decode one file, cached forever; resolves null on any failure. */
  private load(path: string): Promise<AudioBuffer | null> {
    const cached = this.buffers.get(path);
    if (cached) return cached;
    const promise = (async () => {
      try {
        let data = this.primed.get(path);
        if (data) {
          this.primed.delete(path);
        } else {
          // BASE_URL keeps audio working under a sub-path deploy (GitHub Pages).
          const res = await fetch(`${import.meta.env.BASE_URL}audio/${path}.mp3`);
          if (!res.ok) return null;
          data = await res.arrayBuffer();
        }
        return await this.ctx!.decodeAudioData(data);
      } catch {
        return null;
      }
    })();
    this.buffers.set(path, promise);
    return promise;
  }

  play(name: SfxName): void {
    if (this.muted) return;
    const ctx = this.ensure();
    if (!ctx || !this.sfxBus) return;
    void this.load(`sfx/${name}`).then((buffer) => {
      if (!buffer || !this.ctx || !this.sfxBus) return;
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      // Per-sound trim so loud one-shots stay level with the rest of the mix.
      const trim = this.ctx.createGain();
      trim.gain.value = SFX_GAIN[name] ?? 0.7;
      source.connect(trim);
      trim.connect(this.sfxBus);
      source.start();
    });
  }

  /**
   * Route the run phase to the right music: looping BGM for regular phases,
   * a one-shot stinger for the run-ending result screens.
   */
  setPhase(phase: string, bossBattle = false, act = 1): void {
    let key: string | null;
    let oneShot = false;
    if (phase === 'battle') {
      key = bossBattle ? 'music_boss' : (BATTLE_MUSIC[act] ?? 'music_battle');
    } else if (phase === 'victory' || phase === 'defeat') {
      key = `stinger_${phase}`;
      oneShot = true;
    } else {
      key = PHASE_MUSIC[phase] ?? null;
    }
    if (key === null) {
      this.stopMusic();
      return;
    }
    if (this.current?.key === key || this.pendingKey === key) return;
    // Before the first gesture the context cannot start; queue the request.
    if (!this.ctx || this.ctx.state === 'suspended') {
      this.ensure();
      if (!this.ctx || this.ctx.state !== 'running') {
        this.pendingKey = key;
        return;
      }
    }
    // A directly started track supersedes anything still queued.
    this.pendingKey = null;
    this.startTrack(key, oneShot);
  }

  private startTrack(key: string, oneShot: boolean): void {
    if (this.current?.key === key) return;
    const seq = ++this.musicSeq;
    void this.load(`music/${key}`).then((buffer) => {
      if (seq !== this.musicSeq || !this.ctx || !this.musicBus) return;
      this.fadeOutCurrent();
      if (!buffer) return;
      const gain = this.ctx.createGain();
      const target = oneShot ? STINGER_VOL : MUSIC_VOL;
      const t0 = this.ctx.currentTime;
      gain.gain.setValueAtTime(0.001, t0);
      gain.gain.exponentialRampToValueAtTime(target, t0 + FADE_SECONDS);
      gain.connect(this.musicBus);
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = !oneShot;
      source.connect(gain);
      source.start();
      this.current = { key, source, gain };
    });
  }

  private fadeOutCurrent(): void {
    if (!this.current || !this.ctx) return;
    const { source, gain } = this.current;
    const t0 = this.ctx.currentTime;
    gain.gain.cancelScheduledValues(t0);
    gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.001), t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + FADE_SECONDS);
    source.stop(t0 + FADE_SECONDS + 0.05);
    this.current = null;
  }

  private stopMusic(): void {
    this.pendingKey = null;
    this.musicSeq++;
    this.fadeOutCurrent();
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(v) ? v : 1));
}

function readVolume(key: string): number {
  const raw = localStorage.getItem(key);
  return raw === null ? 1 : clamp01(Number(raw));
}

export const sound = new SoundManager();
