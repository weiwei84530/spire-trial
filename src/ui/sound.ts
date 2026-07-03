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

export type MusicName = 'music_title' | 'music_map' | 'music_battle' | 'music_boss';

const MUTE_KEY = 'cardgame_muted';

const SFX_VOL = 0.9;
const MUSIC_VOL = 0.3;
const STINGER_VOL = 0.45;
const FADE_SECONDS = 1.2;

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
  /** Currently looping track: its source, per-track gain, and manifest key. */
  private current: { key: string; source: AudioBufferSourceNode; gain: GainNode } | null = null;
  /** Guards against out-of-order async track starts. */
  private musicSeq = 0;
  /** Music requested before the first user gesture unlocks the context. */
  private pendingKey: string | null = null;
  muted: boolean;

  constructor() {
    let saved = false;
    try {
      saved = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      /* storage unavailable: default to sound on */
    }
    this.muted = saved;
    if (typeof window !== 'undefined') {
      // Dev hook, mirrors window.__app: lets browser-side tests inspect audio state.
      (window as unknown as { __sound: SoundManager }).__sound = this;
      const unlock = () => {
        this.ensure();
        if (this.pendingKey !== null) this.startTrack(this.pendingKey, this.pendingKey.startsWith('stinger'));
        this.pendingKey = null;
      };
      window.addEventListener('pointerdown', unlock, { once: true });
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

  private ensure(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    }
    const Ctor = window.AudioContext ?? (window as never)['webkitAudioContext'];
    if (!Ctor) return null;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(this.ctx.destination);
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = SFX_VOL;
    this.sfxBus.connect(this.master);
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 1;
    this.musicBus.connect(this.master);
    // Warm the SFX cache so the first battle sounds have no fetch latency.
    for (const name of ['click', 'card', 'hit', 'block', 'hurt', 'node'] as const) {
      void this.load(`sfx/${name}`);
    }
    return this.ctx;
  }

  /** Fetch + decode one file, cached forever; resolves null on any failure. */
  private load(path: string): Promise<AudioBuffer | null> {
    const cached = this.buffers.get(path);
    if (cached) return cached;
    const promise = (async () => {
      try {
        // BASE_URL keeps audio working under a sub-path deploy (GitHub Pages).
        const res = await fetch(`${import.meta.env.BASE_URL}audio/${path}.mp3`);
        if (!res.ok) return null;
        const data = await res.arrayBuffer();
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
      source.connect(this.sfxBus);
      source.start();
    });
  }

  /**
   * Route the run phase to the right music: looping BGM for regular phases,
   * a one-shot stinger for the run-ending result screens.
   */
  setPhase(phase: string, bossBattle = false): void {
    let key: string | null;
    let oneShot = false;
    if (phase === 'battle') {
      key = bossBattle ? 'music_boss' : 'music_battle';
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

export const sound = new SoundManager();
