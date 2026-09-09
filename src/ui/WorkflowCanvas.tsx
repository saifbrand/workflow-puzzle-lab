/**
 * The workflow canvas.
 *
 * Nodes are laid out automatically as a vertical chain rather than being
 * dragged into place. That is a deliberate choice: execution really is linear,
 * so a canvas where position carried no meaning would be lying to the learner.
 * Ordering is changed with the arrows on each node, which keeps the picture and
 * the engine permanently in agreement.
 *
 * Pan, zoom, fit-to-view and the grid all work as expected. There is no
 * minimap: a chain of a dozen nodes that already fits the viewport has nothing
 * to navigate, so it would have been decoration.
 */

import { useEffect, useMemo } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { StepNode, type StepNodeType } from './StepNode'
import { useApp } from '../store'
import type { TraceEntry } from '../engine/types'

const NODE_TYPES = { step: StepNode }
const V_GAP = 146
const X = 0

function CanvasInner() {
  const workflow = useApp((s) => s.workflow)
  const run = useApp((s) => s.run)
  const selectedStepId = useApp((s) => s.selectedStepId)
  const selectStep = useApp((s) => s.selectStep)
  const moveStep = useApp((s) => s.moveStep)
  const removeStep = useApp((s) => s.removeStep)
  const isRunning = useApp((s) => s.isRunning)

  const { fitView } = useReactFlow()

  /** Latest trace entry per step id, so re-runs replace rather than stack. */
  const entryByStep = useMemo(() => {
    const map = new Map<string, TraceEntry>()
    for (const entry of run?.entries ?? []) map.set(entry.stepId, entry)
    return map
  }, [run])

  const nodes = useMemo<StepNodeType[]>(
    () =>
      workflow.steps.map((step, index) => {
        const locked = step.config.kind === 'input' || step.config.kind === 'output'
        const prevLocked =
          index > 0 &&
          ['input', 'output'].includes(workflow.steps[index - 1].config.kind)
        const nextLocked =
          index < workflow.steps.length - 1 &&
          ['input', 'output'].includes(workflow.steps[index + 1].config.kind)

        return {
          id: step.id,
          type: 'step' as const,
          position: { x: X, y: index * V_GAP },
          selected: step.id === selectedStepId,
          draggable: false,
          data: {
            step,
            entry: entryByStep.get(step.id),
            index,
            canMoveUp: !locked && index > 0 && !prevLocked,
            canMoveDown: !locked && index < workflow.steps.length - 1 && !nextLocked,
            canDelete: !locked,
            onSelect: selectStep,
            onMove: moveStep,
            onDelete: removeStep,
          },
        }
      }),
    [workflow.steps, selectedStepId, entryByStep, selectStep, moveStep, removeStep],
  )

  const edges = useMemo<Edge[]>(() => {
    const list: Edge[] = []
    for (let i = 0; i < workflow.steps.length - 1; i += 1) {
      const from = workflow.steps[i]
      const to = workflow.steps[i + 1]
      const fromEntry = entryByStep.get(from.id)
      const toEntry = entryByStep.get(to.id)

      let className = ''
      if (toEntry?.status === 'skipped') className = 'is-skipped'
      else if (toEntry && ['running', 'retrying', 'paused'].includes(toEntry.status)) {
        className = 'is-active'
      } else if (fromEntry && toEntry) className = 'is-done'

      list.push({
        id: `${from.id}->${to.id}`,
        source: from.id,
        target: to.id,
        type: 'smoothstep',
        animated: className === 'is-active',
        className,
      })
    }
    return list
  }, [workflow.steps, entryByStep])

  // Re-fit when the shape of the workflow changes, so an inserted block never
  // lands outside the viewport.
  const stepCount = workflow.steps.length
  useEffect(() => {
    const id = window.setTimeout(() => {
      void fitView({ padding: 0.12, duration: 320, maxZoom: 1.25 })
    }, 60)
    return () => window.clearTimeout(id)
  }, [stepCount, fitView])

  const status = run?.status
  const doneCount = run?.entries.filter((e) => e.status !== 'running').length ?? 0

  return (
    <div className="canvas">
      <div className="canvas__hud" role="status" aria-live="polite">
        {isRunning ? (
          <>
            <span className="spinner" />
            <span>
              Running step <strong>{Math.min(doneCount + 1, stepCount)}</strong> of{' '}
              <strong>{stepCount}</strong>
            </span>
          </>
        ) : status ? (
          <>
            <span
              className={
                status === 'succeeded'
                  ? 'badge badge--ok'
                  : status === 'safelyStopped'
                    ? 'badge badge--warn'
                    : 'badge badge--bad'
              }
            >
              {status === 'succeeded'
                ? 'Succeeded'
                : status === 'safelyStopped'
                  ? 'Stopped safely'
                  : 'Failed'}
            </span>
            <span>
              <strong>{stepCount}</strong> steps
            </span>
          </>
        ) : (
          <>
            <span>
              <strong>{stepCount}</strong> steps
            </span>
            <span style={{ color: 'var(--ink-3)' }}>not run yet</span>
          </>
        )}
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.12, maxZoom: 1.25 }}
        minZoom={0.35}
        maxZoom={1.6}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
        onPaneClick={() => selectStep(null)}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#1e2331" />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
    </div>
  )
}

export function WorkflowCanvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  )
}
