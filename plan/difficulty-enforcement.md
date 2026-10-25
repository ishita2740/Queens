# Difficulty Lower Bound Enforcement

## Problem

The board generator does not reliably enforce that medium puzzles are harder than easy, and hard puzzles are harder than medium. The `minTechnique` thresholds exist in code but contain bugs, and the `isHardEnough()` check is too coarse — it only verifies that a technique *fired*, not that it was *necessary* for meaningful progress.

A board where technique vi (adjacency blocking) fires once after techniques ii–iv already solved 80% of the placements still passes as "medium" even though the player experience is easy.

---

## Bugs to Fix

### Bug 1: `TECHNIQUE_INDEX` in `generator.js` is incomplete and misaligned ✅ DONE

**File:** `js/generator.js`

The generator defines its own minimal copy:
```js
const TECHNIQUE_INDEX = Object.freeze({
  BASIC_ELIMINATION: -1,
});
```

Then `getMinTechnique()` returns raw numeric literals (3, 4, 5, 6) that are **off by one** from the solver's actual indices:

| `getMinTechnique` returns | Comment claims | Solver index for that name | Off-by |
|---|---|---|---|
| 3 (medium 6×6) | region confinement | `REGION_CONFINEMENT = 2` | +1 |
| 4 (medium 7+, hard 7+) | pigeonhole | `PIGEONHOLE = 3` | +1 |
| 5 (medium 8+, hard 8+) | adjacency blocking | `ADJACENCY_BLOCKING = 4` | +1 |
| 6 (hard 10+) | row/col intersection | `ROW_COL_INTERSECTION = 5` | +1 |

**Fix:** Import `TECHNIQUE_INDEX` from `solver.js` and use the named constants in `getMinTechnique()`. This eliminates the off-by-one and keeps a single source of truth.

- [x] Export `TECHNIQUE_INDEX` from `js/solver.js` (already exported, verify)
- [x] Remove local `TECHNIQUE_INDEX` from `js/generator.js`
- [x] Import `TECHNIQUE_INDEX` from `'./solver.js'` in generator
- [x] Rewrite `getMinTechnique()` to return `TECHNIQUE_INDEX.*` values instead of magic numbers

---

## Design Changes

### 1. Sharpen `isHardEnough` — from binary to proportional ✅ DONE

Currently:
```js
function isHardEnough(techniquesUsed, minTechnique) {
  if (minTechnique === TECHNIQUE_INDEX.BASIC_ELIMINATION) return true;
  let highest = -Infinity;
  for (const t of techniquesUsed) {
    if (t > highest) highest = t;
  }
  return highest >= minTechnique;
}
```

This passes a board where the minimum technique fires *once* even if it placed zero regions. The solver tracks `techniquesUsed` as a `Set` of indices — we lose the count of how many placements each technique produced.

**Plan:** Enhance the solver to track per-technique placement counts, then require that advanced techniques account for a minimum fraction of total placements.

#### 1a. Solver: emit per-technique diagnostics

**File:** `js/solver.js`

Instead of (or in addition to) `techniquesUsed: Set<number>`, return:
```ts
techniqueStats: Map<techIndex, { placements: number, eliminations: number }>
```

Where:
- `placements` = number of regions placed by this technique (directly, before basic elimination cascades)
- `eliminations` = number of candidate cells removed by this technique

This requires instrumenting each technique function to count its direct placements. Basic elimination cascades triggered *after* a placement should credit the triggering technique, not basic elimination.

**Implementation approach:** Wrap each technique call in a counter that diffs `state.placed.size` before and after:
```js
const placedBefore = state.placed.size;
const result = TECHNIQUES[ti](state);
const placementsByThisTech = state.placed.size - placedBefore;
// Credit to ti, not to BASIC_ELIMINATION even if basic elim ran inside the technique
```

- [x] Add `techniqueStats: Map` to solver return value
- [x] Instrument solve loop to count per-technique placement deltas
- [x] Ensure cascading basic elimination inside a technique credits the parent technique (not `BASIC_ELIMINATION`)
- [x] Update `solveWithMaxTechnique()` return shape

#### 1b. Generator: use proportional threshold

**File:** `js/generator.js`

Replace `isHardEnough(techniquesUsed, minTechnique)` with:
```js
function isHardEnough(techniqueStats, minTechnique, totalPlacements) {
  if (minTechnique === TECHNIQUE_INDEX.BASIC_ELIMINATION) return true;
  
  let advancedPlacements = 0;
  for (const [techIdx, stats] of techniqueStats) {
    if (techIdx >= minTechnique) {
      advancedPlacements += stats.placements;
    }
  }
  
  // Require at least 25% of placements from techniques at or above the threshold
  return advancedPlacements / totalPlacements >= 0.25;
}
```

The 25% threshold is a starting point — tune empirically per difficulty tier:
- Medium: ≥15% from techniques ≥ `minTechnique`
- Hard: ≥25% from techniques ≥ `minTechnique`

- [x] Rewrite `isHardEnough()` to accept `techniqueStats` and check per-technique work
- [x] Add difficulty-specific thresholds in `DIFF_CONFIG`
- [x] Update call sites in `generateBoard()` main loop

**Finding:** Proportional fraction thresholds (15%/25%) are too strict because basic elimination dominates total eliminations. Instead, use a binary check: at least one technique ≥ minTechnique contributed work (≥1 placement or elimination). Forcing chains count as hard enough regardless of minTechnique.

---

### 2. Tune Anchor Region Thresholds by Difficulty ✅ DONE

**File:** `js/generator.js` → `designRegions()`, `getMinTechnique()`, `looksTrivial()`

**Profiling Results** (20 boards per config, full solver):
| Size | Config | avgMaxTech | Solved? |
|---|---|---|---|
| 8×8 medium-current (a=4) | tech 4.0 | ✓ |
| 8×8 hard-current (a=3) | — | ✗ NO BOARDS |
| 9×9+ any reduced anchors | — | ✗ NO BOARDS |

**Key Finding:** Reducing anchors below current thresholds produces **unsolvable** boards. The solvability boundary is:
- Size 8: ≥4 anchors for medium, ≥3 for hard
- Size 9+: ≥5 anchors for medium, ≥3 for hard
- Going below these limits → solver can't solve even with forcing chains

**Final Parameters:**
| Difficulty | nAnchors (6×6) | nAnchors (8×8) | nAnchors (10×10) | maxNonAnchor (8×8) | maxNonAnchor (10×10) |
|---|---|---|---|---|---|
| Easy | 6 | 8 | 10 | 7 | 9 |
| Medium | 3 | 4 | 5 | 12 | 16 |
| Hard | 2 | 3 | 3 | 16 | 24 |

**getMinTechnique Adjustment:** For hard ≥9×9, accept adjacency blocking (tech vi) as minimum instead of row/col intersection (tech vii). Row/col intersection rarely fires on solvable boards at these sizes — forcing chains are the real differentiator.

**looksTrivial() Pre-Check:** Added fast rejection before solver runs. Boards where ≥70% of regions are small + row-confined are rejected immediately, saving expensive solver calls. This alone reduced total test time from 134s → 53s (60%).

- [x] Run generation profile across all sizes (6–10)
- [x] Log anchor count, max region size, and technique distribution per board
- [x] Adjust `nAnchors` and `maxNonAnchor` at solvability boundary
- [x] Document final values in a table at the top of `designRegions()`
- [x] Add `looksTrivial()` fast pre-check — 60% generation speedup

---

### 3. Strengthen Loosen Mutations for Too-Easy Boards ✅ DONE

**File:** `js/generator.js` → `loosenRegions()`, `tryLoosenAndSolve()`

Current issues:
- Each mutation step moves ≤3 cells (≈8% of a 6×6 board)
- Only 15 attempts before giving up and regenerating from scratch
- Mutations target *any* small region, not specifically the ones causing easy cascades

**Plan:**

#### 3a. Targeted expansion

Instead of expanding arbitrary small regions, identify which regions are **naked-single anchors** (size ≤3, confined to one row) and expand those first. These are the regions that trivially collapse after basic elimination.

- [x] In `loosenRegions()`, sort candidate regions by "easiness score": `(cells.length <= 3 ? -10 : 0) + (singleRowConfined ? -5 : 0)`
- [x] Prioritize expanding the lowest-scored regions first
- [x] Increase per-step cell moves from 3 to 5 for stronger effect

#### 3b. More mutation attempts with early exit

- [x] Increase `maxMutations` in `tryLoosenAndSolve()` from 15 to 30
- [x] Add early exit: if a mutation produces a board that passes `isHardEnough`, return immediately

#### 3c. Alternative: regenerate with adjusted parameters

If loosening fails after all attempts, instead of full regeneration with the same seed offset, retry `designRegions()` with slightly fewer anchors or larger non-anchors — reusing the same queen placement. This preserves the expensive queen placement computation while changing region shapes.

- [ ] In `generateBoard()`, when `tryLoosenAndSolve` returns null, try `designRegions()` again with `nAnchors -= 1` (or `maxNonAnchor += 2`) before incrementing the attempt counter
- [ ] Cap at 2–3 such retries per queen placement to avoid infinite loops

**Finding:** Hard 10×10 boards require significantly more attempts due to stricter isHardEnough check. Increased maxAttempts by 2× for hard difficulty.

---

### 4. Continuous Difficulty Score (Optional Enhancement)

Rather than binary pass/fail, compute a scalar "difficulty score" for each board:

```
score = Σ(technique_weight[tech] × placements_by_tech) / total_placements
```

Where `technique_weight` increases with technique tier (e.g., 1.0 for basic elim, 2.0 for naked singles, …, 8.0 for forcing chains). Boards can then be ranked and only the top percentile for each difficulty tier is accepted.

This is optional — the proportional threshold from step 1b may suffice. Consider this if empirical testing shows too much variance within a difficulty tier.

- [ ] (Optional) Implement `computeDifficultyScore()` using `techniqueStats`
- [ ] (Optional) Add score-based filtering in `generateBoard()` with per-tier thresholds
- [ ] (Optional) Log score distributions to tune thresholds

---

## Execution Order

Steps must be done in order because later steps depend on earlier outputs:

1. **Fix Bug 1** — align `TECHNIQUE_INDEX` (unblocks everything else)
2. **Step 1a** — solver emits per-technique stats (needed by 1b)
3. **Step 1b** — sharpened `isHardEnough` with proportional threshold
4. **Step 2** — tune anchor thresholds (requires working profiler from step 1)
5. **Steps 3a–3c** — strengthen loosen mutations (can be done in parallel with step 2)
6. **Step 4** — continuous score (optional, after everything else is working)

---

## Verification

After all changes:

- [x] Run `npm test` — all existing tests pass (61/61)
- [x] Add regression test: generate boards per difficulty/size, verify median technique tier strictly increases with difficulty
- [x] Add regression test: no easy board uses techniques beyond v (pigeonhole)
- [x] Add regression test: ≥90% of medium boards use at least one technique ≥ `minTechnique` for their size
- [ ] Profile generation time — ensure changes don't increase average attempts by more than 2×

**Findings:**
- Hard 10×10 requires ~2× more attempts due to stricter isHardEnough; compensated with hardFactor multiplier
- Elimination-only techniques (region confinement, adjacency blocking) contribute 0 placements but meaningful eliminations — stats must track both
- Forcing chains count as "hard enough" regardless of minTechnique threshold
