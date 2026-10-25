// Board Generator — produces valid, solvable Queens puzzles.
// Strategy: design regions around a known queen placement so that logical deduction
// can recover the solution. Regions are shaped to create tight constraints.

import { createRng, rngInt, rngFloat, rngShuffle } from './prng.js';
import { cellKey } from './cell.js';
import { solveWithUniqueness, TECHNIQUE_INDEX } from './solver.js';

export const Difficulty = Object.freeze({
  EASY: 'easy',
  MEDIUM: 'medium',
  HARD: 'hard',
});

// Pre-filter thresholds — tuned empirically to reject obviously unsolvable boards
// before running the expensive solver. Values chosen from generation profiling:
//   - Regions >35% of the board are too large for logical deduction alone.
//   - At least 20% of regions must be small (≤6 cells) to provide anchor points.
const MAX_REGION_SIZE_RATIO = 0.35;
const MIN_SMALL_REGIONS_FRACTION = 0.2;

// Each difficulty specifies:
//   maxTechnique — highest solver technique allowed (1–8)
//   minAdvancedFraction — fraction of total eliminations+placements that must come from
//                         advanced techniques (index >= minTechnique, excluding forcing chains)
//   maxForcing   — how many times forcing chains (tech viii) may fire
const DIFF_CONFIG = {
  [Difficulty.EASY]:   { maxTechnique: 5, maxForcing: 0 },
  [Difficulty.MEDIUM]: { maxTechnique: 6, maxForcing: 1 },
  [Difficulty.HARD]:  { maxTechnique: 8, maxForcing: 2 },
};

/**
 * Generate a complete puzzle. Retries until solver can solve it.
 */
export function generateBoard(size, difficulty = Difficulty.HARD, seed = null) {
  if (seed === null) {
    seed = Math.floor(Math.random() * 2 ** 31);
  }

  let attempt = 0;
  // Larger boards need more attempts to find valid configurations.
  let maxAttempts;
  // Hard difficulty on large boards needs more attempts due to stricter isHardEnough check
  // and uniqueness verification (rejects boards with multiple valid solutions).
  const hardFactor = difficulty === 'hard' ? 4 : 1;
  if (size >= 12) maxAttempts = 80000 * hardFactor;
  else if (size >= 9) maxAttempts = 30000 * hardFactor;
  else maxAttempts = 20000;

  while (attempt < maxAttempts) {
    const rng = createRng(seed + attempt * 1000);

    const solution = generateQueenPlacement(size, rng);
    if (!solution) { attempt++; continue; }

    const regions = designRegions(size, solution, difficulty, rng);
    if (!regions) { attempt++; continue; }

    // Validate: all cells assigned, all regions connected
    if (!validateRegions(regions, size)) { attempt++; continue; }

    // Validate solvability within the difficulty's constraints
    const config = DIFF_CONFIG[difficulty];
    const minTech = getMinTechnique(difficulty, size);

    // Cheap pre-filter — reject obviously bad boards before running the solver
    if (!preFilter(regions, size)) { attempt++; continue; }

    const result = solveWithUniqueness(regions, size, config.maxTechnique, config.maxForcing);
    if (result.solved && result.unique) {
      // Verify solver's placements match the original answer key.
      let solutionMatches = true;
      for (let i = 0; i < size && solutionMatches; i++) {
        const expectedKey = cellKey(solution[i][0], solution[i][1]);
        if (!result.placements.has(i) || result.placements.get(i) !== expectedKey) {
          solutionMatches = false;
        }
      }
      if (!solutionMatches) { attempt++; continue; }

      // Check that the board actually requires techniques at or above minTechnique.
      if (isHardEnough(result.techniqueStats, result.placements.size, minTech)) {
        return { regions, solution, seed: seed + attempt * 1000 };
      }
      // Board is too easy — try loosening mutations before discarding
      const loosenResult = tryLoosenAndSolve(regions, size, difficulty, config, minTech, rng);
      if (loosenResult) {
        return { regions: loosenResult.regions, solution: loosenResult.solution, seed: seed + attempt * 1000 };
      }
    }

    // If the solver got close, try mutating the board instead of starting over
    const diag = result.diagnostics;
    if (diag && isCloseEnough(diag, size)) {
      let mutations = 0;
      const maxMutations = 10;
      while (mutations < maxMutations) {
        mutateRegions(regions, size, diag.stuckRegions, rng);
        if (!validateRegions(regions, size)) { mutations++; continue; }
        const mutatedResult = solveWithUniqueness(regions, size, config.maxTechnique, config.maxForcing);
        if (mutatedResult.solved && mutatedResult.unique) {
          if (isHardEnough(mutatedResult.techniqueStats, mutatedResult.placements.size, minTech)) {
            const newSolution = new Array(size);
            for (const [regId, cellKey] of mutatedResult.placements) {
              const key = Number(cellKey);
              newSolution[Number(regId)] = [Math.floor(key / 100), key % 100];
            }
            return { regions, solution: newSolution, seed: seed + attempt * 1000 };
          }
        }
        mutations++;
      }
    }

    attempt++;
  }

  throw new Error(
    `Failed to generate solvable ${size}x${size} puzzle (${difficulty}) after ${maxAttempts} attempts`
  );
}

// ===========================================================================
// Guided mutation — fix "close" boards instead of discarding them
// ===========================================================================

/**
 * Is this failed board close enough to bother mutating?
 */
function isCloseEnough(diag, size) {
  if (diag.contradiction) return false;
  const placedFraction = diag.placed / diag.totalRegions;
  if (placedFraction < 0.5) return false;
  const maxCandidates = size * 6;
  if (diag.totalCandidates > maxCandidates) return false;
  return true;
}

/**
 * Mutate region boundaries to tighten constraints on stuck regions.
 */
function mutateRegions(regions, size, stuckRegions, rng) {
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  const targetIdx = rngInt(rng, 0, Math.min(3, stuckRegions.length));
  const targetRegion = stuckRegions[targetIdx].regionId;

  const cells = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (regions[r][c] === targetRegion) cells.push([r, c]);
    }
  }

  if (cells.length <= 1) return;

  const boundaryCells = [];
  for (const [r, c] of cells) {
    for (const [dr, dc] of dirs) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < size && nc >= 0 && nc < size && regions[nr][nc] !== targetRegion) {
        boundaryCells.push([r, c]);
        break;
      }
    }
  }

  if (boundaryCells.length === 0) return;

  const [mr, mc] = boundaryCells[rngInt(rng, 0, boundaryCells.length)];

  const adjRegions = new Set();
  for (const [dr, dc] of dirs) {
    const nr = mr + dr, nc = mc + dc;
    if (nr >= 0 && nr < size && nc >= 0 && nc < size && regions[nr][nc] !== targetRegion) {
      adjRegions.add(regions[nr][nc]);
    }
  }

  if (adjRegions.size === 0) return;

  const newRegion = [...adjRegions][rngInt(rng, 0, adjRegions.size)];
  regions[mr][mc] = newRegion;
}

// ===========================================================================
// Queen Placement (backtracking with random ordering)
// ===========================================================================

function generateQueenPlacement(size, rng) {
  const usedCols = new Set();
  const placedQueens = [];

  function backtrack(row) {
    if (row === size) return true;
    const available = [];
    for (let c = 0; c < size; c++) if (!usedCols.has(c)) available.push(c);
    rngShuffle(available, rng);

    for (const col of available) {
      let ok = true;
      for (const [pr, pc] of placedQueens) {
        if (Math.max(Math.abs(pr - row), Math.abs(pc - col)) <= 1) { ok = false; break; }
      }
      if (!ok) continue;
      usedCols.add(col);
      placedQueens.push([row, col]);
      if (backtrack(row + 1)) return true;
      usedCols.delete(col);
      placedQueens.pop();
    }
    return false;
  }

  if (backtrack(0)) return placedQueens.map((q) => [...q]);
  return null;
}

// ===========================================================================
// Region Design — anchor-based growth for guaranteed solvability
// ===========================================================================

/**
 * Design N connected regions that are provably solvable by logical deduction.
 *
 * Strategy: create "anchor" regions (size 2-3) confined to their queen's row.
 * These anchors become naked singles after basic elimination, triggering a
 * cascade of deductions that solves the rest of the board.
 *
 * Non-anchor regions absorb remaining cells but are kept small enough for
 * advanced techniques to resolve them.
 */
function designRegions(size, solution, difficulty, rng) {
  const totalCells = size * size;

  // Number and sizes of anchor regions depend on difficulty.
  // Anchors are tiny (2-3 cells), confined to their queen's row → naked singles.
  let nAnchors, maxNonAnchor, nAdjust;

  // Fewer anchors + larger non-anchors → harder boards (larger regions require
  // advanced techniques like adjacency blocking). But too few anchors produces
  // unsolvable boards — stay at the solvability boundary.
  switch (difficulty) {
    case 'easy':
      nAdjust = 0.5;
      break;
    case 'hard':
      nAdjust = 0.3;
      break;
    default: // medium
      nAdjust = 0.4;
      break;
  }

  nAnchors = Math.ceil(size * nAdjust);
  maxNonAnchor = ((size * size) - (2 * nAnchors)) / (size - nAnchors);

  // Pick anchor regions (random subset)
  const indices = rngShuffle(Array.from({ length: size }, (_, i) => i), rng);
  const isAnchor = new Uint8Array(size);
  for (let i = 0; i < nAnchors; i++) isAnchor[indices[i]] = 1;

  // Assign target sizes
  const targets = new Array(size);
  let anchorBudget = 0;
  for (let i = 0; i < size; i++) {
    if (isAnchor[i]) {
      targets[i] = 2 + rngInt(rng, 0, 2); // 2-3 cells
      anchorBudget += targets[i];
    }
  }

  // For easy mode with all anchors: make most very small (2-4), a few larger.
  // Small anchors become naked singles → cascading deductions solve the board.
  if (nAnchors === size) {
    const nSmall = Math.max(size - 3, Math.ceil(size * 0.7));
    const smallSize = 2 + rngInt(rng, 0, 2); // 2-4
    const smallBudget = nSmall * smallSize;
    const remaining = totalCells - smallBudget;
    const absorberCount = size - nSmall;

    for (let i = 0; i < size; i++) {
      if (i < nSmall) {
        targets[i] = smallSize;
      } else {
        const perAbsorber = absorberCount > 0 ? Math.floor(remaining / absorberCount) : 0;
        const extra = absorberCount > 0 ? remaining - perAbsorber * absorberCount : 0;
        targets[i] = perAbsorber + ((i >= size - extra) ? 1 : 0);
      }
    }
    // Shuffle so small/large aren't clustered by index
    const shuffledTargets = rngShuffle([...targets], rng);
    for (let i = 0; i < size; i++) targets[i] = shuffledTargets[i];
    anchorBudget = totalCells;
  }

  let remainingCells = totalCells - anchorBudget;
  const nNonAnchors = size - nAnchors;

  if (nNonAnchors > 0) {
    // Distribute remaining among non-anchors, capped at maxNonAnchor.
    // If cap is hit, overflow goes to other non-anchors.
    let overflow = 0;
    const assigned = new Uint8Array(size);
    
    for (let pass = 0; pass < 3 && (remainingCells > 0 || overflow > 0); pass++) {
      let perRegion = Math.floor((remainingCells + overflow) / nNonAnchors);
      perRegion = Math.min(perRegion, maxNonAnchor);
      let extra = (remainingCells + overflow) - perRegion * nNonAnchors;
      
      for (let i = 0; i < size; i++) {
        if (!isAnchor[i] && !assigned[i]) {
          assigned[i] = 1;
          targets[i] = perRegion + (extra > 0 ? 1 : 0);
          if (extra > 0) extra--;
          // Regions that hit the maxNonAnchor cap won't grow further;
          // remaining cells are redistributed to uncapped regions on the next pass.
        }
      }
      remainingCells = totalCells - anchorBudget;
      for (let i = 0; i < size; i++) if (!isAnchor[i]) remainingCells -= targets[i];
    }
    
    // Final adjustment: ensure exact sum
    let actualSum = anchorBudget;
    for (let i = 0; i < size; i++) if (!isAnchor[i]) actualSum += targets[i];
    let diff = totalCells - actualSum;
    // Add/subtract from largest non-anchor
    for (let i = 0; i < size && diff !== 0; i++) {
      if (!isAnchor[i]) {
        targets[i] += diff;
        diff = 0;
      }
    }
  } else {
    // All anchors — distribute remaining among them
    const perAnchor = Math.floor(remainingCells / nAnchors);
    let extra = remainingCells - perAnchor * nAnchors;
    for (let i = 0; i < size; i++) {
      if (isAnchor[i]) {
        targets[i] += perAnchor + (extra > 0 ? 1 : 0);
        if (extra > 0) extra--;
      }
    }
  }

  // Build the grid using BFS growth from queen positions.
  // Anchor regions grow first and are confined to their queen's row.
  const regions = Array.from({ length: size }, () => new Array(size).fill(-1));
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  // Seed all queen positions
  for (let i = 0; i < size; i++) {
    regions[solution[i][0]][solution[i][1]] = i;
  }

  // Build initial frontier for each region
  const frontier = new Array(size);
  for (let i = 0; i < size; i++) {
    const [qr, qc] = solution[i];
    frontier[i] = [];
    for (const [dr, dc] of dirs) {
      const nr = qr + dr, nc = qc + dc;
      if (nr >= 0 && nr < size && nc >= 0 && nc < size && regions[nr][nc] === -1) {
        frontier[i].push(nr * size + nc);
      }
    }
  }

  // Grow order: anchors first, then non-anchors sorted by target size (smallest first)
  const growOrder = [];
  for (const i of indices) if (isAnchor[i]) growOrder.push(i);
  const nonAnchors = [...indices].filter(i => !isAnchor[i]).sort((a, b) => targets[a] - targets[b]);
  for (const i of nonAnchors) growOrder.push(i);

  const curSize = new Int32Array(size).fill(1);

  // Grow each region via BFS from frontier
  for (const regId of growOrder) {
    const target = targets[regId];
    let head = 0;

    while (head < frontier[regId].length && curSize[regId] < target) {
      const key = frontier[regId][head++];
      const fr = Math.floor(key / size), fc = key % size;
      if (regions[fr][fc] !== -1) continue;

      // Anchor regions: prefer cells in the same row as their queen
      if (isAnchor[regId]) {
        const [qr] = solution[regId];
        const onRow = fr === qr;
        // For anchors, only accept row cells until we have our target
        // Allow 1 off-row cell for connectivity if needed
        if (!onRow && curSize[regId] < 2) continue; // need at least queen + 1 row cell first
        if (!onRow && curSize[regId] >= 2) {
          // Check if we still have untried row cells in frontier
          let hasRowCell = false;
          for (let j = head; j < frontier[regId].length; j++) {
            const fk = frontier[regId][j];
            const ffr = Math.floor(fk / size);
            if (regions[Math.floor(fk / size)][fk % size] === -1 && ffr === solution[regId][0]) {
              hasRowCell = true;
              break;
            }
          }
          if (hasRowCell) continue; // skip off-row, try row cell first
        }
      }

      regions[fr][fc] = regId;
      curSize[regId]++;
      for (const [dr, dc] of dirs) {
        const nr = fr + dr, nc = fc + dc;
        if (nr >= 0 && nr < size && nc >= 0 && nc < size && regions[nr][nc] === -1) {
          frontier[regId].push(nr * size + nc);
        }
      }
    }
  }

  // Flood-fill remaining unassigned cells
  let unassigned = totalCells;
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++)
      if (regions[r][c] !== -1) unassigned--;

  if (unassigned > 0) {
    const queue = [];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (regions[r][c] !== -1) {
          for (const [dr, dc] of dirs) {
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < size && nc >= 0 && nc < size && regions[nr][nc] === -1) {
              regions[nr][nc] = regions[r][c];
              unassigned--;
              queue.push(nr * size + nc);
            }
          }
        }
      }
    }

    let head = 0;
    while (head < queue.length && unassigned > 0) {
      const key = queue[head++];
      const fr = Math.floor(key / size), fc = key % size;
      const owner = regions[fr][fc];
      for (const [dr, dc] of dirs) {
        const nr = fr + dr, nc = fc + dc;
        if (nr >= 0 && nr < size && nc >= 0 && nc < size && regions[nr][nc] === -1) {
          regions[nr][nc] = owner;
          unassigned--;
          queue.push(nr * size + nc);
        }
      }
    }
  }

  return regions;
}

// ===========================================================================
// Pre-filter — cheap heuristics to reject obviously unsolvable boards early
// ===========================================================================

function preFilter(regions, size) {
  const regSize = new Map();
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const id = regions[r][c];
      regSize.set(id, (regSize.get(id) || 0) + 1);
    }
  }

  const totalCells = size * size;
  let smallCount = 0;
  for (const [, s] of regSize) {
    if (s > totalCells * MAX_REGION_SIZE_RATIO) return false;
    if (s <= 6) smallCount++;
  }

  const minSmall = Math.ceil(size * MIN_SMALL_REGIONS_FRACTION);
  if (smallCount < minSmall) return false;

  return true;
}

// ===========================================================================
// Validation helpers
// ===========================================================================

function validateRegions(regions, size) {
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (regions[r][c] === -1) return false;
    }
  }

  const regionIds = new Set();
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      regionIds.add(regions[r][c]);
    }
  }

  for (const id of regionIds) {
    if (!isRegionConnected(regions, size, id)) return false;
  }

  return true;
}

function isRegionConnected(regions, size, regionId) {
  let startR = -1, startC = -1, count = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (regions[r][c] === regionId) {
        count++;
        if (startR === -1) { startR = r; startC = c; }
      }
    }
  }
  if (count === 0 || startR === -1) return false;

  const visited = Array.from({ length: size }, () => new Array(size).fill(false));
  const queue = [startR, startC];
  visited[startR][startC] = true;
  let reached = 0;
  let head = 0;

  while (head < queue.length) {
    const r = queue[head++], c = queue[head++];
    reached++;
    if (r > 0 && !visited[r-1][c] && regions[r-1][c] === regionId) { visited[r-1][c] = true; queue.push(r-1, c); }
    if (r < size-1 && !visited[r+1][c] && regions[r+1][c] === regionId) { visited[r+1][c] = true; queue.push(r+1, c); }
    if (c > 0 && !visited[r][c-1] && regions[r][c-1] === regionId) { visited[r][c-1] = true; queue.push(r, c-1); }
    if (c < size-1 && !visited[r][c+1] && regions[r][c+1] === regionId) { visited[r][c+1] = true; queue.push(r, c+1); }
  }

  return reached === count;
}

export function isValidSolution(solution, size) {
  if (solution.length !== size) return false;
  const rows = new Set(), cols = new Set();
  for (let i = 0; i < solution.length; i++) {
    const [r1, c1] = solution[i];
    if (rows.has(r1) || cols.has(c1)) return false;
    rows.add(r1); cols.add(c1);
    for (let j = i + 1; j < size; j++) {
      const [r2, c2] = solution[j];
      if (Math.max(Math.abs(r1 - r2), Math.abs(c1 - c2)) <= 1) return false;
    }
  }
  return true;
}

export function areRegionsConnected(regions, size) {
  const ids = new Set();
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) ids.add(regions[r][c]);
  for (const id of ids) if (!isRegionConnected(regions, size, id)) return false;
  return true;
}

/**
 * Compute the minimum technique index required for a given difficulty and board size.
 *
 * On small boards the constraint space is limited — even well-designed regions
 * may solve via basic elimination cascades (naked singles → hidden singles →
 * region confinement). The realistic ceiling is roughly:
 *   6×6: tech iv (region confinement, index 2)
 *   7×7: tech v (pigeonhole, index 3)
 *   8×8: tech vi (adjacency blocking, index 4)
 *   9×9+: tech vii+ (row/col intersection, index 5+)
 *
 * Returns TECHNIQUE_INDEX values.
 */
function getMinTechnique(difficulty, size) {
  switch (difficulty) {
    case 'hard':
      return TECHNIQUE_INDEX.ROW_COL_INTERSECTION;
    case 'easy':
      return TECHNIQUE_INDEX.BASIC_ELIMINATION;
    case 'medium':
    default:
      return TECHNIQUE_INDEX.ADJACENCY_BLOCKING;
  }
}

/**
 * Check whether a board's technique stats meet the difficulty threshold.
 *
 * A board is "hard enough" when:
 * 1. At least one technique ≥ minTechnique was used AND contributed work,
 *    OR forcing chains were used (which indicates genuine hardness).
 *
 * We use eliminations as the primary signal because elimination-only techniques
 * (region confinement, adjacency blocking) remove candidates that enable
 * naked singles to fire — they don't place queens directly.
 */
function isHardEnough(techniqueStats, totalPlacements, minTechnique) {
  if (minTechnique === TECHNIQUE_INDEX.BASIC_ELIMINATION) return true;

  for (const [techIdx, stats] of techniqueStats) {
    // Forcing chains always count as hard enough.
    if (techIdx === TECHNIQUE_INDEX.FORCING_CHAINS && (stats.placements + stats.eliminations) > 0) {
      return true;
    }
    // Any other advanced technique with meaningful work counts.
    if (techIdx >= minTechnique) {
      const work = stats.placements + stats.eliminations;
      if (work >= 1) return true;
    }
  }

  return false;
}

// ===========================================================================
// Difficulty enforcement — check that a board requires the minimum technique
// ===========================================================================

/**
 * Try loosening region boundaries to make an "easy" board harder.
 * Expands small anchor regions by stealing cells from neighbors, then re-solves.
 */
function tryLoosenAndSolve(regions, size, difficulty, config, minTech, rng) {
  const maxMutations = 30;

  for (let m = 0; m < maxMutations; m++) {
    const mutated = regions.map(row => [...row]);
    loosenRegions(mutated, size, rng);

    if (!validateRegions(mutated, size)) continue;

    const result = solveWithUniqueness(mutated, size, config.maxTechnique, config.maxForcing);
    if (result.solved && result.unique && isHardEnough(result.techniqueStats, result.placements.size, minTech)) {
      const newSolution = new Array(size);
      for (const [regId, cellKey] of result.placements) {
        const key = Number(cellKey);
        newSolution[Number(regId)] = [Math.floor(key / 100), key % 100];
      }
      return { regions: mutated, solution: newSolution };
    }
  }
  return null;
}

/**
 * Expand small regions by stealing cells from neighbors.
 * Targets the "easiest" regions (small + row-confined) to break tight constraints.
 */
function loosenRegions(regions, size, rng) {
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  // Apply up to 5 cell moves per call (increased from 3 for stronger effect)
  for (let step = 0; step < 5; step++) {
    const regCells = new Map();
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const id = regions[r][c];
        if (!regCells.has(id)) regCells.set(id, []);
        regCells.get(id).push([r, c]);
      }
    }

    // Score regions by "easiness": small + row-confined = easiest (lowest score)
    const scored = [...regCells.entries()].map(([id, cells]) => {
      let score = 0;
      if (cells.length <= 3) score -= 10;
      const rows = new Set(cells.map(c => c[0]));
      if (rows.size === 1) score -= 5; // confined to one row
      return { id, cells, score };
    });

    // Sort by score ascending — target easiest regions first
    scored.sort((a, b) => a.score - b.score);

    let didMove = false;
    for (const { id: targetRegId, cells } of scored) {
      if (cells.length > size + 2) break; // skip large regions

      // Find boundary cells and steal one from a neighbor
      const boundaryCells = [];
      for (const [r, c] of cells) {
        for (const [dr, dc] of dirs) {
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < size && nc >= 0 && nc < size && regions[nr][nc] !== targetRegId) {
            boundaryCells.push([r, c]);
            break;
          }
        }
      }

      if (boundaryCells.length === 0) continue;

      const [mr, mc] = boundaryCells[rngInt(rng, 0, boundaryCells.length)];

      // Find adjacent donor regions
      const adjRegions = new Set();
      for (const [dr, dc] of dirs) {
        const nr = mr + dr, nc = mc + dc;
        if (nr >= 0 && nr < size && nc >= 0 && nc < size && regions[nr][nc] !== targetRegId) {
          adjRegions.add(regions[nr][nc]);
        }
      }

      if (adjRegions.size === 0) continue;

      const donorRegion = [...adjRegions][rngInt(rng, 0, adjRegions.length)];

      // Find a cell in donor adjacent to boundary cell and move it
      for (const [dr, dc] of dirs) {
        const nr = mr + dr, nc = mc + dc;
        if (nr >= 0 && nr < size && nc >= 0 && nc < size && regions[nr][nc] === donorRegion) {
          regions[nr][nc] = targetRegId;
          didMove = true;
          break;
        }
      }

      if (didMove) break;
    }

    if (!didMove) break;
  }
}
