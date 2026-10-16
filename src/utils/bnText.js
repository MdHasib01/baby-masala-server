// Bengali nukta letters can be stored precomposed (য় U+09DF) or as base letter
// plus nukta (য + ় U+09AF U+09BC); both render the same. Unicode NFC
// decomposes them, so NFC is no help here. The frontend mostly uses the
// precomposed form, so this is the canonical form.
const DECOMPOSED = /([\u09A1\u09A2\u09AF])\u09BC/g;
const PRECOMPOSED = { '\u09A1': '\u09DC', '\u09A2': '\u09DD', '\u09AF': '\u09DF' };

export const canonBn = (value) =>
  typeof value === 'string' ? value.replace(DECOMPOSED, (_, base) => PRECOMPOSED[base]) : value;

/** Applies canonBn to every string inside plain objects and arrays. */
export function canonDeep(value) {
  if (typeof value === 'string') return canonBn(value);
  if (Array.isArray(value)) return value.map(canonDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, canonDeep(v)]));
  }
  return value;
}
