/**
 * Failure scenario switches.
 *
 * Each scenario is deterministic and says exactly which step it targets and
 * which attempts it breaks, so a reviewer can reproduce any run precisely.
 * Nothing here is random.
 */

import { useApp } from '../store'
import type { FailureKind } from '../engine/types'

const KIND_LABEL: Record<FailureKind, string> = {
  modelTimeout: 'Model timeout',
  toolTimeout: 'Tool timeout',
  invalidJson: 'Invalid JSON',
  missingField: 'Missing field',
  schemaViolation: 'Schema violation',
  emptyRetrieval: 'Empty retrieval',
  lowConfidence: 'Low confidence',
  toolError: 'Tool error',
  rejectedByHuman: 'Human rejection',
}

function attemptsLabel(failOnAttempts: number[]): string {
  if (failOnAttempts.length === 0) return 'every attempt'
  if (failOnAttempts.length === 1) return `attempt ${failOnAttempts[0]}`
  return `attempts ${failOnAttempts.join(' and ')}`
}

export function FailurePanel() {
  const puzzle = useApp((s) => s.puzzle)
  const enabled = useApp((s) => s.enabledFailures)
  const toggleFailure = useApp((s) => s.toggleFailure)
  const isRunning = useApp((s) => s.isRunning)
  const workflow = useApp((s) => s.workflow)

  if (puzzle.failureScenarios.length === 0) return null

  return (
    <div className="pane__section">
      <div className="pane__title">
        <span>Failure simulation</span>
        <span className="badge badge--warn">
          {enabled.length}/{puzzle.failureScenarios.length} on
        </span>
      </div>

      <div className="stack">
        {puzzle.failureScenarios.map((scenario) => {
          const on = enabled.includes(scenario.id)
          const target = workflow.steps.find((s) => s.id === scenario.targetStepId)

          return (
            <button
              key={scenario.id}
              type="button"
              className={`switch${on ? ' switch--on' : ''}`}
              onClick={() => toggleFailure(scenario.id)}
              disabled={isRunning}
              aria-pressed={on}
            >
              <span className="switch__box" aria-hidden>
                ✓
              </span>
              <span className="switch__text">
                <span className="switch__label">{scenario.label}</span>
                <span className="switch__desc">{scenario.description}</span>
                <span className="row row--wrap" style={{ marginTop: 6, gap: 4 }}>
                  <span className="chip">{KIND_LABEL[scenario.kind]}</span>
                  <span className="chip">{target?.title ?? scenario.targetStepId}</span>
                  <span className="chip">{attemptsLabel(scenario.failOnAttempts)}</span>
                  {scenario.exemptFallback && <span className="chip">fallback unaffected</span>}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
