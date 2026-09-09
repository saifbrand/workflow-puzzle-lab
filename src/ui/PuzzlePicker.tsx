/**
 * The puzzle list, grouped by difficulty.
 *
 * Solved puzzles keep a tick so a learner can see their way through the set.
 * Progress is session-scoped on purpose: this is a lab, not a course with an
 * account behind it.
 */

import { useApp } from '../store'
import { DIFFICULTY_LABEL, DIFFICULTY_ORDER, puzzlesByDifficulty } from '../puzzles'

export function PuzzlePicker() {
  const current = useApp((s) => s.puzzle)
  const solved = useApp((s) => s.solved)
  const loadPuzzle = useApp((s) => s.loadPuzzle)

  return (
    <div className="pane__section">
      <div className="pane__title">
        <span>Puzzles</span>
        <span className="badge">
          {solved.length}/{DIFFICULTY_ORDER.reduce((n, d) => n + puzzlesByDifficulty(d).length, 0)}
        </span>
      </div>

      {DIFFICULTY_ORDER.map((level) => (
        <div className="puzzle-group" key={level}>
          <div className="puzzle-group__label">{DIFFICULTY_LABEL[level]}</div>
          {puzzlesByDifficulty(level).map((puzzle) => {
            const active = puzzle.id === current.id
            return (
              <button
                key={puzzle.id}
                type="button"
                className={`puzzle-card${active ? ' puzzle-card--active' : ''}`}
                onClick={() => loadPuzzle(puzzle.id)}
                aria-current={active ? 'true' : undefined}
              >
                <div className="puzzle-card__top">
                  <span className="puzzle-card__title">{puzzle.title}</span>
                  {solved.includes(puzzle.id) && (
                    <span className="puzzle-card__solved" title="Solved" aria-label="Solved">
                      ✓
                    </span>
                  )}
                </div>
                <div className="puzzle-card__tagline">{puzzle.tagline}</div>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
