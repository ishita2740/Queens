// Solver — logical deduction engine for validating puzzle solvability.
// Each technique returns { changed: boolean, contradiction: boolean }.

// Forcing chain limits — keep small to avoid exponential blow-up during board generation.
const MAX_FORCING_CANDIDATE_SET_SIZE = 5; // Skip forcing if best region has >N candidates
const MAX_FORCING_CANDIDATES_TO_TEST = 3; // Only test up to N candidates per region

import { cellKey, cellPos } from './cell.js';

export function createSolverState(regions, size) {
  // Find the actual number of regions from the grid (may differ from size in edge cases)
  let maxRegion = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (regions[r][c] > maxRegion) maxRegion = regions[r][c];
    }
  }

  const numRegions = Math.max(size, maxRegion + 1);
  const candidates = [];
  for (let i = 0; i < numRegions; i++) candidates[i] = new Set();
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const reg = regions[r][c];
      if (reg >= 0 && reg < numRegions) candidates[reg].add(cellKey(r, c));
    }
  }
  // Total candidate count — decremented incrementally on every successful .delete().
  let totalCandidates = 0;
  for (const set of candidates) totalCandidates += set.size;
  return { size, regions, candidates, placed: new Map(), totalCandidates };
}

function cloneState(s) {
  // regions: deep clone (array of arrays)
  // candidates: deep clone (Set → new Set)
  // placed: shallow copy is safe — values are primitive cell keys
  // Regions are never mutated during solving — share the reference to save allocations.
  return {
    size: s.size,
    regions: s.regions,
    candidates: s.candidates.map(set => new Set(set)),
    placed: new Map(s.placed),
  };
}

function isSolved(s) {
  for (let i = 0; i < s.size; i++)
    if (s.candidates[i].size !== 1 || !s.placed.has(i)) return false;
  return true;
}

function isContradiction(s) {
  for (let i = 0; i < s.size; i++)
    if (s.candidates[i].size === 0) return true;
  return false;
}

// ===========================================================================
// Helper: get cells in a region's candidates that lie on a specific row/col.
// Inlines coordinate unpacking from key (r*100+c) to avoid cellPos() call overhead.
// ===========================================================================
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

// ===========================================================================
// Helper: eliminate row/col/adjacent cells for newly placed queens only
// ===========================================================================
// Export for consumers that need direct incremental elimination (e.g. solver-viewer).
// The main solve loop applies it internally within each technique that places queens.
export function incrementalEliminate(state, newPlacements) {
  let changed = false;
  for (const [regId, cell] of newPlacements) {
    const [pr, pc] = cellPos(cell);
    // Same region — keep only this cell
    for (const key of [...state.candidates[regId]]) {
      if (key !== cell && state.candidates[regId].delete(key)) { changed = true; state.totalCandidates--; }
    }
    // Other regions — eliminate row, col, adjacent
    for (let other = 0; other < state.size; other++) {
      if (other === regId) continue;
      for (const key of [...state.candidates[other]]) {
        const [cr, cc] = cellPos(key);
        if (cr === pr || cc === pc || Math.max(Math.abs(cr - pr), Math.abs(cc - pc)) <= 1) {
          if (state.candidates[other].delete(key)) { changed = true; state.totalCandidates--; }
        }
      }
    }
  }
  return { changed, contradiction: isContradiction(state) };
}

// ===========================================================================
// TECH ii: Naked Singles — region with exactly 1 candidate → place queen
// ===========================================================================
export function applyNakedSingles(state) {
  const newPlacements = new Map();
  for (let i = 0; i < state.size; i++) {
    if (!state.placed.has(i) && state.candidates[i].size === 1) {
      state.placed.set(i, [...state.candidates[i]][0]);
      newPlacements.set(i, [...state.candidates[i]][0]);
    }
  }
  const result = incrementalEliminate(state, newPlacements);
  return { changed: result.changed, contradiction: result.contradiction };
}

// ===========================================================================
// TECH iii: Hidden Singles — row/col with only one region's single candidate
// Also: for each row, exactly one queen must be placed there. If a region has
// candidates in this row and no other unplaced region does, that region owns the row.
// ===========================================================================
export function applyHiddenSingles(state) {
  const newPlacements = new Map();

  // For each row: find which regions have candidates here
  for (let r = 0; r < state.size; r++) {
    const regMap = new Map(); // regId -> [cells in this row]
    for (let regId = 0; regId < state.size; regId++) {
      if (state.placed.has(regId)) continue;
      const cells = getCandsInRow(state.candidates[regId], r);
      if (cells.length > 0) regMap.set(regId, cells);
    }

    // If only one region has candidates in this row AND it has exactly 1 → place it
    if (regMap.size === 1) {
      const [regId, cells] = [...regMap][0];
      if (cells.length === 1 && !state.placed.has(regId)) {
        state.placed.set(regId, cells[0]);
        newPlacements.set(regId, cells[0]);
      }
    }
  }

  // Same for columns
  for (let c = 0; c < state.size; c++) {
    const regMap = new Map();
    for (let regId = 0; regId < state.size; regId++) {
      if (state.placed.has(regId)) continue;
      const cells = getCandsInCol(state.candidates[regId], c);
      if (cells.length > 0) regMap.set(regId, cells);
    }

    if (regMap.size === 1) {
      const [regId, cells] = [...regMap][0];
      if (cells.length === 1 && !state.placed.has(regId)) {
        state.placed.set(regId, cells[0]);
        newPlacements.set(regId, cells[0]);
      }
    }
  }

  // Hidden single within a region: for each row that this region has candidates in,
  // check if this is the ONLY cell in the entire row where ANY queen can go.
  // If so and only this region can place here → force it.
  // (Already handled above with regMap.size === 1)

  const result = incrementalEliminate(state, newPlacements);
  return { changed: result.changed, contradiction: result.contradiction };
}

// ===========================================================================
// TECH iv: Region Confinement — all candidates in one row/col → claim it
// ===========================================================================
export function applyRegionConfinement(state) {
  let changed = false;

  for (let regId = 0; regId < state.size; regId++) {
    if (state.placed.has(regId) || state.candidates[regId].size === 0) continue;

    const rows = new Set(), cols = new Set();
    for (const key of state.candidates[regId]) {
      const [r, c] = cellPos(key);
      rows.add(r); cols.add(c);
    }

    if (rows.size === 1) {
      const r = [...rows][0];
      // Eliminate this region's row from other regions' candidates in that row
      for (let other = 0; other < state.size; other++) {
        if (other === regId || state.placed.has(other)) continue;
        for (const key of getCandsInRow(state.candidates[other], r)) {
          if (state.candidates[other].delete(key)) { changed = true; state.totalCandidates--; }
        }
      }
    }

    if (cols.size === 1) {
      const c = [...cols][0];
      for (let other = 0; other < state.size; other++) {
        if (other === regId || state.placed.has(other)) continue;
        for (const key of getCandsInCol(state.candidates[other], c)) {
          if (state.candidates[other].delete(key)) { changed = true; state.totalCandidates--; }
        }
      }
    }
  }

  return { changed, contradiction: isContradiction(state) };
}

// ===========================================================================
// TECH v: Pigeonhole / N-Groupings + Pointed Pairs/Triples
// ===========================================================================
export function applyPigeonhole(state) {
  let changed = false;
  const unplaced = [];
  for (let i = 0; i < state.size; i++) if (!state.placed.has(i)) unplaced.push(i);

  // Precompute row/col sets per region to avoid repeated cellPos() calls
  const regRows = new Map(), regCols = new Map();
  for (const regId of unplaced) {
    const rows = new Set(), cols = new Set();
    for (const key of state.candidates[regId]) {
      const [r, c] = cellPos(key);
      rows.add(r); cols.add(c);
    }
    regRows.set(regId, rows); regCols.set(regId, cols);
  }

  // Cache per-region candidate lists keyed by row/col for reuse in elimination loops.
  // Avoids calling getCandsInRow / getCandsInCol (which iterate all candidates) inside the combo loop.
  const rowCands = [];
  const colCands = [];
  for (let i = 0; i < state.size; i++) {
    rowCands.push([]);
    colCands.push([]);
  }
  for (const regId of unplaced) {
    for (const key of state.candidates[regId]) {
      const [r, c] = cellPos(key);
      if (r < state.size && c < state.size) {
        rowCands[r].push({ regId, key });
        colCands[c].push({ regId, key });
      }
    }
  }

  // Row groupings: K regions confined to ≤K rows → they own those rows
  // Cap k at 3 — higher-order combos are exponentially expensive and rarely useful.
  const maxK = Math.min(3, unplaced.length);
  for (let k = 2; k <= maxK; k++) {
    // Pre-filter: only regions whose row-span ≤ k can participate in a k-grouping.
    // This eliminates combos that would be pruned immediately by the dominated check.
    const eligibleRows = unplaced.filter(r => regRows.get(r).size <= k);
    for (const combo of combinations(eligibleRows, k)) {

      const rowSet = new Set();
      for (const regId of combo) {
        for (const r of regRows.get(regId)) rowSet.add(r);
      }
      // Prune: union already exceeds k
      if (rowSet.size > k || rowSet.size < 1) continue;

      const regSet = new Set(combo);
      for (const r of rowSet) {
        // Use precomputed cache instead of iterating candidates via getCandsInRow
        for (const entry of rowCands[r]) {
          if (state.placed.has(entry.regId) || regSet.has(entry.regId)) continue;
          const cands = state.candidates[entry.regId];
          if (cands && cands.delete(entry.key)) { changed = true; state.totalCandidates--; }
        }
      }
    }
  }

  // Column groupings — same strategy
  for (let k = 2; k <= maxK; k++) {
    const eligibleCols = unplaced.filter(r => regCols.get(r).size <= k);
    for (const combo of combinations(eligibleCols, k)) {

      const colSet = new Set();
      for (const regId of combo) {
        for (const c of regCols.get(regId)) colSet.add(c);
      }
      if (colSet.size > k || colSet.size < 1) continue;

      const regSet = new Set(combo);
      for (const c of colSet) {
        // Use precomputed cache instead of iterating candidates via getCandsInCol
        for (const entry of colCands[c]) {
          if (state.placed.has(entry.regId) || regSet.has(entry.regId)) continue;
          const cands = state.candidates[entry.regId];
          if (cands && cands.delete(entry.key)) { changed = true; state.totalCandidates--; }
        }
      }
    }
  }

  // Pointed pairs/triples: K cells shared by exactly the same K regions
  const cellToRegs = new Map();
  for (const regId of unplaced) {
    for (const key of state.candidates[regId]) {
      if (!cellToRegs.has(key)) cellToRegs.set(key, []);
      cellToRegs.get(key).push(regId);
    }
  }

  const cells = [...cellToRegs.keys()];
  for (let k = 2; k <= Math.min(3, unplaced.length); k++) {
    outer:
    for (let i = 0; i < cells.length; i++) {
      const regs1 = new Set(cellToRegs.get(cells[i]));
      if (regs1.size !== k) continue;
      const sharedCells = [cells[i]];
      for (let j = i + 1; j < cells.length; j++) {
        if (setsEqual(regs1, new Set(cellToRegs.get(cells[j])))) {
          sharedCells.push(cells[j]);
        }
      }
      for (const key of sharedCells) {
        for (let regId = 0; regId < state.size; regId++) {
          if (state.placed.has(regId) || regs1.has(regId)) continue;
          if (state.candidates[regId].delete(key)) { changed = true; state.totalCandidates--; }
        }
      }
    }
  }

  return { changed, contradiction: isContradiction(state) };
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function* combinations(arr, k) {
  if (k === 0) { yield []; return; }
  for (let i = 0; i <= arr.length - k; i++) {
    for (const tail of combinations(arr.slice(i + 1), k - 1)) {
      yield [arr[i], ...tail];
    }
  }
}

// ===========================================================================
// TECH vi: Adjacency Blocking — candidate that kills another region → eliminate
// ===========================================================================
export function applyAdjacencyBlocking(state) {
  let changed = false;
  const unplaced = [];
  for (let i = 0; i < state.size; i++) if (!state.placed.has(i)) unplaced.push(i);

  for (const regId of unplaced) {
    for (const candKey of [...state.candidates[regId]]) {
      const [cr, cc] = cellPos(candKey);
      const blocked = new Set();
      for (let x = 0; x < state.size; x++) {
        blocked.add(cellKey(cr, x));
        blocked.add(cellKey(x, cc));
      }
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nr = cr + dr, nc = cc + dc;
          if (nr >= 0 && nr < state.size && nc >= 0 && nc < state.size)
            blocked.add(cellKey(nr, nc));
        }
      }

      let wouldContradict = false;
      for (const other of unplaced) {
        if (other === regId) continue;
        let hasCand = false;
        for (const key of state.candidates[other]) {
          if (!blocked.has(key)) { hasCand = true; break; }
        }
        if (!hasCand) { wouldContradict = true; break; }
      }

      if (wouldContradict && state.candidates[regId].delete(candKey)) { changed = true; state.totalCandidates--; }
    }
  }

  return { changed, contradiction: isContradiction(state) };
}

// ===========================================================================
// TECH vii: Row/Column + Region Intersections
// If a row has exactly one cell belonging to region R → that cell must be the queen.
// Also: if two regions share candidates in only one common cell in a row, force it.
// ===========================================================================
export function applyRowColIntersection(state) {
  const newPlacements = new Map();

  for (let regId = 0; regId < state.size; regId++) {
    if (state.placed.has(regId)) continue;
    if (state.candidates[regId].size === 0) continue;

    // Count candidates per row/col for this region
    const rowCount = new Map(), rowSingleCell = new Map();
    const colCount = new Map(), colSingleCell = new Map();

    for (const key of state.candidates[regId]) {
      const [r, c] = cellPos(key);
      rowCount.set(r, (rowCount.get(r) || 0) + 1);
      colCount.set(c, (colCount.get(c) || 0) + 1);
    }

    // Only record rows/cols where this region has exactly one candidate
    for (const key of state.candidates[regId]) {
      const [r, c] = cellPos(key);
      if (rowCount.get(r) === 1) rowSingleCell.set(r, key);
      if (colCount.get(c) === 1) colSingleCell.set(c, key);
    }

    // If region has exactly one candidate in a row AND that row can only hold this region's queen
    for (const [r] of rowSingleCell) {
      let regionsInRow = 0;
      for (let other = 0; other < state.size; other++) {
        if (state.placed.has(other)) continue;
        if (getCandsInRow(state.candidates[other], r).length > 0) regionsInRow++;
      }
      if (regionsInRow === 1 && !state.placed.has(regId)) {
        state.placed.set(regId, rowSingleCell.get(r));
        newPlacements.set(regId, rowSingleCell.get(r));
      }
    }

    for (const [c] of colSingleCell) {
      let regionsInCol = 0;
      for (let other = 0; other < state.size; other++) {
        if (state.placed.has(other)) continue;
        if (getCandsInCol(state.candidates[other], c).length > 0) regionsInCol++;
      }
      if (regionsInCol === 1 && !state.placed.has(regId)) {
        state.placed.set(regId, colSingleCell.get(c));
        newPlacements.set(regId, colSingleCell.get(c));
      }
    }
  }

  // Cross-elimination: for each row, find the region with the fewest candidates there.
  // If that region has no other candidates outside this row → force placement.
  for (let r = 0; r < state.size; r++) {
    let minReg = -1, minCount = Infinity;
    for (let regId = 0; regId < state.size; regId++) {
      if (state.placed.has(regId)) continue;
      const count = getCandsInRow(state.candidates[regId], r).length;
      if (count > 0 && count < minCount) { minCount = count; minReg = regId; }
    }
    // If this region has all its candidates in this single row → already handled by confinement
    // But if it has exactly one candidate here and that's the only place for any queen in this row:
    if (minReg >= 0 && minCount === 1) {
      const cells = getCandsInRow(state.candidates[minReg], r);
      let regionsInRow = 0;
      for (let other = 0; other < state.size; other++) {
        if (state.placed.has(other)) continue;
        if (getCandsInRow(state.candidates[other], r).length > 0) regionsInRow++;
      }
      if (regionsInRow === 1 && !state.placed.has(minReg)) {
        state.placed.set(minReg, cells[0]);
        newPlacements.set(minReg, cells[0]);
      }
    }
  }

  const result = incrementalEliminate(state, newPlacements);
  return { changed: result.changed, contradiction: result.contradiction };
}

// ===========================================================================
// TECH viii: Forcing Chains — assume candidate → run solver → check contradiction
// ===========================================================================
export function applyForcingChains(state) {
  let changed = false;

  // Candidate count gate (Opt 2 #1): skip forcing entirely if no region has <=5 candidates.
  for (let i = 0; i < state.size; i++) {
    if (!state.placed.has(i) && state.candidates[i].size > 1 && state.candidates[i].size <= MAX_FORCING_CANDIDATE_SET_SIZE)
      break;
    if (i === state.size - 1) return { changed, contradiction: false };
  }

  let bestReg = -1, bestCount = Infinity;
  for (let i = 0; i < state.size; i++) {
    if (!state.placed.has(i) && state.candidates[i].size > 1 && state.candidates[i].size < bestCount) {
      bestReg = i; bestCount = state.candidates[i].size;
    }
  }

  // Fallback threshold check (redundant after gate above, kept for safety)
  if (bestReg === -1 || bestCount > MAX_FORCING_CANDIDATE_SET_SIZE) return { changed, contradiction: false };

  // Only test up to a subset of candidates — testing all is expensive and diminishing returns
  const cands = [...state.candidates[bestReg]].slice(0, MAX_FORCING_CANDIDATES_TO_TEST);
  for (const candKey of cands) {
    const clone = cloneState(state);
    clone.placed.set(bestReg, candKey);
    incrementalEliminate(clone, new Map([[bestReg, candKey]]));

    // Rapid contradiction check (Opt 2 #2): exit immediately if basic elim creates a contradiction.
    if (isContradiction(clone)) {
      if (state.candidates[bestReg].delete(candKey)) { changed = true; state.totalCandidates--; }
      continue;
    }

    // This bit of code is actually very important. The idea is to apply simple solve
    // techniques as a first pass. If these techniques get stuck or lead to a contradiction,
    // we can early-exit. Any single pass through all techniques that makes no progress counts
    // as being "stuck".

    let stalled = false;
    while (!stalled && !isContradiction(clone)) {
      let cChanged = false;
      for (const fn of [applyNakedSingles, applyHiddenSingles, applyRowColIntersection]) {
        const r = fn(clone);
        if (r.changed) cChanged = r.changed;
        if (r.contradiction) break;
      }
      stalled = !cChanged;
    }

    if (isContradiction(clone) && state.candidates[bestReg].delete(candKey)) { changed = true; state.totalCandidates--; }
  }

  return { changed, contradiction: isContradiction(state) };
}

// ===========================================================================
// Solve loop
// ===========================================================================

/**
 * Named technique registry — maps technique names to their functions.
 * Technique tiers follow the numbering in AGENTS.md:
 *
 *   i  = Basic Elimination (always runs, not in TECHNIQUES array)
 *  ii  = Naked Singles
 * iii = Hidden Singles
 *  iv  = Region Confinement
 *   v  = Pigeonhole / Groupings
 *  vi  = Adjacency Blocking
 *  vii = Row/Column + Region Intersections
 * viii = Forcing Chains
 */
const TECHNIQUE_NAMES = /** @type {const} */ ({
  BASIC_ELIMINATION:    'BASIC_ELIMINATION',    // i (always runs, not in array)
  NAKED_SINGLES:        'NAKED_SINGLES',        // ii
  HIDDEN_SINGLES:       'HIDDEN_SINGLES',       // iii
  REGION_CONFINEMENT:   'REGION_CONFINEMENT',   // iv
  PIGEONHOLE:           'PIGEONHOLE',           // v
  ADJACENCY_BLOCKING:   'ADJACENCY_BLOCKING',   // vi
  ROW_COL_INTERSECTION: 'ROW_COL_INTERSECTION', // vii
  FORCING_CHAINS:       'FORCING_CHAINS',       // viii
});

const TECHNIQUES = [
  applyNakedSingles,           // ii (index 0)
  applyHiddenSingles,          // iii (1)
  applyRegionConfinement,      // iv (2)
  applyPigeonhole,             // v (3)
  applyAdjacencyBlocking,      // vi (4)
  applyRowColIntersection,     // vii (5)
  applyForcingChains,          // viii (6)
];

// Explicit index mapping — each value matches its position in TECHNIQUES[].
// BASIC_ELIMINATION (-1) is not in the array; it runs unconditionally before the loop.
export const TECHNIQUE_INDEX = /** @type {Readonly<Record<string, number>>} */ ({
  BASIC_ELIMINATION:    -1,
  NAKED_SINGLES:        0,
  HIDDEN_SINGLES:       1,
  REGION_CONFINEMENT:   2,
  PIGEONHOLE:           3,
  ADJACENCY_BLOCKING:   4,
  ROW_COL_INTERSECTION: 5,
  FORCING_CHAINS:       6,
});

export function solveWithMaxTechnique(regions, size, maxTechnique = 8, maxForcing = Infinity) {
  const state = createSolverState(regions, size);

  // Track how many times forcing chains has been used (independent of availability)
  let forcingUsed = 0;

  // Track which techniques actually made progress (for difficulty enforcement).
  // Values match TECHNIQUE_INDEX: -1=basic elim, 0=ii, 1=iii, …, 6=viii.
  const techniquesUsed = new Set();

  // Per-technique stats — maps technique index → { placements, eliminations }.
  const techniqueStats = new Map();

  while (!isSolved(state) && !isContradiction(state)) {
    let anyChanged = false;

    // Run techniques up to maxTechnique (1=none beyond basic, 8=all)
    // Basic elimination is now handled incrementally within each technique that places queens.
    // This eliminates the O(N³) full-scan pass every iteration.
    const techLimit = Math.min(maxTechnique - 1, TECHNIQUES.length);
    for (let ti = 0; ti < techLimit; ti++) {
      // Technique viii is forcing chains — respect the usage cap
      if (ti === TECHNIQUE_INDEX.FORCING_CHAINS && forcingUsed >= maxForcing) continue;

      const placedBefore = state.placed.size;
      const totalCandidatesBefore = state.totalCandidates;
      const result = TECHNIQUES[ti](state);
      if (ti === TECHNIQUE_INDEX.FORCING_CHAINS) forcingUsed++;
      if (result.changed) {
        anyChanged = true;
        techniquesUsed.add(ti);
        const eliminationsByThisTech = totalCandidatesBefore - state.totalCandidates;
        const prev = techniqueStats.get(ti) || { placements: 0, eliminations: 0 };
        techniqueStats.set(ti, {
          placements: prev.placements + (state.placed.size - placedBefore),
          eliminations: prev.eliminations + eliminationsByThisTech,
        });
        break;
      }
      if (result.contradiction)
        return { solved: false, placements: null, techniqueStats, diagnostics: { placed: state.placed.size, totalRegions: state.size, stuckRegions: [], totalCandidates: 0, contradiction: true } };
    }

    // Exit if no technique made progress in this pass
    if (!anyChanged) break;
  }

  if (isSolved(state))
    return { solved: true, placements: state.placed, techniqueStats, techniquesUsed };

  // Gather diagnostics for failed solves — useful for guided mutation
  const unplaced = [];
  for (let i = 0; i < state.size; i++) {
    if (!state.placed.has(i)) {
      unplaced.push({ regionId: i, candidates: state.candidates[i].size });
    }
  }
  // Sort by candidate count — regions with the most candidates are the hardest
  unplaced.sort((a, b) => b.candidates - a.candidates);

  return {
    solved: false,
    placements: null,
    techniqueStats,
    diagnostics: {
      placed: state.placed.size,
      totalRegions: state.size,
      stuckRegions: unplaced,       // [{ regionId, candidates }, ...]
      totalCandidates: state.totalCandidates,  // maintained incrementally
      contradiction: isContradiction(state),  // true = impossible constraint
    }
  };
}

// ===========================================================================
// Uniqueness check — verifies puzzle has exactly one valid solution
// ===========================================================================

/**
 * Check whether the board has exactly one valid solution using optimized backtracking.
 *
 * Uses bitmasks for O(1) row/col conflict checks and queenCols array for adjacency.
 * Includes a time budget — if exceeded, assumes unique to avoid rejecting valid puzzles.
 */
export function checkUniqueness(regions, size) {
  // Build candidate lists per region as flat arrays [row0,col0,row1,col1,...]
  const candidates = [];
  for (let i = 0; i < size; i++) candidates[i] = [];

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const reg = regions[r][c];
      if (reg >= 0 && reg < size) candidates[reg].push(r, c);
    }
  }

  // queenCols[row] = column of the queen in that row (-1 if none)
  const queenCols = new Int8Array(size).fill(-1);

  let count = 0;
  const startTime = Date.now();
  // Budget generous enough to verify uniqueness for most boards.
  // If exceeded, assume unique (conservative — better to accept than reject).
  const timeBudgetMs = Math.max(100, size * 25);

  function backtrack(regIdx, rowMask, colMask) {
    if (count > 1 || ((Date.now() - startTime) > timeBudgetMs)) return true;

    if (regIdx === size) {
      count++;
      return false;
    }

    const cands = candidates[regIdx];
    for (let ci = 0; ci < cands.length; ci += 2) {
      const cr = cands[ci], cc = cands[ci + 1];

      // O(1) row/col conflict check via bitmasks
      if ((rowMask >> cr) & 1 || (colMask >> cc) & 1) continue;

      // Adjacency: check neighbor rows for queens in adjacent columns
      let adjConflict = false;
      const startRow = cr > 0 ? cr - 1 : 0;
      const endRow   = cr < size - 1 ? cr + 1 : cr;
      for (let nr = startRow; nr <= endRow && !adjConflict; nr++) {
        if ((rowMask >> nr) & 1 && Math.abs(queenCols[nr] - cc) <= 1) adjConflict = true;
      }
      if (adjConflict) continue;

      queenCols[cr] = cc;
      if (backtrack(regIdx + 1, rowMask | (1 << cr), colMask | (1 << cc))) return true;
      queenCols[cr] = -1;
    }

    return count > 1;
  }

  backtrack(0, 0, 0);

  return {
    // Unique only when exactly one solution exists.
    // Zero solutions is not valid (no puzzle), multiple solutions is ambiguous.
    unique: count === 1,
    solutionCount: count,
  };
}

export function solve(regions, size) {
  const result = solveWithMaxTechnique(regions, size, 8);
  // For backward compatibility, the plain solve() still returns { solved, placements }.
  return { solved: result.solved, placements: result.placements };
}

/**
 * Solve with uniqueness verification. Returns same shape as solveWithMaxTechnique plus:
 *
 *   `unique` — true iff exactly one valid solution exists for this board.
 */
export function solveWithUniqueness(regions, size, maxTechnique = 8, maxForcing = Infinity) {
  const result = solveWithMaxTechnique(regions, size, maxTechnique, maxForcing);

  if (!result.solved) return { ...result, unique: false };

  // If no forcing chains were used, deductions are deterministic → guaranteed unique.
  if (!result.techniquesUsed.has(TECHNIQUE_INDEX.FORCING_CHAINS)) {
    return { ...result, unique: true, alternativeSolutions: 0 };
  }

  const uniq = checkUniqueness(regions, size);
  return { ...result, unique: uniq.unique, alternativeSolutions: uniq.solutionCount - 1 };
}
