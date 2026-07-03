/**
 * Art generation pipeline. Calls the OpenAI Images API to produce every
 * visual asset the game needs, writing raw PNG masters under art-src/
 * (gitignored). Run scripts/optimize-art.ts afterwards to produce the
 * shipped WebP files in public/art/.
 *
 * Usage:
 *   npx tsx scripts/generate-art.ts            # generate everything missing
 *   npx tsx scripts/generate-art.ts --dry      # list what would be generated
 *   npx tsx scripts/generate-art.ts --only jaw_worm,bg_title   # regenerate specific ids (overwrites)
 *   npx tsx scripts/generate-art.ts --force    # regenerate everything (overwrites)
 *
 * Reads OPENAI_API_KEY from .env.local (gitignored). Prompts live here in
 * version control so the whole art set is reproducible and tweakable.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'art-src');

const MODEL = 'gpt-image-2';
/** gpt-image-2 rejects background:'transparent'; sprites/icons fall back to 1.5. */
const TRANSPARENT_MODEL = 'gpt-image-1.5';
const QUALITY = 'medium';
const CONCURRENCY = 4;

// --- Shared style language (the glue that keeps 90+ images coherent) ---

const STYLE =
  'Dark fantasy game illustration, painterly digital art with visible brush strokes, ' +
  'dramatic rim light, muted palette of deep indigo blue, charcoal grey and ember-gold accents. ' +
  'Moody, atmospheric, professional game asset. ' +
  'No text, no letters, no numbers, no watermark, no signature, no border, no frame.';

const CARD_STYLE =
  `${STYLE} Square card illustration, centered composition, dark vignetted background ` +
  'that fades toward the edges.';

const SPRITE_STYLE =
  `${STYLE} Full-body creature for a side-view battle scene, facing slightly toward the ` +
  'viewer\'s left, feet or base at the bottom, whole body fully visible inside the canvas ' +
  'with margin on all sides. Isolated subject on a fully transparent background, no ground, no shadow.';

const ICON_STYLE =
  `${STYLE} Single small object as a game inventory icon, centered, slight magical glow, ` +
  'painted in the same dark fantasy style, generous margin. Isolated on a fully transparent background, no shadow.';

interface Asset {
  /** id doubles as the output filename (without extension). */
  id: string;
  dir: 'cards' | 'enemies' | 'relics' | 'potions' | 'bg' | 'icons' | 'events' | 'frames';
  prompt: string;
  size?: '1024x1024' | '1536x1024' | '1024x1536';
  transparent?: boolean;
}

const ASSETS: Asset[] = [];

function card(id: string, scene: string): void {
  ASSETS.push({ id, dir: 'cards', prompt: `${CARD_STYLE} Scene: ${scene}` });
}
function enemy(id: string, creature: string): void {
  ASSETS.push({ id, dir: 'enemies', prompt: `${SPRITE_STYLE} Subject: ${creature}`, transparent: true });
}
function relic(id: string, object: string): void {
  ASSETS.push({ id, dir: 'relics', prompt: `${ICON_STYLE} Object: ${object}`, transparent: true });
}
function potion(id: string, object: string): void {
  ASSETS.push({ id, dir: 'potions', prompt: `${ICON_STYLE} Object: ${object}`, transparent: true });
}
function bg(id: string, scene: string, size: Asset['size'] = '1536x1024'): void {
  ASSETS.push({ id, dir: 'bg', prompt: `${STYLE} ${scene}`, size });
}
function icon(id: string, object: string): void {
  ASSETS.push({ id, dir: 'icons', prompt: `${ICON_STYLE} Object: ${object}`, transparent: true });
}
function eventArt(id: string, scene: string): void {
  ASSETS.push({ id, dir: 'events', prompt: `${CARD_STYLE} Scene: ${scene}`, size: '1536x1024' });
}

// --- Card illustrations (58) ---
// The protagonist is a lone hooded swordsman in worn leather and a tattered
// indigo cloak; keep him consistent whenever he appears.
const HERO = 'a lone hooded swordsman in worn leather armor and a tattered indigo cloak';

card('strike', `${HERO} mid-swing, his straight sword leaving a faint golden arc of light`);
card('defend', `${HERO} bracing behind a battered round shield, blue-white ward light rippling across its face`);
card('bash', `${HERO} slamming a heavy pommel strike downward, stone floor cracking with golden sparks`);
card('cleave', `${HERO} sweeping his sword in a wide horizontal arc that cuts through several shadowy silhouettes`);
card('pommel_strike', `close view of a sword pommel striking, small burst of golden sparks, quick and precise`);
card('twin_strike', `two crossing sword slash trails of golden light forming an X in the dark`);
card('iron_wave', `${HERO} advancing behind his shield while thrusting his sword forward, wave of grey iron force ahead`);
card('shrug_it_off', `${HERO} rolling his shoulders as cracked pieces of ethereal armor knit back together with soft blue light`);
card('deadly_venom', `a curved dagger dripping thick luminous green venom onto dark stone`);
card('inflame', `${HERO} with burning ember-red aura flaring around his fists and shoulders, eyes glowing`);
card('bludgeon', `a colossal two-handed maul crashing down, shockwave ring of dust and golden light`);
card('offering', `${HERO} kneeling, offering a drop of glowing crimson light from his palm to three floating spectral cards`);
card('anger', `${HERO} screaming with rage, red mist coiling off his shoulders like flames`);
card('sucker_punch', `a sudden gauntleted fist strike from the shadows catching a foe off guard`);
card('wild_strike', `${HERO} in a reckless overhead leap attack, sword trailing chaotic sparks, guard wide open`);
card('reckless_charge', `${HERO} sprinting head-down straight at the viewer, cloak streaming, dust kicked up`);
card('backflip', `${HERO} mid-backflip away from a slashing claw, motion arc of pale blue light`);
card('heavy_armor', `a massive dark steel breastplate and pauldrons on an armor stand, faint blue enchantment lines`);
card('bloodletting', `${HERO} holding out an open palm, wisps of crimson essence rising from it and turning into golden energy motes`);
card('battle_trance', `close-up of the hooded hero's face, eyes glowing white, spectral cards orbiting his head`);
card('clothesline', `${HERO} catching a charging foe across the chest with an outstretched iron-clad arm`);
card('uppercut', `${HERO} delivering a rising uppercut, foe lifted off the ground, arc of golden force`);
card('hemokinesis', `a floating blade of red crystal forming out of swirling crimson mist above the hero's outstretched hand`);
card('pummel', `rapid flurry of four fist impacts shown as overlapping golden shockwave rings`);
card('venom_strike', `a green-glowing envenomed shortsword piercing forward through darkness`);
card('dash', `${HERO} dashing forward low and fast, afterimages trailing, shield raised`);
card('disarm', `an enemy's jagged sword spinning away through the air, knocked from a clawed hand`);
card('flex', `close view of the hero's arm flexing as ember-red power veins ignite under the skin`);
card('shockwave', `${HERO} smashing his fist into the ground, expanding ring of golden shockwave knocking shadows back`);
card('terror', `a shadowy foe recoiling in dread from the hero's burning gaze, cold indigo mist`);
card('shiv', `a single small thin throwing blade spinning through darkness, glinting`);
card('blade_dance', `three slender blades dancing in the air around ${HERO}, orbiting like silver fish`);
card('cloak_and_dagger', `${HERO} wrapped in his cloak, one hidden dagger glinting beneath the folds`);
card('adrenaline', `the hero's silhouette crackling with jagged golden lightning, heart glowing through the chest`);
card('impervious', `${HERO} sealed inside a translucent fortress of overlapping blue energy shields`);
card('demon_form', `${HERO} transformed: horns of ember light curling from his hood, wings of red smoke unfolding`);
card('berserk', `${HERO} roaring skyward as a storm of red and gold energy erupts around him, armor plates rattling loose from the sheer aura`);
card('quick_slash', `a single lightning-fast diagonal sword slash trail of white-gold light`);
card('flurry', `two quick shallow slash trails crossing, sparks scattering`);
card('heavy_blade', `${HERO} dragging an enormous greatsword one-handed, blade carving a glowing furrow in stone`);
card('trip', `a shadowy foe tumbling forward over the hero's outstretched leg, off balance`);
card('emergency_guard', `${HERO} throwing up a hasty shimmering barrier of blue light an instant before impact`);
card('intimidate', `${HERO} looming forward, cloak billowing, wall of cold indigo dread washing over cowering shadows`);
card('noxious_blast', `a bursting cloud of luminous green poison gas spreading across the battlefield`);
card('skewer', `${HERO} thrusting a spear-like blade repeatedly, several overlapping golden thrust trails`);
card('entrench', `${HERO} hunkered behind his shield, second layer of massive stone-blue barrier forming around it`);
card('seeing_red', `extreme close-up of one eye under the hood, iris burning ember red`);
card('footwork', `the hero's boots mid pivot on cracked stone, trails of pale light tracing a fencer's step pattern`);
card('caltrops', `scattered iron caltrops glinting on dark stone, one in sharp focus with a cold blue edge`);
card('die_die_die', `${HERO} spinning in a storm of blades, ring of slashes shredding shadows on every side`);
card('barricade', `a great wall of interlocked blue-lit stone shields standing unbroken in the dark`);
card('noxious_fumes', `${HERO} standing calm as green poison mist pours continuously out of his cloak`);
card('wound', `a deep jagged gash across a stone-grey surface, dull red glow inside the crack`);
card('burn', `a smoldering ember scar burning through dark cloth, small flames and rising sparks`);
card('injury', `a cracked and splintered bone charm hanging from a torn cord, ominous purple haze`);
card('whirlwind', `${HERO} spinning with sword extended, tornado of golden slash arcs surrounding him`);
card('metallicize', `the hero's skin turning to dark polished iron from the forearm up, reflective and cold`);
card('dramatic_entrance', `${HERO} crashing down into the battlefield from above, cloak flared, impact ring of golden light`);

// --- Enemy sprites (19) ---

enemy('jaw_worm', 'a fat segmented worm monster rearing up, enormous circular mouth of inward teeth, mottled green hide');
enemy('cultist', 'a gaunt robed cultist in tattered purple robes, hood hiding the face except two glowing yellow eyes, clutching a crooked bone staff');
enemy('acid_slime', 'a bubbling translucent slime blob, toxic green, small floating bones suspended inside, dripping acid');
enemy('louse_red', 'a round rust-red giant louse bug, six spindly legs, cracked chitin shell, small beady black eyes');
enemy('spike_slime_m', 'a dark crimson slime blob bristling with jagged bone spikes, glossy and dripping');
enemy('shelled_parasite', 'a hunched armored parasite creature with a segmented iron-grey shell and a soft pale underside, small hooked limbs');
enemy('byrd', 'a scruffy blue-grey vulture-like bird monster hovering with ragged wings spread, cruel yellow beak');
enemy('chosen', 'a tall elegant cult zealot in layered magenta and black vestments, antlered bone headdress, floating slightly, hands wreathed in dark energy');
enemy('snake_plant', 'a carnivorous plant monster, thick green stalk, three snapping leafy jaws, thorned vines coiling');
enemy('centurion', 'a heavyset undead soldier in dented bronze centurion armor, tower shield, glowing embers behind the visor');
enemy('gremlin_nob', 'a hulking crimson-skinned gremlin brute, tiny angry eyes, huge shoulders, raising a crude wooden club');
enemy('slime_king', 'a towering emerald slime monarch wearing a half-sunken golden crown, smaller slimes budding from its mass');
enemy('writhing_mass', 'an amorphous horror of tangled grey-violet tentacles and mismatched blinking eyes, constantly shifting');
enemy('orb_walker', 'a floating brass sphere automaton with a single cyclopean golden lens, three spindly dangling mechanical legs');
enemy('spire_growth', 'a twisted tower of thorned dark-green vines grown into a vaguely humanoid pillar, red sap glowing in the cracks');
enemy('darkling', 'a small hunched shadow creature of matte black smoke, hollow white eyes, long thin claws');
enemy('giant_head', 'a colossal weathered stone head half-buried, glowing golden eyes, cracked cheek, moss and chains');
enemy('the_shadow', 'a tall wraith of layered indigo shadow, tattered edges dissolving into mist, two pale violet eyes, no legs');
enemy('boss_maw', 'a gigantic wall of flesh that is mostly one enormous gaping mouth, rings of teeth, small vestigial eyes, meaty pink and red');

// --- Relic icons (7) ---

relic('burning_blood', 'a faceted vial of luminous burning crimson blood, small flame dancing at its mouth');
relic('vajra', 'an ornate golden vajra thunderbolt scepter, crackling faintly');
relic('anchor', 'a heavy barnacled iron ship anchor with a coil of rope, cold blue sheen');
relic('bag_of_preparation', 'a worn leather adventurer satchel, buckles open, faint golden light spilling out');
relic('blood_vial', 'a small corked glass vial of dark red blood on a leather neck-cord');
relic('bronze_scales', 'a cluster of overlapping spiked bronze scales, sharp and polished');
relic('oddly_smooth_stone', 'a perfectly smooth oval grey river stone, subtle pearlescent shimmer');

// --- Potion icons (5) ---

potion('fire_potion', 'a round-bellied glass flask of swirling orange fire, cork smoking');
potion('block_potion', 'a square sturdy bottle of glowing steel-blue liquid, shield emblem embossed in the glass');
potion('strength_potion', 'a tall crimson potion bottle shaped like a flexed arm, red energy wisps');
potion('healing_potion', 'a heart-shaped rose-red healing potion, gentle warm glow, tiny bubbles');
potion('weak_potion', 'a crooked murky green-grey potion bottle, sickly drooping vapor');

// --- Backgrounds & key art (4) ---

bg(
  'title',
  'A colossal ancient spire tower rising out of a sea of mist into a stormy night sky, ' +
    'windows glowing ember-gold up its full height, tiny hooded figure with a sword standing on a cliff ' +
    'in the foreground looking up at it. Epic key art composition, space at the center-top kept simple for a game logo.'
);
bg(
  'battle',
  'Interior of a vast ruined gothic dungeon hall, cracked stone floor forming an open arena in the ' +
    'foreground, broken pillars and hanging chains at the sides, faint ember braziers, depth fading into ' +
    'cold indigo darkness. Empty stage composition with the lower half kept clear and dark for game UI, low contrast, nothing in the center.'
);
bg(
  'map',
  'A tall ancient parchment-and-ink dungeon map pinned over dark stone, faint hand-drawn contour lines, ' +
    'compass rose, wax stains and burned edges, very dark and low contrast so interface elements can sit on top, ' +
    'vertical composition.',
  '1024x1536'
);
bg(
  'hero',
  'Full-body game sprite of a lone hooded swordsman hero in worn leather armor and a tattered indigo cloak, ' +
    'straight sword held low in the right hand, round battered shield on the left arm, standing in a ready stance ' +
    'facing slightly toward the viewer\'s right, feet at the bottom, whole body visible with margin. ' +
    `${STYLE} Isolated subject on a fully transparent background, no ground, no shadow.`
);
// hero is transparent despite living in bg/: patch it after the fact.
ASSETS[ASSETS.length - 1].transparent = true;
ASSETS[ASSETS.length - 1].size = '1024x1536';

bg(
  'rest',
  'A small campfire camp inside a ruined dungeon alcove, bedroll and travel pack beside warm dancing ' +
    'flames, anvil and whetstone nearby, comforting golden light against cold indigo stone darkness. ' +
    'Empty foreground kept dark and simple for game UI.'
);
bg(
  'shop',
  "A mysterious hooded merchant's underground stall, canvas awning strung between pillars, shelves of " +
    'glowing potions and curios, lantern light, coins scattered on a wooden counter, inviting but eerie. ' +
    'Lower half kept dark and simple for game UI.'
);

// --- Title logo (generated Traditional Chinese lettering) ---

ASSETS.push({
  id: 'logo',
  dir: 'bg',
  size: '1536x1024',
  transparent: true,
  prompt:
    'Game logo of exactly four Traditional Chinese characters "尖塔試煉" written horizontally in one row, ' +
    'in this exact order and stroke-accurate: 尖 then 塔 then 試 then 煉. ' +
    'Ornate dark fantasy lettering: engraved gold metal with ember glow along the edges, ' +
    'chipped and weathered, subtle sword-like vertical stroke flourishes. ' +
    'Large characters filling most of the canvas, centered. ' +
    'Isolated on a fully transparent background, no other text, no watermark, no border.',
});

// --- Map node emblems (6) ---

icon('node_battle', 'two crossed straight swords emblem, steel with gold hilts');
icon('node_elite', 'a horned demon skull emblem, ember glow in the eye sockets');
icon('node_rest', 'a small crackling campfire emblem, warm golden flames over dark logs');
icon('node_event', 'a mysterious glowing lantern emblem wrapped in swirling indigo mist');
icon('node_shop', 'a plump leather coin pouch emblem with gold coins spilling out');
icon('node_boss', 'a golden crown resting on a dark skull emblem, ominous red glow');

// --- Top bar & battle UI icons ---

icon('ui_hp', 'a glowing crimson heart shaped gem, gothic faceted');
icon('ui_gold', 'a small neat stack of glowing gold coins');
icon('ui_deck', 'a neat stack of ornate card backs, indigo with gold trim');
icon('ui_floor', 'a slender dark spire tower emblem with tiny glowing windows');
icon('ui_sound_on', 'a curved golden war horn emblem emitting three small sound arcs');
icon('ui_sound_off', 'a curved dark war horn emblem, cracked and silent, faint grey');
icon('ui_draw', 'a face-down ornate card with a golden arrow curving upward out of it');
icon('ui_discard', 'two worn cards tossed loosely, one flipped, muted grey-blue');
icon('ui_exhaust', 'a single card burning away at the corner into ember sparks');
icon('intent_attack', 'a single downward-slashing sword with a red motion arc');
icon('intent_defend', 'a round steel shield emblem with blue ward glow');
icon('intent_buff', 'an upward flaring golden flame arrow');
icon('intent_debuff', 'a downward dripping purple arrow, sickly glow');

// --- Button & panel textures ---

ASSETS.push({
  id: 'btn_stone',
  dir: 'frames',
  size: '1536x1024',
  transparent: true,
  prompt:
    `${STYLE} A wide rectangular game button plate: dark carved stone slab with a thin engraved gold trim ` +
    'border and subtle ember glow at the edges, completely plain empty center for text, slightly rounded corners, ' +
    'front-facing flat view filling the whole canvas. Isolated on a fully transparent background.',
});
ASSETS.push({
  id: 'energy_orb',
  dir: 'frames',
  size: '1024x1024',
  transparent: true,
  prompt:
    `${STYLE} A perfectly round glowing golden energy orb, swirling molten core, thin dark metal ring mount, ` +
    'strong inner light, centered. Isolated on a fully transparent background.',
});

/** Card face background textures per card type (very dark so text stays readable). */
function frame(id: string, tint: string): void {
  ASSETS.push({
    id,
    dir: 'frames',
    size: '1024x1536',
    prompt:
      `${STYLE} A plain vertical game card background texture: very dark aged leather and parchment, ` +
      `extremely subtle ${tint} tint, faint thin ornate inner border near the edges, ` +
      'no pictures, no symbols, no text, empty center, very low contrast so interface text stays readable.',
  });
}
frame('frame_attack', 'deep crimson red');
frame('frame_skill', 'cold steel blue');
frame('frame_power', 'aged brass gold');
frame('frame_neutral', 'neutral charcoal grey');

// --- Event illustrations (one per event id) ---

eventArt('golden_idol', 'a small radiant golden idol statue on a stone altar in a dark ruin, carved warning glyphs on the pedestal, dust motes in a single light shaft');
eventArt('wandering_healer', 'a cloaked wandering healer with a worn medicine chest offering a glowing vial, kind eyes barely visible under the hood, misty dungeon corridor');
eventArt('ancient_forge', 'an abandoned dwarven forge still burning with strange blue fire, anvil and scattered tools, sparks drifting in the dark');
eventArt('mysterious_shrine', 'a grim stone sacrificial shrine with a carved blood groove and scattered gold coins, cold candles, oppressive shadows');
eventArt('abandoned_cart', 'an overturned merchant cart on a dungeon road, crates and goods spilled across the stones, no owner in sight, single hanging lantern');

// --- Engine ---

function loadKey(): string {
  const env = readFileSync(join(ROOT, '.env.local'), 'utf8');
  const m = env.match(/OPENAI_API_KEY=(\S+)/);
  if (!m) throw new Error('OPENAI_API_KEY not found in .env.local');
  return m[1];
}

async function generate(asset: Asset, key: string): Promise<void> {
  const body: Record<string, unknown> = {
    model: asset.transparent ? TRANSPARENT_MODEL : MODEL,
    prompt: asset.prompt,
    size: asset.size ?? '1024x1024',
    quality: QUALITY,
    output_format: 'png',
    n: 1,
  };
  if (asset.transparent) body.background = 'transparent';

  for (let attempt = 1; ; attempt++) {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const json = (await res.json()) as { data: { b64_json: string }[] };
      const file = join(OUT, asset.dir, `${asset.id}.png`);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, Buffer.from(json.data[0].b64_json, 'base64'));
      console.log(`ok   ${asset.dir}/${asset.id}`);
      return;
    }
    const text = await res.text();
    // Retry rate limits and transient server errors with backoff.
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      const wait = attempt * 15_000;
      console.log(`retry ${asset.dir}/${asset.id} (${res.status}) in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    throw new Error(`${asset.dir}/${asset.id} failed (${res.status}): ${text.slice(0, 300)}`);
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
    return !existsSync(join(OUT, a.dir, `${a.id}.png`));
  });

  console.log(`${queue.length} of ${ASSETS.length} assets to generate (model=${MODEL}, quality=${QUALITY})`);
  if (dry) {
    for (const a of queue) console.log(`  ${a.dir}/${a.id}`);
    return;
  }
  if (queue.length === 0) return;

  const key = loadKey();
  let failed = 0;
  // Simple worker pool.
  const pending = [...queue];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, pending.length) }, async () => {
      for (let a = pending.shift(); a; a = pending.shift()) {
        try {
          await generate(a, key);
        } catch (err) {
          failed++;
          console.error(String(err));
        }
      }
    })
  );
  console.log(failed ? `done with ${failed} failures` : 'done');
  if (failed) process.exitCode = 1;
}

main();
