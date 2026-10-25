# ♛ Queendom

Do you want to play the LinkedIn Queens game, but don't want to settle for one measly puzzle per day? Now, through the power of AI slop, you can!

Queendom is a browser-based game with three simple rules:

1. One queen per color.
2. One queen per row or column.
3. Queens can't touch.

Board sizes range from 6x6 to 12x12, with three difficulty levels so everyone can enjoy. Additionally, this version of the game uses procedural board generation, and uses a logical solver to double-check results, so it's essentially infinite games for everyone with no guessing required!

How great is that?!

## How to Play

1. Choose your board size (**6×6** through **12×12**) and difficulty (Easy, Medium, Hard) from the dropdowns at the top.
2. **Double-click** a square to place a queen.
3. **Single-click** a square to toggle an X mark (click again to remove).
4. Press **P** or click **Pause** to pause, press **N** for a new game.

You start with 3 lives ❤️❤️❤️ shown in the status bar. An incorrect queen placement costs one life and leaves a permanent red ✗ on that cell (marked as dead). Place all N queens correctly to win.

### Rules

1. No two queens may occupy the same row or column.
2. No queen may be adjacent to another (including diagonally — Chebyshev distance > 1).
3. Each colored region contains exactly one queen.

This is similar to N-Queens, but with the added constraint of non-adjacency and the guidance of colored regions that make every board solvable by logic alone.

## Playing

Open `index.html` in a browser, or serve locally:

```bash
npx serve .
```

No build step is needed — plain HTML/CSS/JS with ESM modules.

### Debug Mode

Append `?debug=1` to the URL to reveal the **Copy Board** button, which serializes the current board definition (regions + solution) as JSON for debugging or sharing.

```
http://localhost:3000/?debug=1
```

## Development

```bash
npm install        # install dev dependencies (vitest)
npm test           # run all tests once
npm run test:watch # run tests in watch mode
```

## Architecture

The codebase follows a unidirectional pipeline: **Generator → Solver → Engine → Renderer**.

| Module | Role |
|---|---|
| `js/generator.js` | Creates boards: places N non-adjacent queen positions, grows colored regions around them via BFS, then validates solvability. Uses a seeded PRNG for reproducibility. |
| `js/solver.js` | Human-style logical solver with 8 techniques: basic elimination, naked singles, hidden singles, region confinement, pigeonhole/groupings, adjacency blocking, row/col intersections, and forcing chains. Validates generated boards are solvable within difficulty constraints. |
| `js/engine.js` | Pure-logic game state machine. No DOM. Manages placement validation, marks, lives, timer, and win/lose detection. |
| `js/renderer.js` | DOM rendering. Reads game state and updates the board UI. |
| `js/main.js` | Entry point. Wires renderer callbacks to engine, manages timer and overlays. |
| `js/prng.js` | Mulberry32 seeded PRNG with helpers for reproducible randomness. |

### Difficulty Tiers

| Tier | Techniques | Forcing Chains |
|---|---|---|
| **Easy** | Basic elimination, naked singles, hidden singles, region confinement, pigeonhole, adjacency blocking, row/col intersections | None |
| **Medium** | All above techniques | Up to 1 attempt |
| **Hard** | All techniques including forcing chains | Up to 2 attempts |

*Forcing chains* temporarily assume a candidate is correct and check if it leads to a contradiction — this allows the solver to eliminate impossible candidates even when direct deduction isn't enough.

### Board Generation

1. Generate N non-adjacent queen positions (no shared rows/columns)
2. Seed each colored region at its corresponding queen position
3. Grow regions via BFS frontier expansion weighted by difficulty (smaller regions favored for easier puzzles)
4. Run the solver to validate logical solvability within difficulty constraints
5. On failure, attempt guided mutation — shrinking the most-stuck region and retrying — before a full regeneration
6. Repeat up to 1000 attempts; if all fail, display a "Puzzle Build Failed" screen with a retry button

## Project Structure

```
css/style.css           Shared game styling
js/
  generator.js          Board generation with seeded PRNG & BFS region growth
  solver.js             Logical deduction engine (8 techniques)
  solver-viewer.js      Solver step-inspector for debugging boards
  engine.js             Pure-logic game state machine (no DOM)
  renderer.js           DOM rendering + click handling
  main.js               Entry point — wires everything together
  prng.js               Mulberry32 seeded PRNG
plan/                   Design documents (gameplay, strategy, structure, style)
test/
  generator.test.js     Solution validity, region connectivity, solvability, PRNG reproducibility
  solver.test.js        Individual techniques, full solve on fixtures, difficulty validation
  engine.test.js        Game creation, placement, marks, timer, win/lose conditions
  fixtures.json         Static boards (6×6–10×10) with known solutions
index.html              Main game entry point
solver-viewer.html      Solver inspector — paste a board definition and watch the solver walk through it step by step
```

### Debugging Tools

- **Solver Viewer** (`solver-viewer.html`): Paste a board definition (use the "Copy Board" button in debug mode to get one) and watch the solver walk through every deduction step with a detailed, human-readable walkthrough.
- **Debug Mode**: Append `?debug=1` to any URL to reveal the **📋 Copy Board** button.

## Tests

```bash
npm test           # run all tests once
npm run test:watch # watch mode
```

| Test Suite | What It Covers |
|---|---|
| **Generator** | Solution validity, region connectivity, solvability guarantee, PRNG reproducibility, fixture validation |
| **Solver** | Individual technique rules, full solve on fixtures (6×6–10×10), difficulty classification enforcement |
| **Engine** | Game creation, queen placement validation, mark toggling, timer behavior, win/lose detection
