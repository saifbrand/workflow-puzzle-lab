/**
 * Reliability feedback.
 *
 * After a run finishes the learner needs an answer to one question: was that
 * workflow actually resilient, or did it just get lucky? This module turns the
 * trace into that answer.
 *
 * The score is deliberately weighted towards behaviour under failure rather
 * than towards finishing. A workflow that completes only because no failure
 * was injected scores lower than one that survived a real fault, and a
 * workflow that stopped safely rather than emitting garbage is rewarded, not
 * punished.
 */

import type {
  CompletionCriterion,
  FailureScenario,
  Puzzle,
  ReliabilityFinding,
  ReliabilityReport,
  RunState,
  TraceEntry,
} from './types'
import { validateAgainst } from './validators'

interface Facts {
  completed: boolean
  stoppedSafely: boolean
  failedOutright: boolean
  retryAttempts: number
  fallbackActivated: boolean
  humanReviewUsed: boolean
  humanRejected: boolean
  validatorsRun: number
  validationFailuresCaught: number
  unhandledErrors: number
  injectedFailuresSeen: number
  injectedFailuresHandled: number
  outputValid: boolean
  stepsWithRecovery: number
  /** Failure scenarios that were switched on for this run. */
  armed: number
  /**
   * Conditions and confidence checks that actually diverted the run.
   *
   * Designing around a fault deserves the same credit as recovering from one.
   * A workflow that notices an empty shelf and never calls the model has not
   * "failed to recover", it has avoided the failure entirely, which is the
   * better engineering answer.
   */
  guardsUsed: number
  /** True when the run absorbed everything that was thrown at it. */
  coped: boolean
}

function gatherFacts(
  run: RunState,
  activeScenarios: FailureScenario[],
  expectedSchemaId?: string,
): Facts {
  let retryAttempts = 0
  let fallbackActivated = false
  let humanReviewUsed = false
  let humanRejected = false
  let validatorsRun = 0
  let validationFailuresCaught = 0
  let unhandledErrors = 0
  let injectedFailuresSeen = 0
  let injectedFailuresHandled = 0

  for (const entry of run.entries) {
    // Every attempt after the first is a retry that the policy paid for.
    const failedAttempts = entry.attempts.filter((a) => a.status === 'failed')
    retryAttempts += Math.max(0, entry.attempts.length - 1)

    if (entry.attempts.some((a) => a.usedFallback && a.status === 'completed')) {
      fallbackActivated = true
    }
    if (entry.kind === 'validator') {
      validatorsRun += 1
      if (entry.validation && !entry.validation.valid) validationFailuresCaught += 1
    }
    if (entry.humanDecision) {
      humanReviewUsed = true
      if (entry.humanDecision.verdict === 'rejected') humanRejected = true
    }

    if (failedAttempts.length > 0) {
      injectedFailuresSeen += 1
      const rescued =
        entry.status === 'recovered' ||
        entry.status === 'completed' ||
        entry.status === 'safelyStopped'
      if (rescued) injectedFailuresHandled += 1
    }

    if (entry.status === 'failed') unhandledErrors += 1
  }

  const completed = run.status === 'succeeded'
  const stoppedSafely = run.status === 'safelyStopped'

  let outputValid = completed
  if (completed && expectedSchemaId) {
    outputValid = validateAgainst(expectedSchemaId, run.finalOutput).valid
  }

  const stepsWithRecovery = run.entries.filter(
    (e) => e.recovery !== 'none' && e.recovery !== 'safeStop',
  ).length

  const guardsUsed = run.entries.filter(
    (e) =>
      e.status === 'skipped' ||
      ((e.kind === 'condition' || e.kind === 'confidenceCheck') && Boolean(e.message)),
  ).length

  // A scenario that was switched on but never actually bit still counts as an
  // opportunity the design should have been ready for.
  const armed = activeScenarios.length

  const coped =
    armed === 0 || (unhandledErrors === 0 && (completed || stoppedSafely))

  return {
    completed,
    stoppedSafely,
    failedOutright: run.status === 'failed',
    retryAttempts,
    fallbackActivated,
    humanReviewUsed,
    humanRejected,
    validatorsRun,
    validationFailuresCaught,
    unhandledErrors,
    injectedFailuresSeen: Math.max(injectedFailuresSeen, armed > 0 ? 1 : 0),
    injectedFailuresHandled,
    outputValid,
    stepsWithRecovery,
    armed,
    guardsUsed,
    coped,
  }
}

/* -------------------------------------------------------------------------- */
/* Completion criteria                                                         */
/* -------------------------------------------------------------------------- */

function describeCriterion(c: CompletionCriterion): string {
  switch (c.type) {
    case 'runSucceeds':
      return 'The workflow finishes and produces a result.'
    case 'finalOutputValid':
      return `The final output matches the ${c.schemaId} schema.`
    case 'failureRecovered':
      return 'The injected failure is recovered from rather than fatal.'
    case 'usedRetry':
      return 'A retry policy is configured and actually used.'
    case 'usedFallback':
      return 'A fallback provider takes over when the primary keeps failing.'
    case 'usedValidator':
      return 'A validator checks the payload before it travels further.'
    case 'usedHumanReview':
      return 'A person approves, edits or rejects before the workflow continues.'
    case 'stoppedSafely':
      return 'The workflow stops cleanly instead of emitting an unsafe result.'
    case 'noUnhandledErrors':
      return 'No step is left in a failed state.'
    case 'stepPrecedes':
      return c.describeAs
  }
}

function meets(c: CompletionCriterion, run: RunState, facts: Facts): boolean {
  const entries: TraceEntry[] = run.entries

  switch (c.type) {
    case 'runSucceeds':
      return facts.completed

    case 'finalOutputValid':
      return facts.completed && validateAgainst(c.schemaId, run.finalOutput).valid

    case 'failureRecovered':
      return facts.coped

    case 'usedRetry': {
      const pool = c.stepId ? entries.filter((e) => e.stepId === c.stepId) : entries
      return pool.some((e) => e.attempts.length > 1)
    }

    case 'usedFallback': {
      const pool = c.stepId ? entries.filter((e) => e.stepId === c.stepId) : entries
      return pool.some((e) => e.attempts.some((a) => a.usedFallback && a.status === 'completed'))
    }

    case 'usedValidator': {
      const pool = c.schemaId
        ? entries.filter((e) => e.validation?.schemaId === c.schemaId)
        : entries.filter((e) => Boolean(e.validation))
      return pool.length > 0
    }

    case 'usedHumanReview':
      return facts.humanReviewUsed

    case 'stoppedSafely':
      return facts.stoppedSafely

    case 'noUnhandledErrors':
      return facts.unhandledErrors === 0

    case 'stepPrecedes': {
      const earlier = entries.findIndex((e) => e.stepId === c.earlier)
      const later = entries.findIndex((e) => e.stepId === c.later)
      // Both steps must actually have run. A gate that was skipped entirely is
      // not evidence that the ordering is right.
      if (earlier === -1 || later === -1) return false
      return earlier < later
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Findings                                                                    */
/* -------------------------------------------------------------------------- */

function buildFindings(run: RunState, facts: Facts): ReliabilityFinding[] {
  const findings: ReliabilityFinding[] = []
  const add = (
    type: ReliabilityFinding['type'],
    id: string,
    title: string,
    detail: string,
  ) => findings.push({ id, type, title, detail })

  if (facts.retryAttempts > 0 && facts.injectedFailuresHandled > 0) {
    add(
      'strength',
      'retry-worked',
      'A retry rescued a transient failure',
      `The workflow spent ${facts.retryAttempts} extra attempt(s) and recovered instead of collapsing. Transient faults are the cheapest class of failure to survive.`,
    )
  }

  if (facts.fallbackActivated) {
    add(
      'strength',
      'fallback-worked',
      'A fallback provider took over',
      'When the primary provider kept failing, the workflow switched rather than giving up. This is what keeps a service available during a partial outage.',
    )
  }

  if (facts.validationFailuresCaught > 0) {
    add(
      'strength',
      'validator-caught',
      'A validator stopped bad data',
      `${facts.validationFailuresCaught} malformed payload(s) were caught before they reached the output. Without the validator this run would have looked successful while producing unusable data.`,
    )
  }

  if (facts.humanReviewUsed && !facts.humanRejected) {
    add(
      'strength',
      'human-approved',
      'A person signed off before an irreversible step',
      'The approval is recorded on the payload, so the decision is auditable after the fact.',
    )
  }

  if (facts.humanRejected) {
    add(
      'strength',
      'human-rejected',
      'A reviewer stopped the workflow',
      'Rejecting is a successful outcome, not a failure. The unsafe action never happened.',
    )
  }

  if (facts.armed > 0 && facts.coped && facts.retryAttempts === 0 && !facts.fallbackActivated) {
    add(
      'strength',
      'designed-around',
      'The design side-stepped the fault entirely',
      'A fault was injected and the workflow never even stumbled, because the shape of the design meant it could not. Avoiding a failure is a better answer than recovering from one.',
    )
  }

  if (facts.stoppedSafely) {
    add(
      'strength',
      'stopped-safely',
      'The workflow stopped safely',
      'It ended with a clear reason rather than emitting a result nobody could trust.',
    )
  }

  // Weaknesses
  if (facts.unhandledErrors > 0) {
    add(
      'weakness',
      'unhandled',
      `${facts.unhandledErrors} step(s) failed with no recovery`,
      'A step ran out of attempts and the workflow had nowhere to go. Give it a retry, a fallback, or an explicit safe stop.',
    )
  }

  if (facts.completed && !facts.outputValid) {
    add(
      'weakness',
      'invalid-output',
      'The workflow finished but the output is not valid',
      'This is the most dangerous outcome of all: it looks like success. Add a validator before the output step.',
    )
  }

  if (facts.validatorsRun === 0) {
    add(
      'weakness',
      'no-validator',
      'Nothing checked the model output',
      'Every model output in this run was trusted on sight. A single validator converts a silent corruption into a loud, catchable failure.',
    )
  }

  if (
    !facts.coped &&
    facts.retryAttempts === 0 &&
    facts.injectedFailuresSeen > 0 &&
    !facts.fallbackActivated
  ) {
    add(
      'weakness',
      'no-retry',
      'No retry was configured where one would have helped',
      'A failure was injected and the step gave up on its first attempt. Raise max attempts on the step that failed.',
    )
  }

  if (!facts.fallbackActivated && facts.injectedFailuresSeen > 0 && facts.unhandledErrors > 0) {
    add(
      'weakness',
      'no-fallback',
      'No fallback provider was available',
      'When every attempt against the primary fails, a fallback is the difference between a degraded answer and no answer.',
    )
  }

  if (facts.failedOutright) {
    add(
      'weakness',
      'hard-fail',
      'The run ended in an unhandled failure',
      run.stopReason ?? 'The workflow stopped without a recovery path.',
    )
  }

  return findings
}

/* -------------------------------------------------------------------------- */
/* Scoring                                                                     */
/* -------------------------------------------------------------------------- */

function scoreOf(facts: Facts): number {
  let score = 0

  // Did it produce something usable, or stop cleanly? Stopping safely scores
  // well because refusing to answer beats answering wrongly.
  if (facts.completed && facts.outputValid) score += 34
  else if (facts.stoppedSafely) score += 26
  else if (facts.completed) score += 12

  // Did it absorb what was thrown at it? Avoiding a fault by design counts
  // just as much as recovering from one after the fact.
  if (facts.armed === 0) {
    score += 18 // nothing was thrown, so no credit for surviving, but no penalty
  } else if (facts.coped) {
    score += 30
  } else if (facts.injectedFailuresHandled > 0) {
    score += 16
  }

  // Was the design defensive, or merely lucky?
  if (facts.validatorsRun > 0) score += 10
  if (facts.retryAttempts > 0) score += 8
  if (facts.fallbackActivated) score += 8
  if (facts.humanReviewUsed) score += 8
  if (facts.guardsUsed > 0) score += 6

  // Anything left broken costs more than any single good habit earns.
  score -= facts.unhandledErrors * 15

  return Math.max(0, Math.min(100, Math.round(score)))
}

function gradeOf(score: number): ReliabilityReport['grade'] {
  if (score >= 88) return 'bulletproof'
  if (score >= 68) return 'resilient'
  if (score >= 40) return 'brittle'
  return 'fragile'
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

export function buildReliabilityReport(
  run: RunState,
  puzzle: Puzzle | undefined,
  enabledFailureIds: string[],
): ReliabilityReport {
  const activeScenarios = (puzzle?.failureScenarios ?? []).filter((s) =>
    enabledFailureIds.includes(s.id),
  )
  const facts = gatherFacts(run, activeScenarios, puzzle?.expectedSchemaId)
  const findings = buildFindings(run, facts)
  const score = scoreOf(facts)

  const criteria = puzzle?.completionCriteria ?? []
  const unmet = criteria.filter((c) => !meets(c, run, facts)).map(describeCriterion)

  return {
    score,
    grade: gradeOf(score),
    completed: facts.completed,
    outputValid: facts.outputValid,
    // Reported from `coped` rather than from rescued attempts, because a
    // workflow that side-stepped the fault entirely handled it just as truly
    // as one that retried its way through.
    injectedFailureHandled: facts.coped,
    retryAttempts: facts.retryAttempts,
    fallbackActivated: facts.fallbackActivated,
    humanReviewUsed: facts.humanReviewUsed,
    unhandledErrors: facts.unhandledErrors,
    stoppedSafely: facts.stoppedSafely,
    findings,
    puzzleSolved: criteria.length > 0 && unmet.length === 0,
    unmetCriteria: unmet,
  }
}
