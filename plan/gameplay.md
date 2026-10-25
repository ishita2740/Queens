# Gameplay and Rules

The game works like this:

1. No queen may be adjacent to another queen.
2. No two queens may occupy the same row or column.
3. Only one queen may exist per colored region.

Note that this is _similar_ to N-Queens, but not quite, as full diagonals do not count.

To facilitate that, the game design is as follows:

1. The game is played in a square grid, where lines are visible.
2. The grid can be 6-12 blocks in width/height.
3. There are a number of queens on the board equal to the dimensions of the board.
4. The board is divided into colored areas equal to the dimensions of the board.
5. Queen placement follows the three gameplay rules.
6. Users start each game with three "lives".
7. A play timer will start once a valid board appears for user interaction.
   - It should be possible to pause or resume this timer.
   - Pausing the timer should obscure the game board with an overlay.
7. Users may place an X on any empty square by clicking it once.
   - Clicking a user-placed X should remove it.
   - There is no penalty for adding or removing these marks.
8. Double-clicking on a square should _attempt_ to place a queen.
   - If the queen is invalid based on the answer key, it should be replaced with a permanent red X.
   - Invalid queen attempts should reduce user life count by 1.
9. The game ends when all lives are lost, or all queens are found.
   - Always display a "new game" message.
   - If won, display a congratulation message, the current life count and the value on the timer.
10. New games should reset lives, the play timer, and generate a new board.

Most importantly, regarding the colored regions:

* The colored areas act as context clues to where the queens should go, and must be entirely sufficient to solve the board through logical deduction alone. The rules make limited use of obscure techniques like forcing chains, but these are still logically consistent.
* Solutions must avoid "deadly pattern" scenarios where board clues alone don't suggest all possible eliminations. Even if the solution matrix has one unique solution, it must _also_ be possible to derive this state from the color patterns.

Implementation details for these are a matter for the engine.
