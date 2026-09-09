/**
 * The step inspector.
 *
 * Two halves. The top edits what the step does; the bottom edits how it behaves
 * when it misbehaves. Splitting them this way is the point being taught: the
 * reliability policy is not an afterthought bolted onto a step, it is half of
 * the step's definition.
 */

import { BLOCK_LIBRARY } from '../engine/blocks'
import { TRANSFORMS } from '../engine/transforms'
import { SCHEMAS, listSchemas } from '../engine/validators'
import { MOCK_MODELS } from '../providers/mockModel'
import { TOOLS } from '../providers/tools'
import { useApp } from '../store'
import type { ErrorPolicy, StepConfig, WorkflowStep } from '../engine/types'

/* -------------------------------------------------------------------------- */

function ConfigEditor({ step }: { step: WorkflowStep }) {
  const update = useApp((s) => s.updateStepConfig)
  const c = step.config
  const set = (patch: Partial<StepConfig>) => update(step.id, patch)

  switch (c.kind) {
    case 'input':
    case 'output':
      return (
        <label className="field">
          <span className="field__label">Label</span>
          <input
            className="input"
            value={c.label}
            onChange={(e) => set({ label: e.target.value } as Partial<StepConfig>)}
          />
        </label>
      )

    case 'ai':
      return (
        <>
          <label className="field">
            <span className="field__label">Model</span>
            <select
              className="select"
              value={c.modelId}
              onChange={(e) => set({ modelId: e.target.value } as Partial<StepConfig>)}
            >
              {MOCK_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <span className="field__hint">
              {MOCK_MODELS.find((m) => m.id === c.modelId)?.note}
            </span>
          </label>

          <label className="field">
            <span className="field__label">Task</span>
            <input
              className="input"
              value={c.task}
              onChange={(e) => set({ task: e.target.value } as Partial<StepConfig>)}
            />
          </label>

          <label className="field">
            <span className="field__label">Prompt</span>
            <textarea
              className="textarea"
              value={c.prompt}
              onChange={(e) => set({ prompt: e.target.value } as Partial<StepConfig>)}
            />
            <span className="field__hint">
              <code>{'{{input}}'}</code> is replaced with the payload arriving from the previous
              step.
            </span>
          </label>

          <label className="field">
            <span className="field__label">Enforce output schema</span>
            <select
              className="select"
              value={c.schemaId ?? ''}
              onChange={(e) =>
                set({ schemaId: e.target.value || undefined } as Partial<StepConfig>)
              }
            >
              <option value="">Do not check (trust the model)</option>
              {listSchemas().map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <span className="field__hint">
              When set, every attempt is validated here. An invalid response counts as a failed
              attempt, so a retry or a fallback can rescue it.
            </span>
          </label>
        </>
      )

    case 'tool':
    case 'retrieval': {
      const pool = TOOLS.filter((t) => t.isRetrieval === (c.kind === 'retrieval'))
      const active = TOOLS.find((t) => t.id === c.toolId)
      return (
        <>
          <label className="field">
            <span className="field__label">{c.kind === 'retrieval' ? 'Source' : 'Tool'}</span>
            <select
              className="select"
              value={c.toolId}
              onChange={(e) => set({ toolId: e.target.value } as Partial<StepConfig>)}
            >
              {pool.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            {active && (
              <span className="field__hint">
                {active.summary} Typical latency {active.latencyMs}ms. {active.failureNote}
              </span>
            )}
          </label>

          <label className="field">
            <span className="field__label">Task</span>
            <input
              className="input"
              value={c.task}
              onChange={(e) => set({ task: e.target.value } as Partial<StepConfig>)}
            />
          </label>
        </>
      )
    }

    case 'validator': {
      const schema = SCHEMAS[c.schemaId]
      return (
        <>
          <label className="field">
            <span className="field__label">Schema</span>
            <select
              className="select"
              value={c.schemaId}
              onChange={(e) => set({ schemaId: e.target.value } as Partial<StepConfig>)}
            >
              {listSchemas().map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            {schema && <span className="field__hint">{schema.description}</span>}
          </label>

          <label className="field">
            <span className="field__label">Behaviour</span>
            <select
              className="select"
              value={c.warnOnly ? 'warn' : 'enforce'}
              onChange={(e) =>
                set({ warnOnly: e.target.value === 'warn' } as Partial<StepConfig>)
              }
            >
              <option value="enforce">Enforce: a failure stops the payload</option>
              <option value="warn">Warn only: record it and carry on</option>
            </select>
          </label>

          {schema && (
            <>
              <div className="inspector__divider">Schema fields</div>
              <table className="schema-table">
                <tbody>
                  {schema.fields.map((f) => (
                    <tr key={f.name}>
                      <td>{f.name}</td>
                      <td>{f.type}</td>
                      <td>{f.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )
    }

    case 'condition':
      return (
        <>
          <label className="field">
            <span className="field__label">Path</span>
            <input
              className="input"
              value={c.path}
              onChange={(e) => set({ path: e.target.value } as Partial<StepConfig>)}
              placeholder="documents"
            />
            <span className="field__hint">
              A dotted path into the payload, for example <code>classification.confidence</code>.
            </span>
          </label>

          <div className="grid-2">
            <label className="field">
              <span className="field__label">Operator</span>
              <select
                className="select"
                value={c.operator}
                onChange={(e) => set({ operator: e.target.value } as Partial<StepConfig>)}
              >
                <option value="notEmpty">is not empty</option>
                <option value="exists">exists</option>
                <option value="eq">equals</option>
                <option value="neq">does not equal</option>
                <option value="gt">is greater than</option>
                <option value="gte">is at least</option>
                <option value="lt">is less than</option>
                <option value="lte">is at most</option>
              </select>
            </label>

            <label className="field">
              <span className="field__label">Skip when false</span>
              <input
                className="input"
                type="number"
                min={0}
                max={9}
                value={c.skipWhenFalse}
                onChange={(e) =>
                  set({ skipWhenFalse: Number(e.target.value) || 0 } as Partial<StepConfig>)
                }
              />
            </label>
          </div>

          {!['exists', 'notEmpty'].includes(c.operator) && (
            <label className="field">
              <span className="field__label">Value</span>
              <input
                className="input"
                value={String(c.value ?? '')}
                onChange={(e) => {
                  const raw = e.target.value
                  const num = Number(raw)
                  const parsed =
                    raw.trim() !== '' && Number.isFinite(num)
                      ? num
                      : raw === 'true'
                        ? true
                        : raw === 'false'
                          ? false
                          : raw
                  set({ value: parsed } as Partial<StepConfig>)
                }}
              />
            </label>
          )}

          <span className="field__hint">
            When the condition is false the workflow skips the next {c.skipWhenFalse} step(s)
            instead of stopping.
          </span>
        </>
      )

    case 'transform': {
      const t = TRANSFORMS.find((x) => x.id === c.transformId)
      return (
        <label className="field">
          <span className="field__label">Transform</span>
          <select
            className="select"
            value={c.transformId}
            onChange={(e) => set({ transformId: e.target.value } as Partial<StepConfig>)}
          >
            {TRANSFORMS.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
          {t && <span className="field__hint">{t.summary}</span>}
        </label>
      )
    }

    case 'confidenceCheck':
      return (
        <>
          <label className="field">
            <span className="field__label">Path</span>
            <input
              className="input"
              value={c.path}
              onChange={(e) => set({ path: e.target.value } as Partial<StepConfig>)}
            />
          </label>

          <label className="field">
            <span className="field__label">Threshold</span>
            <input
              className="input"
              type="number"
              step={0.05}
              min={0}
              max={1}
              value={c.threshold}
              onChange={(e) =>
                set({ threshold: Number(e.target.value) || 0 } as Partial<StepConfig>)
              }
            />
          </label>

          <label className="field">
            <span className="field__label">When below the threshold</span>
            <select
              className="select"
              value={c.belowThreshold}
              onChange={(e) => set({ belowThreshold: e.target.value } as Partial<StepConfig>)}
            >
              <option value="humanReview">Carry on to a human review step</option>
              <option value="fallback">Mark the payload as low confidence and continue</option>
              <option value="safeStop">Stop safely</option>
            </select>
          </label>
        </>
      )

    case 'humanReview':
      return (
        <>
          <label className="field">
            <span className="field__label">Prompt to the reviewer</span>
            <textarea
              className="textarea"
              value={c.prompt}
              onChange={(e) => set({ prompt: e.target.value } as Partial<StepConfig>)}
            />
          </label>

          <label className="field">
            <span className="field__label">Reviewer may edit</span>
            <select
              className="select"
              value={c.allowEdit ? 'yes' : 'no'}
              onChange={(e) => set({ allowEdit: e.target.value === 'yes' } as Partial<StepConfig>)}
            >
              <option value="yes">Yes, they can correct the payload</option>
              <option value="no">No, approve or reject only</option>
            </select>
          </label>
        </>
      )

    case 'safeStop':
      return (
        <label className="field">
          <span className="field__label">Reason</span>
          <textarea
            className="textarea"
            value={c.reason}
            onChange={(e) => set({ reason: e.target.value } as Partial<StepConfig>)}
          />
          <span className="field__hint">
            Shown in the trace and in the reliability report. Say what was missing, not just that
            something was.
          </span>
        </label>
      )
  }
}

/* -------------------------------------------------------------------------- */

function ReliabilityEditor({ step }: { step: WorkflowStep }) {
  const update = useApp((s) => s.updateStepReliability)
  const policy = step.reliability
  if (!policy) return null

  const isAi = step.config.kind === 'ai'
  const isRetrieval = step.config.kind === 'retrieval'
  const fallbackOptions = isAi
    ? MOCK_MODELS.map((m) => ({ id: m.id, label: m.label }))
    : TOOLS.filter((t) => t.isRetrieval === isRetrieval).map((t) => ({
        id: t.id,
        label: t.label,
      }))

  return (
    <>
      <div className="inspector__divider">Reliability policy</div>

      <div className="grid-2">
        <label className="field">
          <span className="field__label">Max attempts</span>
          <input
            className="input"
            type="number"
            min={1}
            max={6}
            value={policy.maxAttempts}
            onChange={(e) =>
              update(step.id, { maxAttempts: Math.max(1, Number(e.target.value) || 1) })
            }
          />
        </label>

        <label className="field">
          <span className="field__label">Timeout (ms)</span>
          <input
            className="input"
            type="number"
            min={100}
            step={100}
            value={policy.timeoutMs ?? 2000}
            onChange={(e) => update(step.id, { timeoutMs: Number(e.target.value) || 2000 })}
          />
        </label>
      </div>
      <span className="field__hint" style={{ marginTop: -6, marginBottom: 12, display: 'block' }}>
        Attempts include the first try. Raising this only helps when the fault is transient.
      </span>

      <label className="field">
        <span className="field__label">Fallback {isAi ? 'model' : 'source'}</span>
        <select
          className="select"
          value={policy.fallbackId ?? ''}
          onChange={(e) => update(step.id, { fallbackId: e.target.value || undefined })}
        >
          <option value="">None</option>
          {fallbackOptions
            .filter((o) =>
              isAi ? o.id !== (step.config.kind === 'ai' ? step.config.modelId : '') : true,
            )
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
        </select>
        <span className="field__hint">
          Tried once after every normal attempt has failed. This is what saves a run when the
          primary provider is down rather than merely slow.
        </span>
      </label>

      <label className="field">
        <span className="field__label">When everything has failed</span>
        <select
          className="select"
          value={policy.onError}
          onChange={(e) => update(step.id, { onError: e.target.value as ErrorPolicy })}
        >
          <option value="fail">Fail the workflow</option>
          <option value="safeStop">Stop safely with an explanation</option>
          <option value="humanReview">Hand it to a human</option>
          <option value="useDefault">Substitute a safe default and continue</option>
        </select>
      </label>

      {policy.onError === 'useDefault' && (
        <label className="field">
          <span className="field__label">Default value (JSON)</span>
          <textarea
            className="textarea"
            value={JSON.stringify(policy.defaultValue ?? {}, null, 2)}
            onChange={(e) => {
              try {
                update(step.id, { defaultValue: JSON.parse(e.target.value) })
              } catch {
                // Ignore keystrokes that leave the JSON temporarily invalid;
                // the last parseable value stays in place.
              }
            }}
          />
        </label>
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * What the right column shows before anything is selected.
 *
 * An empty panel this tall is wasted space, so it earns its keep: how a run
 * works, what the accent colours on the canvas mean, and which blocks this
 * particular puzzle has unlocked.
 */
function InspectorEmptyState() {
  const puzzle = useApp((s) => s.puzzle)
  const workflow = useApp((s) => s.workflow)
  const selectStep = useApp((s) => s.selectStep)

  return (
    <div className="pane__section" style={{ borderBottom: 'none' }}>
      <div className="pane__title">
        <span>How this works</span>
      </div>

      <ol className="howto">
        <li>
          <strong>Run it first.</strong> Watch where the workflow breaks, or worse, where it
          succeeds while producing something you would not act on.
        </li>
        <li>
          <strong>Read the trace.</strong> Every step records its input, its output and each
          attempt it made.
        </li>
        <li>
          <strong>Change the design.</strong> Add a block, reorder a step, or open a step and give
          it a retry, a fallback or a schema to enforce.
        </li>
        <li>
          <strong>Run it again</strong> and see whether the reliability report agrees with you.
        </li>
      </ol>

      <div className="inspector__divider">This workflow</div>
      <div className="stack">
        {workflow.steps.map((step, i) => {
          const def = BLOCK_LIBRARY[step.config.kind]
          return (
            <button
              key={step.id}
              type="button"
              className="palette-item"
              style={{ ['--palette-accent' as string]: `var(--${def.accent})` }}
              onClick={() => selectStep(step.id)}
            >
              <span className="palette-item__glyph" aria-hidden>
                {def.glyph}
              </span>
              <span className="palette-item__text">
                <span className="palette-item__label">
                  {i + 1}. {step.title}
                </span>
                <span className="palette-item__summary">{def.label}</span>
              </span>
            </button>
          )
        })}
      </div>

      <div className="inspector__divider">Blocks unlocked here</div>
      <div className="row row--wrap">
        {puzzle.availableBlocks.map((kind) => {
          const def = BLOCK_LIBRARY[kind]
          return (
            <span className="chip" key={kind} title={def.summary}>
              {def.glyph} {def.label}
            </span>
          )
        })}
      </div>
    </div>
  )
}

export function Inspector() {
  const workflow = useApp((s) => s.workflow)
  const selectedStepId = useApp((s) => s.selectedStepId)
  const rename = useApp((s) => s.renameStep)

  const step = workflow.steps.find((s) => s.id === selectedStepId)

  if (!step) return <InspectorEmptyState />

  const def = BLOCK_LIBRARY[step.config.kind]

  return (
    <div className="pane__section" style={{ borderBottom: 'none' }}>
      <div className="inspector__head">
        <div className="inspector__glyph" aria-hidden>
          {def.glyph}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ color: 'var(--ink-0)', fontWeight: 600 }}>{def.label}</div>
          <div style={{ color: 'var(--ink-3)', fontSize: 11.5 }}>{def.summary}</div>
        </div>
      </div>

      <div className="inspector__teaches">{def.teaches}</div>

      <label className="field">
        <span className="field__label">Step name</span>
        <input
          className="input"
          value={step.title}
          onChange={(e) => rename(step.id, e.target.value)}
        />
      </label>

      <ConfigEditor step={step} />
      <ReliabilityEditor step={step} />
    </div>
  )
}
