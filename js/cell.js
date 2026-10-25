/**
 * Cell coordinate utilities.
 * Positions are encoded as r * 100 + c (supports boards up to 99x99).
 */

export function cellKey(r, c) {
  return r * 100 + c;
}

export function cellPos(key) {
  return [Math.floor(key / 100), key % 100];
}
