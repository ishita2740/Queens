// Solver Viewer — instruments the solve loop to record every step,
// then renders a human-readable walkthrough plus final answer key.

import {
  createSolverState,
  incrementalEliminate,
  applyNakedSingles,
  applyHiddenSingles,
  applyRegionConfinement,
  applyPigeonhole,
  applyAdjacencyBlocking,
  applyRowColIntersection,
  applyForcingChains,
} from './solver.js';

// ---------------------------------------------------------------------------
// Helpers — use shared cell utilities from cell.js
// ---------------------------------------------------------------------------

import { cellKey, cellPos } from './cell.js';

// Note: Basic Elimination is no longer a separate step — it's handled
// incrementally within each technique that places queens (ii, iii, vii).
const TECH_NAMES = [
  'Naked Singles',
  'Hidden Singles',
  'Region Confinement',
  'Pigeonhole / Groupings',
  'Adjacency Blocking',
  'Row/Column + Region Intersections',
  'Forcing Chains',
];

// Technique functions — basic elimination is now handled incrementally
// within each technique that places queens (ii, iii, vii).
const TECH_FUNCTIONS = [
  applyNakedSingles,
  applyHiddenSingles,
  applyRegionConfinement,
  applyPigeonhole,
  applyAdjacencyBlocking,
  applyRowColIntersection,
  applyForcingChains,
];

function cloneState(s) {
  return {
    size: s.size,
    regions: s.regions.map(r => [...r]),
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

// Snapshot all candidate sets as arrays of [r,c] pairs per region
function snapshotCandidates(state) {
  const snap = [];
  for (let i = 0; i < state.size; i++) {
    snap[i] = [...state.candidates[i]].map(k => cellPos(k));
  }
  return snap;
}

// Reconstruct a minimal "before-state" from snapshots so reasoning can analyze it
function reconstructBeforeState(beforeCands, beforePlaced, size) {
  const candidates = [];
  for (let i = 0; i < size; i++) {
    candidates[i] = new Set(beforeCands[i].map(([r, c]) => cellKey(r, c)));
  }
  const placed = new Map();
  for (const [reg, cell] of Object.entries(beforePlaced)) {
    const [r, c] = cell.split(',').map(Number);
    placed.set(Number(reg), cellKey(r, c));
  }
  return { size, candidates, placed };
}

// Diff two candidate snapshots → { regionId: [[r,c], ...], ... }
function diffCandidates(before, after) {
  const eliminated = {};
  for (let reg = 0; reg < before.length; reg++) {
    const beforeSet = new Set(before[reg].map(([r, c]) => `${r},${c}`));
    const afterSet = new Set(after[reg].map(([r, c]) => `${r},${c}`));
    const gone = [];
    for (const k of beforeSet) {
      if (!afterSet.has(k)) {
        const [r, c] = k.split(',').map(Number);
        gone.push([r, c]);
      }
    }
    if (gone.length > 0) eliminated[reg] = gone;
  }
  return eliminated;
}

// Snapshot the placed map so we can diff between steps
function snapshotPlacements(state) {
  const snap = {};
  for (const [reg, cell] of state.placed) {
    const [r, c] = cellPos(cell);
    snap[reg] = `${r},${c}`;
  }
  return snap;
}

// Diff two placement snapshots → [{ regionId, row, col }, ...]
function diffPlacements(before, after) {
  const placements = [];
  for (const [reg, cell] of Object.entries(after)) {
    if (!before[reg]) {
      const [r, c] = cell.split(',').map(Number);
      placements.push({ regionId: Number(reg), row: r, col: c });
    }
  }
  return placements;
}

// Count total remaining candidates
function totalCandidates(state) {
  let n = 0;
  for (let i = 0; i < state.size; i++) n += state.candidates[i].size;
  return n;
}

// ---------------------------------------------------------------------------
// Reasoning reconstruction — why was this placement forced?
// Analyzes the BEFORE-state to explain each new placement.
// ---------------------------------------------------------------------------

function buildReasonings(state, placements) {
  const reasons = [];
  for (const p of placements) {
    const reg = p.regionId;
    const cands = state.candidates[reg];
    const reason = findPlacementReason(state, reg, [p.row, p.col]);
    if (reason) reasons.push(reason);
    else reasons.push(`R${reg} → (${p.row},${p.col})`);
  }
  return reasons;
}

function findPlacementReason(state, regId, targetCell) {
  const cands = state.candidates[regId];
  const [tr, tc] = targetCell;

  // Naked single: region has exactly 1 candidate
  if (cands.size === 1) {
    return `R${regId} had only 1 candidate left: (${tr},${tc})`;
  }

  // Row ownership: this is the only region with candidates in this row
  const unplaced = [];
  for (let i = 0; i < state.size; i++) {
    if (!state.placed.has(i)) unplaced.push(i);
  }

  let regionsInRow = 0;
  for (const r of unplaced) {
    for (const k of state.candidates[r]) {
      const [cr] = cellPos(k);
      if (cr === tr) { regionsInRow++; break; }
    }
  }
  if (regionsInRow === 1) {
    return `row ${tr} can only hold a queen from R${regId}`;
  }

  let regionsInCol = 0;
  for (const r of unplaced) {
    for (const k of state.candidates[r]) {
      const [, cc] = cellPos(k);
      if (cc === tc) { regionsInCol++; break; }
    }
  }
  if (regionsInCol === 1) {
    return `column ${tc} can only hold a queen from R${regId}`;
  }

  // Region confined to single row/col and that row/col is owned
  const rows = new Set(), cols = new Set();
  for (const k of cands) { const [r, c] = cellPos(k); rows.add(r); cols.add(c); }
  if (rows.size === 1 && regionsInRow <= 2) {
    return `R${regId} confined to row ${tr}`;
  }
  if (cols.size === 1 && regionsInCol <= 2) {
    return `R${regId} confined to column ${tc}`;
  }

  // Fallback: just state the placement
  return null;
}

// ---------------------------------------------------------------------------
// Build human-readable detail from placements + eliminations + reasoning
// ---------------------------------------------------------------------------

function buildDetailText(stateBefore, placements, eliminated, totalCands) {
  const parts = [];

  if (placements.length > 0) {
    // Show WHY each placement was forced
    const reasons = buildReasonings(stateBefore, placements);
    for (const reason of reasons) {
      parts.push(`<span class="reason">Because ${reason}</span>`);
    }
    parts.push(
      `<strong>Placed:</strong> ${placements.map(p => `R${p.regionId} → (${p.row}, ${p.col})`).join(', ')}`
    );
  }

  if (Object.keys(eliminated).length > 0) {
    const elimParts = [];
    for (const [reg, cells] of Object.entries(eliminated)) {
      elimParts.push(`R${reg}: ${cells.map(([r, c]) => `(${r},${c})`).join(', ')}`);
    }
    parts.push(`<strong>Eliminated:</strong> ${elimParts.join('; ')}`);
  }

  if (parts.length === 0) {
    return 'No change.';
  }

  parts.push(`Total candidates: <em>${totalCands}</em>`);
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Instrumented solve loop — records every step with full diffs + reasoning
// Basic elimination is handled incrementally within each technique that places queens.
// This avoids the O(N³) full-scan that ran on every iteration.
// ---------------------------------------------------------------------------

export function inspectSolve(regions, size) {
  const state = createSolverState(regions, size);
  const steps = [];
  let stepNum = 0;
  let stalls = 0;

  while (!isSolved(state) && !isContradiction(state)) {
    let anyChanged = false;

    // Run techniques in order — stop after first one that changes state.
    // Each technique handles its own incremental elimination internally,
    // so we record combined per-technique changes (placements + eliminations).
    for (let ti = 0; ti < TECH_FUNCTIONS.length; ti++) {
      const beforeCands = snapshotCandidates(state);
      const beforePlaced = snapshotPlacements(state);
      const result = TECH_FUNCTIONS[ti](state);
      if (result.contradiction) {
        steps.push({ step: ++stepNum, technique: TECH_NAMES[ti], badge: 'contradiction', detail: 'Contradiction detected — board is unsolvable.' });
        return { solved: false, steps };
      }

      if (result.changed) {
        const afterCands = snapshotCandidates(state);
        const afterPlaced = snapshotPlacements(state);
        const placements = diffPlacements(beforePlaced, afterPlaced);
        const eliminated = diffCandidates(beforeCands, afterCands);
        anyChanged = true;

        // Reconstruct BEFORE-state so reasoning sees the state that forced each placement
        const beforeState = reconstructBeforeState(beforeCands, beforePlaced, size);
        steps.push({ step: ++stepNum, technique: TECH_NAMES[ti], badge: placements.length ? 'placement' : 'elimination', detail: buildDetailText(beforeState, placements, eliminated, totalCandidates(state)) });
        break; // restart main loop after a change
      } else {
        // Record no-op for transparency (only first few to avoid noise)
        if (steps.length < 3 || steps.at(-1)?.badge !== 'nothing') {
          steps.push({ step: ++stepNum, technique: TECH_NAMES[ti], badge: 'nothing', detail: 'No change.' });
        } else {
          // Compress consecutive no-ops
          steps.at(-1).detail += ` <em>${TECH_NAMES[ti]} also had no effect.</em>`;
        }
      }
    }

    if (!anyChanged) stalls++;
    else stalls = 0;
    if (stalls >= 3) {
      steps.push({ step: ++stepNum, technique: '—', badge: 'stuck', detail: `Solver stalled. Placed ${state.placed.size}/${size} regions.` });
      break;
    }
  }

  if (isSolved(state)) {
    const sol = new Map(state.placed);
    return { solved: true, steps, solution: sol };
  }

  // Partial result — solver couldn't finish
  const unplaced = [];
  for (let i = 0; i < state.size; i++) {
    if (!state.placed.has(i)) unplaced.push(`R${i} (${state.candidates[i].size} candidates)`);
  }
  steps.push({ step: ++stepNum, technique: '—', badge: 'stuck', detail: `Could not solve. Unplaced: ${unplaced.join(', ')}.` });
  return { solved: false, steps };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const REGION_COLORS = [
  '#F06292','#BA68C8','#7986CB','#4FC3F7','#4DB6AC','#81C784',
  '#D4E157','#FFD54F','#FF9800','#E57373','#FF8A65','#AED581',
];

function renderBoardPreview(regions, size, solution) {
  const container = document.getElementById('board-preview');
  const cellSize = Math.min(560 / size, 60);

  let html = `<h2>Board Preview (${size}×${size})</h2>`;
  html += `<div class="solution-grid" style="grid-template-columns:repeat(${size}, ${cellSize}px); width:${cellSize * size}px;">`;

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const reg = regions[r][c];
      const isSol = solution && [...solution].some(([sr, sc]) => sr === r && sc === c);
      html += `<div class="solution-cell ${isSol ? 'has-queen' : ''}" style="background:${REGION_COLORS[reg % REGION_COLORS.length]};width:${cellSize}px;" title="R${reg} (${r},${c})"></div>`;
    }
  }

  html += '</div>';
  container.innerHTML = html;
}

function renderSteps(steps) {
  const container = document.getElementById('steps-section');
  let html = `<h2>Solving Steps (${steps.length} steps)</h2>`;

  for (const s of steps) {
    const badgeClass = s.badge === 'placement' ? 'badge-placement' :
                       s.badge === 'elimination' ? 'badge-elimination' :
                       s.badge === 'contradiction' ? 'badge-elimination' :
                       s.badge === 'stuck' ? 'badge-elimination' : 'badge-nothing';
    const badgeLabel = s.badge === 'placement' ? '✓ Placement' :
                       s.badge === 'elimination' ? '✂ Elimination' :
                       s.badge === 'contradiction' ? '✗ Contradiction' :
                       s.badge === 'stuck' ? '⚠ Stalled' : '— No change';

    // Determine if detail is long (needs expand/collapse)
    const isLong = s.detail.length > 120;
    const collapsedClass = isLong ? ' collapsed' : '';

    html += `<div class="step-card${collapsedClass}" data-step="${s.step}">`;
    html += `<div class="step-header"><span class="step-number">${s.step}</span><span class="step-technique">${s.technique}</span><span class="step-badge ${badgeClass}">${badgeLabel}</span>`;
    if (isLong) {
      html += `<button class="step-expand-btn" onclick="this.parentElement.parentElement.classList.toggle('collapsed'); this.textContent = this.parentElement.parentElement.classList.contains('collapsed') ? '▸' : '▾';">▸</button>`;
    }
    html += `</div>`;
    html += `<div class="step-detail">${s.detail}</div>`;
    html += `</div>`;
  }

  container.innerHTML = html;
}

function renderSolution(solution, size) {
  const container = document.getElementById('solution-section');
  const cellSize = Math.min(560 / size, 60);
  const entries = [...solution].sort((a, b) => a[0]);

  let html = `<h2>♛ Solution Key</h2>`;
  html += `<div class="solution-list">`;
  for (const [regId, cell] of entries) {
    const [r, c] = cellPos(cell);
    html += `<span class="solution-chip">Region ${regId} → (${r}, ${c})</span>`;
  }
  html += `</div>`;

  // Also render as a grid with queens shown
  html += `<div style="margin-top:20px;"><h3 style="font-family:'Fredoka One',cursive;color:#333;margin-bottom:12px;">Visual Solution</h3>`;
  html += `<div class="solution-grid" style="grid-template-columns:repeat(${size}, ${cellSize}px); width:${cellSize * size}px;">`;

  const queenSet = new Set(entries.map(([, cell]) => cell));
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const hasQ = queenSet.has(cellKey(r, c));
      html += `<div class="solution-cell ${hasQ ? 'has-queen' : ''}" style="background:#e8e8e8;width:${cellSize}px;"></div>`;
    }
  }

  html += '</div></div>';
  container.innerHTML = html;
}

function renderFailure(steps) {
  const container = document.getElementById('solution-section');
  container.innerHTML = `<h2 style="color:#e74c3c;">⚠ Could Not Solve</h2><p>The solver could not find a complete solution. This board may require techniques beyond logical deduction, or it may be malformed.</p>`;
}

// ---------------------------------------------------------------------------
// App wiring
// ---------------------------------------------------------------------------

function showError(msg) {
  const el = document.getElementById('error-msg');
  el.textContent = msg;
  el.classList.add('visible');
}

function hideError() {
  document.getElementById('error-msg').classList.remove('visible');
}

function handleSolve() {
  hideError();
  const raw = document.getElementById('board-input').value.trim();
  if (!raw) { showError('Please paste a board definition.'); return; }

  let data;
  try { data = JSON.parse(raw); } catch (e) { showError(`Invalid JSON: ${e.message}`); return; }

  const { size, regions: regionRows } = data;
  if (!size || !regionRows) { showError('Board must have "size" and "regions".'); return; }

  // Parse region rows — accept both formats:
  //   Copy Board: ["0 1 2 ...", "3 4 5 ...", ...] (space-separated strings)
  //   Fixtures:   [[0,1,2,...], [3,4,5,...], ...] (nested arrays)
  const regions = [];
  for (const row of regionRows) {
    if (typeof row === 'string') {
      regions.push(row.split(/\s+/).map(Number));
    } else if (Array.isArray(row)) {
      regions.push(row.map(Number));
    } else {
      showError('Each region row must be a string or array.'); return;
    }
  }

  if (regions.length !== size) { showError(`Region grid has ${regions.length} rows but size is ${size}.`); return; }
  for (let r = 0; r < size; r++) {
    if (regions[r].length !== size) { showError(`Row ${r} has ${regions[r].length} cells but size is ${size}.`); return; }
  }

  const result = inspectSolve(regions, size);

  // Show results
  document.getElementById('results').classList.add('visible');

  // Board preview (with solution queens if solved)
  renderBoardPreview(regions, size, result.solution);

  // Steps
  renderSteps(result.steps);

  // Solution or failure
  if (result.solved) {
    renderSolution(result.solution, size);
  } else {
    renderFailure(result.steps);
  }

  // Scroll to results
  document.getElementById('results').scrollIntoView({ behavior: 'smooth' });
}

// Load fixtures from test/fixtures.json for quick testing
async function loadFixtures() {
  try {
    const resp = await fetch('test/fixtures.json');
    if (!resp.ok) return;
    const fixtures = await resp.json();
    const select = document.getElementById('fixture-select');

    // Fixtures are an array of { name, size, regions: [[...], ...] }
    for (const board of fixtures) {
      const opt = document.createElement('option');
      opt.value = JSON.stringify(board);
      opt.textContent = `${board.name} (${board.size}×${board.size})`;
      select.appendChild(opt);
    }

    select.addEventListener('change', () => {
      if (select.value) {
        document.getElementById('board-input').value = select.value;
        hideError();
      }
    });
  } catch (e) {
    // Fixtures not available — that's fine
  }
}

// Init — only in browser
if (typeof document !== 'undefined') {
  document.getElementById('btn-solve').addEventListener('click', handleSolve);
  loadFixtures();
}
