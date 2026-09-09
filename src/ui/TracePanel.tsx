/**
 * The execution trace.
 *
 * A user should be able to understand a run without reading backend
 * logs, so every entry carries its own input, output, attempt history,
 * validation result and human decision. Failed and paused entries open by
 * default, because those are the ones a learner needs to read.
 */

import { useEffect, useState } from 'react'
import { useApp } from '../store'
import { JsonView } from './JsonView'
import { BLOCK_LIBRARY } from '../engine/blocks'
import type { StepStatus, TraceEntry } from '../engine/types'

const STATUS_BADGE: Record<StepStatus, string> = {
  pending: 'badge',
  running: 'badge badge--info',
  retrying: 'badge badge--info',
  completed: 'badge badge--ok',
  recovered: 'badge badge--ok',
  failed: 'badge badge--bad',
  paused: 'badge badge--pause',
  safelyStopped: 'badge badge--warn',
  skipped: 'badge',
}

const STATUS_TEXT: Record<StepStatus, string> = {
  pending: 'pending',
  running: 'running',
  retrying: 'retrying',
  completed: 'completed',
  recovered: 'recovered',
  failed: 'failed',
  paused: 'paused',
  safelyStopped: 'stopped',
  skipped: 'skipped',
}

function TraceItem({ entry, index }: { entry: TraceEntry; index: number }) {
  const interesting =
    entry.status === 'failed' ||
    entry.status === 'paused' ||
    entry.status === 'safelyStopped' ||
    entry.validation?.valid === false
  const [open, setOpen] = useState(interesting)

  // Keep an entry open once it becomes interesting mid-run.
  useEffect(() => {
    if (interesting) setOpen(true)
  }, [interesting])

  const def = BLOCK_LIBRARY[entry.kind]
  const duration = entry.endedAt ? entry.endedAt - entry.startedAt : undefined

  return (
    <div className="trace-item">
      <button
        type="button"
        className="trace-item__head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="trace-item__index">{index + 1}</span>
        <span aria-hidden>{def.glyph}</span>
        <span className="trace-item__title">{entry.stepTitle}</span>
        {duration !== undefined && duration > 0 && (
          <span style={{ color: 'var(--ink-3)', fontSize: 11 }}>{duration}ms</span>
        )}
        <span className={STATUS_BADGE[entry.status]}>{STATUS_TEXT[entry.status]}</span>
        <span style={{ color: 'var(--ink-3)', fontSize: 11 }}>{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="trace-item__body">
          {entry.message && (
            <div
              className={`trace-item__msg${
                entry.status === 'failed'
                  ? ' trace-item__msg--bad'
                  : entry.status === 'recovered'
                    ? ' trace-item__msg--good'
                    : ''
              }`}
            >
              {entry.message}
            </div>
          )}

          {entry.recovery !== 'none' && (
            <div className="row row--wrap" style={{ marginBottom: 8 }}>
              <span className="chip chip--fallback">recovery: {entry.recovery}</span>
            </div>
          )}

          {entry.attempts.length > 0 && (
            <>
              <div className="trace-label">Attempts</div>
              {entry.attempts.map((attempt) => (
                <div
                  key={`${attempt.attempt}-${attempt.status}`}
                  className={`attempt attempt--${attempt.status}`}
                >
                  <span className="attempt__n">#{attempt.attempt}</span>
                  <span className="attempt__text">
                    {attempt.status === 'completed' ? 'Succeeded' : attempt.error}
                  </span>
                  {attempt.usedFallback && <span className="chip chip--fallback">fallback</span>}
                  <span style={{ color: 'var(--ink-3)', fontSize: 10.5 }}>
                    {attempt.durationMs}ms
                  </span>
                </div>
              ))}
            </>
          )}

          {entry.validation && (
            <>
              <div className="trace-label">
                Validation · {entry.validation.schemaId}{' '}
                <span
                  className={
                    entry.validation.valid ? 'badge badge--ok' : 'badge badge--bad'
                  }
                >
                  {entry.validation.valid ? 'valid' : 'invalid'}
                </span>
              </div>
              {!entry.validation.valid && (
                <ul className="issue-list">
                  {entry.validation.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              )}
            </>
          )}

          {entry.humanDecision && (
            <>
              <div className="trace-label">Human decision</div>
              <div className="attempt">
                <span
                  className={
                    entry.humanDecision.verdict === 'rejected'
                      ? 'badge badge--bad'
                      : 'badge badge--ok'
                  }
                >
                  {entry.humanDecision.verdict}
                </span>
                <span className="attempt__text">
                  {entry.humanDecision.note || 'No note recorded.'}
                </span>
              </div>
            </>
          )}

          <div className="trace-label">Input</div>
          <JsonView value={entry.input} compact />

          {entry.output !== undefined && (
            <>
              <div className="trace-label">Output</div>
              <JsonView value={entry.output} compact />
            </>
          )}
        </div>
      )}
    </div>
  )
}

export function TracePanel() {
  const run = useApp((s) => s.run)

  if (!run || run.entries.length === 0) {
    return (
      <div className="empty">
        <div className="empty__glyph">📡</div>
        Run the workflow to see every step, its input, its output and anything that went wrong.
      </div>
    )
  }

  return (
    <div>
      {run.entries.map((entry, i) => (
        <TraceItem key={`${entry.stepId}-${i}`} entry={entry} index={i} />
      ))}

      {run.stopReason && (
        <div className="pane__section">
          <div className="trace-label">Why the run ended</div>
          <div
            className={`trace-item__msg${
              run.status === 'failed' ? ' trace-item__msg--bad' : ''
            }`}
          >
            {run.stopReason}
          </div>
        </div>
      )}

      {run.finalOutput !== undefined && (
        <div className="pane__section">
          <div className="trace-label">Final output</div>
          <JsonView value={run.finalOutput} />
        </div>
      )}
    </div>
  )
}
