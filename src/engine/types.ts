/**
 * Core domain model for the AI Workflow Puzzle Builder.
 *
 * The model is deliberately small. A workflow is an ordered chain of steps.
 * Each step has a kind, a configuration object, and an optional reliability
 * policy that describes how the engine should behave when that step misbehaves.
 *
 * Keeping execution linear (rather than an arbitrary graph) is what makes the
 * trace easy to read and failures easy to reproduce, which is the whole point
 * of the product. Branching is expressed through `condition` steps that can
 * skip forward, which covers the puzzle scenarios without turning the engine
 * into a general purpose orchestration platform.
 */

/** Every kind of block a workflow can contain. */
export type BlockKind =
  // core
  | 'input'
  | 'ai'
  | 'tool'
  | 'retrieval'
  | 'condition'
  | 'transform'
  | 'output'
  // reliability
  | 'validator'
  | 'safeStop'
  // human control
  | 'humanReview'
  | 'confidenceCheck'

/** Which family a block belongs to. Drives grouping and colour in the UI. */
export type BlockFamily = 'core' | 'reliability' | 'human'

/** What the engine should do when a step has exhausted its retries. */
export type ErrorPolicy =
  /** Abort the run and mark the workflow failed. */
  | 'fail'
  /** Stop early, but cleanly, with an explanation. Counts as a safe stop. */
  | 'safeStop'
  /** Hand the failure to a human, who may approve, edit, reject or stop. */
  | 'humanReview'
  /** Substitute a configured default value and carry on. */
  | 'useDefault'

/**
 * Per-step reliability policy.
 *
 * This is the heart of the learning experience: the same workflow either
 * survives or collapses depending on what the user configures here.
 */
export interface ReliabilityPolicy {
  /** Total attempts, including the first. 1 means "no retry". */
  maxAttempts: number
  /** Simulated milliseconds before a step is considered timed out. */
  timeoutMs?: number
  /**
   * Fallback to use when the primary provider keeps failing. For `ai` steps
   * this is a different (usually weaker but more reliable) model id; for
   * `tool` and `retrieval` steps it is a different source id.
   */
  fallbackId?: string
  /** What to do once every attempt, including the fallback, has failed. */
  onError: ErrorPolicy
  /** Value handed downstream when `onError` is `useDefault`. */
  defaultValue?: unknown
}

/** Configuration for an `ai` step. */
export interface AiStepConfig {
  /** Which mock or live model to call. */
  modelId: string
  /** Human readable description of the job, shown on the node. */
  task: string
  /** Prompt template. `{{input}}` is replaced with the incoming payload. */
  prompt: string
  /**
   * Which family of canned responses the mock provider should draw from.
   * Kept separate from `schemaId` so a step can produce, say, a meeting
   * summary without also policing its own output.
   */
  responseKey: string
  /**
   * When set, the engine validates this step's output against the schema on
   * every attempt. An invalid response counts as a failed attempt, which is
   * what allows a retry or a fallback model to rescue schema drift.
   *
   * Leave it unset to let bad output travel downstream, which is exactly the
   * mistake several puzzles ask the learner to notice.
   */
  schemaId?: string
}

/** Configuration for a `tool` or `retrieval` step. */
export interface ToolStepConfig {
  toolId: string
  /** Description shown on the node. */
  task: string
}

/** Configuration for a `validator` step. */
export interface ValidatorStepConfig {
  /** Which registered schema to check the incoming payload against. */
  schemaId: string
  /**
   * When true a failed validation is reported but does not stop the run.
   * Used by puzzles that teach the difference between warning and enforcing.
   */
  warnOnly?: boolean
}

/** Configuration for a `condition` step. */
export interface ConditionStepConfig {
  /** Dot path into the incoming payload, e.g. `classification.confidence`. */
  path: string
  operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq' | 'exists' | 'notEmpty'
  value?: unknown
  /**
   * Number of steps to skip when the condition is false. The default of 1
   * means "skip the next step", which is how puzzles express "only ask a
   * human when confidence is low".
   */
  skipWhenFalse: number
}

/** Configuration for a `transform` step. */
export interface TransformStepConfig {
  /** Which registered pure transform to apply. */
  transformId: string
}

/** Configuration for a `confidenceCheck` step. */
export interface ConfidenceStepConfig {
  path: string
  threshold: number
  /** What happens when confidence sits below the threshold. */
  belowThreshold: 'humanReview' | 'fallback' | 'safeStop'
}

/** Configuration for a `humanReview` step. */
export interface HumanReviewStepConfig {
  /** Question put to the reviewer. */
  prompt: string
  /** Whether the reviewer is allowed to edit the payload before approving. */
  allowEdit: boolean
}

/** Configuration for a `safeStop` step. */
export interface SafeStopStepConfig {
  reason: string
}

/** Configuration for `input` and `output` steps. */
export interface IoStepConfig {
  label: string
}

export type StepConfig =
  | ({ kind: 'input' } & IoStepConfig)
  | ({ kind: 'output' } & IoStepConfig)
  | ({ kind: 'ai' } & AiStepConfig)
  | ({ kind: 'tool' } & ToolStepConfig)
  | ({ kind: 'retrieval' } & ToolStepConfig)
  | ({ kind: 'validator' } & ValidatorStepConfig)
  | ({ kind: 'condition' } & ConditionStepConfig)
  | ({ kind: 'transform' } & TransformStepConfig)
  | ({ kind: 'confidenceCheck' } & ConfidenceStepConfig)
  | ({ kind: 'humanReview' } & HumanReviewStepConfig)
  | ({ kind: 'safeStop' } & SafeStopStepConfig)

/** One node in the workflow chain. */
export interface WorkflowStep {
  id: string
  /** Short name shown on the canvas node. */
  title: string
  config: StepConfig
  /** Omitted for steps that cannot fail, such as `input`. */
  reliability?: ReliabilityPolicy
}

/** A complete, runnable workflow. */
export interface Workflow {
  id: string
  name: string
  steps: WorkflowStep[]
}

/* -------------------------------------------------------------------------- */
/* Failure simulation                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The failure types the simulator can inject. Every one of these is
 * deterministic: given the same seed and the same configuration, the same
 * attempt numbers fail in the same way, so a reviewer can reproduce a bug
 * report exactly.
 */
export type FailureKind =
  | 'modelTimeout'
  | 'toolTimeout'
  | 'invalidJson'
  | 'missingField'
  | 'schemaViolation'
  | 'emptyRetrieval'
  | 'lowConfidence'
  | 'toolError'
  | 'rejectedByHuman'

/** A failure scenario that a puzzle can switch on. */
export interface FailureScenario {
  id: string
  kind: FailureKind
  label: string
  /** Plain language explanation shown next to the toggle. */
  description: string
  /** Id of the step this failure is injected into. */
  targetStepId: string
  /**
   * Which attempts fail, 1-indexed. `[1, 2]` means the step fails twice then
   * succeeds, which is exactly what makes a retry policy visibly worthwhile.
   * An empty array means every attempt fails, which forces a fallback or a
   * safe stop.
   */
  failOnAttempts: number[]
  /**
   * When true the failure is never injected into a fallback attempt.
   *
   * This models the ordinary case where one provider is down and another is
   * not. Without it, an "always fails" scenario would also take out the
   * fallback, and no amount of good design could rescue the run, which
   * teaches nothing.
   */
  exemptFallback?: boolean
  /** Enabled by default when the puzzle loads. */
  defaultEnabled?: boolean
}

/* -------------------------------------------------------------------------- */
/* Execution trace                                                             */
/* -------------------------------------------------------------------------- */

export type StepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'paused'
  | 'retrying'
  | 'recovered'
  | 'safelyStopped'
  | 'skipped'

/** What the engine did to rescue a step. */
export type RecoveryAction =
  | 'retry'
  | 'fallback'
  | 'useDefault'
  | 'humanApproved'
  | 'humanEdited'
  | 'humanRejected'
  | 'safeStop'
  | 'none'

/** One attempt at running one step. */
export interface AttemptRecord {
  attempt: number
  status: 'completed' | 'failed'
  /** Present when the attempt failed. */
  error?: string
  /** Which injected failure caused this, when it was simulated. */
  failureKind?: FailureKind
  /** True when this attempt ran against the fallback provider. */
  usedFallback: boolean
  durationMs: number
  output?: unknown
}

/** The reviewer's decision on a paused step. */
export interface HumanDecision {
  verdict: 'approved' | 'edited' | 'rejected'
  /** Payload after the reviewer's edit, when they edited it. */
  editedValue?: unknown
  note?: string
  decidedAt: number
}

/** Result of running one validator. */
export interface ValidationResult {
  schemaId: string
  valid: boolean
  /** Human readable messages, one per violated rule. */
  issues: string[]
}

/** The full record of one step's execution. */
export interface TraceEntry {
  stepId: string
  stepTitle: string
  kind: BlockKind
  status: StepStatus
  input: unknown
  output?: unknown
  attempts: AttemptRecord[]
  validation?: ValidationResult
  humanDecision?: HumanDecision
  recovery: RecoveryAction
  /** Explanation shown in the trace panel when something went wrong. */
  message?: string
  startedAt: number
  endedAt?: number
}

export type RunStatus =
  | 'idle'
  | 'running'
  | 'awaitingHuman'
  | 'succeeded'
  | 'failed'
  | 'safelyStopped'

/** Everything the UI needs to render one execution. */
export interface RunState {
  runId: string
  status: RunStatus
  /** Index into `workflow.steps` of the step currently executing. */
  currentStepIndex: number
  entries: TraceEntry[]
  finalOutput?: unknown
  /** Set when the run ended without producing a usable result. */
  stopReason?: string
  startedAt: number
  endedAt?: number
}

/* -------------------------------------------------------------------------- */
/* Reliability feedback                                                        */
/* -------------------------------------------------------------------------- */

/** One graded observation about how the workflow behaved. */
export interface ReliabilityFinding {
  id: string
  /** `strength` is something the design got right, `weakness` is a gap. */
  type: 'strength' | 'weakness'
  title: string
  detail: string
}

export interface ReliabilityReport {
  /** 0-100. Weighted across completion, validity, recovery and safety. */
  score: number
  grade: 'fragile' | 'brittle' | 'resilient' | 'bulletproof'
  completed: boolean
  outputValid: boolean
  injectedFailureHandled: boolean
  retryAttempts: number
  fallbackActivated: boolean
  humanReviewUsed: boolean
  unhandledErrors: number
  stoppedSafely: boolean
  findings: ReliabilityFinding[]
  /** True when every completion criterion of the active puzzle was met. */
  puzzleSolved: boolean
  /** Criteria that are still outstanding, in the puzzle's own words. */
  unmetCriteria: string[]
}

/* -------------------------------------------------------------------------- */
/* Puzzles                                                                     */
/* -------------------------------------------------------------------------- */

export type Difficulty = 'beginner' | 'intermediate' | 'advanced'

/**
 * A machine checkable completion criterion. The reliability engine evaluates
 * these against the finished run, which is what lets the app tell the user
 * "you solved it" rather than leaving them to guess.
 */
export type CompletionCriterion =
  | { type: 'runSucceeds' }
  | { type: 'finalOutputValid'; schemaId: string }
  | { type: 'failureRecovered'; failureId: string }
  | { type: 'usedRetry'; stepId?: string }
  | { type: 'usedFallback'; stepId?: string }
  | { type: 'usedValidator'; schemaId?: string }
  | { type: 'usedHumanReview' }
  | { type: 'stoppedSafely' }
  | { type: 'noUnhandledErrors' }
  /**
   * Asserts execution order. Ordering is not a detail: an approval gate that
   * runs after the irreversible action it is meant to guard has no effect at
   * all, and no amount of per-step configuration would reveal that.
   */
  | { type: 'stepPrecedes'; earlier: string; later: string; describeAs: string }

export interface Puzzle {
  id: string
  title: string
  difficulty: Difficulty
  /** One line hook shown on the puzzle card. */
  tagline: string
  /** What the learner is being asked to achieve, in full. */
  objective: string
  /** Friendly instruction in puzzle language, e.g. "Survive the timeout". */
  challengeCall: string
  /** Block kinds the learner is allowed to add for this puzzle. */
  availableBlocks: BlockKind[]
  /** The workflow the learner starts from. Usually deliberately broken. */
  startingWorkflow: Workflow
  /** Committed sample input, so runs are reproducible. */
  sampleInput: unknown
  /** Prose description of the result the workflow should produce. */
  expectedResult: string
  /** Id of the schema the final output is expected to satisfy, if any. */
  expectedSchemaId?: string
  /** Failure scenarios the learner can switch on. */
  failureScenarios: FailureScenario[]
  /** Machine checkable definition of "solved". */
  completionCriteria: CompletionCriterion[]
  /** Shown when the learner asks for a nudge. */
  hints: string[]
}
