/**
 * Random, varied looks for AI users' photos. Left to itself the image model
 * draws nearly the same woman, room and pose every time, so the variety is
 * chosen here in code: a fixed identity per person (kept on persona.look so a
 * new photo still matches her profile) plus a fresh scene for every photo.
 * Everyone described is fictional.
 */

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const chance = (p) => Math.random() < p;
/** Weighted pick: [[value, weight], ...] */
function weighted(pairs) {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [value, w] of pairs) if ((r -= w) < 0) return value;
  return pairs[pairs.length - 1][0];
}

const SKIN_TONES = [
  ['fair skin', 1],
  ['light wheatish skin', 2],
  ['wheatish skin', 3],
  ['medium brown skin', 3],
  ['warm brown skin', 2],
  ['deep brown skin', 1],
];
const BUILDS = ['slim', 'petite', 'average build', 'average build', 'curvy', 'plus-size', 'tall and slender', 'slightly chubby'];
const FACES = ['round face', 'oval face', 'long face', 'heart-shaped face', 'square jaw', 'soft full cheeks', 'high cheekbones'];
const HAIR = [
  'long straight black hair worn loose',
  'a long single braid over her shoulder',
  'hair tied in a simple low bun',
  'shoulder-length wavy hair',
  'short bob haircut',
  'curly hair tied back with a clip',
  'hair in a messy bun with loose strands',
  'long hair with a side parting and a few henna-brown highlights',
];
const HIJABS = [
  'a {c} hijab pinned neatly under the chin',
  'a loosely draped {c} hijab',
  'a {c} printed hijab wrapped turban-style',
  'a {c} hijab with an under-cap',
];
const COLOURS = [
  'maroon', 'mustard yellow', 'teal', 'sky blue', 'navy', 'olive green', 'peach', 'lavender', 'off-white', 'black',
  'rust orange', 'pink', 'bottle green', 'grey', 'magenta', 'cream', 'turquoise', 'red', 'beige', 'purple',
];
const OUTFITS = {
  any: [
    'a {c} cotton salwar kameez with a contrasting dupatta',
    'a {c} printed three-piece with a dupatta',
    'a {c} kurti with jeans',
    'a {c} kurti with palazzo pants',
    'a simple {c} cotton saree',
    'a {c} printed georgette saree',
    'a {c} jamdani saree',
    'a casual {c} t-shirt at home',
    'a {c} long tunic top',
    'a {c} formal shirt for the office',
    'a {c} shawl over a plain kameez',
  ],
  covered: ['a {c} abaya', 'a {c} long kameez', 'a {c} loose gown-style dress'],
};
const ACCESSORIES = ['a small nose pin', 'thin gold earrings', 'glass bangles', 'a wristwatch', 'small stud earrings', 'a simple necklace', 'no jewellery'];
const CHILD_AGES = ['3 months', '5 months', '7 months', '9 months', '1 year', '15 months', '18 months', '2 years', '3 years'];

const FRAMINGS = [
  "close-up selfie taken at arm's length with the front camera",
  'head-and-shoulders portrait taken by a friend',
  'half-body photo while sitting',
  'candid three-quarter angle, looking slightly away from the camera',
  'selfie from a slightly high angle',
  'waist-up standing photo',
  'turning toward the camera mid-movement, natural candid moment',
  'slightly off-centre composition with background visible',
];
const SETTINGS = [
  'a small Dhaka apartment living room with a sofa and patterned curtains',
  'a home kitchen with steel pots and a gas stove',
  'a balcony with potted plants and window grills',
  'a rooftop with water tanks and city buildings behind',
  'a village courtyard in front of a tin-roof house',
  'beside a pond with coconut and banana trees',
  'a city park with green trees',
  'a street with blurred rickshaws behind',
  'a small cafe table with a cup of tea',
  'a shopping mall corridor',
  'a tea garden in Sylhet',
  "the beach at Cox's Bazar",
  'a family wedding with fairy lights',
  'a bedroom with a printed bedsheet and a wardrobe',
  'an office desk with a laptop',
  'a rice field in the countryside',
  'a relative\'s drawing room with a wooden showcase',
  'a lakeside walkway at Hatirjheel',
  'a rainy-day window with water drops',
  'a plain painted wall at home',
];
const LIGHT = {
  in: [
    'soft morning window light',
    'bright daylight from a window',
    'warm indoor lamp light in the evening',
    'cool white tube-light',
    'mixed window and ceiling light',
  ],
  out: ['bright midday sun', 'warm golden-hour light', 'overcast daylight', 'shade under a tree with dappled light', 'soft late-afternoon light'],
};
const OUTDOOR = /rooftop|courtyard|pond|park|street|tea garden|beach|rice field|walkway|campus/;
const lightFor = (setting) => pick(LIGHT[OUTDOOR.test(setting) ? 'out' : 'in']);
const CAMERAS = [
  'mid-range Android phone camera with slight noise',
  'phone portrait mode with a blurred background',
  'slightly soft front-camera focus',
  'sharp rear phone camera',
  'a little overexposed, typical phone snapshot',
];
const EXPRESSIONS = [
  'a warm smile showing teeth',
  'a gentle closed-mouth smile',
  'laughing mid-moment',
  'a calm neutral expression',
  'a shy smile looking slightly down',
  'a confident look straight at the camera',
  'a tired but happy smile',
  'a playful expression',
];
const WITH_CHILD = [
  'holding her {a} on her lap',
  'with her {a} asleep on her shoulder',
  'cheek-to-cheek with her {a}, both looking at the camera',
  'carrying her {a} on her hip',
  'with her {a} sitting beside her, playing',
  'kissing the forehead of her {a}',
];

const colour = (template) => template.replace('{c}', pick(COLOURS));
/** "7 months" -> "7-month-old baby", "2 years" -> "2-year-old toddler". */
function childPhrase(age = '1 year') {
  const [n, unit] = String(age).split(' ');
  const months = unit.startsWith('month') ? Number(n) : Number(n) * 12;
  const noun = months < 12 ? 'baby' : months < 36 ? 'toddler' : 'child';
  return `${n}-${unit.startsWith('month') ? 'month' : 'year'}-old ${noun}`;
}
const sentence = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** A new person's fixed traits; stored on User.persona.look. */
export function randomIdentity({ religion = weighted([['Muslim', 8], ['Hindu', 2]]) } = {}) {
  const cover =
    religion === 'Muslim' ? weighted([['hijab', 5], ['dupatta over head', 2], ['none', 4]]) : weighted([['none', 1]]);
  return {
    religion,
    age: 21 + Math.floor(Math.random() * 19), // 21-39
    skinTone: weighted(SKIN_TONES),
    build: pick(BUILDS),
    face: pick(FACES),
    hair: pick(HAIR),
    cover,
    glasses: chance(0.2),
    childAge: pick(CHILD_AGES),
  };
}

/** One photo of that person: a fresh outfit, place, pose and light every time. */
export function describePortrait(look = randomIdentity(), { withChild = chance(0.4) } = {}) {
  const hairOrCover =
    look.cover === 'hijab'
      ? colour(pick(HIJABS))
      : look.cover === 'dupatta over head'
        ? `${look.hair}, partly covered by a dupatta drawn over her head`
        : look.hair;
  const outfit = colour(pick(look.cover === 'hijab' && chance(0.4) ? OUTFITS.covered : OUTFITS.any));
  const setting = pick(SETTINGS);
  const hinduMarks = look.religion === 'Hindu' && chance(0.6) ? ', a little sindoor in her hair parting and shakha-pola bangles' : '';
  const parts = [
    `A fictional Bangladeshi ${look.religion === 'Hindu' ? 'Hindu ' : ''}woman, about ${look.age} years old, ${look.skinTone}, ${look.build}, ${look.face}`,
    `${hairOrCover}${look.glasses ? ', wearing glasses' : ''}`,
    `wearing ${outfit}, ${pick(ACCESSORIES)}${hinduMarks}`,
    pick(EXPRESSIONS),
    withChild ? pick(WITH_CHILD).replace('{a}', childPhrase(look.childAge)) : null,
    `Setting: ${setting}`,
    `Shot: ${pick(FRAMINGS)}; ${lightFor(setting)}; ${pick(CAMERAS)}`,
  ].filter(Boolean);
  return { description: `${parts.map(sentence).join('. ')}.`, withChild };
}

/** Variety for post photos (the post writer supplies the subject). */
export function randomPhotoStyle() {
  return `${pick([...LIGHT.in, ...LIGHT.out])}; ${pick(CAMERAS)}; ${pick(['top-down angle', 'eye-level angle', 'slight side angle', 'close-up detail', 'wide shot showing the room'])}`;
}

const HINDU_SURNAMES = /(রায়|দাস|সাহা|চক্রবর্তী|ঘোষ|দত্ত|পাল|ভট্টাচার্য|বসু|সেন|দে|দেব|মিত্র|কর|নন্দী|গুহ|বণিক|সাহু|পোদ্দার|রানী|রাণী|দেবী)$/;
/** Best guess for personas made before looks were stored, so a new photo fits the name. */
export const guessReligion = (name = '') =>
  HINDU_SURNAMES.test(String(name).replace(/\s*\(AI[^)]*\)\s*$/, '').trim()) ? 'Hindu' : 'Muslim';
