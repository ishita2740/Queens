# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working in this repository.

## Project Overview

**Queendom** — a browser puzzle game where players place N queens on an NxN grid divided into N colored regions. One queen per region, no two queens share a row/column, and no two queens are adjacent (Chebyshev distance > 1). Boards are algorithmically generated and validated by a human-style logical solver before being presented to the player.

Plain HTML/CSS/JS with ESM modules. No build step — served directly via any static HTTP server.

## Commands

| Command | Purpose |
|---|---|
| `npm test` | Run all tests once (vitest) |
| `npm run test:watch` | Run tests in watch mode |

Tests run in Node environment via vitest (`vitest.config.js`). Timeout is 60s per test — board generation can be slow on larger sizes.

## Architecture

The codebase follows a unidirectional pipeline: **Generator → Solver → Engine → Renderer**.

See `plan/structure.md` for more information.

### Core modules (`js/`)

| File | Role |
|---|---|
| `cell.js` | Shared cell coordinate utilities. Exports `cellKey(r, c)` → `r * 100 + c` and `cellPos(key)` → `[row, col]`. Import this instead of defining your own — it is the single source of truth for all cell encoding across the codebase. |
| `generator.js` | Creates boards: places N non-adjacent queen positions, grows regions around them via BFS frontier growth (O(N²) neighbor-only scan), then validates solvability. Uses a seeded PRNG for reproducibility. On solver failure, attempts guided mutation — shrinking the most-stuck region and retrying — before full regeneration. |
| `solver.js` | Human-style logical solver with 8 technique tiers: basic elimination (i, always runs), naked singles (ii), hidden singles (iii), region confinement (iv), pigeonhole/groupings (v), adjacency blocking (vi), row/col intersections (vii), forcing chains (viii). Returns `{ solved, placements, diagnostics }`. The `placements` value is a `Map<regionId, cellKey>`. Technique registry uses named constants (`TECHNIQUE_NAMES`, `TECHNIQUE_INDEX`) — do not use magic indices. |
| `engine.js` | Pure-logic game state machine. No DOM. Manages queen placement validation against the solution set, marks (X / dead), lives (3), timer, win/lose detection. Exports `createGame()`, `placeQueen()`, `toggleMark()`, etc. Imports cell utilities from `cell.js`. |
| `renderer.js` | DOM rendering. Reads game state and updates the board UI. Calls back to engine on user interaction. SVG icons (queens, X marks) are defined as `<template>` elements in `index.html` — fetched via `_getTemplateSVG()`. Imports cell utilities from `cell.js`. |
| `main.js` | Entry point. Wires renderer callbacks to engine functions, manages timer interval, handles pause/resume overlays, keyboard shortcuts (P = pause, N = new game). Includes input validation for board size (6–12) and difficulty before passing to the generator. |
| `prng.js` | Mulberry32 seeded PRNG with helpers: `rngFloat()`, `rngInt()`, `rngShuffle()` |

### Cell key encoding

Cell positions are encoded as `r * 100 + c` (supports boards up to 99x99). Decode with `[Math.floor(key / 100), key % 100]`. The shared implementation lives in `js/cell.js` — import it from there instead of defining your own. All modules that need cell encoding should use this single source of truth: `cellKey(r, c)` and `cellPos(key)`.

### Board generation flow

1. Generate N queen positions: no shared rows/cols, no adjacent queens
2. Seed each region at its queen position (`regions[r][c] = regionId`)
3. Grow regions via BFS — pick frontier cells (unassigned neighbors of assigned cells) weighted by difficulty (easy = favor smaller regions)
4. Run the solver to validate the board is logically solvable within difficulty constraints
5. If solver fails and the board is "close enough" (≥50% placed, no contradiction), mutate stuck region boundaries and retry solver; only mutate regions, not queen locations.
6. Repeat up to 50,000 attempts (larger boards like 12×12 may need 10K+ before finding a valid configuration)

### Difficulty tiers

The solver follows the solution patterns explained in `plan/strategy.md`. Technique numbers use Roman numerals matching the solver's internal registry:

- **Easy**: solvable with techniques i–v only (basic elimination through pigeonhole), zero forcing chains. All regions are small anchors.
- **Medium**: techniques i–vi allowed (adds adjacency blocking), up to 1 forcing chain.
- **Hard**: techniques i–vii + 2 forcing chains allowed (adds row/col intersections). Requires advanced deduction for some puzzles.

### Tests (`test/`)

- `generator.test.js` — solution validity, region connectivity, solvability, PRNG reproducibility, fixture validation
- `solver.test.js` — individual technique rules, full solve on fixtures, difficulty validation (sizes 6–10), edge cases
- `engine.test.js` — game creation, queen placement, marks, timer behavior, win/lose conditions
- `fixtures.json` — static boards (6x6 through 10x10) with known solutions for regression testing

### Gameplay 

Rules for how the game functions are in `plan/gameplay.md`.

Key constraints: boards must be solvable by logical deduction alone (no guessing), regions are connected, and each region contains exactly one queen.

### Styling

Game styling is found in `plan/style.md`.

Essentially: be fun and whimsical
