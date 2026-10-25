# Solver Migration Plan: Strategy-Parameterized System

## Goal

Migrate `js/solver.js` to implement the 17 strategies from `plan/solving.md` using **parameterized N-variants** instead of separate functions, gated by difficulty.

---

## Current → New Mapping

| Current Function | Covers Strategies | Action |
|---|---|---|
| `applyBasicElimination` | #1 Basic elimination | ✅ Keep as-is |
| `applyNakedSingles` | #2 Naked single | ✅ Keep as-is |
| `applyHiddenSingles` + parts of `applyRowColIntersection` | #3 Hidden single | Consolidate, delete `applyRowColIntersection` |
| `applyRegionConfinement` | #4 Pointing + #6 House claim | Parameterize: `{ pointing, houseClaim }` — easy = pointing only, medium+ = both |
| `applyPigeonhole` (naked) | #5 pairs, #8 triple, #11 quad, #16 N Set | Already generic — parameterize max K via difficulty gate |
| `applyAdjacencyBlocking` | #7 contradiction, #9 double, #14 triple, #15 quad | ✅ Rename only — already checks ALL unplaced regions per candidate in one pass |
| *(new)* | #10 hidden pair, #12 triple, #13 quad | New generic **hidden-N**, parameterized by N |
| `applyForcingChains` | #17 Forcing chain | ✅ Keep as-is |

---

## Phased Sub-Agent Task List

### Phase 1 — Cleanup: Consolidate Hidden Singles + Delete RowColIntersection

**File:** `js/solver.js`

- [ ] Merge row/column hidden-single logic from `applyRowColIntersection` into `applyHiddenSingles`
- [ ] Ensure the merged function covers both directions (rows AND columns) with clean, deduplicated code
- [ ] Delete `applyRowColIntersection` entirely
- [ ] Verify: all existing tests in `test/solver.test.js` still pass

### Phase 2 — Parameterize Region Confinement (#4 Pointing + #6 House Claim)

**File:** `js/solver.js`

- [ ] Add `{ pointing = true, houseClaim = false }` options parameter to `applyRegionConfinement`
- [ ] Gate the "eliminate other regions from claimed row/col" block behind `pointing`
- [ ] Gate the "house claim" elimination (already present) behind `houseClaim`
- [ ] Verify: existing region confinement test still passes with defaults

### Phase 3 — Parameterize Pigeonhole Max-K (#5, #8, #11, #16)

**File:** `js/solver.js`

- [ ] Add `{ maxK = 4 }` options parameter to `applyPigeonhole`
- [ ] Use `maxK` as the upper bound for the combination loop (`k <= maxK`)
- [ ] Verify: existing tests pass with default `maxK: 4`

### Phase 4 — Rename Adjacency Blocking → Contradiction (#7, #9, #14, #15)

**File:** `js/solver.js`

- [ ] Rename `applyAdjacencyBlocking` to `applyContradiction` (no logic changes)
- [ ] Update all references in the solve loop and exports
- [ ] Verify: existing adjacency blocking test still passes under new name

### Phase 5 — Implement Generic Hidden-N (#10, #12, #13)

**File:** `js/solver.js`

- [ ] Add `applyHiddenN(state, opts)` with `{ maxRegions = 0 }` parameter
- [ ] When `maxRegions === 0`, return early (disabled / easy mode)
- [ ] For each combination of N unplaced regions sharing ≤N houses:
  - Identify any house within that set where only one region has candidates
  - Eliminate that region's candidates outside that house
- [ ] Add to `TECHNIQUES` array between contradiction and forcing chains
- [ ] Verify: no regressions on existing tests

### Phase 6 — Rebuild Solve Loop + Update Tests

**Files:** `js/solver.js`, `test/solver.test.js`

- [ ] Replace `TECHNIQUES` array with strategy config that passes difficulty-driven opts to each function
- [ ] Rename `solveWithMaxTechnique` → `solveWithDifficulty(difficulty, regions, size)` where difficulty is `'easy' | 'medium' | 'hard'`
- [ ] Difficulty gates:
  - easy: pointing only, maxK=2, contradiction (default), hidden-N disabled
  - medium: pointing + houseClaim, maxK=3, contradiction, hidden-N maxRegions=2
  - hard: all enabled, maxK=4, hidden-N maxRegions=4
- [ ] Update `test/solver.test.js` imports to match new names/signatures
- [ ] Update difficulty validation tests to use `solveWithDifficulty`
- [ ] Verify: full test suite passes

---

## File Changes Summary

| File | Change |
|---|---|
| `js/solver.js` | Consolidate hidden singles, parameterize confinement/pigeonhole, rename contradiction, add hidden-N, rebuild solve loop |
| `test/solver.test.js` | Update imports, update difficulty validation tests |

## No Changes

| File | Reason |
|---|---|
| `js/engine.js` | Solver is only used by generator for validation; engine is unaffected |
| `js/generator.js` | Calls `solve()` — API shape changes but usage pattern stays the same |
| `test/engine.test.js` | No solver tests |
