/**
 * The reliability report.
 *
 * A score on its own teaches nothing, so the score sits next to the specific
 * behaviours that earned or cost it. Strengths are listed as well as weaknesses
 * because a learner needs to know which of their choices actually did the work,
 * not only what is still missing.
 */

import { useApp } from '../store'
import type { ReliabilityReport } from '../engine/types'

const GRADE_COLOR: Record<ReliabilityReport['grade'], string> = {
  fragile: 'var(--bad)',
  brittle: 'var(--warn)',
  resilient: 'var(--ok)',
  bulletproof: 'var(--teal)',
}

const GRADE_NOTE: Record<ReliabilityReport['grade'], string> = {
  fragile: 'This workflow breaks the moment anything goes wrong.',
  brittle: 'It survives some faults, but there are gaps a real outage would find.',
  resilient: 'It handles what was thrown at it and fails in ways you could defend.',
  bulletproof: 'Defensive at every layer, and honest about what it cannot do.',
}

function Ring({ score, grade }: { score: number; grade: ReliabilityReport['grade'] }) {
  const color = GRADE_COLOR[grade]
  return (
    <div
      className="score__ring"
      style={{
        background: `conic-gradient(${color} ${score * 3.6}deg, var(--bg-3) 0deg)`,
      }}
      role="img"
      aria-label={`Reliability score ${score} out of 100`}
    >
      <div
        style={{
          position: 'absolute',
          inset: 6,
          borderRadius: '50%',
          background: 'var(--bg-1)',
        }}
      />
      <span className="score__ring-value" style={{ color }}>
        {score}
      </span>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
    </div>
  )
}

export function ReliabilityPanel() {
  const report = useApp((s) => s.report)
  const puzzle = useApp((s) => s.puzzle)

  if (!report) {
    return (
      <div className="empty">
        <div className="empty__glyph">📊</div>
        Once a run finishes you will get a reliability score, what your design got right, and what
        is still exposed.
      </div>
    )
  }

  return (
    <div>
      {report.puzzleSolved ? (
        <div className="solved-banner">
          <span className="solved-banner__glyph" aria-hidden>
            🎉
          </span>
          <div>
            <div className="solved-banner__title">Puzzle solved</div>
            <div className="solved-banner__sub">
              Every completion criterion for {puzzle.title} is met.
            </div>
          </div>
        </div>
      ) : (
        <div className="unsolved-banner">
          <div className="unsolved-banner__title">Not solved yet</div>
          <ul className="criteria">
            {report.unmetCriteria.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="score">
        <Ring score={report.score} grade={report.grade} />
        <div className="score__meta">
          <div className="score__grade" style={{ color: GRADE_COLOR[report.grade] }}>
            {report.grade}
          </div>
          <div className="score__sub">{GRADE_NOTE[report.grade]}</div>
        </div>
      </div>

      <div className="stat-grid">
        <Stat
          label="Completed"
          value={report.completed ? 'Yes' : report.stoppedSafely ? 'Stopped safely' : 'No'}
          tone={report.completed || report.stoppedSafely ? 'var(--ok)' : 'var(--bad)'}
        />
        <Stat
          label="Output valid"
          value={report.outputValid ? 'Yes' : 'No'}
          tone={report.outputValid ? 'var(--ok)' : 'var(--bad)'}
        />
        <Stat
          label="Injected failure handled"
          value={report.injectedFailureHandled ? 'Yes' : 'No'}
          tone={report.injectedFailureHandled ? 'var(--ok)' : 'var(--bad)'}
        />
        <Stat label="Retry attempts" value={String(report.retryAttempts)} />
        <Stat
          label="Fallback activated"
          value={report.fallbackActivated ? 'Yes' : 'No'}
          tone={report.fallbackActivated ? 'var(--teal)' : undefined}
        />
        <Stat
          label="Human review used"
          value={report.humanReviewUsed ? 'Yes' : 'No'}
          tone={report.humanReviewUsed ? 'var(--pause)' : undefined}
        />
        <Stat
          label="Unhandled errors"
          value={String(report.unhandledErrors)}
          tone={report.unhandledErrors > 0 ? 'var(--bad)' : 'var(--ok)'}
        />
        <Stat
          label="Stopped safely"
          value={report.stoppedSafely ? 'Yes' : 'No'}
          tone={report.stoppedSafely ? 'var(--warn)' : undefined}
        />
      </div>

      {report.findings.map((finding) => (
        <div className={`finding finding--${finding.type}`} key={finding.id}>
          <span className="finding__mark" aria-hidden>
            {finding.type === 'strength' ? '✓' : '!'}
          </span>
          <div>
            <div className="finding__title">{finding.title}</div>
            <div className="finding__detail">{finding.detail}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
