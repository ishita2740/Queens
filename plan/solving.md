# Game Pattern Solving Strategies

Solving Queens relies on several heuristics of varying implementation difficulty.

## Glossary

Some terminology is necessary to describe these techniques.

* **Region** - The colored area where a queen _may_ appear. There are multiple of these per puzzle.
* **House** - Collectively refers to any singular row or column.

## Strategies

These are the known approaches, in perceived order of complexity:

1. **Basic elimination** - Anywhere a queen is placed, exclude all 8 cells around the queen, cells in the same house, or in the region containing the cell.
2. **Naked single** - A region with only one cell, which must contain a queen.
3. **Hidden single** - Following multiple eliminations, any region or house where one cell is the single remaining option must contain a queen.
4. **Pointing** - When two or more cells of the same region may only appear in a single house, exclude all cells outside that region within the house.
5. **Naked pairs** - When two regions are restricted to only two houses, exclude cells from any other region in those houses.
6. **House claim** - When the only options for any house are from a single region, exclude all region cells outside that house.
7. **Contradiction** - Exclude any cell that would reduce valid options for a region or house to zero.
8. **Naked triple** - When three regions are restricted to only three houses, exclude cells from any other region in those houses.
9. **Double contradiction** - Exclude any cell that would reduce valid options for two regions to a single house.
10. **Hidden pair** - When one region is restricted to three houses and a second region is the only legal option to fulfill the second house, exclude cells outside that house from the second region.
11. **Naked quad** - When four regions are restricted to only four houses, exclude cells from any other region in those houses.
12. **Hidden triple** - When two regions are restricted to three houses and a third region is the only legal option to fulfill the third house, exclude cells outside that house from the third region.
13. **Hidden quad** - When two or three regions are restricted to four houses and a third and fourth region are the only legal options to fulfill the third and fourth house, exclude cells outside those house from the third and forth region.
14. **Triple contradiction** - Exclude any cell that would reduce valid options for three regions to fewer than three houses.
15. **Quad contradiction** - Exclude any cell that would reduce valid options for four regions to fewer than four houses.
16. **N Set** - When any N regions exist entirely within any N houses, eliminate cells from other regions in those houses. This covers naked N above 4.
17. **Forcing chain** - Choosing a candidate cell as a queen and using all previous techniques to make exclusions until there is either a contradiction, or the puzzle is solved. Humans would do this mentally, solvers can clone the board state.


