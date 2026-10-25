// Renderer — DOM rendering + user interaction handling for Queendom.
// Takes a GameState from the engine and renders it to the DOM.

import { Mark, Status, formatTimer } from './engine.js';
import { cellKey } from './cell.js';

// Region colors — each has a distinct hue AND saturation level for maximum distinction
const REGION_COLORS = [
  '#F06292', // hot pink (saturated)
  '#BA68C8', // purple (saturated)
  '#7986CB', // indigo (muted blue-purple)
  '#4FC3F7', // bright blue
  '#4DB6AC', // teal (saturated green-blue)
  '#81C784', // fresh green
  '#D4E157', // chartreuse (yellow-green, saturated)
  '#FFD54F', // golden yellow
  '#FF9800', // orange (saturated)
  '#E57373', // red
  '#FF8A65', // coral
  '#AED581', // soft green
];

// SVG template references — fetched from <template> elements in the HTML.
// This avoids recreating strings on every render and keeps SVGs in the document.
let _svgCache = new Map();

/** Clear the SVG cache when the board is rebuilt (templates may be re-added). */
export function _clearSvgCache() {
  _svgCache.clear();
}

function _getTemplateSVG(id) {
  if (!_svgCache.has(id)) {
    const tpl = document.getElementById(id);
    _svgCache.set(id, tpl ? tpl.content.firstElementChild : null);
  }
  return _svgCache.get(id);
}

export class Renderer {
  constructor(game, container) {
    this.game = game;
    this.container = container;
    this.boardEl = null;
    this.cellEls = [];
    this.clickTimers = {}; // { [cellKey]: { status: 'pending'|'dbl', timerId?: number } }
                            // Stores timeout IDs alongside markers so they can be cleared properly.
    this._dragging = false;        // is the user currently drag-toggling marks?
    this._strokeToggled = new Set(); // cells toggled in current drag stroke (prevents double-toggle)
    this._recentDragKeys = new Set();  // cells dragged over recently (blocks click timeout undo)
    this._init();
  }

  _init() {
    // Explicitly remove old board (and its event listeners) before rebuilding.
    if (this.boardEl && this.boardEl.parentNode) {
      this.boardEl.remove();
    }
    // Clear pending click timers from the previous game to prevent stale
    // single-click callbacks firing on unrelated cells of the new board.
    Object.values(this.clickTimers).forEach(t => { if (t?.timerId != null) clearTimeout(t.timerId); });
    this.clickTimers = {};
    this._strokeToggled.clear();
    this._recentDragKeys.clear();
    this._dragStartRow = undefined;
    this._dragStartCol = undefined;
    this.container.innerHTML = '';
    this.boardEl = document.createElement('div');
    this.boardEl.className = 'board';
    this.boardEl.style.gridTemplateColumns = `repeat(${this.game.size}, 1fr)`;
    this.container.appendChild(this.boardEl);

    this.cellEls = [];
    for (let r = 0; r < this.game.size; r++) {
      this.cellEls[r] = [];
      for (let c = 0; c < this.game.size; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        const reg = this.game.regions[r][c];
        cell.style.backgroundColor = REGION_COLORS[reg % REGION_COLORS.length];
        cell.dataset.row = r;
        cell.dataset.col = c;

        // Region borders: add dark border where regions meet
        this._applyRegionBorders(cell, r, c);

        this.boardEl.appendChild(cell);
        this.cellEls[r][c] = cell;
      }
    }

    // Attach click handlers with single/double click disambiguation
    this._attachClickHandlers();
  }

  _applyRegionBorders(cell, r, c) {
    const reg = this.game.regions[r][c];
    const size = this.game.size;

    // Check each direction for a different region neighbor
    if (r === 0 || this.game.regions[r - 1][c] !== reg) cell.classList.add('border-top');
    if (r < size - 1 && this.game.regions[r + 1][c] !== reg) cell.classList.add('border-bottom');
    if (c === 0 || this.game.regions[r][c - 1] !== reg) cell.classList.add('border-left');
    if (c < size - 1 && this.game.regions[r][c + 1] !== reg) cell.classList.add('border-right');
  }

  _attachClickHandlers() {
    const CLICK_DELAY = 200; // ms to wait before treating as single click

    // --- Click-and-drag for mark toggling ---

    // Track where mousedown started so we can detect real dragging.
    this._dragStartRow = undefined;
    this._dragStartCol = undefined;

    // mousedown: track the start cell and enable drag mode.
    this.boardEl.addEventListener('mousedown', (e) => {
      const cell = e.target.closest('.cell');
      if (!cell || e.button !== 0) return; // only left button

      this._dragStartRow = parseInt(cell.dataset.row);
      this._dragStartCol = parseInt(cell.dataset.col);
    });

    // mousemove: detect actual dragging (cursor moved to a different cell from mousedown target).
    // On first real movement, toggle the start cell and current cell.
    // During ongoing drag, toggle each new cell entered.
    this.boardEl.addEventListener('mousemove', (e) => {
      const cell = e.target.closest('.cell');
      if (!cell || !cell.parentElement) return;

      // Only enter/continue drag mode when a mousedown has established a start cell.
      // Without this guard, hovering over cells would activate drag mode since
      // undefined !== number always returns false for the === check below.
      if (this._dragStartRow == null) return;

      const r = parseInt(cell.dataset.row);
      const c = parseInt(cell.dataset.col);

      // Only start drag when we've moved to a different cell from mousedown target.
      if (r === this._dragStartRow && c === this._dragStartCol) return;

      // First time detecting drag: toggle the start cell now.
      if (!this._dragging) {
        this._dragging = true;

        const startKey = cellKey(this._dragStartRow, this._dragStartCol);
        if (!this._strokeToggled.has(startKey)) {
          this._strokeToggled.add(startKey);
          this._recentDragKeys.add(startKey);
          this._onSingleClick(this._dragStartRow, this._dragStartCol);
        }
      }

      // Toggle current cell (first time in this stroke).
      const key = cellKey(r, c);
      if (!this._strokeToggled.has(key)) {
        this._strokeToggled.add(key);
        this._recentDragKeys.add(key);
        this._onSingleClick(r, c);
      }
    });

    // mouseup on document: end drag, cancel pending timers, schedule clearing of recent keys.
    const onMouseUp = () => {
      if (this._dragging) {
        Object.values(this.clickTimers).forEach(t => {
          if (t?.timerId != null) clearTimeout(t.timerId);
        });
        this.clickTimers = {};

        // Keep _recentDragKeys around briefly so click timeout callbacks can check it.
        // Click's timer fires after CLICK_DELAY=200ms, give a bit of headroom.
        setTimeout(() => { this._recentDragKeys.clear(); }, 300);

        this._strokeToggled.clear();
      }
      this._dragging = false;
      this._dragStartRow = undefined;
      this._dragStartCol = undefined;
    };
    document.addEventListener('mouseup', onMouseUp);

    // mouseleave: cancel pending timers if dragging off the board without a proper mouseup.
    this.boardEl.addEventListener('mouseleave', () => {
      if (this._dragging) {
        Object.values(this.clickTimers).forEach(t => {
          if (t?.timerId != null) clearTimeout(t.timerId);
        });
        this.clickTimers = {};
        this._strokeToggled.clear();
      }
    });

    this.boardEl.addEventListener('click', (e) => {
      const cell = e.target.closest('.cell');
      if (!cell) return;

      const r = parseInt(cell.dataset.row);
      const c = parseInt(cell.dataset.col);
      const key = cellKey(r, c);

      // If we already fired a dblclick for this cell, ignore the click
      if (this.clickTimers[key] && this.clickTimers[key].status === 'dbl') {
        delete this.clickTimers[key];
        return;
      }

      // Set a timer: if no second click arrives, treat as single click.
      const timerId = setTimeout(() => {
        if (this.clickTimers[key] && this.clickTimers[key].status === 'pending') {
          // If this cell was part of a recent drag, skip toggle — don't undo what dragging set.
          if (this._recentDragKeys.has(key)) return;

          delete this.clickTimers[key];
          this._onSingleClick(r, c);
        }
      }, CLICK_DELAY);
      this.clickTimers[key] = { status: 'pending', timerId };
    });

    this.boardEl.addEventListener('dblclick', (e) => {
      const cell = e.target.closest('.cell');
      if (!cell) return;

      const r = parseInt(cell.dataset.row);
      const c = parseInt(cell.dataset.col);
      const key = cellKey(r, c);

      // Cancel the pending single-click timer using its stored timeout ID
      if (this.clickTimers[key]) {
        clearTimeout(this.clickTimers[key].timerId);
        delete this.clickTimers[key];
      }
      this.clickTimers[key] = { status: 'dbl' };

      this._onDoubleClick(r, c);
    });
  }

  _onSingleClick(row, col) {
    const callback = this.onToggleMark;
    if (callback) callback(row, col);
    this.renderCell(row, col);
    this._updateOverlays();
  }



  _onDoubleClick(row, col) {
    // Ignore double-click on cells that already have a queen
    const key = cellKey(row, col);
    if (this.game.queens.has(key)) return;

    const callback = this.onPlaceQueen;
    if (callback) callback(row, col);
    this.renderCell(row, col);
    this._updateOverlays();
  }

  // Callbacks set by main.js
  onToggleMark = null;
  onPlaceQueen = null;
  onPause = null;
  onResume = null;
  onNewGame = null;

  render() {
    const game = this.game;

    for (let r = 0; r < game.size; r++) {
      for (let c = 0; c < game.size; c++) {
        this.renderCell(r, c);
      }
    }

    // Update overlays based on game status
    this._updateOverlays();
  }

  renderCell(row, col) {
    const cell = this.cellEls[row][col];
    const reg = this.game.regions[row][col];

    // Reset content
    cell.innerHTML = '';
    cell.classList.remove('has-queen', 'has-mark', 'has-dead');

    // Region color (always)
    cell.style.backgroundColor = REGION_COLORS[reg % REGION_COLORS.length];

    const key = cellKey(row, col);

    // Check for queen
    if (this.game.queens.has(key)) {
      const svg = _getTemplateSVG('queen-svg');
      if (svg) cell.innerHTML = svg.cloneNode(true).outerHTML;
      cell.classList.add('has-queen');
      return;
    }

    // Check for marks
    const mark = this.game.marks.get(key);
    if (mark === Mark.DEAD) {
      const svg = _getTemplateSVG('dead-x-svg');
      if (svg) cell.innerHTML = svg.cloneNode(true).outerHTML;
      cell.classList.add('has-dead');
    } else if (mark === Mark.X) {
      const svg = _getTemplateSVG('x-mark-svg');
      if (svg) cell.innerHTML = svg.cloneNode(true).outerHTML;
      cell.classList.add('has-mark');
    }
  }

  /**
   * Update overlay visibility based on game status.
   * Uses innerHTML assignment to clear old content + listeners before adding new ones.
   */
  _updateOverlays() {
    const pauseOverlay = document.getElementById('pause-overlay');
    const gameOverOverlay = document.getElementById('game-over-overlay');
    const solutionOverlay = document.getElementById('solution-overlay');

    if (this.game.status === Status.WON) {
      // Clear and rebuild game-over overlay — innerHTML assignment removes old listeners
      if (gameOverOverlay) {
        gameOverOverlay.className = 'overlay game-win';
        gameOverOverlay.innerHTML = `
          <div class="overlay-content">
            <h2>🎉 Congratulations!</h2>
            <p>You solved the ${this.game.size}×${this.game.size} puzzle</p>
            <p class="time">${formatTimer(this.game.timerSeconds)}</p>
            <button id="btn-new-game-win">New Game</button>
          </div>`;
        const btn = gameOverOverlay.querySelector('#btn-new-game-win');
        if (btn && this.onNewGame) {
          btn.addEventListener('click', () => this.onNewGame());
        }
      }
      if (pauseOverlay) pauseOverlay.className = 'overlay hidden';
      if (solutionOverlay) solutionOverlay.className = 'solution-overlay hidden';

    } else if (this.game.status === Status.LOST) {
      // Clear and rebuild game-over overlay — innerHTML assignment removes old listeners
      if (gameOverOverlay) {
        gameOverOverlay.className = 'overlay game-lose';
        gameOverOverlay.innerHTML = `
          <div class="overlay-content">
            <h2>Game Over</h2>
            <p>You ran out of lives!</p>
            <button id="btn-show-solution">Show Solution</button>
            <button id="btn-new-game-lose">New Game</button>
          </div>`;

        const showBtn = gameOverOverlay.querySelector('#btn-show-solution');
        if (showBtn) {
          showBtn.addEventListener('click', () => {
            this._renderSolutionRevealInner();
            // Swap: hide game-over, show solution
            gameOverOverlay.className = 'overlay hidden';
            solutionOverlay.className = 'solution-overlay';
          });
        }

        const newGameBtn = gameOverOverlay.querySelector('#btn-new-game-lose');
        if (newGameBtn && this.onNewGame) {
          newGameBtn.addEventListener('click', () => {
            solutionOverlay.className = 'solution-overlay hidden';
            this.onNewGame();
          });
        }
      }

      // Hide solution overlay by default — user opens with "Show Solution"
      if (solutionOverlay) solutionOverlay.className = 'solution-overlay hidden';

    } else {
      // Playing — hide overlays
      if (gameOverOverlay) gameOverOverlay.className = 'overlay hidden';
      if (solutionOverlay) solutionOverlay.className = 'solution-overlay hidden';
    }

    // Pause state
    const isPaused = !this.game.timerRunning && this.game.status === Status.PLAYING;
    if (pauseOverlay) {
      pauseOverlay.className = isPaused ? 'overlay pause-overlay' : 'overlay hidden';
    }
  }

  _renderSolutionRevealInner() {
    // Render solution queens directly on the board cells — no separate grid,
    // so alignment is perfect. The overlay itself is just a dimming backdrop.
    const size = this.game.size;

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (this.game.solution.some(([sr, sc]) => sr === r && sc === c)) {
          const cell = this.cellEls[r][c];
          // Save existing content so we can restore it later
          if (!cell.dataset._savedContent) {
            cell.dataset._savedContent = cell.innerHTML;
          }
          const svg = _getTemplateSVG('queen-svg');
          if (svg) {
            cell.innerHTML = svg.cloneNode(true).outerHTML;
            cell.classList.add('has-queen');
          }
        }
      }
    }

    // Remove old solution-close listeners to prevent accumulation.
    // innerHTML on the overlay would destroy them, but we're not rebuilding it —
    // just replacing the close button element itself.
    const oldCloseBtn = document.querySelector('#solution-overlay .close-btn');
    if (oldCloseBtn) {
      const newBtn = oldCloseBtn.cloneNode(true);
      oldCloseBtn.parentNode.replaceChild(newBtn, oldCloseBtn);
      newBtn.onclick = () => {
        this._clearSolutionQueens();
        document.getElementById('solution-overlay').className = 'solution-overlay hidden';
        // Restore game-over overlay
        const gameOverOverlay = document.getElementById('game-over-overlay');
        if (gameOverOverlay) gameOverOverlay.className = 'overlay game-lose';
      };
    }
  }

  /** Clear SVG template cache so fresh templates are fetched on next render. */
  _invalidateSvgCache() {
    _svgCache.clear();
  }

  _clearSolutionQueens() {
    // Restore cells to their pre-solution state
    for (const cell of this.cellEls.flat()) {
      if (cell.dataset._savedContent !== undefined) {
        cell.innerHTML = cell.dataset._savedContent;
        cell.classList.remove('has-queen');
        delete cell.dataset._savedContent;
      }
    }
  }

  setGame(game) {
    this._invalidateSvgCache();
    this.game = game;
    // Rebuild the board
    const container = this.container;
    this._init();
    this.render();
  }
}
