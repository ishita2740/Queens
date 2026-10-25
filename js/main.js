// Main — Entry point for Queendom. Wires game engine to renderer.

import { createGame, placeQueen, toggleMark, resetMarks, pauseTimer, resumeTimer, tickTimer, newGame, Status, formatTimer } from './engine.js';
import { Renderer } from './renderer.js';

let game;
let renderer;
let timerInterval = null;
let isGameStarting = false; // guard against concurrent startNewGame calls that could leave stale intervals running

/** Check if ?debug=1 is in the URL query string. */
function isDebugMode() {
  return new URLSearchParams(window.location.search).get('debug') === '1';
}

/**
 * Validate board parameters before starting a new game.
 *
 * @param {number} size — board dimension
 * @param {string} difficulty — 'easy', 'medium', or 'hard'
 * @returns {{ valid: boolean, message?: string }}
 */
function validateBoardParams(size, difficulty) {
  const MIN_SIZE = 6;
  const MAX_SIZE = 12;
  const VALID_DIFFICULTIES = ['easy', 'medium', 'hard'];

  if (isNaN(size)) return { valid: false, message: 'Invalid board size.' };
  if (!Number.isInteger(size) || size < MIN_SIZE || size > MAX_SIZE)
    return { valid: false, message: `Board size must be an integer between ${MIN_SIZE} and ${MAX_SIZE}.` };
  if (!VALID_DIFFICULTIES.includes(difficulty))
    return { valid: false, message: 'Difficulty must be easy, medium, or hard.' };

  return { valid: true };
}

/**
 * Serialize the current board to a compact JSON string and copy to clipboard.
 * Format: { size, difficulty, regions (row-major), solution ([r,c] pairs) }
 */
function copyBoardDefinition() {
  if (!game) return;

  const definition = JSON.stringify({
    size: game.size,
    difficulty: game.difficulty,
    regions: game.regions.map(row => row.join(' ')),
    solution: [...game.solution],
  });

  navigator.clipboard.writeText(definition).then(() => {
    const btn = document.getElementById('btn-copy-board');
    const orig = btn.textContent;
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });
}

function init() {
  const boardContainer = document.getElementById('board-container');
  const sizeSelect = document.getElementById('size-select');
  const difficultySelect = document.getElementById('difficulty-select');

  // Populate size selector
  for (let s = 6; s <= 12; s++) {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = `${s}×${s}`;
    if (s === 8) opt.selected = true;
    sizeSelect.appendChild(opt);
  }

  // Populate difficulty selector
  for (const diff of ['easy', 'medium', 'hard']) {
    const opt = document.createElement('option');
    opt.value = diff;
    opt.textContent = diff.charAt(0).toUpperCase() + diff.slice(1);
    if (diff === 'medium') opt.selected = true;
    difficultySelect.appendChild(opt);
  }

  // Button handlers
  const btnCopy = document.getElementById('btn-copy-board');
  if (isDebugMode()) {
    btnCopy.hidden = false;
    btnCopy.addEventListener('click', copyBoardDefinition);
  }

  document.getElementById('btn-new-game').addEventListener('click', startNewGame);
  document.getElementById('btn-pause').addEventListener('click', togglePause);
  document.getElementById('btn-resume').addEventListener('click', resumeFromPause);
  document.getElementById('btn-reset-marks').addEventListener('click', resetAllMarks);
  document.getElementById('btn-retry').addEventListener('click', startNewGame);

  sizeSelect.addEventListener('change', startNewGame);
  difficultySelect.addEventListener('change', startNewGame);

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') togglePause();
    if (e.key === 'n' || e.key === 'N') startNewGame();
  });

  startNewGame();
}

function startNewGame() {
  // Clear stale timer immediately — before any async boundary or guard check.
  // This prevents overlapping intervals when "New Game" is clicked rapidly.
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;

  // Guard: prevent concurrent game starts that could leave stale intervals running.
  if (isGameStarting) return;
  isGameStarting = true;

  const sizeSelect = document.getElementById('size-select');
  const difficultySelect = document.getElementById('difficulty-select');
  const size = parseInt(sizeSelect.value);
  const difficulty = difficultySelect.value;

  // Validate parameters — reject before they reach the generator.
  const validation = validateBoardParams(size, difficulty);
  if (!validation.valid) {
    isGameStarting = false;
    console.warn(`Invalid board settings: ${validation.message}`);
    return;
  }

  // Dismiss build-fail overlay immediately (if retrying)
  hideBuildFailOverlay();

  // Show loading overlay — yield to browser so it paints before blocking.
  showLoadingOverlay();
  const startTimeout = setTimeout(() => {
    let gameState;
    try {
      // Create new game (may block for a while on larger boards).
      gameState = createGame(size, difficulty);
    } catch (err) {
      hideLoadingOverlay();
      showBuildFailOverlay();
      isGameStarting = false;
      return;
    }

    game = gameState;
    isGameStarting = false;
    hideLoadingOverlay();

    // Setup renderer
    const boardContainer = document.getElementById('board-container');
    renderer = new Renderer(game, boardContainer);

    // Wire renderer callbacks
    renderer.onToggleMark = (row, col) => {
      toggleMark(game, row, col);
      updateLives();
    };
    renderer.onPlaceQueen = (row, col) => {
      const result = placeQueen(game, row, col);
      if (!result.ok && game.lives < 3) {
        // Animate lives shake on life loss
        const livesEl = document.getElementById('lives');
        livesEl.classList.add('shake');
        setTimeout(() => livesEl.classList.remove('shake'), 600);
      }
      updateLives();
    };
    renderer.onNewGame = startNewGame;

    // Hide all overlays (including build-fail)
    hideBuildFailOverlay();
    hideAllOverlays();

    // Update UI
    updateLives();
    updateTimerDisplay();

    // Start timer
    game.timerRunning = true;
    timerInterval = setInterval(() => {
        tickTimer(game);
        updateTimerDisplay();
      }, 1000);

    renderer.render();
  });
}

function showLoadingOverlay() {
  document.getElementById('loading-overlay').className = 'overlay loading-overlay';
}

function hideLoadingOverlay() {
  document.getElementById('loading-overlay').className = 'overlay hidden';
}

function showBuildFailOverlay() {
  document.getElementById('build-fail-overlay').className = 'overlay build-fail-overlay';
}

function hideBuildFailOverlay() {
  document.getElementById('build-fail-overlay').className = 'overlay build-fail-overlay hidden';
}

function togglePause() {
  if (game.status !== 'playing') return;

  if (game.timerRunning) {
    pauseTimer(game);
    document.getElementById('pause-overlay').className = 'overlay pause-overlay';
  } else {
    resumeFromPause();
  }
}

function resumeFromPause() {
  if (game.status !== 'playing') return;

  resumeTimer(game);
  document.getElementById('pause-overlay').className = 'overlay hidden';
  renderer.render(); // Re-render to remove pause obscuring
}

function resetAllMarks() {
  if (!game || game.status !== Status.PLAYING) return;

  const hadMarks = game.marks.size > 0;
  resetMarks(game);
  if (hadMarks) {
    renderer.render();
  }
}

function hideAllOverlays() {
  document.getElementById('pause-overlay').className = 'overlay hidden';
  document.getElementById('game-over-overlay').className = 'overlay hidden';
  document.getElementById('solution-overlay').className = 'solution-overlay hidden';
}

function updateLives() {
  const livesEl = document.getElementById('lives');
  livesEl.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const span = document.createElement('span');
    // Full heart or empty heart
    span.textContent = i < game.lives ? '❤️' : '🪵';
    livesEl.appendChild(span);
  }
}

function updateTimerDisplay() {
  document.getElementById('timer').textContent = formatTimer(game.timerSeconds);
}

// Start the app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
