/**
 * Tiny Web Audio synth for SFX: no audio assets, everything is generated
 * from oscillators. The AudioContext is created lazily on the first play
 * call, which always happens inside a user gesture (a click handler).
 */

export type SfxName =
  | 'card'
  | 'hit'
  | 'block'
  | 'hurt'
  | 'heal'
  | 'potion'
  | 'victory'
  | 'defeat'
  | 'click';

const MUTE_KEY = 'cardgame_muted';

class SoundManager {
  private ctx: AudioContext | null = null;
  muted: boolean;

  constructor() {
    let saved = false;
    try {
      saved = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      /* storage unavailable: default to sound on */
    }
    this.muted = saved;
  }

  toggle(): boolean {
    this.muted = !this.muted;
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
    } catch {
      /* ignore */
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
    return this.ctx;
  }

  /** One enveloped oscillator note, optionally sweeping to a second frequency. */
  private tone(
    freq: number,
    duration: number,
    type: OscillatorType = 'sine',
    gain = 0.12,
    sweepTo?: number,
    startAt = 0,
  ): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime + startAt;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (sweepTo !== undefined) osc.frequency.exponentialRampToValueAtTime(sweepTo, t0 + duration);
    amp.gain.setValueAtTime(gain, t0);
    amp.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(amp).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  play(name: SfxName): void {
    if (this.muted) return;
    switch (name) {
      case 'card':
        this.tone(320, 0.08, 'triangle', 0.1, 520);
        break;
      case 'hit':
        this.tone(170, 0.14, 'sawtooth', 0.14, 70);
        break;
      case 'block':
        this.tone(680, 0.06, 'triangle', 0.09, 740);
        break;
      case 'hurt':
        this.tone(120, 0.28, 'sine', 0.2, 55);
        break;
      case 'heal':
        this.tone(440, 0.12, 'sine', 0.1, 660);
        break;
      case 'potion':
        this.tone(500, 0.09, 'sine', 0.1, 900);
        this.tone(750, 0.1, 'sine', 0.07, 1100, 0.07);
        break;
      case 'victory':
        this.tone(523, 0.14, 'triangle', 0.12, undefined, 0);
        this.tone(659, 0.14, 'triangle', 0.12, undefined, 0.13);
        this.tone(784, 0.24, 'triangle', 0.12, undefined, 0.26);
        break;
      case 'defeat':
        this.tone(330, 0.3, 'sawtooth', 0.1, 250, 0);
        this.tone(220, 0.5, 'sawtooth', 0.12, 140, 0.25);
        break;
      case 'click':
        this.tone(880, 0.035, 'triangle', 0.06);
        break;
    }
  }
}

export const sound = new SoundManager();
