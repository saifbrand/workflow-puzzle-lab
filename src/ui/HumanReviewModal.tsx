/**
 * The human review dialog.
 *
 * The workflow is genuinely paused while this is open: the engine is awaiting
 * the promise this component resolves. Approving, editing and rejecting are all
 * recorded on the trace, because an approval nobody can audit later is not
 * really an approval.
 */

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../store'
import type { HumanDecision } from '../engine/types'

export function HumanReviewModal() {
  const pending = useApp((s) => s.pendingReview)
  const submit = useApp((s) => s.submitReview)

  const request = pending?.request
  const initialJson = useMemo(
    () => (request ? JSON.stringify(request.value, null, 2) : ''),
    [request],
  )

  const [draft, setDraft] = useState(initialJson)
  const [note, setNote] = useState('')
  const [editing, setEditing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)

  // Reset whenever a new review arrives.
  useEffect(() => {
    setDraft(initialJson)
    setNote('')
    setEditing(false)
    setParseError(null)
  }, [initialJson])

  if (!pending || !request) return null

  const decide = (verdict: HumanDecision['verdict']) => {
    if (verdict === 'edited') {
      try {
        const parsed = JSON.parse(draft)
        submit({
          verdict: 'edited',
          editedValue: parsed,
          note: note.trim() || 'reviewer (edited)',
          decidedAt: Date.now(),
        })
      } catch (error) {
        setParseError(error instanceof Error ? error.message : 'That is not valid JSON.')
      }
      return
    }
    submit({
      verdict,
      note: note.trim() || (verdict === 'approved' ? 'reviewer' : ''),
      decidedAt: Date.now(),
    })
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Human review">
      <div className="modal">
        <div className="modal__head">
          <div className="modal__glyph" aria-hidden>
            🙋
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="modal__title">{request.stepTitle}</div>
            <div className="modal__sub">The workflow is paused, waiting on you.</div>
          </div>
          <span className="badge badge--pause">paused</span>
        </div>

        <div className="modal__body">
          {request.reason && <div className="modal__reason">{request.reason}</div>}

          <p className="modal__prompt">{request.prompt}</p>

          {request.suggestedVerdict === 'rejected' && (
            <div className="modal__reason" style={{ borderLeftColor: 'var(--amber)' }}>
              This run has the rejection scenario switched on, so Reject is the suggested choice.
              You are still free to pick anything.
            </div>
          )}

          <div className="row" style={{ marginBottom: 8 }}>
            <span className="trace-label" style={{ margin: 0 }}>
              Payload
            </span>
            <div style={{ flex: 1 }} />
            {request.allowEdit && (
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                onClick={() => setEditing((v) => !v)}
              >
                {editing ? 'Stop editing' : 'Edit payload'}
              </button>
            )}
          </div>

          {editing ? (
            <>
              <textarea
                className="textarea"
                style={{ minHeight: 200 }}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value)
                  setParseError(null)
                }}
                spellCheck={false}
              />
              {parseError && (
                <div className="modal__reason" style={{ marginTop: 8, marginBottom: 0 }}>
                  {parseError}
                </div>
              )}
            </>
          ) : (
            <pre className="code">{draft}</pre>
          )}

          <label className="field" style={{ marginTop: 14 }}>
            <span className="field__label">Your name or note (recorded on the trace)</span>
            <input
              className="input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Priya, checked the quote figures"
            />
          </label>
        </div>

        <div className="modal__foot">
          <button type="button" className="btn btn--danger" onClick={() => decide('rejected')}>
            Reject and stop
          </button>
          <div className="modal__foot-spacer" />
          {editing && (
            <button type="button" className="btn" onClick={() => decide('edited')}>
              Save edit and continue
            </button>
          )}
          <button type="button" className="btn btn--primary" onClick={() => decide('approved')}>
            Approve and continue
          </button>
        </div>
      </div>
    </div>
  )
}
