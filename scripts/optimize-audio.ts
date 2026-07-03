/**
 * Compress raw generated audio masters (audio-src/, 192kbps MP3) into the
 * files the game actually ships (public/audio/). Uses the local ffmpeg
 * (libmp3lame). Music targets ~96kbps (<1MB per loop), SFX 128kbps.
 *
 * Each SFX was generated in multiple takes (name_a, name_b, ...); PICK maps
 * every SFX name to the shipped take. To audition alternatives, change the
 * letter here and re-run:  npx tsx scripts/optimize-audio.ts
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, 'audio-src');
const OUT = join(ROOT, 'public', 'audio');

/** Which take of each SFX ships. All takes stay in audio-src/ for swapping. */
const PICK: Record<string, string> = {
  click: 'a',
  card: 'a',
  draw: 'a',
  hit: 'a',
  block: 'a',
  hurt: 'a',
  heal: 'a',
  potion: 'a',
  gold: 'a',
  upgrade: 'a',
  node: 'a',
  boss: 'a',
  victory: 'a',
  defeat: 'a',
};

const SFX_BITRATE = '128k';
const MUSIC_BITRATE = '96k';

function encode(src: string, out: string, bitrate: string): void {
  execFileSync('ffmpeg', ['-y', '-i', src, '-codec:a', 'libmp3lame', '-b:a', bitrate, out], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

function main(): void {
  let total = 0;
  let bytes = 0;

  mkdirSync(join(OUT, 'sfx'), { recursive: true });
  for (const [name, take] of Object.entries(PICK)) {
    const src = join(SRC, 'sfx', `${name}_${take}.mp3`);
    if (!existsSync(src)) {
      console.warn(`skip sfx/${name}: missing master ${name}_${take}.mp3`);
      continue;
    }
    const out = join(OUT, 'sfx', `${name}.mp3`);
    encode(src, out, SFX_BITRATE);
    bytes += statSync(out).size;
    total++;
  }

  mkdirSync(join(OUT, 'music'), { recursive: true });
  for (const file of readdirSync(join(SRC, 'music'))) {
    if (!file.endsWith('.mp3')) continue;
    const out = join(OUT, 'music', file);
    encode(join(SRC, 'music', file), out, MUSIC_BITRATE);
    bytes += statSync(out).size;
    total++;
  }

  console.log(`optimized ${total} audio files -> public/audio (${(bytes / 1024 / 1024).toFixed(2)}MB)`);
}

main();
