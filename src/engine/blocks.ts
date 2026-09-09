/**
 * The block catalogue.
 *
 * Everything the UI needs to render, describe and create a block lives here,
 * so adding a new block kind is a single edit rather than a hunt through the
 * component tree. The library is intentionally small on purpose: a focused set
 * of well designed blocks teaches more than a sprawling no-code palette.
 */

import type { BlockFamily, BlockKind, StepConfig, WorkflowStep, ReliabilityPolicy } from './types'

export interface BlockDefinition {
  kind: BlockKind
  label: string
  family: BlockFamily
  /** One line explanation shown in the palette and on hover. */
  summary: string
  /** Longer teaching note shown in the inspector. */
  teaches: string
  /** Emoji glyph. Cheap, dependency free, and renders everywhere. */
  glyph: string
  /** CSS custom property suffix used for the node accent colour. */
  accent: string
  /** Whether this block can fail and therefore carries a reliability policy. */
  canFail: boolean
  /** Factory for a sensible default configuration. */
  defaultConfig: () => StepConfig
}

const defaultPolicy = (): ReliabilityPolicy => ({
  maxAttempts: 1,
  timeoutMs: 2000,
  onError: 'fail',
})

export const BLOCK_LIBRARY: Record<BlockKind, BlockDefinition> = {
  input: {
    kind: 'input',
    label: 'Input',
    family: 'core',
    summary: 'Where the sample payload enters the workflow.',
    teaches: 'Every workflow starts from a committed sample input so that runs are reproducible.',
    glyph: '📥',
    accent: 'slate',
    canFail: false,
    defaultConfig: () => ({ kind: 'input', label: 'Sample input' }),
  },
  ai: {
    kind: 'ai',
    label: 'AI Model',
    family: 'core',
    summary: 'Calls a model to classify, extract, summarise or draft.',
    teaches:
      'Model calls are the least predictable part of a workflow. They time out, drift from the requested format, and occasionally return confident nonsense. Treat every model output as untrusted until something checks it.',
    glyph: '🧠',
    accent: 'violet',
    canFail: true,
    defaultConfig: () => ({
      kind: 'ai',
      modelId: 'mock-balanced',
      task: 'Process the input',
      prompt: 'Given the following input, produce a structured result.\n\n{{input}}',
      responseKey: 'meetingSummary',
    }),
  },
  tool: {
    kind: 'tool',
    label: 'Tool / API',
    family: 'core',
    summary: 'Calls a simulated external service.',
    teaches:
      'External services fail for reasons you do not control. A workflow that assumes a tool always answers is a workflow that breaks in production.',
    glyph: '🔧',
    accent: 'amber',
    canFail: true,
    defaultConfig: () => ({ kind: 'tool', toolId: 'crm-lookup', task: 'Look up a record' }),
  },
  retrieval: {
    kind: 'retrieval',
    label: 'Retrieval',
    family: 'core',
    summary: 'Fetches supporting documents for the model to ground its answer on.',
    teaches:
      'Retrieval can legitimately return nothing. A grounded assistant must be able to say "I do not know" instead of inventing an answer from an empty context.',
    glyph: '📚',
    accent: 'teal',
    canFail: true,
    defaultConfig: () => ({ kind: 'retrieval', toolId: 'kb-search', task: 'Search the knowledge base' }),
  },
  condition: {
    kind: 'condition',
    label: 'Condition',
    family: 'core',
    summary: 'Branches the workflow by inspecting a value.',
    teaches:
      'Conditions let a workflow spend expensive steps, such as human attention, only when they are actually needed.',
    glyph: '🔀',
    accent: 'sky',
    canFail: false,
    defaultConfig: () => ({
      kind: 'condition',
      path: 'confidence',
      operator: 'gte',
      value: 0.7,
      skipWhenFalse: 1,
    }),
  },
  transform: {
    kind: 'transform',
    label: 'Transform',
    family: 'core',
    summary: 'Reshapes the payload with a pure, deterministic function.',
    teaches:
      'Deterministic steps are free reliability. Anything you can do without a model, do without a model.',
    glyph: '🔁',
    accent: 'slate',
    canFail: false,
    defaultConfig: () => ({ kind: 'transform', transformId: 'passthrough' }),
  },
  output: {
    kind: 'output',
    label: 'Output',
    family: 'core',
    summary: 'The final result handed back to the caller.',
    teaches: 'The output step is what the reliability report grades.',
    glyph: '🏁',
    accent: 'slate',
    canFail: false,
    defaultConfig: () => ({ kind: 'output', label: 'Final result' }),
  },
  validator: {
    kind: 'validator',
    label: 'Validator',
    family: 'reliability',
    summary: 'Checks the payload against a schema before it travels further.',
    teaches:
      'A validator converts a silent, downstream corruption into a loud, local failure. It is the single highest value block in this library.',
    glyph: '🛡️',
    accent: 'emerald',
    canFail: true,
    defaultConfig: () => ({ kind: 'validator', schemaId: 'meetingSummary' }),
  },
  safeStop: {
    kind: 'safeStop',
    label: 'Safe Stop',
    family: 'reliability',
    summary: 'Ends the run deliberately, with an explanation.',
    teaches:
      'Refusing to answer is a valid, and often correct, outcome. A workflow that stops cleanly beats one that guesses.',
    glyph: '🛑',
    accent: 'rose',
    canFail: false,
    defaultConfig: () => ({
      kind: 'safeStop',
      reason: 'Not enough reliable evidence to continue.',
    }),
  },
  humanReview: {
    kind: 'humanReview',
    label: 'Human Review',
    family: 'human',
    summary: 'Pauses the workflow until a person approves, edits or rejects.',
    teaches:
      'Human review is the last line of defence for irreversible actions. The decision must be recorded, not just acted on.',
    glyph: '🙋',
    accent: 'indigo',
    canFail: false,
    defaultConfig: () => ({
      kind: 'humanReview',
      prompt: 'Review this result before the workflow continues.',
      allowEdit: true,
    }),
  },
  confidenceCheck: {
    kind: 'confidenceCheck',
    label: 'Confidence Check',
    family: 'human',
    summary: 'Routes low confidence results away from the happy path.',
    teaches:
      'A model that is unsure is telling you something useful. Acting on a low confidence answer is how quiet errors reach customers.',
    glyph: '📊',
    accent: 'indigo',
    canFail: false,
    defaultConfig: () => ({
      kind: 'confidenceCheck',
      path: 'confidence',
      threshold: 0.7,
      belowThreshold: 'humanReview',
    }),
  },
}

/** Ordered list for the palette, grouped by family. */
export const PALETTE_ORDER: BlockKind[] = [
  'ai',
  'tool',
  'retrieval',
  'condition',
  'transform',
  'validator',
  'safeStop',
  'humanReview',
  'confidenceCheck',
]

export const FAMILY_LABELS: Record<BlockFamily, string> = {
  core: 'Core blocks',
  reliability: 'Reliability blocks',
  human: 'Human control blocks',
}

let stepCounter = 0

/** Creates a new step with a unique id and the block's default configuration. */
export function createStep(kind: BlockKind, overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  const def = BLOCK_LIBRARY[kind]
  stepCounter += 1
  return {
    id: `${kind}-${Date.now().toString(36)}-${stepCounter}`,
    title: def.label,
    config: def.defaultConfig(),
    reliability: def.canFail ? defaultPolicy() : undefined,
    ...overrides,
  }
}

/** True when the step's policy would let it survive a transient failure. */
export function hasRecoveryConfigured(step: WorkflowStep): boolean {
  const p = step.reliability
  if (!p) return false
  return p.maxAttempts > 1 || Boolean(p.fallbackId) || p.onError !== 'fail'
}
