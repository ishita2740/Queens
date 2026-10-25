// mulberry32 — a fast, seeded PRNG suitable for game board generation.
// Returns a function that produces 32-bit unsigned integers in [0, 2^32).

export function createRng(seed) {
  let state = seed | 0; // coerce to signed 32-bit int
  return function next() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0); // unsigned 32-bit
  };
}

// Helper: random float in [0, 1) from an RNG function.
export function rngFloat(rng) {
  return rng() / 4294967296; // 2^32
}

// Helper: random integer in [min, max) from an RNG function.
export function rngInt(rng, min, max) {
  return min + Math.floor(rngFloat(rng) * (max - min));
}

// Helper: shuffle an array in-place using Fisher-Yates with the given RNG.
export function rngShuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rngInt(rng, 0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
