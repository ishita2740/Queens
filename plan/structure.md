# Basic Game Logic

Aside from finer details, the general implementation design and structure of the game should look like this:

1. Split HTML, JS, CSS files.
2. Separate game and rendering pipelines, so you can test game state, board generation, etc, without rendering. This will help you build a solid game engine without worrying about display requirements.
3. Generate the board using just the queen positions as a base.
  - Place the colored regions _afterwards_ using Voronoi or random assignment.
  - Apply solver logic afterwards to validate generated puzzles, described below.
4. Brute force at these scales is too slow (a 10x10 has almost 500k potental layouts). So you must write a "solver" that can apply standard patterns as a human would use while solving, to validate the puzzle is usable before presenting it as a game board. The validation procedure should apply the steps described in `plan/solving.md` until the board is solved or deemed unsolvable (due to deadly patterns, ambiguity, or 2 consecutive trips through solving steps with no change in solution state).
  - Difficultly level should act as a "gate"; i.e. skip techniques assigned to higher difficulty levels
  - The solver should track the total amount of times through the technique list, and how many times it had to use each technique.
  - If two loops through the solver result in no progress or solution, fail the puzzle.
5. If a puzzle fails validation, the color regions should be "mutated" by shrinking one or more regions so they may be more likely to produce eliminations.
  - The queen should be considered immobile during this process; no mutation should ever try to move the queen.
  - Squares to be reassigned should be randomly selected along region borders.
6. For testing:
  i. Produce 3-5 static boards with known solutions to use as a base for solver tests.
  ii. Provide unit tests for all solver rules.
  iii. Use the solver against the generator until there are 5 samples of each board size from 6 to 12; store those seeds for later validation.
  iv. Include any tests you think I may have missed.
7. Do not allow a user to place a queen that is not explicitly in the answer key.
8. Tie everything together in the rendering HTML file, which calls the game engine JS via functions or hooks.
