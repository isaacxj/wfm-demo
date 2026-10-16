/**
 * Seeded randomness. Integer arithmetic only, so every JavaScript engine
 * produces the same sequence and a screenshot taken today matches next month.
 */

/** 32-bit FNV-1a hash of a string. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mulberry32: returns a generator of floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A generator keyed to a name, so adding one stream never shifts another. */
export function streamFor(seed: number, name: string): () => number {
  return mulberry32((seed ^ fnv1a(name)) >>> 0);
}

/** Uniform in [lo, hi). */
export function between(rand: () => number, lo: number, hi: number): number {
  return lo + (hi - lo) * rand();
}
