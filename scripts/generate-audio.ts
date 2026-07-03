/**
 * Audio generation pipeline (ElevenLabs). Mirrors scripts/generate-art.ts:
 * prompts live here in version control, raw MP3 masters are written under
 * audio-src/ (gitignored). Run scripts/optimize-audio.ts afterwards to
 * produce the shipped files in public/audio/.
 *
 * Usage:
 *   npx tsx scripts/generate-audio.ts            # generate everything missing
 *   npx tsx scripts/generate-audio.ts --dry      # list queue + credit estimate
 *   npx tsx scripts/generate-audio.ts --only hit_a,music_battle
 *   npx tsx scripts/generate-audio.ts --force    # regenerate everything
 *
 * Reads ELEVENLABS_API_KEY from .env.local (gitignored).
 * Credit model (per the current plan): SFX = 40 credits per requested second,
 * music = 900 credits per minute. The script aborts the whole queue on the
 * first quota error so a miscalculation cannot drain the account.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'audio-src');

const API = 'https://api.elevenlabs.io/v1';
/** Master quality; falls back automatically if the plan rejects 192kbps. */
const FORMATS = ['mp3_44100_192', 'mp3_44100_128'];
const SFX_CREDITS_PER_SECOND = 40;
const MUSIC_CREDITS_PER_MINUTE = 900;
/** Music renders are slow; keep concurrency low to stay under rate limits. */
const CONCURRENCY = 2;

interface AudioAsset {
  /** id doubles as the output filename (without extension). */
  id: string;
  dir: 'sfx' | 'music';
  kind: 'sfx' | 'music';
  prompt: string;
  /** SFX: duration_seconds; music: music_length_ms / 1000. */
  seconds: number;
  /** SFX only: ask the model for a seamlessly loopable result. */
  loop?: boolean;
}

const ASSETS: AudioAsset[] = [];

/** Each SFX gets CANDIDATES takes (_a, _b, ...); pick the keeper in optimize-audio.ts. */
const CANDIDATES = 2;

function sfx(name: string, seconds: number, prompt: string): void {
  for (let i = 0; i < CANDIDATES; i++) {
    ASSETS.push({
      id: `${name}_${String.fromCharCode(97 + i)}`,
      dir: 'sfx',
      kind: 'sfx',
      prompt,
      seconds,
    });
  }
}

function music(id: string, seconds: number, prompt: string): void {
  ASSETS.push({ id, dir: 'music', kind: 'music', prompt, seconds });
}

// --- Shared style language (audio counterpart of the art STYLE prefix) ---

const MUSIC_STYLE =
  'Dark fantasy orchestral game music, brooding low strings, deep war drums, ' +
  'sparse distant choir, cold and vast dungeon atmosphere with faint ember-like warm accents. ' +
  'Instrumental only, no vocals with lyrics. Designed as a seamless loop: ' +
  'consistent energy from start to end, no intro build-up, no final cadence, no fade-out.';

const STINGER_STYLE =
  'Dark fantasy orchestral game stinger, instrumental, single short musical phrase that ends cleanly with silence.';

// --- Sound effects (14 names x 2 candidates) ---

sfx('click', 0.6, 'Soft single UI click, stone and metal tick, short, subtle, dark fantasy game interface');
sfx('card', 0.8, 'Quick sharp playing-card swipe whoosh, paper flick with a faint metallic shing, fast');
sfx('draw', 0.7, 'A card being drawn swiftly from a deck, crisp short paper slide, quiet');
sfx('hit', 0.9, 'Sword slash impact hitting a monster, heavy meaty thud with a metallic edge, short');
sfx('block', 0.8, 'Sword blow deflected by a round metal shield, dull metallic clang, short single impact');
sfx('hurt', 1.0, 'Male warrior grunt of pain with a heavy body impact, short, visceral');
sfx('heal', 1.4, 'Warm magical healing shimmer, soft ascending chime sparkle, gentle glow');
sfx('potion', 1.2, 'Drinking a magic potion: glass clink, quick gulp, bubbling fizz tail');
sfx('gold', 1.0, 'A small handful of gold coins dropping and jingling onto a wooden counter');
sfx('upgrade', 1.5, 'Blacksmith hammer striking an anvil once, bright metallic ring with a magical shimmer tail');
sfx('node', 1.0, 'A single heavy boot footstep on stone with a faint leather and armor rustle, dungeon reverb');
sfx('boss', 2.5, 'Monstrous deep creature roar echoing in a vast stone hall, menacing, ominous');
sfx('victory', 2.5, 'Short triumphant dark fantasy fanfare, small brass and war drum flourish, ends cleanly');
sfx('defeat', 3.0, 'Dark descending orchestral failure sting, low strings falling into an ominous drone, somber');

// --- Music (4 loops + 2 stingers) ---

music(
  'music_title',
  90,
  `${MUSIC_STYLE} Title theme: slow, mysterious and monumental, a colossal ancient spire in a stormy night, ` +
    'quiet awe with an undercurrent of danger, restrained percussion.'
);
music(
  'music_map',
  90,
  `${MUSIC_STYLE} Exploration and camp theme: calm, sparse and wary, soft plucked strings and low drones, ` +
    'slow heartbeat-like percussion, a moment of rest inside a hostile dungeon.'
);
music(
  'music_battle',
  75,
  `${MUSIC_STYLE} Combat theme: driving mid-tempo battle music, aggressive string ostinato, ` +
    'insistent war drums, tense and relentless but not overwhelming.'
);
music(
  'music_boss',
  90,
  `${MUSIC_STYLE} Boss battle theme: massive and threatening, thunderous percussion, full low brass, ` +
    'urgent string runs and dark choir stabs, high intensity.'
);
music('stinger_victory', 10, `${STINGER_STYLE} Triumphant victory fanfare, warm brass swell over war drums, heroic relief.`);
music('stinger_defeat', 10, `${STINGER_STYLE} Somber defeat phrase, low strings sinking downward, sparse piano notes fading into silence.`);

// --- Engine ---

function loadKey(): string {
  const env = readFileSync(join(ROOT, '.env.local'), 'utf8');
  const m = env.match(/ELEVENLABS_API_KEY=(\S+)/);
  if (!m) throw new Error('ELEVENLABS_API_KEY not found in .env.local');
  return m[1];
}

function creditsOf(a: AudioAsset): number {
  return a.kind === 'sfx'
    ? Math.ceil(a.seconds * SFX_CREDITS_PER_SECOND)
    : Math.ceil((a.seconds / 60) * MUSIC_CREDITS_PER_MINUTE);
}

/** Set on the first quota error; drains the queue without further requests. */
let aborted = false;

async function generate(asset: AudioAsset, key: string): Promise<void> {
  for (let fmt = 0; fmt < FORMATS.length; fmt++) {
    const url =
      asset.kind === 'sfx'
        ? `${API}/sound-generation?output_format=${FORMATS[fmt]}`
        : `${API}/music?output_format=${FORMATS[fmt]}`;
    const body =
      asset.kind === 'sfx'
        ? { text: asset.prompt, duration_seconds: asset.seconds, prompt_influence: 0.4, loop: asset.loop ?? false }
        : { prompt: asset.prompt, music_length_ms: Math.round(asset.seconds * 1000) };

    for (let attempt = 1; ; attempt++) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        const file = join(OUT, asset.dir, `${asset.id}.mp3`);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, buf);
        console.log(`ok   ${asset.dir}/${asset.id} (${(buf.length / 1024).toFixed(0)}KB, ~${creditsOf(asset)} credits)`);
        return;
      }
      const text = await res.text();
      // Out of credits: stop the whole run, never burn further requests.
      if (res.status === 402 || /quota|credit/i.test(text)) {
        aborted = true;
        throw new Error(`QUOTA: ${asset.dir}/${asset.id} (${res.status}): ${text.slice(0, 300)}`);
      }
      // Plan may not allow 192kbps output; retry once at the next format down.
      if (/output_format/i.test(text) && fmt < FORMATS.length - 1) break;
      if ((res.status === 429 || res.status >= 500) && attempt < 5) {
        const wait = attempt * 15_000;
        console.log(`retry ${asset.dir}/${asset.id} (${res.status}) in ${wait / 1000}s`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw new Error(`${asset.dir}/${asset.id} failed (${res.status}): ${text.slice(0, 300)}`);
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const force = args.includes('--force');
  const onlyArg = args.find((a) => a.startsWith('--only'));
  const only = onlyArg
    ? (onlyArg.includes('=') ? onlyArg.split('=')[1] : args[args.indexOf(onlyArg) + 1]).split(',')
    : null;

  const ids = new Set(ASSETS.map((a) => a.id));
  if (ids.size !== ASSETS.length) throw new Error('Duplicate asset ids in manifest');

  const queue = ASSETS.filter((a) => {
    if (only) return only.includes(a.id);
    if (force) return true;
    return !existsSync(join(OUT, a.dir, `${a.id}.mp3`));
  });

  const total = queue.reduce((sum, a) => sum + creditsOf(a), 0);
  console.log(`${queue.length} of ${ASSETS.length} assets to generate, estimated ~${total} credits`);
  if (dry) {
    for (const a of queue) {
      console.log(`  ${a.dir}/${a.id}  ${a.seconds}s  ~${creditsOf(a)} credits`);
    }
    return;
  }
  if (queue.length === 0) return;

  const key = loadKey();
  let failed = 0;
  const pending = [...queue];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, pending.length) }, async () => {
      for (let a = pending.shift(); a && !aborted; a = pending.shift()) {
        try {
          await generate(a, key);
        } catch (err) {
          failed++;
          console.error(String(err));
        }
      }
    })
  );
  if (aborted) {
    console.error('ABORTED: quota error, remaining queue skipped');
    process.exitCode = 2;
    return;
  }
  console.log(failed ? `done with ${failed} failures` : 'done');
  if (failed) process.exitCode = 1;
}

main();
