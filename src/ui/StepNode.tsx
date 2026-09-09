/**
 * One workflow step, drawn on the canvas.
 *
 * The node has two jobs. Before a run it summarises the step's configuration,
 * so the whole workflow can be read at a glance without opening anything. While
 * a run is in flight it mirrors the trace, so the eye follows execution down
 * the chain rather than hunting through a log.
 */

import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { BLOCK_LIBRARY } from '../engine/blocks'
import type { StepStatus, TraceEntry, WorkflowStep } from '../engine/types'
import { SCHEMAS } from '../engine/validators'
import { TOOL_BY_ID } from '../providers/tools'
import { TRANSFORM_BY_ID } from '../engine/transforms'

export interface StepNodeData extends Record<string, unknown> {
  step: WorkflowStep
  entry?: TraceEntry
  index: number
  canMoveUp: boolean
  canMoveDown: boolean
  canDelete: boolean
  onSelect: (id: string) => void
  onMove: (id: string, direction: -1 | 1) => void
  onDelete: (id: string) => void
}

export type StepNodeType = Node<StepNodeData, 'step'>

const STATUS_GLYPH: Record<StepStatus, string> = {
  pending: '',
  running: '',
  completed: '✓',
  failed: '✕',
  paused: '❚❚',
  retrying: '↻',
  recovered: '✓',
  safelyStopped: '■',
  skipped: '–',
}

/** One line of prose describing what this step is configured to do. */
function summarise(step: WorkflowStep): string {
  const c = step.config
  switch (c.kind) {
    case 'input':
    case 'output':
      return c.label
    case 'ai':
      return c.task
    case 'tool':
    case 'retrieval':
      return TOOL_BY_ID[c.toolId]?.label ?? c.toolId
    case 'validator':
      return `Checks against ${SCHEMAS[c.schemaId]?.label ?? c.schemaId}`
    case 'condition': {
      const op =
        c.operator === 'notEmpty'
          ? 'is not empty'
          : c.operator === 'exists'
            ? 'exists'
            : `${c.operator} ${JSON.stringify(c.value)}`
      return `If ${c.path} ${op}`
    }
    case 'transform':
      return TRANSFORM_BY_ID[c.transformId]?.label ?? c.transformId
    case 'confidenceCheck':
      return `If ${c.path} < ${c.threshold} then ${c.belowThreshold}`
    case 'humanReview':
      return c.allowEdit ? 'Approve, edit or reject' : 'Approve or reject'
    case 'safeStop':
      return c.reason
  }
}

export function StepNode({ data, selected }: NodeProps<StepNodeType>) {
  const { step, entry, index, canMoveUp, canMoveDown, canDelete } = data
  const def = BLOCK_LIBRARY[step.config.kind]
  const status = entry?.status
  const policy = step.reliability

  const classes = [
    'node',
    `node--${def.accent}`,
    selected ? 'node--selected' : '',
    status ? `node--${status}` : '',
  ]
    .filter(Boolean)
    .join(' ')

  const chips: { label: string; className: string }[] = []
  if (policy?.maxAttempts && policy.maxAttempts > 1) {
    chips.push({ label: `retry ×${policy.maxAttempts}`, className: 'chip chip--retry' })
  }
  if (policy?.fallbackId) {
    chips.push({ label: `fallback: ${policy.fallbackId}`, className: 'chip chip--fallback' })
  }
  if (step.config.kind === 'ai' && step.config.schemaId) {
    chips.push({ label: `enforces ${step.config.schemaId}`, className: 'chip chip--schema' })
  }
  if (policy && policy.onError !== 'fail') {
    chips.push({ label: `on error: ${policy.onError}`, className: 'chip chip--policy' })
  }

  const attemptCount = entry?.attempts.length ?? 0

  return (
    <div
      className={classes}
      onClick={() => data.onSelect(step.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          data.onSelect(step.id)
        }
      }}
      aria-label={`${def.label} step: ${step.title}`}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} />

      <div className="node__tools">
        <button
          className="node__tool"
          title="Move up"
          aria-label="Move step up"
          disabled={!canMoveUp}
          onClick={(e) => {
            e.stopPropagation()
            data.onMove(step.id, -1)
          }}
        >
          ↑
        </button>
        <button
          className="node__tool"
          title="Move down"
          aria-label="Move step down"
          disabled={!canMoveDown}
          onClick={(e) => {
            e.stopPropagation()
            data.onMove(step.id, 1)
          }}
        >
          ↓
        </button>
        <button
          className="node__tool node__tool--danger"
          title="Remove"
          aria-label="Remove step"
          disabled={!canDelete}
          onClick={(e) => {
            e.stopPropagation()
            data.onDelete(step.id)
          }}
        >
          ✕
        </button>
      </div>

      <div className="node__head">
        <div className="node__glyph" aria-hidden>
          {def.glyph}
        </div>
        <div className="node__titles">
          <div className="node__title">{step.title}</div>
          <div className="node__kind">
            {index + 1} · {def.label}
          </div>
        </div>
        {status && (
          <div className={`node__status node__status--${status}`} title={status}>
            {status === 'running' || status === 'retrying' ? (
              <span className="spinner" />
            ) : (
              STATUS_GLYPH[status]
            )}
          </div>
        )}
      </div>

      <div className="node__body">{summarise(step)}</div>

      {(chips.length > 0 || attemptCount > 1) && (
        <div className="node__chips">
          {chips.map((chip) => (
            <span key={chip.label} className={chip.className}>
              {chip.label}
            </span>
          ))}
          {attemptCount > 1 && (
            <span className="chip chip--retry">{attemptCount} attempts</span>
          )}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  )
}
