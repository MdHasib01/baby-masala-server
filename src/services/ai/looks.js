/**
 * Random, varied looks for AI users' photos. Left to itself the image model
 * draws nearly the same woman, room and pose every time, so the variety is
 * chosen here in code: a fixed identity per person (kept on persona.look so a
 * new photo still matches her profile) plus a fresh scene for every photo.
 *
 * The admin picks style options per group (STYLE_GROUPS, at least 2 each) and
 * planCombos() spreads them over a batch so every user gets a different mix:
 * a real photo, a face-hidden photo, an illustration, a flower, scenery...
 * Everyone described is fictional.
 */

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const chance = (p) => Math.random() < p;
const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
/** Weighted pick: [[value, weight], ...] */
function weighted(pairs) {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [value, w] of pairs) if ((r -= w) < 0) return value;
  return pairs[pairs.length - 1][0];
}
function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ------------------------------------------------------------------ */
/* Style options the admin chooses from                                */
/* ------------------------------------------------------------------ */

export const MIN_PER_GROUP = 2;

export const STYLE_GROUPS = [
  {
    id: 'nameStyle',
    label: 'নামের ধরন',
    options: [
      { id: 'bangla', label: 'বাংলায় (নুসরাত জাহান)' },
      { id: 'english', label: 'English (Nusrat Jahan)' },
      { id: 'nickname', label: 'ডাকনামসহ (Sadia Islam Mim)' },
      { id: 'childMom', label: "শিশুর নামে (Ayan's Mom)" },
    ],
  },
  {
    id: 'picture',
    label: 'ছবির ধরন',
    options: [
      { id: 'photo', label: 'বাস্তব ছবি' },
      { id: 'faceHidden', label: 'মুখ দেখা যায় না' },
      { id: 'illustration', label: 'কার্টুন / ইলাস্ট্রেশন' },
      { id: 'painting', label: 'জলরং / পেইন্টিং' },
      { id: 'flower', label: 'ফুল' },
      { id: 'nature', label: 'প্রকৃতি / দৃশ্য' },
      { id: 'babyDetail', label: 'শিশুর হাত-পা' },
      { id: 'aesthetic', label: 'চা-বই / নান্দনিক' },
    ],
  },
  {
    id: 'age',
    label: 'বয়স',
    options: [
      { id: 'early20s', label: '২১–২৫' },
      { id: 'late20s', label: '২৬–৩০' },
      { id: 'early30s', label: '৩১–৩৫' },
      { id: 'late30s', label: '৩৬–৪০' },
    ],
  },
  {
    id: 'camera',
    label: 'ক্যামেরা স্টাইল',
    options: [
      { id: 'selfie', label: 'সেলফি' },
      { id: 'friendShot', label: 'অন্য কেউ তুলেছে' },
      { id: 'candid', label: 'ক্যান্ডিড' },
      { id: 'mirror', label: 'আয়নায় সেলফি' },
      { id: 'portraitMode', label: 'পোর্ট্রেট মোড' },
      { id: 'wide', label: 'পুরো দৃশ্যসহ' },
    ],
  },
  {
    id: 'child',
    label: 'শিশু',
    options: [
      { id: 'alone', label: 'একা' },
      { id: 'withBaby', label: 'কোলে শিশু' },
      { id: 'withToddler', label: 'ছোট বাচ্চার সাথে' },
      { id: 'pregnant', label: 'গর্ভবতী' },
    ],
  },
  {
    id: 'dress',
    label: 'পোশাক',
    options: [
      { id: 'hijab', label: 'হিজাব / বোরকা' },
      { id: 'saree', label: 'শাড়ি' },
      { id: 'salwar', label: 'সালোয়ার কামিজ' },
      { id: 'modern', label: 'আধুনিক' },
    ],
  },
  {
    id: 'place',
    label: 'জায়গা',
    options: [
      { id: 'home', label: 'বাসা' },
      { id: 'city', label: 'শহর' },
      { id: 'village', label: 'গ্রাম' },
      { id: 'trip', label: 'বেড়ানো / অনুষ্ঠান' },
    ],
  },
];

const GROUP_IDS = STYLE_GROUPS.map((g) => g.id);
const OPTION_IDS = Object.fromEntries(STYLE_GROUPS.map((g) => [g.id, g.options.map((o) => o.id)]));

/** Which groups change the picture itself, per picture type (the rest only shape the profile text). */
const IMAGE_GROUPS = {
  photo: ['age', 'camera', 'child', 'dress', 'place'],
  faceHidden: ['child', 'dress', 'place'],
  illustration: ['age', 'child', 'dress', 'place'],
  painting: ['age', 'child', 'dress', 'place'],
  flower: [],
  nature: ['place'],
  aesthetic: [],
  babyDetail: ['child'],
};

/** Every option selected. */
export const defaultStyles = () => Object.fromEntries(GROUP_IDS.map((g) => [g, [...OPTION_IDS[g]]]));

const cleanGroup = (group, raw) => [...new Set((Array.isArray(raw) ? raw : []).map(String))].filter((id) => OPTION_IDS[group].includes(id));

/** Label of the first group with fewer than MIN_PER_GROUP valid options, or null. Missing groups count as "all". */
export function invalidStyleGroup(input) {
  if (input == null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) return 'ছবির স্টাইল';
  for (const g of STYLE_GROUPS) {
    if (input[g.id] == null) continue;
    if (cleanGroup(g.id, input[g.id]).length < MIN_PER_GROUP) return g.label;
  }
  return null;
}

/** Known ids only; a missing or too-small group falls back to all its options. */
export function normalizeStyles(input) {
  const out = defaultStyles();
  for (const g of GROUP_IDS) {
    const picked = cleanGroup(g, input?.[g]);
    if (picked.length >= MIN_PER_GROUP) out[g] = picked;
  }
  return out;
}

/** n values from `options`, each used about n/k times, in random order. */
function balanced(options, n) {
  const out = [];
  while (out.length < n) out.push(...shuffle(options));
  return shuffle(out.slice(0, n));
}

/** What makes two users look the same: the picture type plus the groups that type uses. */
const comboKey = (c) => [c.picture, ...(IMAGE_GROUPS[c.picture] || []).map((g) => c[g])].join('|');

/**
 * One combo per user: {picture, age, camera, child, dress, place}. Every selected
 * option is used about evenly, and no two users share the same visible mix
 * unless there are fewer possible mixes than users.
 */
export function planCombos(styles, n) {
  const s = normalizeStyles(styles);
  const columns = Object.fromEntries(GROUP_IDS.map((g) => [g, balanced(s[g], n)]));
  const combos = Array.from({ length: n }, (_, i) => Object.fromEntries(GROUP_IDS.map((g) => [g, columns[g][i]])));

  // Break duplicates by swapping one group's value with another user (keeps the balance).
  for (let attempt = 0; attempt < n * 30; attempt++) {
    const seen = new Map();
    let dup = -1;
    combos.forEach((c, i) => {
      const k = comboKey(c);
      if (seen.has(k) && dup < 0) dup = i;
      else seen.set(k, i);
    });
    if (dup < 0) break;
    const other = randInt(0, n - 1);
    if (other === dup) continue;
    const group = pick(['picture', ...(IMAGE_GROUPS[combos[dup].picture] || []), ...GROUP_IDS]);
    [combos[dup][group], combos[other][group]] = [combos[other][group], combos[dup][group]];
  }
  return combos;
}

/* ------------------------------------------------------------------ */
/* Identity                                                            */
/* ------------------------------------------------------------------ */

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
const AGE_BANDS = { early20s: [21, 25], late20s: [26, 30], early30s: [31, 35], late30s: [36, 40] };
const BABY_AGES = ['3 months', '5 months', '7 months', '9 months', '11 months'];
const TODDLER_AGES = ['1 year', '15 months', '18 months', '2 years', '3 years'];
const CHILD_AGES = [...BABY_AGES, ...TODDLER_AGES];
const RELIGION_BY_DRESS = {
  hijab: [['Muslim', 1]],
  saree: [['Muslim', 6], ['Hindu', 4]],
};
const DEFAULT_RELIGION = [['Muslim', 8], ['Hindu', 2]];

/**
 * A new person's fixed traits; stored on User.persona.look. `combo` (from
 * planCombos) fixes her picture type, age band, child, dress and background.
 */
export function randomIdentity({ religion, combo } = {}) {
  const c = combo || {};
  const rel = religion || weighted(RELIGION_BY_DRESS[c.dress] || DEFAULT_RELIGION);
  let cover = 'none';
  if (c.dress === 'hijab') cover = 'hijab';
  else if (rel === 'Muslim')
    cover = c.dress ? weighted([['dupatta over head', 2], ['none', 5]]) : weighted([['hijab', 5], ['dupatta over head', 2], ['none', 4]]);

  const [minAge, maxAge] = AGE_BANDS[c.age] || [21, 39];
  const look = {
    religion: rel,
    age: randInt(minAge, maxAge),
    skinTone: weighted(SKIN_TONES),
    build: pick(BUILDS),
    face: pick(FACES),
    hair: pick(HAIR),
    cover,
    glasses: chance(0.2),
    childAge: pick(c.child === 'withBaby' ? BABY_AGES : c.child === 'withToddler' ? TODDLER_AGES : CHILD_AGES),
  };
  for (const g of ['picture', 'camera', 'child', 'dress', 'place', 'nameStyle']) if (c[g]) look[g] = c[g];
  if (c.child === 'pregnant') {
    look.pregnancyMonth = randInt(4, 8);
    look.childAge = undefined;
  }
  return look;
}

/* ------------------------------------------------------------------ */
/* Scene pieces                                                        */
/* ------------------------------------------------------------------ */

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
  hijab: [
    'a {c} abaya',
    'a {c} long kameez',
    'a {c} loose gown-style dress',
    'a {c} salwar kameez with a long dupatta',
    'a {c} long kurti with palazzo pants',
  ],
  saree: [
    'a simple {c} cotton saree',
    'a {c} printed georgette saree',
    'a {c} jamdani saree',
    'a {c} tant saree with a contrasting border',
    'a {c} silk saree for an occasion',
  ],
  salwar: [
    'a {c} cotton salwar kameez with a contrasting dupatta',
    'a {c} printed three-piece with a dupatta',
    'a {c} shawl over a plain kameez',
    'a {c} embroidered salwar kameez',
  ],
  modern: [
    'a {c} kurti with jeans',
    'a casual {c} t-shirt at home',
    'a {c} long tunic top',
    'a {c} formal shirt for the office',
    'a {c} cardigan over a plain top',
  ],
};
const ACCESSORIES = ['a small nose pin', 'thin gold earrings', 'glass bangles', 'a wristwatch', 'small stud earrings', 'a simple necklace', 'no jewellery'];

const FRAMINGS = {
  selfie: [
    "close-up selfie taken at arm's length with the front camera",
    'selfie from a slightly high angle',
    'selfie with her head slightly tilted, phone held to one side',
  ],
  friendShot: [
    'head-and-shoulders portrait taken by a friend',
    'waist-up photo taken by her husband',
    'half-body photo while sitting, taken by a relative',
  ],
  candid: [
    'candid three-quarter angle, looking slightly away from the camera',
    'candid moment caught mid-laugh, not posing',
    'turning toward the camera mid-movement, natural candid moment',
  ],
  mirror: [
    'mirror selfie holding the phone at chest height, her face clearly visible',
    'mirror selfie in a wardrobe mirror, phone held low',
  ],
  portraitMode: [
    'portrait-mode photo with a strongly blurred background',
    'shallow depth-of-field portrait with soft bokeh lights behind',
  ],
  wide: [
    'full-body photo with the place clearly visible',
    'slightly off-centre wide shot with lots of background',
    'waist-up standing photo with the surroundings in view',
  ],
};
const SETTINGS = {
  home: [
    'a small Dhaka apartment living room with a sofa and patterned curtains',
    'a home kitchen with steel pots and a gas stove',
    'a balcony with potted plants and window grills',
    'a bedroom with a printed bedsheet and a wardrobe',
    "a relative's drawing room with a wooden showcase",
    'a rainy-day window with water drops',
    'a plain painted wall at home',
  ],
  city: [
    'a rooftop with water tanks and city buildings behind',
    'a street with blurred rickshaws behind',
    'a small cafe table with a cup of tea',
    'a shopping mall corridor',
    'an office desk with a laptop',
    'a lakeside walkway at Hatirjheel',
  ],
  village: [
    'a village courtyard in front of a tin-roof house',
    'beside a pond with coconut and banana trees',
    'a rice field in the countryside',
    'a village road lined with tall trees',
    'a river ghat with a wooden boat',
  ],
  trip: [
    'a city park with green trees',
    'a tea garden in Sylhet',
    "the beach at Cox's Bazar",
    'a family wedding with fairy lights',
    'the green hills of Bandarban',
    'an Eid get-together in a decorated living room',
  ],
};
const ALL_SETTINGS = Object.values(SETTINGS).flat();
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
const OUTDOOR = /rooftop|courtyard|pond|park|street|tea garden|beach|rice field|walkway|road|ghat|hills/;
const lightFor = (setting) => pick(LIGHT[OUTDOOR.test(setting) ? 'out' : 'in']);
const CAMERAS = [
  'mid-range Android phone camera with slight noise',
  'phone portrait mode with a blurred background',
  'slightly soft front-camera focus',
  'sharp rear phone camera',
  'a little overexposed, typical phone snapshot',
];
/** Image quality that never contradicts the chosen camera style. */
const NEUTRAL_CAMERAS = ['mid-range Android phone camera with slight noise', 'sharp phone camera', 'a little overexposed, typical phone snapshot', 'natural phone colours'];
const CAMERA_EXTRAS = { selfie: ['slightly soft front-camera focus'], portraitMode: ['phone portrait mode with a blurred background'] };
const cameraQuality = (look) =>
  pick(look.picture ? [...NEUTRAL_CAMERAS, ...((look.picture === 'photo' && CAMERA_EXTRAS[look.camera]) || [])] : CAMERAS);
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
const PREGNANT = [
  'about {m} months pregnant, one hand resting on her visible baby bump',
  'about {m} months pregnant, her baby bump visible under her outfit',
  'about {m} months pregnant, holding her bump with both hands and smiling down at it',
];
const FACE_HIDDEN = [
  'seen from behind, looking out at the view',
  'a side silhouette against the light, face in shadow',
  'holding a small bouquet of flowers in front of her face',
  'looking down so her face is not visible, only her hair or head cover and outfit show',
  'face turned away, one hand raised toward the camera as if shy',
  'walking away from the camera',
];
const ART_STYLES = {
  illustration: [
    'a flat-colour digital illustration avatar',
    'a cute cartoon-style character avatar with big expressive eyes',
    'a clean line-art illustration with soft pastel fills',
    'a modern vector-style portrait illustration',
    'a soft 3D cartoon-style character render',
  ],
  painting: [
    'a soft watercolour painting',
    'an oil-painting style portrait with visible brush strokes',
    'a gouache painting in warm muted colours',
    'a coloured-pencil sketch with light shading',
    'a charcoal-and-wash portrait',
  ],
};
const FLOWERS = [
  'a single red rose with dew drops',
  'a pink shapla (water lily) floating on a pond',
  'a red hibiscus (joba) flower on the bush',
  'a bunch of orange marigolds',
  'white shiuli (night jasmine) flowers scattered on green grass',
  'a yellow sunflower against a blue sky',
  'red krishnachura (flame tree) flowers against the sky',
  'white kamini flowers on a branch',
  'purple jarul flowers on a tree',
  'a pink lotus with a green leaf',
  'a small pot of white beli (jasmine) flowers',
  'tuberose (rajanigandha) sticks in a glass vase',
];
const FLOWER_STYLES = [
  'close-up macro phone photo',
  'soft-focus phone photo with a blurred background',
  'photo in fresh morning light',
  'top-down phone photo',
];
/** Scenery per place option, so a scenery picture follows the selected places too. */
const NATURE = {
  home: [
    'rain drops on a window with blurred green trees outside',
    'a full moon seen from a balcony with potted plants',
    'morning sunlight through a window onto potted plants',
  ],
  city: [
    'a sky full of orange clouds at sunset over city rooftops',
    'Hatirjheel lake with lights reflecting at dusk',
    'a quiet tree-lined city road after the rain',
  ],
  village: [
    'a calm river with a small wooden boat at sunset',
    'a misty rice field at sunrise',
    'a pond with lotus leaves and coconut trees',
    'a river bank with white kash flowers in autumn',
    'a field of yellow mustard flowers',
  ],
  trip: [
    'a green tea garden on rolling hills',
    "the sea at Cox's Bazar at golden hour",
    'clouds over the Bandarban hills',
    'a full moon over palm trees by the sea',
  ],
};
const BABY_DETAIL = [
  "tiny baby feet held in a mother's palm",
  "a baby's tiny hand gripping an adult's finger",
  'a sleeping baby wrapped in a soft blanket, face turned away from the camera',
  'baby feet peeking out of a knitted blanket',
  "a toddler's small hand holding a mother's hand, walking",
  "a baby's hand resting on a mother's hand with glass bangles",
];
const BABY_DETAIL_PREGNANT = [
  'a pair of tiny knitted baby shoes on a bed',
  'hands forming a heart over a pregnancy bump, only the bump and hands in the frame',
  'small folded baby clothes and a soft toy on a bedsheet',
];
const AESTHETIC = [
  'a cup of milk tea beside an open book by the window',
  'henna (mehndi) designs on two hands',
  'glass bangles and a jasmine garland on a wooden table',
  'a cup of coffee and a notebook on a bed with fairy lights',
  'a jar of fresh flowers on a windowsill',
  'two hands holding a cup of tea on a rainy day',
  'a stack of books with dried flowers on top',
  'clay pots and a money plant on a balcony',
];
const OBJECT_STYLES = ['cozy phone photo', 'top-down flat-lay photo', 'soft warm light, shallow focus', 'aesthetic social-media style photo'];

const colour = (template) => template.replace('{c}', pick(COLOURS));
/** "7 months" -> "7-month-old baby", "2 years" -> "2-year-old toddler". */
function childPhrase(age = '1 year') {
  const [n, unit] = String(age).split(' ');
  const months = unit.startsWith('month') ? Number(n) : Number(n) * 12;
  const noun = months < 12 ? 'baby' : months < 36 ? 'toddler' : 'child';
  return `${n}-${unit.startsWith('month') ? 'month' : 'year'}-old ${noun}`;
}
const sentence = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Which child line goes into the picture. Older looks have no `child`: 40% with the child. */
function childLine(look) {
  const mode = look.child || (chance(0.4) ? 'withChild' : 'alone');
  if (mode === 'alone') return null;
  if (mode === 'pregnant') return pick(PREGNANT).replace('{m}', look.pregnancyMonth || 6);
  return pick(WITH_CHILD).replace('{a}', childPhrase(look.childAge));
}

function outfitFor(look) {
  if (look.dress && OUTFITS[look.dress]) return colour(pick(OUTFITS[look.dress]));
  if (look.cover === 'hijab' && chance(0.4)) return colour(pick(OUTFITS.hijab));
  return colour(pick([...OUTFITS.salwar, ...OUTFITS.saree, ...OUTFITS.modern]));
}

/** The woman herself: identity, hair or head cover, outfit. */
function personLines(look) {
  const hairOrCover =
    look.cover === 'hijab'
      ? colour(pick(HIJABS))
      : look.cover === 'dupatta over head'
        ? `${look.hair}, partly covered by ${look.dress === 'saree' ? 'the end of her saree' : 'a dupatta'} drawn over her head`
        : look.hair;
  const hinduMarks = look.religion === 'Hindu' && chance(0.6) ? ', a little sindoor in her hair parting and shakha-pola bangles' : '';
  return [
    `A fictional Bangladeshi ${look.religion === 'Hindu' ? 'Hindu ' : ''}woman, about ${look.age} years old, ${look.skinTone}, ${look.build}, ${look.face}`,
    `${hairOrCover}${look.glasses ? ', wearing glasses' : ''}`,
    `wearing ${outfitFor(look)}, ${pick(ACCESSORIES)}${hinduMarks}`,
  ];
}

const settingFor = (look) => pick(SETTINGS[look.place] || ALL_SETTINGS);
const done = (parts, kind) => ({ description: `${parts.filter(Boolean).map(sentence).join('. ')}.`, kind });

/**
 * One picture of that person: a fresh outfit, place, pose and light every time.
 * `kind` picks the image prompt wrapper: 'photo' (photorealistic, her),
 * 'art' (illustrated, her) or 'object' (no face shown: flower, scenery...).
 */
export function describePortrait(look = randomIdentity()) {
  const picture = look.picture || 'photo';

  if (picture === 'flower') return done([`${pick(FLOWERS)}`, `Style: ${pick(FLOWER_STYLES)}`], 'object');
  if (picture === 'nature') return done([pick(NATURE[look.place] || Object.values(NATURE).flat()), `Style: ${pick(['wide phone photo', 'phone photo in natural colours', 'slightly dreamy edited phone photo', 'phone photo with a slight vignette'])}`], 'object');
  if (picture === 'aesthetic') return done([pick(AESTHETIC), `Style: ${pick(OBJECT_STYLES)}`], 'object');
  if (picture === 'babyDetail') {
    const subject = look.child === 'pregnant' ? pick(BABY_DETAIL_PREGNANT) : pick(BABY_DETAIL);
    return done([subject, `Style: ${pick(OBJECT_STYLES)}`, 'No faces visible'], 'object');
  }

  const setting = settingFor(look);
  const child = childLine(look);

  if (picture === 'illustration' || picture === 'painting') {
    return done(
      [
        `Art style: ${pick(ART_STYLES[picture])}`,
        ...personLines(look),
        pick(EXPRESSIONS),
        child,
        `Background: ${setting}, simplified to suit the art style`,
      ],
      'art'
    );
  }

  if (picture === 'faceHidden') {
    return done(
      [
        ...personLines(look),
        `Her face is NOT visible: ${pick(FACE_HIDDEN)}`,
        child ? `${child}, the child's face also turned away or out of view` : null,
        `Setting: ${setting}`,
        `Shot: ${lightFor(setting)}; ${cameraQuality(look)}`,
      ],
      'photo'
    );
  }

  const framing = pick(FRAMINGS[look.camera] || Object.values(FRAMINGS).flat());
  return done(
    [...personLines(look), pick(EXPRESSIONS), child, `Setting: ${setting}`, `Shot: ${framing}; ${lightFor(setting)}; ${cameraQuality(look)}`],
    'photo'
  );
}

/** Variety for post photos (the post writer supplies the subject). */
export function randomPhotoStyle() {
  return `${pick([...LIGHT.in, ...LIGHT.out])}; ${pick(CAMERAS)}; ${pick(['top-down angle', 'eye-level angle', 'slight side angle', 'close-up detail', 'wide shot showing the room'])}`;
}

const HINDU_SURNAMES = /(রায়|দাস|সাহা|চক্রবর্তী|ঘোষ|দত্ত|পাল|ভট্টাচার্য|বসু|সেন|দে|দেব|মিত্র|কর|নন্দী|গুহ|বণিক|সাহু|পোদ্দার|রানী|রাণী|দেবী)$/;
/** Best guess for personas made before looks were stored, so a new photo fits the name. */
export const guessReligion = (name = '') =>
  HINDU_SURNAMES.test(String(name).replace(/\s*\(AI[^)]*\)\s*$/, '').trim()) ? 'Hindu' : 'Muslim';
