/**
 * Application state.
 *
 * One store holds the current puzzle, the workflow being edited, the live run
 * and the reliability report. Keeping the run in the same place as the workflow
 * is what lets the canvas colour its nodes from the trace as execution happens,
 * rather than only showing a result at the end.
 */

import { create } from 'zustand'
import { createStep } from './engine/blocks'
import { runWorkflow, type HumanReviewRequest } from './engine/executor'
import { buildReliabilityReport } from './engine/reliability'
import {
  PUZZLES,
  PUZZLE_BY_ID,
  cloneWorkflow,
  defaultEnabledFailures,
} from './puzzles'
import { sfx } from './audio/sfx'
import { loadLiveProvider, type LiveProviderConfig } from './providers/liveModel'
import type {
  BlockKind,
  HumanDecision,
  Puzzle,
  ReliabilityReport,
  RunState,
  StepConfig,
  Workflow,
  WorkflowStep,
} from './engine/types'

/** Which reviewer decision a paused run is waiting on, plus its resolver. */
interface PendingReview {
  request: HumanReviewRequest
  resolve: (decision: HumanDecision) => void
}

export interface AppState {
  puzzle: Puzzle
  workflow: Workflow
  enabledFailures: string[]
  selectedStepId: string | null
  run: RunState | null
  report: ReliabilityReport | null
  isRunning: boolean
  pendingReview: PendingReview | null
  /** Index into the current puzzle's hint list that the learner has revealed. */
  hintsRevealed: number
  soundOn: boolean
  /** Puzzle ids the learner has fully solved this session. */
  solved: string[]
  /** Optional live model. Null means the deterministic mock is in use. */
  liveProvider: LiveProviderConfig | null
  providerModalOpen: boolean

  loadPuzzle: (id: string) => void
  resetWorkflow: () => void
  selectStep: (id: string | null) => void
  addBlock: (kind: BlockKind) => void
  removeStep: (id: string) => void
  moveStep: (id: string, direction: -1 | 1) => void
  updateStepConfig: (id: string, patch: Partial<StepConfig>) => void
  updateStepReliability: (id: string, patch: Partial<WorkflowStep['reliability']>) => void
  renameStep: (id: string, title: string) => void
  toggleFailure: (id: string) => void
  revealHint: () => void
  toggleSound: () => void
  start: () => Promise<void>
  submitReview: (decision: HumanDecision) => void
  setLiveProvider: (config: LiveProviderConfig | null) => void
  openProviderModal: () => void
  closeProviderModal: () => void
}

/** Steps the learner may not delete or move, because the chain needs them. */
function isLocked(step: WorkflowStep): boolean {
  return step.config.kind === 'input' || step.config.kind === 'output'
}

/** Plays the sound that matches a newly arrived trace entry. */
function announce(previous: RunState | null, next: RunState): void {
  const before = previous?.entries.length ?? 0
  const after = next.entries.length

  // A step that gained an attempt since the last publish is retrying.
  if (previous && after === before && after > 0) {
    const last = next.entries[after - 1]
    const prior = previous.entries[after - 1]
    if (last && prior && last.attempts.length > prior.attempts.length) {
      const latest = last.attempts[last.attempts.length - 1]
      if (latest?.usedFallback) sfx.fallback()
      else sfx.retry()
    }
    if (last?.status === 'paused' && prior?.status !== 'paused') sfx.awaitHuman()
    return
  }

  if (after > before && before > 0) {
    const finished = next.entries[before - 1]
    if (!finished) return
    if (finished.status === 'failed') sfx.stepFail()
    else if (finished.kind === 'validator' && finished.validation?.valid === false) sfx.invalid()
    else if (finished.status !== 'skipped') sfx.stepOk(before - 1)
  }
}

const firstPuzzle = PUZZLES[0]

export const useApp = create<AppState>((set, get) => ({
  puzzle: firstPuzzle,
  workflow: cloneWorkflow(firstPuzzle.startingWorkflow),
  enabledFailures: defaultEnabledFailures(firstPuzzle),
  selectedStepId: null,
  run: null,
  report: null,
  isRunning: false,
  pendingReview: null,
  hintsRevealed: 0,
  soundOn: true,
  solved: [],
  liveProvider: loadLiveProvider(),
  providerModalOpen: false,

  loadPuzzle: (id) => {
    const puzzle = PUZZLE_BY_ID[id]
    if (!puzzle) return
    set({
      puzzle,
      workflow: cloneWorkflow(puzzle.startingWorkflow),
      enabledFailures: defaultEnabledFailures(puzzle),
      selectedStepId: null,
      run: null,
      report: null,
      isRunning: false,
      pendingReview: null,
      hintsRevealed: 0,
    })
  },

  resetWorkflow: () => {
    const { puzzle } = get()
    set({
      workflow: cloneWorkflow(puzzle.startingWorkflow),
      enabledFailures: defaultEnabledFailures(puzzle),
      selectedStepId: null,
      run: null,
      report: null,
      pendingReview: null,
    })
    sfx.click()
  },

  selectStep: (id) => set({ selectedStepId: id }),

  addBlock: (kind) => {
    const { workflow, selectedStepId } = get()
    const step = createStep(kind)
    const steps = [...workflow.steps]

    // Insert after the selection when there is one, otherwise immediately
    // before the output step, which is where a new block almost always wants
    // to go and saves the learner a reorder.
    const selectedIndex = selectedStepId
      ? steps.findIndex((s) => s.id === selectedStepId)
      : -1
    const outputIndex = steps.findIndex((s) => s.config.kind === 'output')
    let target =
      selectedIndex >= 0 ? selectedIndex + 1 : outputIndex >= 0 ? outputIndex : steps.length
    // Never land after the output step.
    if (outputIndex >= 0 && target > outputIndex) target = outputIndex

    steps.splice(target, 0, step)
    set({ workflow: { ...workflow, steps }, selectedStepId: step.id })
    sfx.place()
  },

  removeStep: (id) => {
    const { workflow, selectedStepId } = get()
    const step = workflow.steps.find((s) => s.id === id)
    if (!step || isLocked(step)) return
    set({
      workflow: { ...workflow, steps: workflow.steps.filter((s) => s.id !== id) },
      selectedStepId: selectedStepId === id ? null : selectedStepId,
    })
    sfx.click()
  },

  moveStep: (id, direction) => {
    const { workflow } = get()
    const steps = [...workflow.steps]
    const from = steps.findIndex((s) => s.id === id)
    if (from === -1) return
    const to = from + direction
    if (to < 0 || to >= steps.length) return
    // Input stays first and output stays last, always.
    if (isLocked(steps[from]) || isLocked(steps[to])) return
    ;[steps[from], steps[to]] = [steps[to], steps[from]]
    set({ workflow: { ...workflow, steps } })
    sfx.place()
  },

  updateStepConfig: (id, patch) => {
    const { workflow } = get()
    set({
      workflow: {
        ...workflow,
        steps: workflow.steps.map((s) =>
          s.id === id ? ({ ...s, config: { ...s.config, ...patch } } as WorkflowStep) : s,
        ),
      },
    })
  },

  updateStepReliability: (id, patch) => {
    const { workflow } = get()
    set({
      workflow: {
        ...workflow,
        steps: workflow.steps.map((s) =>
          s.id === id
            ? {
                ...s,
                reliability: {
                  maxAttempts: 1,
                  onError: 'fail',
                  ...s.reliability,
                  ...patch,
                },
              }
            : s,
        ),
      },
    })
  },

  renameStep: (id, title) => {
    const { workflow } = get()
    set({
      workflow: {
        ...workflow,
        steps: workflow.steps.map((s) => (s.id === id ? { ...s, title } : s)),
      },
    })
  },

  toggleFailure: (id) => {
    const { enabledFailures } = get()
    set({
      enabledFailures: enabledFailures.includes(id)
        ? enabledFailures.filter((f) => f !== id)
        : [...enabledFailures, id],
    })
    sfx.click()
  },

  revealHint: () => {
    const { hintsRevealed, puzzle } = get()
    if (hintsRevealed >= puzzle.hints.length) return
    set({ hintsRevealed: hintsRevealed + 1 })
    sfx.click()
  },

  toggleSound: () => {
    const next = !get().soundOn
    set({ soundOn: next })
    if (next) sfx.click()
  },

  start: async () => {
    const { workflow, puzzle, enabledFailures, isRunning, liveProvider } = get()
    if (isRunning) return

    set({ isRunning: true, run: null, report: null, pendingReview: null })

    let previous: RunState | null = null

    const finalState = await runWorkflow(workflow, puzzle.sampleInput, puzzle.failureScenarios, {
      speed: 1,
      enabledFailures,
      liveProvider,
      onUpdate: (state) => {
        announce(previous, state)
        previous = state
        set({ run: state })
      },
      requestHumanDecision: (request) =>
        new Promise<HumanDecision>((resolve) => {
          set({ pendingReview: { request, resolve } })
        }),
    })

    const report = buildReliabilityReport(finalState, puzzle, enabledFailures)

    if (finalState.status === 'succeeded') sfx.success()
    else if (finalState.status === 'safelyStopped') sfx.safeStop()
    else sfx.failure()

    if (report.puzzleSolved) {
      // Let the outcome sound land before the fanfare.
      window.setTimeout(() => sfx.solved(), 380)
    }

    set((s) => ({
      isRunning: false,
      run: finalState,
      report,
      pendingReview: null,
      solved:
        report.puzzleSolved && !s.solved.includes(puzzle.id)
          ? [...s.solved, puzzle.id]
          : s.solved,
    }))
  },

  submitReview: (decision) => {
    const pending = get().pendingReview
    if (!pending) return
    set({ pendingReview: null })
    pending.resolve(decision)
  },

  setLiveProvider: (config) => set({ liveProvider: config }),
  openProviderModal: () => {
    set({ providerModalOpen: true })
    sfx.click()
  },
  closeProviderModal: () => set({ providerModalOpen: false }),
}))
