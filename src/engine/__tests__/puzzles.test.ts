/**
 * The contract this suite enforces is the one that matters most for a
 * teaching product:
 *
 *   1. Every puzzle is genuinely broken as shipped. If a starting workflow
 *      already met its own completion criteria the puzzle would be a lie.
 *
 *   2. Every puzzle is genuinely solvable, by exactly the fix its own hints
 *      describe. If the hints and the engine ever drift apart, this fails.
 *
 * The solutions below are written the same way a learner would perform them in
 * the UI: insert a block, reorder a step, change a policy field.
 */

import { describe, expect, it } from 'vitest'
import { runWorkflow, type HumanReviewRequest } from '../executor'
import { buildReliabilityReport } from '../reliability'
import { createStep } from '../blocks'
import { PUZZLES, cloneWorkflow, defaultEnabledFailures } from '../../puzzles'
import type { HumanDecision, Puzzle, Workflow, WorkflowStep } from '../types'

/* -------------------------------------------------------------------------- */
/* Test helpers                                                                */
/* -------------------------------------------------------------------------- */

/** Approves everything, which is the neutral choice for solvability tests. */
const approveAll = async (_request: HumanReviewRequest): Promise<HumanDecision> => ({
  verdict: 'approved',
  note: 'test-reviewer',
  decidedAt: Date.now(),
})

function indexOfStep(wf: Workflow, id: string): number {
  const i = wf.steps.findIndex((s) => s.id === id)
  if (i === -1) throw new Error(`Step "${id}" not found in "${wf.id}"`)
  return i
}

function insertAfter(wf: Workflow, afterId: string, step: WorkflowStep): void {
  wf.steps.splice(indexOfStep(wf, afterId) + 1, 0, step)
}

function insertBefore(wf: Workflow, beforeId: string, step: WorkflowStep): void {
  wf.steps.splice(indexOfStep(wf, beforeId), 0, step)
}

function moveBefore(wf: Workflow, moveId: string, beforeId: string): void {
  const [step] = wf.steps.splice(indexOfStep(wf, moveId), 1)
  wf.steps.splice(indexOfStep(wf, beforeId), 0, step)
}

function stepOf(wf: Workflow, id: string): WorkflowStep {
  return wf.steps[indexOfStep(wf, id)]
}

/** Runs a workflow to completion and grades it against the puzzle. */
async function grade(puzzle: Puzzle, wf: Workflow, failures?: string[]) {
  const enabled = failures ?? defaultEnabledFailures(puzzle)
  const run = await runWorkflow(wf, puzzle.sampleInput, puzzle.failureScenarios, {
    speed: 0,
    enabledFailures: enabled,
    requestHumanDecision: approveAll,
  })
  return { run, report: buildReliabilityReport(run, puzzle, enabled) }
}

/* -------------------------------------------------------------------------- */
/* The documented solution for each puzzle                                     */
/* -------------------------------------------------------------------------- */

const SOLUTIONS: Record<string, (wf: Workflow) => void> = {
  'meeting-summarizer': (wf) => {
    // Hint 3: repair the gap, then prove the repair with a validator.
    insertBefore(
      wf,
      'p1-output',
      createStep('transform', {
        id: 'fix-transform',
        title: 'Assign unowned tasks',
        config: { kind: 'transform', transformId: 'assignUnownedTasks' },
      }),
    )
    insertBefore(
      wf,
      'p1-output',
      createStep('validator', {
        id: 'fix-validator',
        title: 'Check the summary',
        config: { kind: 'validator', schemaId: 'meetingSummary' },
      }),
    )
  },

  'knowledge-assistant': (wf) => {
    // Hint 2 and 3: guard the model, then decline honestly.
    insertAfter(
      wf,
      'p2-retrieval',
      createStep('condition', {
        id: 'fix-condition',
        title: 'Any evidence?',
        config: {
          kind: 'condition',
          path: 'documents',
          operator: 'notEmpty',
          skipWhenFalse: 1,
        },
      }),
    )
    insertAfter(
      wf,
      'p2-ai',
      createStep('transform', {
        id: 'fix-ground',
        title: 'Ground or decline',
        config: { kind: 'transform', transformId: 'groundOrDecline' },
      }),
    )
  },

  'ticket-router': (wf) => {
    // Hint 1 and 3: make the step police itself, then give it somewhere to go.
    const ai = stepOf(wf, 'p3-ai')
    if (ai.config.kind === 'ai') ai.config.schemaId = 'ticketRouting'
    ai.reliability = { maxAttempts: 2, timeoutMs: 2000, fallbackId: 'mock-strict', onError: 'fail' }
  },

  'research-timeout': (wf) => {
    // Hint 2: a transient fault wants a retry.
    stepOf(wf, 'p4-research').reliability = {
      maxAttempts: 3,
      timeoutMs: 2000,
      onError: 'fail',
    }
  },

  'approve-before-sending': (wf) => {
    // Hint 2: an approval gate only counts in front of the irreversible action.
    moveBefore(wf, 'p5-human', 'p5-send')
  },

  'data-extractor': (wf) => {
    // Hint 2: the values are right, so repair rather than re-ask.
    insertBefore(
      wf,
      'p6-validator',
      createStep('transform', {
        id: 'fix-coerce',
        title: 'Coerce invoice types',
        config: { kind: 'transform', transformId: 'coerceInvoiceTypes' },
      }),
    )
  },

  'activate-fallback': (wf) => {
    // Hint 2: retries cannot revive a dead provider.
    const ai = stepOf(wf, 'p7-ai')
    ai.reliability = { maxAttempts: 3, timeoutMs: 2000, fallbackId: 'mock-strict', onError: 'fail' }
  },

  'interrupted-mission': (wf) => {
    // Hint 2 and 3: two faults, two different tools.
    stepOf(wf, 'p8-checkpoint').reliability = {
      maxAttempts: 3,
      timeoutMs: 2000,
      onError: 'fail',
    }
    insertBefore(
      wf,
      'p8-validator',
      createStep('transform', {
        id: 'fix-resumed',
        title: 'Mark resumed',
        config: { kind: 'transform', transformId: 'markResumed' },
      }),
    )
  },
}

/* -------------------------------------------------------------------------- */
/* Suite                                                                       */
/* -------------------------------------------------------------------------- */

describe('seeded puzzle set', () => {
  it('ships eight puzzles spanning all three difficulty levels', () => {
    expect(PUZZLES).toHaveLength(8)
    const levels = new Set(PUZZLES.map((p) => p.difficulty))
    expect(levels).toEqual(new Set(['beginner', 'intermediate', 'advanced']))
  })

  it('covers at least four distinct failure kinds', () => {
    const kinds = new Set(PUZZLES.flatMap((p) => p.failureScenarios.map((s) => s.kind)))
    expect(kinds.size).toBeGreaterThanOrEqual(4)
  })

  it('requires failure recovery in at least three puzzles', () => {
    const withFailures = PUZZLES.filter((p) =>
      p.failureScenarios.some((s) => s.defaultEnabled),
    )
    expect(withFailures.length).toBeGreaterThanOrEqual(3)
  })

  it('has at least one puzzle that requires structured output validation', () => {
    const withValidation = PUZZLES.filter((p) =>
      p.completionCriteria.some((c) => c.type === 'usedValidator'),
    )
    expect(withValidation.length).toBeGreaterThanOrEqual(1)
  })

  it('has at least one puzzle that records a human decision', () => {
    const withHuman = PUZZLES.filter((p) =>
      p.completionCriteria.some((c) => c.type === 'usedHumanReview'),
    )
    expect(withHuman.length).toBeGreaterThanOrEqual(1)
  })

  it('gives every puzzle a solution in this suite', () => {
    for (const puzzle of PUZZLES) {
      expect(SOLUTIONS[puzzle.id], `no solution written for "${puzzle.id}"`).toBeTypeOf('function')
    }
  })

  it('targets every failure scenario at a step that exists', () => {
    for (const puzzle of PUZZLES) {
      const ids = new Set(puzzle.startingWorkflow.steps.map((s) => s.id))
      for (const scenario of puzzle.failureScenarios) {
        expect(
          ids.has(scenario.targetStepId),
          `${puzzle.id}: scenario "${scenario.id}" targets missing step "${scenario.targetStepId}"`,
        ).toBe(true)
      }
    }
  })
})

describe.each(PUZZLES.map((p) => [p.id, p] as const))('%s', (_id, puzzle) => {
  it('is unsolved as shipped', async () => {
    const wf = cloneWorkflow(puzzle.startingWorkflow)
    const { report } = await grade(puzzle, wf)
    expect(
      report.puzzleSolved,
      `"${puzzle.title}" already passes its own criteria before the learner changes anything`,
    ).toBe(false)
    expect(report.unmetCriteria.length).toBeGreaterThan(0)
  })

  it('is solved by the fix its hints describe', async () => {
    const wf = cloneWorkflow(puzzle.startingWorkflow)
    SOLUTIONS[puzzle.id](wf)
    const { run, report } = await grade(puzzle, wf)
    expect(
      report.puzzleSolved,
      `"${puzzle.title}" still unmet: ${report.unmetCriteria.join(' | ')} (run ${run.status}: ${run.stopReason ?? 'no reason'})`,
    ).toBe(true)
    expect(report.unhandledErrors).toBe(0)
    expect(report.score).toBeGreaterThanOrEqual(60)
  })

  it('produces a trace entry for every executed step', async () => {
    const wf = cloneWorkflow(puzzle.startingWorkflow)
    SOLUTIONS[puzzle.id](wf)
    const { run } = await grade(puzzle, wf)
    expect(run.entries.length).toBeGreaterThan(0)
    for (const entry of run.entries) {
      expect(entry.stepId).toBeTruthy()
      expect(entry.status).not.toBe('running')
      expect(entry.endedAt).toBeDefined()
    }
  })

  it('is deterministic: the same configuration produces the same outcome', async () => {
    const build = () => {
      const wf = cloneWorkflow(puzzle.startingWorkflow)
      SOLUTIONS[puzzle.id](wf)
      return wf
    }
    const a = await grade(puzzle, build())
    const b = await grade(puzzle, build())
    expect(a.run.status).toBe(b.run.status)
    expect(a.report.score).toBe(b.report.score)
    expect(JSON.stringify(a.run.finalOutput)).toBe(JSON.stringify(b.run.finalOutput))
  })

  it('runs cleanly with every failure scenario switched off', async () => {
    const wf = cloneWorkflow(puzzle.startingWorkflow)
    const { run } = await grade(puzzle, wf, [])
    expect(
      run.status,
      `"${puzzle.title}" should not break when nothing is being injected`,
    ).not.toBe('failed')
  })
})
