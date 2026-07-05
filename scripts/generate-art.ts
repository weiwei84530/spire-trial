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
  'with margin on all sides. The entire subject — every limb, weapon, spike and appendage — ' +
  'stays fully inside the frame with at least 10% empty margin on all four sides; ' +
  'nothing touches or gets cut off by the canvas edges. ' +
  'Isolated subject on a fully transparent background, no ground, no shadow.';

const ICON_STYLE =
  `${STYLE} Single small object as a game inventory icon, centered, slight magical glow, ` +
  'painted in the same dark fantasy style, generous margin. Isolated on a fully transparent background, no shadow.';

// Cutout-first style for relic icons that must sit on the dark UI with a clean
// edge. The generic ICON_STYLE ("slight magical glow", "dramatic rim light")
// makes gpt-image paint an OPAQUE woolly halo / mist / ground puff around the
// object, which no amount of alpha post-processing can remove. This variant
// keeps the painterly object but forbids every kind of surrounding atmosphere
// so the alpha silhouette hugs the object itself.
const RELIC_CUTOUT_STYLE =
  'Dark fantasy game inventory icon, painterly digital art with visible brush strokes, ' +
  'muted palette of deep indigo blue, charcoal grey and ember-gold accents, ' +
  'soft even studio lighting on the object itself. ' +
  'A single object, centered, filling most of the frame with a small even margin. ' +
  'CRITICAL CUTOUT REQUIREMENT: the object is cleanly cut out on a FULLY TRANSPARENT background. ' +
  'There is absolutely nothing around the object: no glow, no aura, no halo, no rim-light spill, ' +
  'no mist, no fog, no smoke, no steam, no clouds, no dust, no sparks, no floating particles, ' +
  'no ground, no floor, no surface, no cast shadow, no reflection, no colored haze or vignette. ' +
  'Every single pixel outside the solid silhouette of the object must be 100% transparent, ' +
  'with a crisp clean hard alpha edge exactly at the object outline — no soft white or grey fringe. ' +
  'No text, no letters, no numbers, no watermark, no signature, no border, no frame.';

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
/** Relic variant that uses the strict cutout style (see RELIC_CUTOUT_STYLE). */
function relicClean(id: string, object: string): void {
  ASSETS.push({ id, dir: 'relics', prompt: `${RELIC_CUTOUT_STYLE} Object: ${object}`, transparent: true });
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
// The second playable character: a female assassin; keep her consistent
// whenever she appears (defined here so card() calls above can reference her).
const HEROINE =
  'a lithe female assassin with a short dark braid, fitted teal-green hooded leathers and a grey half-mask, twin curved daggers';

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
card('backflip', `${HEROINE} mid-backflip away from a slashing claw, motion arc of pale teal light`);
card('heavy_armor', `a massive dark steel breastplate and pauldrons on an armor stand, faint blue enchantment lines`);
card('bloodletting', `${HERO} holding out an open palm, wisps of crimson essence rising from it and turning into golden energy motes`);
card('battle_trance', `close-up of the hooded hero's face, eyes glowing white, spectral cards orbiting his head`);
card('clothesline', `${HERO} catching a charging foe across the chest with an outstretched iron-clad arm`);
card('uppercut', `${HERO} delivering a rising uppercut, foe lifted off the ground, arc of golden force`);
card('hemokinesis', `a floating blade of red crystal forming out of swirling crimson mist above the hero's outstretched hand`);
card('pummel', `rapid flurry of four fist impacts shown as overlapping golden shockwave rings`);
card('venom_strike', `${HEROINE} lunging with a green-glowing envenomed dagger, thick venom trailing from the blade`);
card('dash', `${HEROINE} dashing forward low and fast, afterimages trailing, twin daggers held wide`);
card('disarm', `an enemy's jagged sword spinning away through the air, knocked from a clawed hand`);
card('flex', `close view of the hero's arm flexing as ember-red power veins ignite under the skin`);
card('shockwave', `${HERO} smashing his fist into the ground, expanding ring of golden shockwave knocking shadows back`);
card('terror', `a shadowy foe recoiling in dread from ${HEROINE}'s cold gaze above her half-mask, indigo mist`);
card('shiv', `a single small thin throwing blade spinning through darkness, glinting`);
card('blade_dance', `three slender blades dancing in the air around ${HEROINE}, orbiting like silver fish`);
card('cloak_and_dagger', `${HEROINE} wrapped in her hooded cloak, one hidden curved dagger glinting beneath the folds`);
card('adrenaline', `${HEROINE}'s silhouette crackling with jagged golden lightning, heart glowing through the chest`);
card('impervious', `${HERO} sealed inside a translucent fortress of overlapping blue energy shields`);
card('demon_form', `${HERO} transformed: horns of ember light curling from his hood, wings of red smoke unfolding`);
card('berserk', `${HERO} roaring skyward as a storm of red and gold energy erupts around him, armor plates rattling loose from the sheer aura`);
card('quick_slash', `a single lightning-fast diagonal sword slash trail of white-gold light`);
card('flurry', `two quick shallow slash trails crossing, sparks scattering`);
card('heavy_blade', `${HERO} dragging an enormous greatsword one-handed, blade carving a glowing furrow in stone`);
card('trip', `a shadowy foe tumbling forward over ${HEROINE}'s outstretched leg, off balance`);
card('emergency_guard', `${HERO} throwing up a hasty shimmering barrier of blue light an instant before impact`);
card('intimidate', `${HERO} looming forward, cloak billowing, wall of cold indigo dread washing over cowering shadows`);
card('noxious_blast', `a bursting cloud of luminous green poison gas spreading across the battlefield, swirling toxic fumes only, no figure, no person, no creature`);
card('skewer', `${HEROINE} thrusting a slender dagger repeatedly, several overlapping teal thrust trails`);
card('entrench', `${HERO} hunkered behind his shield, second layer of massive stone-blue barrier forming around it`);
card('seeing_red', `extreme close-up of one eye under the hood, iris burning ember red`);
card('footwork', `${HEROINE}'s light boots mid pivot on cracked stone, trails of pale teal light tracing a nimble step pattern`);
card('caltrops', `scattered iron caltrops glinting on dark stone, one in sharp focus with a cold blue edge`);
card('die_die_die', `${HEROINE} spinning in a storm of blades, ring of slashes shredding shadows on every side`);
card('barricade', `a great wall of interlocked blue-lit stone shields standing unbroken in the dark`);
card('noxious_fumes', `${HEROINE} standing calm as green poison mist pours continuously out of her cloak`);
card('wound', `a deep jagged gash across a stone-grey surface, dull red glow inside the crack`);
card('burn', `a smoldering ember scar burning through dark cloth, small flames and rising sparks`);
card('injury', `a cracked and splintered bone charm hanging from a torn cord, ominous purple haze`);
card('whirlwind', `${HERO} spinning with sword extended, tornado of golden slash arcs surrounding him`);
card('metallicize', `the hero's skin turning to dark polished iron from the forearm up, reflective and cold`);
card('dramatic_entrance', `${HERO} crashing down into the battlefield from above, cloak flared, impact ring of golden light`);
// Neutral card shared by both characters: assassin gets her own art variant.
card('dramatic_entrance_assassin', `${HEROINE} dropping from above into the battlefield, cloak flared, twin daggers first, impact ring of teal light`);

card('neutralize', `${HEROINE} flickering past a foe in a blur, one dagger drawing a thin pale-green cut across the dark`);
card('survivor', `${HEROINE} crouched low under her cloak among falling debris, teal ward light tracing its edge`);
card('crippling_cloud', `a wide bank of luminous green-violet toxic mist rolling over several staggering shadowy figures`);
card('twin_fangs', `two serpent-shaped dagger slashes of venom-green light striking the same point like biting fangs`);
// Character-specific art for the shared starter cards.
card('strike_assassin', `${HEROINE} lunging with one curved dagger, a thin arc of teal light tracing the slash`);
card('defend_assassin', `${HEROINE} sweeping her cloak up as a shimmering teal ward deflects a blow`);
// Silent-set port
card('bane', `a cursed dagger plunging into a pool of glowing green venom, dark tendrils spreading from the wound`);
card('dagger_spray', `a fan of small silver throwing knives slicing outward through the dark in a wide spread`);
card('dagger_throw', `${HEROINE} hurling a single spinning dagger, silver arc of light trailing behind it`);
card('deflect', `${HEROINE} flicking an incoming blade aside with a curved dagger, small burst of teal sparks at the parry point`);
card('dodge_and_roll', `${HEROINE} tumbling low under a sweeping claw, motion arcs of pale teal light curling around her`);
card('flying_knee', `${HEROINE} leaping knee-first into a shadowy foe, burst of teal impact light`);
card('outmaneuver', `two ghostly teal footprint trails weaving around a confused shadowy figure in the dark`);
card('piercing_wail', `a hooded figure screaming, expanding rings of pale sonic distortion pushing shadows back`);
card('slice', `a single clean horizontal dagger slash trail of cold silver light across darkness`);
card('acrobatics', `${HEROINE} mid-cartwheel between spectral floating cards, teal ribbons of motion`);
card('prepared', `gloved hands fanning three spectral cards over a belt of sheathed knives, faint teal glow`);
card('accuracy', `a floating dagger aligned with three concentric glowing rings, perfect aim lines converging`);
card('all_out_attack', `${HEROINE} exploding into a spinning storm of dagger slashes, silhouettes reeling on all sides`);
card('backstab', `${HEROINE} striking from behind a shadowy figure, dagger buried between its shoulders, cold light`);
card('blur', `${HEROINE} splitting into three translucent afterimages, edges dissolving into teal mist`);
card('bouncing_flask', `a corked glass flask of luminous green poison ricocheting between shadowy figures, droplets scattering`);
card('catalyst', `a vial of virulent green liquid boiling over, poison veins spreading and multiplying across dark flesh`);
card('finisher', `${HEROINE} delivering a final descending strike, all previous slash trails converging into one point`);
card('flechettes', `a volley of needle-thin darts streaking through darkness in tight formation`);
card('infinite_blades', `an endless spiral of conjured spectral daggers materializing out of teal mist`);
card('leg_sweep', `${HEROINE} spinning low, her extended leg sweeping a shadowy foe off its feet`);
card('predator', `${HEROINE} pouncing from above with both daggers, eyes gleaming like a hunting cat`);
card('riddle_with_holes', `five rapid dagger thrust trails punching through a dark silhouette, light shining through the holes`);
card('thousand_cuts', `a dark figure surrounded by countless hovering slash marks filling the air like rain`);
card('after_image', `${HEROINE} standing still while a ghostly duplicate of her peels away, translucent teal`);
card('envenom', `${HEROINE} drawing both her curved daggers through a cloud of green venom, blades absorbing the poison glow`);
card('grand_finale', `${HEROINE} at the center of a massive circular explosion of silver blade light, final devastating flourish`);
card('tools_of_the_trade', `an unrolled leather kit of lockpicks, vials and knives, one dagger lifting itself in teal light`);
card('unload', `${HEROINE} throwing every knife she carries at once, a storm of blades converging on one foe`);
card('wraith_form', `${HEROINE} dissolving into a towering translucent wraith of dark teal smoke, hollow glowing eyes`);

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
relicClean(
  'snake_ring',
  'an ornate silver finger ring shaped as a single coiled serpent biting its own tail, ' +
    'emerald eyes glinting, fine engraved scales, tiny ember-gold highlights on the metal itself',
);
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
  'hero_assassin',
  'Full-body game sprite of a lithe female assassin hero with a short dark braid, fitted teal-green hooded ' +
    'leathers and a grey half-mask, twin curved daggers held low in both hands, standing in a light ready ' +
    'stance facing slightly toward the viewer\'s right, feet at the bottom, whole body visible with margin. ' +
    `${STYLE} Isolated subject on a fully transparent background, no ground, no shadow.`
);
// Same transparent-sprite treatment as the first hero.
ASSETS[ASSETS.length - 1].transparent = true;
ASSETS[ASSETS.length - 1].size = '1024x1536';

bg(
  'rest',
  'A small campfire camp inside a ruined dungeon alcove, bedroll and travel pack beside warm dancing ' +
    'flames, anvil and whetstone nearby, comforting golden light against cold indigo stone darkness. ' +
    'Empty foreground kept dark and simple for game UI.'
);
// Per-act battle arenas. Act 1 keeps the original 'battle' dungeon hall;
// acts 2/3 get their own theme (StS: The City / The Beyond) in the same style.
bg(
  'battle_city',
  'Interior plaza of a decadent ruined city built inside the ancient spire, seen from a ' +
    'slightly elevated viewpoint looking gently down, a vast open floor of cracked marble ' +
    'flagstones filling the lower 60% of the image, the paved ground reaching up past the ' +
    'vertical middle of the canvas before the building facades begin. Leaning gothic ' +
    'townhouses, ornate iron lamp posts and tattered violet cult banners at the sides, cold ' +
    'moonlit haze with faint ember lantern glow, depth fading into indigo darkness. Empty ' +
    'stage composition, the floor kept clear and dark for game UI, low contrast, nothing in ' +
    'the center.'
);
bg(
  'battle_beyond',
  'A surreal otherworldly void at the top of the ancient spire, viewed from above eye level ' +
    'looking down onto a vast platform of shattered dark stone, the paved floor dominating the ' +
    'composition and filling the bottom 60% of the image, its far edge sitting clearly above ' +
    'the vertical middle of the canvas, the void sky confined to the top third. Broken arches ' +
    'and slabs of rubble drifting weightless at the sides, alien nebula of deep indigo with ' +
    'faint violet glow and drifting ember-gold motes, strange dim colossal silhouettes far in ' +
    'the distance. Empty stage composition, the floor kept clear and dark for game UI, low ' +
    'contrast, nothing in the center.'
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
    'Isolated on a fully transparent background with a perfectly clean sharp alpha silhouette: ' +
    'no rust speckles, no texture fragments, no smoke, no particles, no debris floating around or between ' +
    'the characters — every pixel outside the letter strokes must be fully transparent. ' +
    'No other text, no watermark, no border.',
});

// English title logo (counterpart of the Chinese one above).
ASSETS.push({
  id: 'logo_en',
  dir: 'bg',
  size: '1536x1024',
  transparent: true,
  prompt:
    'Game logo of exactly two English words "SPIRE TRIAL" in capital letters, written in two centered rows: ' +
    '"SPIRE" on the first row and "TRIAL" on the second row, spelled exactly. ' +
    'Ornate dark fantasy lettering: engraved gold metal with ember glow along the edges, ' +
    'chipped and weathered, subtle sword-like vertical stroke flourishes. ' +
    'Large letters filling most of the canvas, centered. ' +
    'Isolated on a fully transparent background, no other text, no watermark, no border.',
});

// --- Map node emblems (6) ---

icon('node_battle', 'two crossed straight swords emblem, steel with gold hilts');
icon('node_elite', 'a horned demon skull emblem, ember glow in the eye sockets');
icon('node_rest', 'a small crackling campfire emblem, warm golden flames over dark logs');
// Deliberate "?" glyph (map event node): custom prompt without the shared
// no-text clause so the question mark actually gets drawn.
ASSETS.push({
  id: 'node_event',
  dir: 'icons',
  transparent: true,
  prompt:
    'Dark fantasy game illustration, painterly digital art with visible brush strokes, ' +
    'dramatic rim light, muted palette of deep indigo blue, charcoal grey and ember-gold accents. ' +
    'A single large ornate golden question mark symbol "?" as a glowing carved rune emblem, ' +
    'wrapped in faint swirling indigo mist, centered game icon with generous margin, ' +
    'bold unmistakable silhouette readable at very small sizes. ' +
    'Only the question mark glyph, no other text, no watermark, no border. ' +
    'Isolated on a fully transparent background, no shadow.',
});
icon('node_shop', 'a plump leather coin pouch emblem with gold coins spilling out');
icon('node_boss', 'a golden crown resting on a dark skull emblem, ominous red glow');

icon(
  'node_ring',
  'a round weathered dark-bronze medallion ring frame with faint engraved runes, ' +
    'hollow fully transparent center, uniform ring thickness, front-facing flat view'
);

// --- Top bar & battle UI icons ---

icon('ui_hp', 'a glowing crimson heart shaped gem, gothic faceted');
icon('ui_gold', 'a small neat stack of glowing gold coins');
icon('ui_deck', 'a neat stack of ornate card backs, indigo with gold trim');
icon('ui_floor', 'a slender dark spire tower emblem with tiny glowing windows');
icon('ui_menu', 'an ornate dark iron gear emblem with a thin engraved gold rim, faint ember glow');
icon(
  'ui_sound_on',
  'a bold golden loudspeaker pictogram emblem with three curved sound waves to its right, ' +
    'simple unmistakable silhouette, instantly readable at very small sizes, crisp clean edges, ' +
    'no smoke, no dark halo, no background shading of any kind around the emblem'
);
icon(
  'ui_sound_off',
  'a bold grey loudspeaker pictogram emblem crossed out by one thick diagonal red slash, ' +
    'simple unmistakable silhouette, instantly readable at very small sizes, crisp clean edges, no glow spill'
);
icon(
  'ui_draw',
  'a face-down ornate card with a golden arrow curving upward out of it, ' +
    'crisp clean silhouette, no smoke, no mist, no fog, no dust, no haze around the edges',
);
icon('ui_discard', 'two worn cards tossed loosely, one flipped, muted grey-blue');
icon('ui_exhaust', 'a single card burning away at the corner into ember sparks');
icon(
  'intent_attack',
  'a bold steel longsword with a clear crossguard and hilt, pointed diagonally downward, ' +
    'unmistakable sword silhouette readable at very small sizes, thin red motion arc behind the blade'
);
icon('intent_defend', 'a round steel shield emblem with blue ward glow');
icon('intent_buff', 'an upward flaring golden flame arrow');
icon('intent_debuff', 'a downward dripping purple arrow, sickly glow');

// --- Status (buff/debuff) icons: bold silhouettes readable at ~20px ---

const STATUS_ICON_STYLE =
  'bold simple emblem with an unmistakable silhouette, instantly readable at very small sizes, crisp clean edges';

icon('status_strength', `a flexed armored arm emblem with ember-red power glow, ${STATUS_ICON_STYLE}`);
icon('status_dexterity', `a swift light boot emblem with pale green motion lines, ${STATUS_ICON_STYLE}`);
icon('status_vulnerable', `a cracked broken shield emblem with orange glow seeping from the cracks, ${STATUS_ICON_STYLE}`);
icon('status_weak', `a drooping bent sword emblem sagging downward in teal mist, ${STATUS_ICON_STYLE}`);
icon('status_frail', `a shattering pale-blue shield splitting into fragments emblem, ${STATUS_ICON_STYLE}`);
icon('status_poison', `a single bubbling toxic green droplet emblem, ${STATUS_ICON_STYLE}`);
icon('status_ritual', `a dark candle burning with a violet occult flame emblem, ${STATUS_ICON_STYLE}`);
icon('status_metallicize', `a riveted polished iron plate emblem with cold sheen, ${STATUS_ICON_STYLE}`);
icon('status_thorns', `a ring of sharp interlocking briar thorns emblem, ${STATUS_ICON_STYLE}`);
icon('status_energized', `a bold golden lightning bolt emblem, ${STATUS_ICON_STYLE}`);
icon('status_barricade', `a sturdy stone tower-shield wall emblem with blue glow, ${STATUS_ICON_STYLE}`);
icon('status_noxious', `a swirling cloud of luminous green fumes emblem, ${STATUS_ICON_STYLE}`);
icon('status_nextTurnBlock', `an hourglass fused with a small shield emblem, sand glowing blue, ${STATUS_ICON_STYLE}`);
icon('status_nextTurnEnergy', `a charging golden orb emblem with rising spark trails, ${STATUS_ICON_STYLE}`);
icon('status_nextTurnDraw', `a fanned trio of glowing card backs emblem with a forward arrow, ${STATUS_ICON_STYLE}`);
icon('status_blur', `a fading double-exposure silhouette emblem trailing pale afterimages, ${STATUS_ICON_STYLE}`);
icon('status_accuracy', `a thin dagger piercing the center of a small target reticle emblem, ${STATUS_ICON_STYLE}`);
icon('status_infiniteBlades', `a circular loop of small floating daggers emblem, silver glint, ${STATUS_ICON_STYLE}`);
icon('status_toolsOfTrade', `a crossed lockpick and dagger over a small pouch emblem, ${STATUS_ICON_STYLE}`);
icon('status_thousandCuts', `a dense burst of tiny crisscrossing slash marks emblem, silver-white, ${STATUS_ICON_STYLE}`);
icon('status_afterImage', `a hooded figure emblem with a translucent ghostly copy offset behind, ${STATUS_ICON_STYLE}`);
icon('status_envenom', `a dagger blade coated in dripping luminous green venom emblem, ${STATUS_ICON_STYLE}`);
icon('status_intangible', `a translucent spectral wisp emblem, edges dissolving into pale smoke, ${STATUS_ICON_STYLE}`);
icon('status_wraithForm', `a dark wraith visage emblem with hollow glowing eyes and trailing shadow, ${STATUS_ICON_STYLE}`);

// --- Relic icons: batch 2 (StS-inspired additions) ---

relicClean(
  'lantern',
  'an ornate weathered brass adventurer lantern with a domed top, ring handle and glass panes; ' +
    'a warm golden flame glows only INSIDE the glass panes — the light stays contained within the ' +
    'metal-and-glass body and does not spill, glow or haze outside the lantern frame',
);
relicClean(
  'bag_of_marbles',
  'a small open drawstring leather pouch tipped on its side with a few glossy dark-blue glass ' +
    'marbles resting against its mouth, the marbles touching the pouch so it reads as one compact object',
);
relic('red_mask', 'a sinister crimson festival mask with narrow eye slits');
relic('thread_and_needle', 'a silver sewing needle with shimmering golden thread coiled around it');
relic('twisted_funnel', 'a twisted dark metal funnel dripping luminous green venom');
relic('strawberry', 'a plump glossy strawberry with a faint magical shimmer');
relic('mango', 'a ripe golden mango with a faint magical shimmer');
relic('whetstone', 'a worn grey whetstone with fine metal shavings and faint sparks');
relic('potion_belt', 'a leather bandolier belt with small potion vials tucked in its loops');
relicClean(
  'meat_on_the_bone',
  'a hearty roasted joint of meat on a single large bone, glistening browned and charred surface, ' +
    'held upright by the exposed bone handle — just the meat and bone, no plate, no smoke, no steam',
);

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
    `${STYLE} A perfectly round golden energy orb with a dark smoky obsidian core and a bright ` +
    'glowing molten-gold rim, thin dark metal ring mount, the centre distinctly darker than the ' +
    'rim so pale UI numerals stay readable on top, centered. Isolated on a fully transparent background.',
});
ASSETS.push({
  id: 'panel_stone',
  dir: 'frames',
  size: '1536x1024',
  transparent: true,
  prompt:
    `${STYLE} A large rectangular game window panel: dark carved stone slab framed by a thin engraved ` +
    'gold trim border with subtle ember glow at the corners, uniform border thickness on all four sides, ' +
    'completely plain very dark empty center for interface content, slightly rounded corners, ' +
    'front-facing flat view filling the whole canvas. Isolated on a fully transparent background.',
});
ASSETS.push({
  id: 'block_shield',
  dir: 'icons',
  size: '1024x1024',
  transparent: true,
  prompt:
    `${ICON_STYLE} Object: a compact steel kite shield badge with a cold blue ward glow and a plain ` +
    'flat center for a number, bold simple silhouette readable at very small sizes',
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
