/**
 * Compress raw generated masters (art-src/, PNG, ~1.5MB each) into the
 * WebP files the game actually ships (public/art/). Sizes are matched to
 * the largest on-screen usage (with 2x headroom for high-DPI displays).
 *
 * Run after scripts/generate-art.ts:  npx tsx scripts/optimize-art.ts
 */
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, 'art-src');
const OUT = join(ROOT, 'public', 'art');

/** Max bounding box per asset directory (fit inside, never upscale). */
const SIZES: Record<string, { w: number; h: number; quality: number }> = {
  cards: { w: 512, h: 512, quality: 78 },
  enemies: { w: 512, h: 512, quality: 80 },
  relics: { w: 160, h: 160, quality: 80 },
  potions: { w: 160, h: 160, quality: 80 },
  bg: { w: 1600, h: 1600, quality: 78 },
};

async function main(): Promise<void> {
  let total = 0;
  for (const dir of Object.keys(SIZES)) {
    const { w, h, quality } = SIZES[dir];
    mkdirSync(join(OUT, dir), { recursive: true });
    for (const file of readdirSync(join(SRC, dir))) {
      if (!file.endsWith('.png')) continue;
      const out = join(OUT, dir, file.replace(/\.png$/, '.webp'));
      await sharp(join(SRC, dir, file))
        .resize(w, h, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality })
        .toFile(out);
      total++;
    }
  }
  console.log(`optimized ${total} images -> public/art (webp)`);
}

main();
