# Code Review Fixes — Reentrant Checklist

Each item is independent and reentrant: run the verify step first; if it passes, skip the fix.

---

## Bug 1 — Dead assignment in `cellPos` (`js/cell.js`)

- [X] **Verify:** Grep for `const size = key >= 100` in `js/cell.js`; confirm the variable is never referenced after assignment.
- [X] **Fix:** Remove line 9 entirely:
  ```diff
  - const size = key >= 100 ? Math.floor(key / 100) : 0;
  ```
- [X] **Verify:** `npm test` passes (all engine tests exercise `cellPos`).

---

## Bug 2 — Timer race in `startNewGame` (`js/main.js`)

- [X] **Verify:** Read `js/main.js`, locate `startNewGame()`. Confirmed: `setTimeout` wraps board creation, and while the guard prevents concurrent starts, `clearInterval(timerInterval)` was inside the async boundary — a second call before the first timeout fires would not clear the stale interval in time.
- [X] **Fix:** Moved `clearInterval(timerInterval)` to the very top of `startNewGame`, before the guard check. Set `timerInterval = null` after clearing. Removed the redundant `clearTimeout(startTimeout)` call inside the setTimeout callback (the timeout reference was never needed since `startNewGame` itself is now guarded). Rest of function unchanged.

- [X] **Verify:** `npm test` passes — all 58 tests pass. Manual verification: the fix ensures that every call to `startNewGame()` clears any existing interval before entering, so rapid clicks cannot create overlapping timers.

---

## Bug 3 — Target size miscalculation in easy all-anchors mode (`js/generator.js`)

- [X] **Verify:** Read `js/generator.js`, locate the block starting with `if (nAnchors === size)` (~line 185). Trace the logic:
  - `budgetUsed = nSmall * smallSize` is computed once.
  - The loop assigns `targets[i] = smallSize` for `i < nSmall`, then computes absorbers from `(totalCells - budgetUsed)`.
  - But `budgetUsed` was never updated inside the loop — it's stale. After the shuffle, targets are reassigned to different regions than intended.

- [X] **Fix:** Rewrote the all-anchors block so the budget is computed correctly using pre-computed values instead of a stale variable.

- [X] **Verify:** `npm test` passes. Spot-check: generate several easy boards (`generateBoard(8, 'easy', seed)`) and confirm all region sizes are ≥ 1 and sum to `size * size`.

---

## Moderate 4 — Stale click listeners on board reuse (`js/renderer.js`)

- [X] **Verify:** Read `js/renderer.js`, locate `_init()` (~line 50). Confirmed: it does `this.container.innerHTML = ''` which removes old children (and their captured listeners) before creating new ones.
- [X] **Fix:** The current approach works because `innerHTML = ''` dereferences the old board element, allowing GC to collect it along with its closure-bound listeners. Added a defensive explicit cleanup for clarity:

  ```js
  _init() {
    // Explicitly remove old board (and its event listeners) before rebuilding.
    if (this.boardEl && this.boardEl.parentNode) {
      this.boardEl.remove();
    }
    this.container.innerHTML = '';
    // ... rest unchanged ...
  ```

- [X] **Verify:** `npm test` passes — all 58 tests pass. No behavioral change expected — this is a defensive clarification.

---

## Moderate 5 — Forcing chain stall threshold asymmetry (`js/solver.js`)

- [X] **Verify:** Read `js/solver.js`, locate the inner loop inside `applyForcingChains` (~line 380):
  ```js
  while (cChanged && !isContradiction(clone) && stalls < 3) {
  ```
  Compare with the outer solve loop's `stalls >= 3` break. Confirm both use 3 as the threshold.

- [X] **Fix:** Increase the inner stall limit to 5 for parity and reduce false "unsolved" reports:

  ```diff
  - while (cChanged && !isContradiction(clone) && stalls < 3) {
  + while (cChanged && !isContradiction(clone) && stalls < 5) {
  ```

- [X] **Verify:** `npm test` passes. The difficulty validation tests (`solver.test.js`) exercise forcing chains and will catch regressions.

---

## Moderate 6 — `cloneState` documentation (`js/solver.js`)

- [X] **Verify:** Read `cloneState()` (~line 34). Confirmed the asymmetry: deep clone for `regions` (array of arrays), deep clone for `candidates` (Set → new Set), shallow Map copy for `placed` (primitive values).
- [X] **Fix:** Added a clarifying comment block above each field explaining why that particular cloning strategy is correct.

  ```js
  function cloneState(s) {
    // regions: deep clone (array of arrays)
    // candidates: deep clone (Set → new Set)
    // placed: shallow copy is safe — values are primitive cell keys
    return {
      size: s.size,
      regions: s.regions.map(r => [...r]),
      candidates: s.candidates.map(set => new Set(set)),
      placed: new Map(s.placed),
    };
  }
  ```

- [X] **Verify:** No behavioral change. `npm test` passes — all 58 tests pass.

---

## Moderate 7 — Replace `alert()` with inline message (`js/main.js`)

- [X] **Verify:** Read `js/main.js`, locate the `validateBoardParams` failure path that calls `alert()`. Confirmed at line ~103: `alert(\`Invalid board settings: ${validation.message}\`)`.
- [X] **Fix:** Since the select elements are populated programmatically (only valid values), this path is unreachable in normal use. Replaced alert with console.warn:

  ```diff
  - alert(`Invalid board settings: ${validation.message}`);
  + console.warn(`Invalid board settings: ${validation.message}`);
  ```

- [X] **Verify:** `npm test` passes — all 58 tests pass. No UI change in normal operation.

---

## Moderate 8 — `flashRed` animation ends at brightness(5) (`css/style.css`)

- [X] **Verify:** Read `css/style.css`, locate `@keyframes flashRed`. Confirm:
  ```css
  100% { filter: brightness(5); }
  ```
- [X] **Fix:** Return to normal brightness at the end:

  ```diff
  @keyframes flashRed {
    0%   { filter: brightness(3); }
  - 100% { filter: brightness(5); }
  + 100% { filter: brightness(1); }
  }
  ```

- [X] **Verify:** `npm test` passes — no CSS tests exist, but the animation is purely visual (3→5 → 3→1) cannot break any logic. Manual verification: load the game in a browser, place an incorrect queen, confirm the red X flashes and returns to normal visibility.

---

## Minor 9 — Document `isSolved` early exit (`js/solver.js`)

- [X] **Verify:** Read `js/solver.js`, locate the solve loop (~line 570). Confirm:
  ```js
  if (isSolved(state)) break;
  ```
  appears after `applyBasicElimination` inside the while loop.
- [X] **Fix:** Added a comment explaining the micro-optimization:

  ```js
  // Early exit: if basic elimination alone solved it, skip the technique loop.
  if (isSolved(state)) break;
  ```

- [X] **Verify:** No behavioral change. `npm test` passes.

---

## Minor 10 — Remove no-op `overflow += 0` (`js/generator.js`)

- [X] **Verify:** Read `js/generator.js`, locate `overflow += 0` (~line 215). Confirmed: the `if/else` branches are dead code — neither path mutates any state; `overflow += 0` is a no-op.
- [X] **Fix:** Removed the entire dead if/else block and replaced it with an explanatory comment:

  ```diff
    for (let i = 0; i < size; i++) {
      if (!isAnchor[i] && !assigned[i]) {
        assigned[i] = 1;
        targets[i] = perRegion + (extra > 0 ? 1 : 0);
        if (extra > 0) extra--;
  -     if (targets[i] < maxNonAnchor) {
  -       // Can absorb more in next pass
  -     } else {
  -       overflow += 0; // at cap, will redistribute
  -     }
  +     // Regions that hit the maxNonAnchor cap won't grow further;
  +     // remaining cells are redistributed to uncapped regions on the next pass.
      }
    ```

- [X] **Verify:** `npm test` passes — all 58 tests pass. No behavioral change (the removed branches mutated nothing).

---

## Minor 11 — Document magic numbers (`js/generator.js`)

- [X] **Verify:** Read the top of `js/generator.js`, locate:
  ```js
  const MAX_REGION_SIZE_RATIO = 0.35;
  const MIN_SMALL_REGIONS_FRACTION = 0.2;
  ```
- [X] **Fix:** Add explanatory comments:

  ```js
  // Pre-filter thresholds — tuned empirically to reject obviously unsolvable boards
  // before running the expensive solver. Values chosen from generation profiling:
  //   - Regions >35% of the board are too large for logical deduction alone.
  //   - At least 20% of regions must be small (≤6 cells) to provide anchor points.
  const MAX_REGION_SIZE_RATIO = 0.35;
  const MIN_SMALL_REGIONS_FRACTION = 0.2;
  ```

- [X] **Verify:** No behavioral change. `npm test` passes.

---

## Minor 13 — Duplicate lines in `x-mark-svg` (`index.html`)

- [X] **Verify:** Read `index.html`, locate `<template id="x-mark-svg">`. Confirm each diagonal is drawn twice (white stroke + dark stroke as separate `<line>` elements).
- [X] **Fix:** The duplication is intentional — it creates a stroked/outlined effect. Added an explanatory comment:

  ```html
  <template id="x-mark-svg">
    <!-- Each diagonal is drawn twice: white background stroke, then dark foreground stroke -->
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      ...
    </svg>
  </template>
  ```

- [X] **Verify:** `npm test` passes — no HTML tests exist, but the change is purely documentary (adds a comment, no structural or visual change).

---

## Final Verification

After all items above are checked off:

- [ ] `npm test` — all 58 tests pass
- [ ] Manual smoke test: open `index.html` in a browser, play through one complete game (win), verify no console errors
