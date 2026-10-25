import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { generateBoard, isValidSolution, areRegionsConnected } from '../js/generator.js';
import { solve } from '../js/solver.js';

const fixtures = JSON.parse(readFileSync('test/fixtures.json', 'utf-8'));

describe('Generator — Solution Validation', () => {
  it('produces valid queen placements (no shared rows/cols)', () => {
    // Sizes 6-10: hard boards need vii/viii, generation is fast.
    // Size 12 excluded — takes minutes per attempt and is covered in engine.test.js.
    for (let size = 6; size <= 10; size++) {
      const board = generateBoard(size, 'hard', size * 100);
      expect(isValidSolution(board.solution, size)).toBe(true);
    }
  }, 300000);

  it('produces valid queen placements (no adjacent queens)', () => {
    // Sizes 6-10: hard boards need vii/viii, generation is fast.
    for (let size = 6; size <= 10; size++) {
      const board = generateBoard(size, 'hard', size * 200);
      const sol = board.solution;
      for (let i = 0; i < sol.length; i++) {
        for (let j = i + 1; j < sol.length; j++) {
          const [r1, c1] = sol[i];
          const [r2, c2] = sol[j];
          expect(Math.max(Math.abs(r1 - r2), Math.abs(c1 - c2))).toBeGreaterThan(1);
        }
      }
    }
  }, 300000);

  it('each queen is in its corresponding region', () => {
    for (let size = 6; size <= 8; size++) {
      const board = generateBoard(size, 'hard', size * 300);
      for (let i = 0; i < board.solution.length; i++) {
        const [r, c] = board.solution[i];
        expect(board.regions[r][c]).toBe(i);
      }
    }
  }, 300000);
});

describe('Generator — Region Validation', () => {
  it('all cells are assigned a region (sizes 6-8)', () => {
    for (let size = 6; size <= 8; size++) {
      const board = generateBoard(size, 'hard', size * 400);
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          expect(board.regions[r][c]).toBeGreaterThanOrEqual(0);
          expect(board.regions[r][c]).toBeLessThan(size);
        }
      }
    }
  }, 300000);

  it('all regions are connected (sizes 6-8)', () => {
    for (let size = 6; size <= 8; size++) {
      const board = generateBoard(size, 'hard', size * 500);
      expect(areRegionsConnected(board.regions, size)).toBe(true);
    }
  }, 300000);

  it('each region has at least one cell (sizes 6-8)', () => {
    for (let size = 6; size <= 8; size++) {
      const board = generateBoard(size, 'hard', size * 600);
      const counts = new Array(size).fill(0);
      for (const row of board.regions) for (const v of row) counts[v]++;
      for (let i = 0; i < size; i++) expect(counts[i]).toBeGreaterThan(0);
    }
  }, 300000);

  it('region sizes vary by difficulty', () => {
    const easyBoard = generateBoard(8, 'easy', 42);
    const hardBoard = generateBoard(8, 'hard', 42);

    const countsEasy = new Array(8).fill(0);
    for (const row of easyBoard.regions) for (const v of row) countsEasy[v]++;
    const hardCounts = new Array(8).fill(0);
    for (const row of hardBoard.regions) for (const v of row) hardCounts[v]++;

    const easySmallCount = countsEasy.filter(c => c <= 4).length;
    const hardSmallCount = hardCounts.filter(c => c <= 4).length;
    expect(easySmallCount).toBeGreaterThanOrEqual(hardSmallCount);
  });
});

describe('Generator — Solvability', () => {
  it('generated boards are solvable by the solver (sizes 6-8)', () => {
    for (let size = 6; size <= 8; size++) {
      for (const diff of ['easy', 'medium', 'hard']) {
        const board = generateBoard(size, diff, size * 100 + 42);
        const result = solve(board.regions, size);
        expect(result.solved).toBe(true);
      }
    }
  }, 300000);

  it('solver placements are valid (sizes 6-8)', () => {
    for (let size = 6; size <= 8; size++) {
      const board = generateBoard(size, 'hard', size * 700);
      const result = solve(board.regions, size);
      expect(result.solved).toBe(true);

      if (result.placements) {
        // Verify each placement is in the correct region and no conflicts
        const placements = [];
        for (const [regId, cellKeyVal] of result.placements) {
          const r = Math.floor(cellKeyVal / 100);
          const c = cellKeyVal % 100;
          expect(board.regions[r][c]).toBe(Number(regId));
          placements.push([r, c]);
        }
        // No shared rows/cols
        const rows = new Set(placements.map(p => p[0]));
        const cols = new Set(placements.map(p => p[1]));
        expect(rows.size).toBe(size);
        expect(cols.size).toBe(size);
      }
    }
  }, 300000);
});

describe('Generator — PRNG Reproducibility', () => {
  it('same seed produces same board', () => {
    const board1 = generateBoard(8, 'hard', 12345);
    const board2 = generateBoard(8, 'hard', 12345);
    expect(board1.regions).toEqual(board2.regions);
    expect(board1.solution).toEqual(board2.solution);
    expect(board1.seed).toBe(board2.seed);
  });

  it('different seeds produce different boards', () => {
    const board1 = generateBoard(8, 'hard', 12345);
    const board2 = generateBoard(8, 'hard', 67890);
    let differs = false;
    for (let r = 0; r < 8 && !differs; r++) {
      for (let c = 0; c < 8 && !differs; c++) {
        if (board1.regions[r][c] !== board2.regions[r][c]) differs = true;
      }
    }
    expect(differs).toBe(true);
  });
});

describe('Generator — Fixture Validation', () => {
  for (const fixture of fixtures) {
    it(`fixture ${fixture.name} has valid solution`, () => {
      expect(isValidSolution(fixture.solution, fixture.size)).toBe(true);
    });

    it(`fixture ${fixture.name} has connected regions`, () => {
      expect(areRegionsConnected(fixture.regions, fixture.size)).toBe(true);
    });
  }
});
