// Game Engine — pure-logic state machine. No DOM dependencies.
// Manages game state: lives, timer, queen placements, marks, win/lose detection.

import { generateBoard } from './generator.js';
import { cellKey, cellPos } from './cell.js';

export const Mark = Object.freeze({ NONE: 'none', X: 'x', DEAD: 'dead' });
export const Status = Object.freeze({ PLAYING: 'playing', WON: 'won', LOST: 'lost' });

/**
 * Create a new game state with a freshly generated board.
 *
 * @param {number} size — board dimension (6–12)
 * @param {string} difficulty — 'easy' | 'medium' | 'hard'
 * @param {number|null} seed — PRNG seed, or null for random
 * @returns {GameState}
 */
export function createGame(size, difficulty = 'hard', seed = null) {
  const { regions, solution, seed: boardSeed } = generateBoard(size, difficulty, seed);

  // Build solution set for fast lookup: cellKey -> true
  const solutionSet = new Set();
  for (const [r, c] of solution) {
    solutionSet.add(cellKey(r, c));
  }

  return {
    size,
    difficulty,
    regions,
    solution,
    solutionSet,
    queens: new Map(),       // cellKey -> regionId (placed queens)
    marks: new Map(),        // cellKey -> Mark.X | Mark.DEAD
    lives: 3,
    timerSeconds: 0,
    timerRunning: true,
    status: Status.PLAYING,
    seed: boardSeed,
  };
}

// Re-export cell utilities so tests and renderer can use the shared implementation.
export { cellKey as _cellKey, cellPos };

/**
 * Attempt to place a queen at (row, col).
 * Returns { ok: boolean, message: string }.
 *
 * @param {GameState} game — current game state
 * @param {number} row — row index (0-based)
 * @param {number} col — column index (0-based)
 * @returns {{ ok: boolean, message: string }}
 */
export function placeQueen(game, row, col) {
  if (game.status !== Status.PLAYING) {
    return { ok: false, message: 'Game is not in progress.' };
  }

  const key = cellKey(row, col);

  // Already has a queen?
  if (game.queens.has(key)) {
    return { ok: false, message: 'A queen is already here.' };
  }

  // Check against solution
  if (game.solutionSet.has(key)) {
    // Correct placement!
    const regionId = game.regions[row][col];
    game.queens.set(key, regionId);
    // Remove any player mark on this cell
    game.marks.delete(key);

    // Check win condition
    if (game.queens.size === game.size) {
      game.status = Status.WON;
      game.timerRunning = false;
    }

    return { ok: true, message: '' };
  } else {
    // Wrong placement — lose a life
    game.lives--;
    game.marks.set(key, Mark.DEAD);

    if (game.lives <= 0) {
      game.status = Status.LOST;
      game.timerRunning = false;
    }

    return { ok: false, message: 'Incorrect! Life lost.' };
  }
}

/**
 * Toggle a player X mark on a cell.
 *
 * @param {GameState} game — current game state
 * @param {number} row — row index (0-based)
 * @param {number} col — column index (0-based)
 */
export function toggleMark(game, row, col) {
  if (game.status !== Status.PLAYING) return;

  const key = cellKey(row, col);

  // Can't mark a cell with a queen
  if (game.queens.has(key)) return;

  const current = game.marks.get(key);

  if (current === Mark.DEAD) {
    // Permanent mark — cannot be removed
    return;
  }

  if (current === Mark.X) {
    game.marks.delete(key);
  } else {
    game.marks.set(key, Mark.X);
  }
}

/**
 * Check if all queens are correctly placed.
 *
 * @returns {boolean}
 */
export function checkWin(game) {
  return game.status === Status.WON;
}

/**
 * Check if the player has lost.
 *
 * @returns {boolean}
 */
export function checkLose(game) {
  return game.status === Status.LOST;
}

/**
 * Get the number of correctly placed queens.
 *
 * @returns {number}
 */
export function getQueenCount(game) {
  return game.queens.size;
}

/**
 * Pause the timer.
 *
 * @param {GameState} game
 */
export function pauseTimer(game) {
  game.timerRunning = false;
}

/**
 * Resume the timer if still playing.
 *
 * @param {GameState} game
 */
export function resumeTimer(game) {
  if (game.status === Status.PLAYING) {
    game.timerRunning = true;
  }
}

/**
 * Tick the timer (call this every second when timer is running).
 *
 * @returns {number} Updated timer value in seconds.
 */
export function tickTimer(game) {
  if (game.timerRunning && game.status === Status.PLAYING) {
    game.timerSeconds++;
  }
  return game.timerSeconds;
}

/**
 * Format timer seconds as MM:SS.
 *
 * @param {number} seconds
 * @returns {string}
 */
export function formatTimer(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Start a new game. Resets everything.
 */
export function newGame(size, difficulty = 'hard', seed = null) {
  return createGame(size, difficulty, seed);
}

/**
 * Clear all player X marks from the board (keeps DEAD/incorrect marks).
 *
 * @param {GameState} game
 */
export function resetMarks(game) {
  if (game.status !== Status.PLAYING) return;

  for (const [key, mark] of game.marks) {
    if (mark === Mark.X) {
      game.marks.delete(key);
    }
  }
}

/**
 * Get the mark at a cell, or Mark.NONE if none.
 *
 * @returns {string}
 */
export function getMark(game, row, col) {
  const key = cellKey(row, col);
  return game.marks.get(key) || Mark.NONE;
}

/**
 * Check if a cell has a placed queen.
 *
 * @returns {boolean}
 */
export function hasQueen(game, row, col) {
  return game.queens.has(cellKey(row, col));
}

/**
 * Get the solution as an array of [row, col] pairs.
 *
 * @returns {[number, number][]}
 */
export function getSolution(game) {
  return [...game.solution];
}
