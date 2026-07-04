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
  icons: { w: 160, h: 160, quality: 82 },
  events: { w: 960, h: 960, quality: 78 },
  frames: { w: 768, h: 768, quality: 80 },
};

/** Directories whose masters come back with faint grey haze in the alpha
    channel (e.g. noise around ui_draw's arrow). Near-transparent pixels are
    snapped to fully transparent and the remaining falloff is re-steepened. */
const ALPHA_CLEAN_DIRS = new Set(['icons']);
const ALPHA_CUTOFF = 48;

/** Masters whose subject must fill the whole canvas (crop the transparent
    margins away). btn_stone ships as a 9-sliced border-image: any baked-in
    transparent margin renders as phantom padding around every button, so the
    visible plate covered only ~41% of the element's height (V3 fix). */
const TRIM_FILES = new Set(['frames/btn_stone.png']);

async function trimAlpha(input: string): Promise<sharp.Sharp> {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  let minX = w, maxX = -1, minY = h, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3]! > 16) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return sharp(input); // fully transparent: leave untouched
  return sharp(input).extract({
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  });
}

async function cleanAlpha(input: string): Promise<sharp.Sharp> {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 3; i < data.length; i += 4) {
    const a = data[i];
    data[i] = a < ALPHA_CUTOFF ? 0 : Math.min(255, Math.round(((a - ALPHA_CUTOFF) * 255) / (255 - ALPHA_CUTOFF)));
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
}

async function main(): Promise<void> {
  let total = 0;
  for (const dir of Object.keys(SIZES)) {
    const { w, h, quality } = SIZES[dir];
    mkdirSync(join(OUT, dir), { recursive: true });
    for (const file of readdirSync(join(SRC, dir))) {
      if (!file.endsWith('.png')) continue;
      const src = join(SRC, dir, file);
      const out = join(OUT, dir, file.replace(/\.png$/, '.webp'));
      const pipeline = TRIM_FILES.has(`${dir}/${file}`)
        ? await trimAlpha(src)
        : ALPHA_CLEAN_DIRS.has(dir)
          ? await cleanAlpha(src)
          : sharp(src);
      await pipeline
        .resize(w, h, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality })
        .toFile(out);
      total++;
    }
  }
  console.log(`optimized ${total} images -> public/art (webp)`);
}

main();
