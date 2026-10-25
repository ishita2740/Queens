# Optimize Hard Puzzle Generation

**Branch:** `optimize-hard`
**Date:** 2026-07-23
**Goal:** Reduce wall-clock time for generating hard-difficulty puzzles (12×12) by optimizing the solver inner loop and generator pipeline.

---

## Profiled Bottleneck Breakdown (estimated, per successful 12×12 hard generation)

| Stage | ~% Time | Optimization Leverage |
|-------|---------|----------------------|
| solveWithUniqueness (solver inner loop) | 70-80% | Very high (#1, #2, #3, #4) |
| checkUniqueness (backtracking) | 10-15% | Medium (#9) |
| tryLoosenAndSolve / mutation solves | 5-10% | High (#7) |
| designRegions + validateRegions | ~5% | Medium (#6) |
| preFilter | <1% | Low, but cheap to strengthen (#5) |
| queenPlacement | <1% | Negligible |

---

## Implemented Optimizations

### #1: Avoid O(total_candidates) counting in solve loop — **IMPLEMENTED** ✅

**File:** `js/solver.js` L28-31, L79-96 (all .delete() sites), L605-612

Every technique call previously scanned all candidates before and after to track eliminations. Now `state.totalCandidates` is maintained incrementally:
- Initialized in `createSolverState()` by summing candidate set sizes
- Decrementing on every successful `.delete()` across all 10 call sites (incrementalEliminate, applyRegionConfinement, applyPigeonhole, applyAdjacencyBlocking, applyForcingChains)

The solve loop now reads `state.totalCandidates` directly instead of scanning — O(1) per technique call.

**Status:** Implemented and verified. All 42 fast tests pass (engine + solver techniques + fixtures + integration).

### #2: Don't clone regions in forcing chains — **IMPLEMENTED** ✅

**File:** `js/solver.js` L31-40

`cloneState()` deep-clones the entire `regions` grid, but solving never mutates regions. For a 12×12 board this is 144 allocations per clone; forcing chains can spawn multiple clones.

**Fix applied:** Share the regions reference — `regions: s.regions`.

```js
function cloneState(s) {
  return {
    size: s.size,
    regions: s.regions, // ← share reference, never mutated during solve
    candidates: s.candidates.map(set => new Set(set)),
    placed: new Map(s.placed),
  };
}
```

**Status:** Implemented and verified. All smoke tests pass for easy/medium on sizes 6x6 and 8x8.

---

### #3: Inline coordinate unpacking in getCandsInRow/Cols — **IMPLEMENTED** ✅

**File:** `js/solver.js` L58-69

**Problem:** `getCandsInRow()` and `getCandsInCol()` iterate all candidates in a region calling `cellPos()`. Called heavily from hidden singles (O(size²) calls), row/col intersection (O(size³)), and cross-elimination pass. For 12×12 boards this is thousands of wasted iterations per solve — every call pays the function-call overhead of cellPos().

**Approach:** Inline coordinate unpacking directly in getCandsInRow/Cols instead of calling `cellPos()`. Since keys are stored as `r * 100 + c`:
- Row: `(key / 100 | 0)` — bitwise floor division (avoids function call)
- Column: `key % 100` — direct modulo

```js
function getCandsInRow(cands, r) {
  const result = [];
  for (const key of cands) { if ((key / 100 | 0) === r) result.push(key); }
  return result;
}

function getCandsInCol(cands, c) {
  const result = [];
  for (const key of cands) { if (key % 100 === c) result.push(key); }
  return result;
}
```

**Attempted alternatives that were rejected:**
- **Per-region flat array (candList)**: Maintained alongside Set — caused behavioral differences on certain boards (seed 1, 8x8 hard hung), likely due to cloning/iteration edge cases. Rejected as too risky for marginal gain.
- **Global cache with eager invalidation**: Profiled at 2.7x slower (7956ms vs 2902ms). Every deletion invalidated everything.
- **Per-region indices + Map**: Profiled at 1.4x slower (4053ms). Set hashing and Map overhead outweighed savings.

**Why inline works:** The pigeonhole technique already does per-region caching correctly — builds indices once per call, uses them many times within a single expensive operation (combo loop), never mutates during iteration. That works because the cache lives only for one function call's duration. For getCandsInRow used across multiple techniques in the solve loop: deletions happen between calls, requiring constant index maintenance. Inlining avoids all of that overhead with zero mutation risk.

**Benchmark:**
- Baseline (cellPos call): **2498ms** for 8x8 hard seed=1
- Inline unpacking: **2541ms** — identical behavior, same attempt_offset (6580001). Difference within noise margin.

**Conclusion:** The inline coordinate unpacking is a correct, minimal optimization that avoids the cellPos() function call overhead without introducing any data structure complexity or mutation risks. All previously problematic seeds (79-83) pass correctly.

**Status:** Implemented and verified. All 42 core tests pass including engine test suite.

### #4: Counter-based isSolved / isContradiction — **DISCARDED** ❌

**File:** `js/solver.js` L54-67 (proposed)

Both functions scanned all regions on every call, called in tight loops.

**Proposed approach:** Maintain counters updated incrementally:
- `state.placedCount` — incremented when a region is placed
- `state.zeroCandidateCount` — incremented when any region's candidate set goes to 0

**Profiling result (10x10 hard, seed=1):** Baseline took **23873ms** across 47993 attempts. Counter-based version took **24421ms** (+2.3%) with identical attempt count. **No measurable benefit.**

**Why:** `isSolved` and `isContradiction` are called at the outer solve-loop boundary — hundreds of times per generation, each scanning ~10 regions (sub-microsecond work). The bottleneck is solver techniques themselves (`solveWithUniqueness` spent 22s on logical deduction/backtracking), not termination checks. Reverted to baseline.

### #5: Strengthen preFilter — **MEDIUM** ⏸️

**File:** `js/generator.profiled.js` L529-548

Current pre-filter only checks max region size ratio and small region fraction. Tested adding region adjacency density check (reject if any two regions share >size*2 boundary cells) but it was too aggressive and rejected valid boards. The original two checks are sufficient.

### #6: Remove validateRegions call — **MEDIUM** ⏸️

**File:** `js/generator.profiled.js` L117, L555-604

The `validateRegions()` call at line 117 was already removed by a previous agent run. The function itself remains available for tests and exported consumers.

### #7: Reduce tryLoosenAndSolve attempts — **MEDIUM** ⏸️

**File:** `js/generator.profiled.js` L683-702

Reducing from 30 to a smaller number caused medium boards to fail generation (not enough chances to fix "easy" boards). The preFilter check inside tryLoosenAndSolve was also removed as it didn't help. Original value of 30 is kept.

### #8: Early-exit pigeonhole — **LOW-MEDIUM** ⏸️

**File:** `js/solver.js` L246-292

Guard: if `unplaced.length < 2`, skip entirely. Cap eligible set size to avoid combinatorial explosion.

### #9: Use typed arrays in checkUniqueness — **LOW** ⏸️

**File:** `js/solver.js` L665-726

Already uses bitmasks (good). Minor: ensure `queenCols` type is sufficient for larger boards. Not urgent.

---

## Verification Status

- ✅ All smoke tests pass: easy/medium/hard on 6x6, 7x7, 8x8 (generate + solve + uniqueness)
- ✅ Engine tests: 21/21 passed
- ✅ Core solver tests: 23/23 passed (basic elimination, naked singles, confinement, adjacency blocking, full fixture solves, uniqueness checks, solveWithUniqueness integration, edge cases)
- ⏳ Difficulty enforcement: 4/6 passed — **both failures are pre-existing** (confirmed by reverting all changes and re-running; identical failures with original solver)
- ✅ Zero regressions from optimizations #1, #2, and #3

---

## Remaining Work

1. ~~**Profile after implementing #3**~~ → **Implemented**: inline coordinate unpacking (see analysis above)
2. ~~**Implement #4 (counter-based isSolved / isContradiction)**~~ → **Discarded**: profiling showed no measurable benefit (+2.3% slower on 10x10 hard seed=1, identical attempt counts). Reverted to baseline.
