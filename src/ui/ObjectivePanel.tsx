/**
 * Objective, expected result, sample input and hints for the active puzzle.
 *
 * Hints are revealed one at a time rather than shown as a list. The first is a
 * nudge towards noticing the problem, the last names the fix, so handing over
 * all three at once would give the answer away to someone who only wanted a
 * push.
 */

import { useState } from 'react'
import { useApp } from '../store'
import { JsonView } from './JsonView'

export function ObjectivePanel() {
  const puzzle = useApp((s) => s.puzzle)
  const hintsRevealed = useApp((s) => s.hintsRevealed)
  const revealHint = useApp((s) => s.revealHint)
  const [showInput, setShowInput] = useState(false)

  return (
    <div className="pane__section">
      <div className="pane__title">
        <span>Objective</span>
        <span className={`badge badge--${puzzle.difficulty}`}>{puzzle.difficulty}</span>
      </div>

      <div className="objective__call">{puzzle.challengeCall}</div>
      <p className="objective__text">{puzzle.objective}</p>

      <div className="objective__expected">
        <strong style={{ color: 'var(--ink-1)' }}>Expected result</strong>
        <br />
        {puzzle.expectedResult}
      </div>

      <div className="row" style={{ marginTop: 10 }}>
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          onClick={() => setShowInput((v) => !v)}
          aria-expanded={showInput}
        >
          {showInput ? '▾' : '▸'} Sample input
        </button>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          className="btn btn--sm"
          onClick={revealHint}
          disabled={hintsRevealed >= puzzle.hints.length}
        >
          {hintsRevealed === 0
            ? 'Need a hint?'
            : hintsRevealed >= puzzle.hints.length
              ? 'No hints left'
              : 'Next hint'}
        </button>
      </div>

      {showInput && <JsonView value={puzzle.sampleInput} className="code--sm" />}

      {puzzle.hints.slice(0, hintsRevealed).map((hint, i) => (
        <div className="hint" key={hint}>
          <span className="hint__n">{i + 1}.</span>
          {hint}
        </div>
      ))}
    </div>
  )
}
