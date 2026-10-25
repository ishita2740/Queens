import { describe, it, expect } from 'vitest';
import {
  createGame, placeQueen, toggleMark, checkWin, checkLose,
  getQueenCount, pauseTimer, resumeTimer, tickTimer, formatTimer,
  getMark, hasQueen, getSolution, cellPos, _cellKey,
  Mark, Status,
} from '../js/engine.js';

describe('Engine — Game Creation', () => {
  it('creates a valid game state', () => {
    const game = createGame(6, 'hard', 42);
    expect(game.size).toBe(6);
    expect(game.difficulty).toBe('hard');
    expect(game.lives).toBe(3);
    expect(game.status).toBe(Status.PLAYING);
    expect(game.timerRunning).toBe(true);
    expect(game.timerSeconds).toBe(0);
    expect(game.queens.size).toBe(0);
  });

  it('creates games for all sizes', () => {
    // Test core sizes with seeds that produce hard boards quickly.
    // Sizes 9-12 excluded from this test — hard boards now need vii/viii,
    // making generation slow (30s+ per board). See 'large-board-hard' test below.
    const seeds = [42, 137, 999];
    for (let size = 6; size <= 8; size++) {
      const game = createGame(size, 'hard', seeds[size - 6]);
      expect(game.size).toBe(size);
      expect(game.regions.length).toBe(size);
      expect(game.regions[0].length).toBe(size);
    }
  });

  it('solution has correct number of queens', () => {
    const game = createGame(8, 'hard', 42);
    expect(game.solution.length).toBe(8);
    expect(game.solutionSet.size).toBe(8);
  });
});

describe('Engine — Queen Placement', () => {
  it('placing a correct queen succeeds without losing a life', () => {
    const game = createGame(6, 'hard', 42);
    const [r, c] = game.solution[0];
    const result = placeQueen(game, r, c);
    expect(result.ok).toBe(true);
    expect(game.lives).toBe(3);
    expect(hasQueen(game, r, c)).toBe(true);
  });

  it('placing an incorrect queen costs a life', () => {
    const game = createGame(6, 'hard', 42);
    // Place at a non-solution cell
    let wrongR, wrongC;
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 6; c++) {
        if (!game.solutionSet.has(_cellKey(r, c))) {
          wrongR = r; wrongC = c;
          break;
        }
      }
      if (wrongR !== undefined) break;
    }

    const result = placeQueen(game, wrongR, wrongC);
    expect(result.ok).toBe(false);
    expect(game.lives).toBe(2);
    expect(getMark(game, wrongR, wrongC)).toBe(Mark.DEAD);
  });

  it('cannot place a queen on an existing queen', () => {
    const game = createGame(6, 'hard', 42);
    const [r, c] = game.solution[0];
    placeQueen(game, r, c);
    const result = placeQueen(game, r, c);
    expect(result.ok).toBe(false);
  });

  it('losing all lives ends the game', () => {
    const game = createGame(6, 'hard', 42);
    // Find 3 non-solution cells
    const wrongCells = [];
    for (let r = 0; r < 6 && wrongCells.length < 3; r++) {
      for (let c = 0; c < 6 && wrongCells.length < 3; c++) {
        if (!game.solutionSet.has(_cellKey(r, c))) {
          wrongCells.push([r, c]);
        }
      }
    }

    for (const [r, c] of wrongCells) {
      placeQueen(game, r, c);
    }

    expect(game.lives).toBe(0);
    expect(game.status).toBe(Status.LOST);
  });

  it('placing all correct queens triggers win', () => {
    const game = createGame(6, 'hard', 42);
    for (const [r, c] of game.solution) {
      placeQueen(game, r, c);
    }
    expect(game.status).toBe(Status.WON);
    expect(getQueenCount(game)).toBe(6);
  });

  it('cannot place queens after winning', () => {
    const game = createGame(6, 'hard', 42);
    for (const [r, c] of game.solution) {
      placeQueen(game, r, c);
    }
    expect(game.status).toBe(Status.WON);

    // Try to place another queen — should be rejected
    let wrongR = -1, wrongC = -1;
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 6; c++) {
        if (!hasQueen(game, r, c)) { wrongR = r; wrongC = c; break; }
      }
      if (wrongR >= 0) break;
    }
    const result = placeQueen(game, wrongR, wrongC);
    expect(result.ok).toBe(false);
  });
});

describe('Engine — Marks', () => {
  it('toggling a mark adds X', () => {
    const game = createGame(6, 'hard', 42);
    toggleMark(game, 0, 0);
    expect(getMark(game, 0, 0)).toBe(Mark.X);
  });

  it('toggling a mark removes X', () => {
    const game = createGame(6, 'hard', 42);
    toggleMark(game, 0, 0);
    toggleMark(game, 0, 0);
    expect(getMark(game, 0, 0)).toBe(Mark.NONE);
  });

  it('cannot remove a dead mark by toggling', () => {
    const game = createGame(6, 'hard', 42);
    // Create a dead mark by placing incorrectly
    let wrongR, wrongC;
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 6; c++) {
        if (!game.solutionSet.has(_cellKey(r, c))) {
          wrongR = r; wrongC = c; break;
        }
      }
      if (wrongR !== undefined) break;
    }
    placeQueen(game, wrongR, wrongC);
    expect(getMark(game, wrongR, wrongC)).toBe(Mark.DEAD);

    // Try to toggle it off — should not work
    toggleMark(game, wrongR, wrongC);
    expect(getMark(game, wrongR, wrongC)).toBe(Mark.DEAD);
  });

  it('cannot mark a cell with a queen', () => {
    const game = createGame(6, 'hard', 42);
    const [r, c] = game.solution[0];
    placeQueen(game, r, c);
    toggleMark(game, r, c); // should be no-op
    expect(getMark(game, r, c)).toBe(Mark.NONE);
    expect(hasQueen(game, r, c)).toBe(true);
  });
});

describe('Engine — Timer', () => {
  it('timer starts at 0 and increments when running', () => {
    const game = createGame(6, 'hard', 42);
    expect(game.timerSeconds).toBe(0);
    tickTimer(game);
    expect(game.timerSeconds).toBe(1);
    tickTimer(game);
    expect(game.timerSeconds).toBe(2);
  });

  it('timer does not increment when paused', () => {
    const game = createGame(6, 'hard', 42);
    pauseTimer(game);
    tickTimer(game);
    expect(game.timerSeconds).toBe(0);
  });

  it('timer resumes after pausing', () => {
    const game = createGame(6, 'hard', 42);
    tickTimer(game);
    expect(game.timerSeconds).toBe(1);
    pauseTimer(game);
    tickTimer(game);
    expect(game.timerSeconds).toBe(1); // still paused
    resumeTimer(game);
    tickTimer(game);
    expect(game.timerSeconds).toBe(2); // resumed
  });

  it('timer stops when game is won', () => {
    const game = createGame(6, 'hard', 42);
    for (const [r, c] of game.solution) placeQueen(game, r, c);
    tickTimer(game);
    expect(game.timerSeconds).toBe(0); // timer stopped on win
  });

  it('timer stops when game is lost', () => {
    const game = createGame(6, 'hard', 42);
    // Lose all lives
    const wrongCells = [];
    for (let r = 0; r < 6 && wrongCells.length < 3; r++) {
      for (let c = 0; c < 6 && wrongCells.length < 3; c++) {
        if (!game.solutionSet.has(_cellKey(r, c))) wrongCells.push([r, c]);
      }
    }
    for (const [r, c] of wrongCells) placeQueen(game, r, c);
    tickTimer(game);
    expect(game.timerSeconds).toBe(0); // timer stopped on loss
  });
});

describe('Engine — Timer Formatting', () => {
  it('formats seconds correctly', () => {
    expect(formatTimer(0)).toBe('00:00');
    expect(formatTimer(59)).toBe('00:59');
    expect(formatTimer(60)).toBe('01:00');
    expect(formatTimer(123)).toBe('02:03');
    expect(formatTimer(3661)).toBe('61:01');
  });
});

describe('Engine — Solution Access', () => {
  it('getSolution returns the solution positions', () => {
    const game = createGame(6, 'hard', 42);
    const sol = getSolution(game);
    expect(sol.length).toBe(6);
    expect(sol).toEqual(game.solution);
  });

  it('cellPos correctly parses cell keys', () => {
    expect(cellPos(_cellKey(3, 5))).toEqual([3, 5]);
    expect(cellPos(_cellKey(0, 0))).toEqual([0, 0]);
    expect(cellPos(_cellKey(11, 9))).toEqual([11, 9]);
  });
});
