/**
 * The workflow execution engine.
 *
 * Design notes worth knowing before changing anything here:
 *
 * 1. Execution is linear. `condition` steps skip forward rather than branching
 *    into sub-graphs. This keeps the trace readable, which is the product.
 *
 * 2. Failures are injected per attempt, not per run. A scenario that fails on
 *    attempts [1, 2] is what makes a three-attempt retry policy visibly pay
 *    off, and it is completely reproducible.
 *
 * 3. An `ai` step that declares a `schemaId` validates its own output inside
 *    the attempt loop. That is how real structured-output pipelines work, and
 *    it is what allows a fallback model to rescue schema drift. A standalone
 *    `validator` block still exists for checking payloads further down the
 *    chain, where retrying would not help.
 *
 * 4. By default nothing here touches the network. The providers are
 *    deterministic mocks, so the same configuration always produces the same
 *    trace. A live provider can be supplied through `RunOptions`, but it is
 *    used only for calls with no failure injected into them, which keeps every
 *    seeded puzzle reproducible whether or not a key is present.
 */

import {
  generateMock,
  mockLatency,
  ModelError,
  type ModelResponse,
} from '../providers/mockModel'
import { callTool, toolLatency, ToolError } from '../providers/tools'
import { generateLive, type LiveProviderConfig } from '../providers/liveModel'
import { applyTransform } from './transforms'
import { validateAgainst } from './validators'
import type {
  AttemptRecord,
  FailureKind,
  FailureScenario,
  HumanDecision,
  RecoveryAction,
  ReliabilityPolicy,
  RunState,
  StepStatus,
  TraceEntry,
  ValidationResult,
  Workflow,
  WorkflowStep,
} from './types'

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Reads a dotted path out of an unknown payload without throwing. */
export function getByPath(value: unknown, path: string): unknown {
  if (!path) return value
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') {
      return (acc as Record<string, unknown>)[key]
    }
    return undefined
  }, value)
}

/** Sleeps, unless the caller asked for instant execution. */
function wait(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isEmpty(value: unknown): boolean {
  if (value == null) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') {
    const rec = value as Record<string, unknown>
    if (Array.isArray(rec.documents)) return (rec.documents as unknown[]).length === 0
    return Object.keys(rec).length === 0
  }
  return false
}

/** The policy used when a step carries none. */
const NO_POLICY: ReliabilityPolicy = { maxAttempts: 1, onError: 'fail' }

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

/** Context handed to the UI when the engine needs a human decision. */
export interface HumanReviewRequest {
  stepId: string
  stepTitle: string
  prompt: string
  allowEdit: boolean
  /** Payload the reviewer is being asked to sign off. */
  value: unknown
  /**
   * Set when the run reached the reviewer because something went wrong, so the
   * modal can explain why a person is being asked rather than just what.
   */
  reason?: string
  /**
   * Pre-selected verdict when a "human rejects" scenario is active. The
   * reviewer is still free to choose anything.
   */
  suggestedVerdict?: HumanDecision['verdict']
}

export interface RunOptions {
  /**
   * Latency multiplier. `1` runs at simulated real speed, `0` runs instantly
   * which is what the test suite uses.
   */
  speed?: number
  /** Called after every state change so the UI can re-render the trace live. */
  onUpdate?: (state: RunState) => void
  /** Supplies a human decision. Required if the workflow contains a reviewer. */
  requestHumanDecision?: (request: HumanReviewRequest) => Promise<HumanDecision>
  /** Enabled failure scenario ids. */
  enabledFailures?: string[]
  /** Aborts the run when it flips to true. */
  signal?: { aborted: boolean }
  /**
   * Optional live model. Used only for healthy calls: any step with a failure
   * injected into it stays on the deterministic mock, because a real provider
   * cannot be asked to time out on cue and the puzzles must stay reproducible.
   */
  liveProvider?: LiveProviderConfig | null
}

let runCounter = 0

/**
 * Runs a workflow end to end and resolves with the final state.
 *
 * The function never throws for workflow-level failures. A failed run is a
 * legitimate outcome that is reported through `RunState.status`, because
 * "this workflow broke and here is exactly where" is the thing being taught.
 */
export async function runWorkflow(
  workflow: Workflow,
  input: unknown,
  scenarios: FailureScenario[],
  options: RunOptions = {},
): Promise<RunState> {
  const speed = options.speed ?? 1
  const enabled = new Set(options.enabledFailures ?? [])
  const activeScenarios = scenarios.filter((s) => enabled.has(s.id))

  runCounter += 1
  const state: RunState = {
    runId: `run-${Date.now().toString(36)}-${runCounter}`,
    status: 'running',
    currentStepIndex: 0,
    entries: [],
    startedAt: Date.now(),
  }

  const publish = () => options.onUpdate?.({ ...state, entries: [...state.entries] })
  publish()

  /** Injected failure for a given step and attempt, if any scenario applies. */
  const failureFor = (
    stepId: string,
    attempt: number,
    usingFallback = false,
  ): FailureKind | undefined => {
    for (const scenario of activeScenarios) {
      if (scenario.targetStepId !== stepId) continue
      // A provider outage takes out the primary, not its replacement.
      if (usingFallback && scenario.exemptFallback) continue
      const applies =
        scenario.failOnAttempts.length === 0 || scenario.failOnAttempts.includes(attempt)
      if (applies) return scenario.kind
    }
    return undefined
  }

  const humanRejectionArmed = (stepId: string): boolean =>
    activeScenarios.some((s) => s.targetStepId === stepId && s.kind === 'rejectedByHuman')

  let payload: unknown = input
  let index = 0
  let skipRemaining = 0

  while (index < workflow.steps.length) {
    if (options.signal?.aborted) {
      state.status = 'failed'
      state.stopReason = 'Run cancelled.'
      state.endedAt = Date.now()
      publish()
      return state
    }

    const step = workflow.steps[index]
    state.currentStepIndex = index

    if (skipRemaining > 0) {
      skipRemaining -= 1
      state.entries.push({
        stepId: step.id,
        stepTitle: step.title,
        kind: step.config.kind,
        status: 'skipped',
        input: payload,
        attempts: [],
        recovery: 'none',
        message: 'Skipped by an upstream condition.',
        startedAt: Date.now(),
        endedAt: Date.now(),
      })
      publish()
      index += 1
      continue
    }

    const entry: TraceEntry = {
      stepId: step.id,
      stepTitle: step.title,
      kind: step.config.kind,
      status: 'running',
      input: payload,
      attempts: [],
      recovery: 'none',
      startedAt: Date.now(),
    }
    state.entries.push(entry)
    publish()

    const outcome = await executeStep({
      step,
      payload,
      entry,
      speed,
      failureFor,
      humanRejectionArmed: humanRejectionArmed(step.id),
      requestHumanDecision: options.requestHumanDecision,
      liveProvider: options.liveProvider ?? null,
      publish,
    })

    entry.endedAt = Date.now()

    if (outcome.kind === 'ok') {
      payload = outcome.value
      entry.output = outcome.value
      entry.status = outcome.recovered ? 'recovered' : 'completed'
      entry.recovery = outcome.recovery
      if (outcome.skipNext) skipRemaining = outcome.skipNext
      publish()
      index += 1
      continue
    }

    if (outcome.kind === 'safeStop') {
      entry.status = 'safelyStopped'
      entry.recovery = 'safeStop'
      entry.message = outcome.reason
      entry.output = payload
      state.status = 'safelyStopped'
      state.stopReason = outcome.reason
      state.finalOutput = payload
      state.endedAt = Date.now()
      publish()
      return state
    }

    // outcome.kind === 'failed'
    entry.status = 'failed'
    entry.message = outcome.reason
    entry.recovery = outcome.recovery
    state.status = 'failed'
    state.stopReason = outcome.reason
    state.finalOutput = payload
    state.endedAt = Date.now()
    publish()
    return state
  }

  state.status = 'succeeded'
  state.finalOutput = payload
  state.currentStepIndex = workflow.steps.length
  state.endedAt = Date.now()
  publish()
  return state
}

/* -------------------------------------------------------------------------- */
/* Step execution                                                              */
/* -------------------------------------------------------------------------- */

type StepOutcome =
  | { kind: 'ok'; value: unknown; recovered: boolean; recovery: RecoveryAction; skipNext?: number }
  | { kind: 'failed'; reason: string; recovery: RecoveryAction }
  | { kind: 'safeStop'; reason: string }

interface ExecuteStepArgs {
  step: WorkflowStep
  payload: unknown
  entry: TraceEntry
  speed: number
  failureFor: (stepId: string, attempt: number, usingFallback?: boolean) => FailureKind | undefined
  humanRejectionArmed: boolean
  requestHumanDecision?: (request: HumanReviewRequest) => Promise<HumanDecision>
  liveProvider: LiveProviderConfig | null
  publish: () => void
}

async function executeStep(args: ExecuteStepArgs): Promise<StepOutcome> {
  const { step, payload, entry, publish } = args
  const config = step.config

  switch (config.kind) {
    case 'input':
      return { kind: 'ok', value: payload, recovered: false, recovery: 'none' }

    case 'output':
      return { kind: 'ok', value: payload, recovered: false, recovery: 'none' }

    case 'transform': {
      const value = applyTransform(config.transformId, payload)
      return { kind: 'ok', value, recovered: false, recovery: 'none' }
    }

    case 'safeStop':
      return { kind: 'safeStop', reason: config.reason }

    case 'condition': {
      const actual = getByPath(payload, config.path)
      const passed = evaluateCondition(actual, config.operator, config.value)
      entry.message = passed
        ? `Condition passed: ${config.path} ${config.operator} ${format(config.value)}.`
        : `Condition failed: ${config.path} was ${format(actual)}. Skipping the next ${config.skipWhenFalse} step(s).`
      return {
        kind: 'ok',
        value: payload,
        recovered: false,
        recovery: 'none',
        skipNext: passed ? 0 : config.skipWhenFalse,
      }
    }

    case 'confidenceCheck': {
      const raw = getByPath(payload, config.path)
      const confidence = typeof raw === 'number' ? raw : Number.NaN
      const known = Number.isFinite(confidence)
      if (known && confidence >= config.threshold) {
        entry.message = `Confidence ${confidence.toFixed(2)} met the ${config.threshold} threshold.`
        return { kind: 'ok', value: payload, recovered: false, recovery: 'none', skipNext: 0 }
      }

      const shown = known ? confidence.toFixed(2) : 'unknown'
      entry.message = `Confidence ${shown} is below the ${config.threshold} threshold.`

      if (config.belowThreshold === 'safeStop') {
        return {
          kind: 'safeStop',
          reason: `Stopped safely: confidence ${shown} did not meet the ${config.threshold} threshold.`,
        }
      }
      if (config.belowThreshold === 'humanReview') {
        // Falls through to the next step, which the puzzle wires to a reviewer.
        return { kind: 'ok', value: payload, recovered: false, recovery: 'none', skipNext: 0 }
      }
      // 'fallback' asks the workflow to carry on but marks the payload.
      return {
        kind: 'ok',
        value: { ...asObject(payload), lowConfidence: true },
        recovered: true,
        recovery: 'useDefault',
        skipNext: 0,
      }
    }

    case 'humanReview': {
      if (!args.requestHumanDecision) {
        return {
          kind: 'failed',
          reason: 'A human review step was reached but no reviewer is available.',
          recovery: 'none',
        }
      }
      entry.status = 'paused'
      publish()

      const decision = await args.requestHumanDecision({
        stepId: step.id,
        stepTitle: step.title,
        prompt: config.prompt,
        allowEdit: config.allowEdit,
        value: payload,
        suggestedVerdict: args.humanRejectionArmed ? 'rejected' : undefined,
      })
      entry.humanDecision = decision

      if (decision.verdict === 'rejected') {
        return {
          kind: 'safeStop',
          reason: decision.note?.trim()
            ? `A reviewer rejected this result: ${decision.note.trim()}`
            : 'A reviewer rejected this result, so the workflow stopped before acting on it.',
        }
      }

      const approver = decision.note?.trim() || 'reviewer'
      const stamped = {
        ...asObject(decision.verdict === 'edited' ? decision.editedValue : payload),
        approvedBy: approver,
      }
      return {
        kind: 'ok',
        value: stamped,
        recovered: false,
        recovery: decision.verdict === 'edited' ? 'humanEdited' : 'humanApproved',
      }
    }

    case 'validator':
      return runValidatorStep(args, config.schemaId, config.warnOnly === true)

    case 'ai':
    case 'tool':
    case 'retrieval':
      return runFallibleStep(args)
  }
}

/* -------------------------------------------------------------------------- */
/* Validator step                                                              */
/* -------------------------------------------------------------------------- */

async function runValidatorStep(
  args: ExecuteStepArgs,
  schemaId: string,
  warnOnly: boolean,
): Promise<StepOutcome> {
  const { step, payload, entry, speed } = args
  await wait(80 * speed)

  const result = validateAgainst(schemaId, payload)
  entry.validation = result
  entry.attempts.push({
    attempt: 1,
    status: result.valid ? 'completed' : 'failed',
    error: result.valid ? undefined : result.issues.join('; '),
    failureKind: result.valid ? undefined : 'schemaViolation',
    usedFallback: false,
    durationMs: 80,
    output: payload,
  })

  if (result.valid) {
    entry.message = `Payload matches the ${schemaId} schema.`
    return { kind: 'ok', value: payload, recovered: false, recovery: 'none' }
  }

  if (warnOnly) {
    entry.message = `Validation failed but this validator is set to warn only: ${result.issues.join('; ')}`
    return { kind: 'ok', value: payload, recovered: false, recovery: 'none' }
  }

  const policy = step.reliability ?? NO_POLICY
  const reason = `Validation against ${schemaId} failed: ${result.issues.join('; ')}`
  return applyErrorPolicy(args, policy, reason, payload)
}

/* -------------------------------------------------------------------------- */
/* AI, tool and retrieval steps                                                */
/* -------------------------------------------------------------------------- */

async function runFallibleStep(args: ExecuteStepArgs): Promise<StepOutcome> {
  const { step, payload, entry, speed, failureFor } = args
  const policy = step.reliability ?? NO_POLICY
  const maxAttempts = Math.max(1, policy.maxAttempts)

  let lastError = 'The step failed.'
  let lastKind: FailureKind | undefined
  let providerNote: string | undefined

  const totalAttempts = policy.fallbackId ? maxAttempts + 1 : maxAttempts

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    const usingFallback = Boolean(policy.fallbackId) && attempt > maxAttempts
    const injected = failureFor(step.id, attempt, usingFallback)
    const started = Date.now()

    if (attempt > 1) {
      entry.status = usingFallback ? 'running' : 'retrying'
      entry.message = usingFallback
        ? `Primary provider exhausted. Switching to fallback "${policy.fallbackId}".`
        : `Attempt ${attempt} of ${maxAttempts} after a failure.`
      args.publish()
    }

    try {
      const result = await performCall(
        step,
        payload,
        injected,
        usingFallback,
        policy,
        speed,
        args.liveProvider,
      )
      if (result.providerNote) providerNote = result.providerNote

      // An AI step that declares a schema validates its own output here, so a
      // retry or a fallback can actually rescue schema drift.
      if (step.config.kind === 'ai' && step.config.schemaId) {
        const validation = validateAgainst(step.config.schemaId, result.value)
        entry.validation = validation
        if (!validation.valid) {
          const message = `Model output did not match ${step.config.schemaId}: ${validation.issues.join('; ')}`
          entry.attempts.push({
            attempt,
            status: 'failed',
            error: message,
            failureKind: 'schemaViolation',
            usedFallback: usingFallback,
            durationMs: Date.now() - started,
            output: result.value,
          })
          lastError = message
          lastKind = 'schemaViolation'
          args.publish()
          continue
        }
      }

      entry.attempts.push({
        attempt,
        status: 'completed',
        usedFallback: usingFallback,
        durationMs: Date.now() - started,
        output: result.value,
      })

      const recovered = attempt > 1
      const recovery: RecoveryAction = usingFallback ? 'fallback' : recovered ? 'retry' : 'none'
      if (providerNote) entry.message = providerNote
      return { kind: 'ok', value: result.value, recovered, recovery }
    } catch (error) {
      const kind: FailureKind =
        error instanceof ModelError || error instanceof ToolError
          ? error.kind
          : 'toolError'
      const message = error instanceof Error ? error.message : String(error)
      entry.attempts.push({
        attempt,
        status: 'failed',
        error: message,
        failureKind: kind,
        usedFallback: usingFallback,
        durationMs: Date.now() - started,
      })
      lastError = message
      lastKind = kind
      args.publish()
    }
  }

  entry.message = lastError
  return applyErrorPolicy(args, policy, lastError, payload, lastKind)
}

interface CallResult {
  value: unknown
  /** Set when the provider used was not the one the step asked for. */
  providerNote?: string
}

async function performCall(
  step: WorkflowStep,
  payload: unknown,
  injected: FailureKind | undefined,
  usingFallback: boolean,
  policy: ReliabilityPolicy,
  speed: number,
  liveProvider: LiveProviderConfig | null,
): Promise<CallResult> {
  const config = step.config

  if (config.kind === 'ai') {
    const modelId = usingFallback && policy.fallbackId ? policy.fallbackId : config.modelId
    const request = {
      modelId,
      responseKey: config.responseKey || config.schemaId || 'default',
      prompt: config.prompt.replace('{{input}}', safeStringify(payload)),
      input: payload,
      corruption: injected,
    }

    // A live provider handles the healthy path only. Injected failures stay on
    // the mock so that every puzzle stays reproducible.
    if (liveProvider && !injected) {
      try {
        const live = await generateLive(liveProvider, request)
        return { value: mergeModelOutput(payload, live) }
      } catch (error) {
        const why = error instanceof Error ? error.message : String(error)
        const response = generateMock(request)
        return {
          value: mergeModelOutput(payload, response),
          providerNote: `Live provider unavailable (${why}) so this step used the deterministic mock instead.`,
        }
      }
    }

    const latency = mockLatency(modelId)
    await wait(Math.min(latency, 900) * speed)

    if (policy.timeoutMs && latency > policy.timeoutMs) {
      throw new ModelError(
        `Model "${modelId}" took ${latency}ms, over the ${policy.timeoutMs}ms timeout.`,
        'modelTimeout',
      )
    }

    const response: ModelResponse = generateMock(request)
    const merged = mergeModelOutput(payload, response)
    return { value: merged }
  }

  // Only fallible kinds reach this function, and the ai case returned above.
  if (config.kind !== 'tool' && config.kind !== 'retrieval') {
    throw new Error(`performCall does not handle step kind "${config.kind}".`)
  }

  const toolId = usingFallback && policy.fallbackId ? policy.fallbackId : config.toolId
  const latency = toolLatency(toolId)
  await wait(Math.min(latency, 900) * speed)

  if (policy.timeoutMs && latency > policy.timeoutMs) {
    throw new ToolError(
      `"${toolId}" took ${latency}ms, over the ${policy.timeoutMs}ms timeout.`,
      'toolTimeout',
    )
  }

  const result = callTool(toolId, injected)

  if (config.kind === 'retrieval') {
    // Merge documents so a second retrieval source adds to the first rather
    // than replacing it, which is what "combine multiple sources" needs.
    const existing = asObject(payload)
    const incoming = asObject(result.value)
    const previousDocs = Array.isArray(existing.documents) ? (existing.documents as unknown[]) : []
    const newDocs = Array.isArray(incoming.documents) ? (incoming.documents as unknown[]) : []
    return {
      value: { ...existing, ...incoming, documents: [...previousDocs, ...newDocs] },
    }
  }

  return { value: { ...asObject(payload), ...asObject(result.value) } }
}

/**
 * Model output replaces the payload, but the confidence score is lifted to the
 * top level so `condition` and `confidenceCheck` steps can read it with a
 * simple path.
 */
function mergeModelOutput(payload: unknown, response: ModelResponse): unknown {
  const value = response.value
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = { ...(value as Record<string, unknown>) }
    if (response.confidence !== undefined && record.confidence === undefined) {
      record.confidence = response.confidence
    }
    // Carry forward anything the payload was tracking that the model did not
    // overwrite, so retrieval evidence survives a summarisation step.
    const previous = asObject(payload)
    if (Array.isArray(previous.citations) && record.citations === undefined) {
      record.citations = previous.citations
    }
    if (Array.isArray(previous.sourcesUsed) && record.sourcesUsed === undefined) {
      record.sourcesUsed = previous.sourcesUsed
    }
    return record
  }
  return value
}

/* -------------------------------------------------------------------------- */
/* Error policy                                                                */
/* -------------------------------------------------------------------------- */

async function applyErrorPolicy(
  args: ExecuteStepArgs,
  policy: ReliabilityPolicy,
  reason: string,
  payload: unknown,
  kind?: FailureKind,
): Promise<StepOutcome> {
  const { entry, step } = args

  switch (policy.onError) {
    case 'useDefault': {
      const value = policy.defaultValue ?? { recoveredWithDefault: true }
      entry.message = `${reason} A safe default was substituted instead.`
      return { kind: 'ok', value, recovered: true, recovery: 'useDefault' }
    }

    case 'safeStop':
      return { kind: 'safeStop', reason: `${reason} The workflow stopped safely.` }

    case 'humanReview': {
      if (!args.requestHumanDecision) {
        return { kind: 'failed', reason, recovery: 'none' }
      }
      entry.status = 'paused'
      args.publish()
      const decision = await args.requestHumanDecision({
        stepId: step.id,
        stepTitle: step.title,
        prompt: 'This step failed. Decide how the workflow should continue.',
        allowEdit: true,
        value: payload,
        reason,
        suggestedVerdict: args.humanRejectionArmed ? 'rejected' : undefined,
      })
      entry.humanDecision = decision

      if (decision.verdict === 'rejected') {
        return {
          kind: 'safeStop',
          reason: `${reason} A reviewer chose not to continue.`,
        }
      }
      const value =
        decision.verdict === 'edited' && decision.editedValue !== undefined
          ? decision.editedValue
          : payload
      entry.message = `${reason} A reviewer took over and the workflow continued.`
      return {
        kind: 'ok',
        value,
        recovered: true,
        recovery: decision.verdict === 'edited' ? 'humanEdited' : 'humanApproved',
      }
    }

    case 'fail':
    default:
      return {
        kind: 'failed',
        reason: kind ? `${reason} (${kind})` : reason,
        recovery: 'none',
      }
  }
}

/* -------------------------------------------------------------------------- */
/* Small utilities                                                             */
/* -------------------------------------------------------------------------- */

function evaluateCondition(actual: unknown, operator: string, expected: unknown): boolean {
  switch (operator) {
    case 'exists':
      return actual !== undefined && actual !== null
    case 'notEmpty':
      return !isEmpty(actual)
    case 'eq':
      return actual === expected
    case 'neq':
      return actual !== expected
    case 'gt':
      return typeof actual === 'number' && typeof expected === 'number' && actual > expected
    case 'gte':
      return typeof actual === 'number' && typeof expected === 'number' && actual >= expected
    case 'lt':
      return typeof actual === 'number' && typeof expected === 'number' && actual < expected
    case 'lte':
      return typeof actual === 'number' && typeof expected === 'number' && actual <= expected
    default:
      return false
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function format(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`
  if (value === undefined) return 'undefined'
  return JSON.stringify(value)
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

export type { ValidationResult, StepStatus, AttemptRecord }
