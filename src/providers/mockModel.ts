/**
 * Mock model provider.
 *
 * The entire puzzle set runs on this file. No API key, no network, no cost.
 * Responses are canned per response key and are completely deterministic, so
 * a reviewer who enables the same failure scenario sees the same corruption
 * every time.
 *
 * The corrupted variants matter as much as the healthy ones. They are modelled
 * on the ways real models actually misbehave: a fenced code block that is not
 * valid JSON, a required field quietly dropped, an enum value invented on the
 * spot, a number returned as a string, and a confident answer with no evidence
 * behind it.
 */

import type { FailureKind } from '../engine/types'

export interface ModelRequest {
  modelId: string
  /** Which canned response family to draw from. Usually the step's schemaId. */
  responseKey: string
  /** Fully interpolated prompt. Recorded in the trace for transparency. */
  prompt: string
  /** Payload arriving from the previous step. */
  input: unknown
  /** When set, the provider returns a deliberately broken response. */
  corruption?: FailureKind
}

export interface ModelResponse {
  /** Parsed value handed to the next step. */
  value: unknown
  /** Raw text as the "model" produced it, shown in the trace. */
  raw: string
  modelId: string
  /** True when this came from the mock bank rather than a live provider. */
  mocked: boolean
  /** Self reported confidence, where the response family has one. */
  confidence?: number
}

export class ModelError extends Error {
  constructor(
    message: string,
    readonly kind: FailureKind,
  ) {
    super(message)
    this.name = 'ModelError'
  }
}

/** Registered mock models. Weaker models are cheaper but likelier to drift. */
export const MOCK_MODELS = [
  {
    id: 'mock-fast',
    label: 'Mock Fast',
    note: 'Quick and cheap. Formats sloppily under pressure.',
  },
  {
    id: 'mock-balanced',
    label: 'Mock Balanced',
    note: 'The default. Good structure, occasional timeouts.',
  },
  {
    id: 'mock-strict',
    label: 'Mock Strict (fallback)',
    note: 'Slower but returns schema-clean output. Ideal as a fallback.',
  },
] as const

export type MockModelId = (typeof MOCK_MODELS)[number]['id']

/* -------------------------------------------------------------------------- */
/* Healthy responses                                                           */
/* -------------------------------------------------------------------------- */

const HEALTHY: Record<string, { value: unknown; confidence?: number }> = {
  meetingSummary: {
    value: {
      summary:
        'The team agreed to ship the billing rewrite behind a feature flag and postpone the mobile refresh to next quarter.',
      decisions: [
        'Ship the billing rewrite behind a feature flag',
        'Postpone the mobile refresh to Q3',
      ],
      actionItems: [
        { task: 'Wire the feature flag into the checkout path', owner: 'Priya' },
        { task: 'Draft the Q3 mobile plan', owner: 'Marcus' },
      ],
    },
    confidence: 0.88,
  },
  groundedAnswer: {
    value: {
      answer:
        'Refunds are issued to the original payment method within five business days of approval.',
      citations: ['policy-refunds-v4#section-2', 'faq-payments#refund-window'],
      answered: true,
    },
    confidence: 0.91,
  },
  ticketRouting: {
    value: { category: 'billing', priority: 'high', confidence: 0.86, queue: 'billing-tier2' },
    confidence: 0.86,
  },
  researchBrief: {
    value: {
      topic: 'Battery recycling regulation in the EU',
      findings: [
        'The 2023 Batteries Regulation sets collection targets rising to 73 percent by 2030',
        'Producers carry extended responsibility for end-of-life collection',
        'Recycled content minimums begin to apply from 2031',
      ],
      sourcesUsed: ['eur-lex-2023-1542', 'eea-briefing-2024', 'industry-review-2024'],
      partial: false,
    },
    confidence: 0.83,
  },
  outboundMessage: {
    value: {
      to: 'dana@northwind.example',
      subject: 'Your renewal quote',
      body: 'Hi Dana, thanks for your patience. Your renewal quote is attached and holds until the end of the month. Happy to walk through it whenever suits you.',
      approvedBy: '',
    },
    confidence: 0.79,
  },
  extractedInvoice: {
    value: {
      invoiceNumber: 'INV-2026-0834',
      vendor: 'Northwind Logistics',
      total: 4820.5,
      currency: 'USD',
      dueDate: '2026-09-30',
    },
    confidence: 0.9,
  },
  moderationVerdict: {
    value: { verdict: 'escalate', reason: 'Ambiguous claim about a named person', confidence: 0.62 },
    confidence: 0.62,
  },
  missionState: {
    value: {
      missionId: 'mission-7742',
      completedStages: ['collect', 'normalise', 'enrich'],
      resumedFrom: 'normalise',
      finalReport:
        'All three stages finished after the interruption was recovered from the last checkpoint.',
    },
    confidence: 0.87,
  },
}

/* -------------------------------------------------------------------------- */
/* Corrupted responses                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Drops a required field, the single most common structured-output failure.
 * For each family we remove the field whose absence is genuinely damaging.
 */
const MISSING_FIELD: Record<string, unknown> = {
  meetingSummary: {
    summary:
      'The team agreed to ship the billing rewrite behind a feature flag and postpone the mobile refresh.',
    decisions: ['Ship the billing rewrite behind a feature flag'],
    // Every action item has lost its owner, so nobody is accountable.
    actionItems: [{ task: 'Wire the feature flag into the checkout path', owner: '' }],
  },
  ticketRouting: {
    category: 'billing',
    priority: 'high',
    confidence: 0.81,
    // queue is missing entirely, so the ticket would go nowhere.
  },
  extractedInvoice: {
    invoiceNumber: 'INV-2026-0834',
    vendor: 'Northwind Logistics',
    currency: 'USD',
    dueDate: '2026-09-30',
    // total is missing, which is the one number the finance system needs.
  },
  outboundMessage: {
    to: 'dana@northwind.example',
    subject: 'Your renewal quote',
    body: 'Hi Dana, your quote is attached and holds until month end. Happy to talk it through.',
    // approvedBy missing: the message would be sent with nobody accountable.
  },
  missionState: {
    missionId: 'mission-7742',
    completedStages: ['collect'],
    finalReport: 'Partial run recorded.',
    // resumedFrom missing, so the job cannot prove where it restarted.
  },
}

/** Values that parse as JSON but violate the schema's own rules. */
const SCHEMA_VIOLATION: Record<string, unknown> = {
  ticketRouting: {
    // "refunds" is not a member of the enum; the model invented a category.
    category: 'refunds',
    priority: 'severe',
    confidence: 1.4,
    queue: 'billing-tier2',
  },
  extractedInvoice: {
    invoiceNumber: 'INV-2026-0834',
    vendor: 'Northwind Logistics',
    // total arrives as a string with a currency symbol, a classic drift.
    total: '$4,820.50',
    currency: 'US Dollars',
    dueDate: '30 September 2026',
  },
  meetingSummary: {
    summary: 'Short.',
    decisions: [],
    actionItems: [],
  },
  moderationVerdict: {
    verdict: 'maybe',
    reason: '',
    confidence: 2,
  },
  groundedAnswer: {
    answer: 'Refunds take about a week, I believe.',
    citations: [],
    answered: true,
  },
}

/** Text that is not valid JSON at all, wrapped in a chatty preamble. */
const INVALID_JSON: Record<string, string> = {
  meetingSummary:
    'Sure! Here is the summary you asked for:\n\n```json\n{\n  "summary": "The team agreed to ship the billing rewrite",\n  "decisions": ["Ship behind a flag",],\n  "actionItems": [{ "task": "Wire the flag", owner: Priya }]\n}\n```\nLet me know if you would like it shorter.',
  ticketRouting:
    'Happy to help! Based on the ticket:\n\n{ category: billing, priority: "high", confidence: 0.8, queue: "billing-tier2" ',
  extractedInvoice:
    'Here are the fields I could find:\n\ninvoiceNumber: INV-2026-0834\nvendor: Northwind Logistics\ntotal: 4820.50 USD\ndueDate: 2026-09-30',
  default:
    'Of course! Here is the result:\n\n```\n{ "result": "ok", }\n```\nHope that helps.',
}

/** A confidently worded answer with nothing behind it. */
const LOW_CONFIDENCE: Record<string, { value: unknown; confidence: number }> = {
  ticketRouting: {
    value: { category: 'technical', priority: 'medium', confidence: 0.34, queue: 'triage' },
    confidence: 0.34,
  },
  groundedAnswer: {
    value: {
      answer: 'I think refunds are processed within a couple of weeks.',
      citations: [],
      answered: true,
    },
    confidence: 0.28,
  },
  moderationVerdict: {
    value: { verdict: 'allow', reason: 'Seems fine', confidence: 0.31 },
    confidence: 0.31,
  },
  default: {
    value: { result: 'uncertain', confidence: 0.3 },
    confidence: 0.3,
  },
}

/* -------------------------------------------------------------------------- */
/* Provider                                                                    */
/* -------------------------------------------------------------------------- */

function healthyFor(key: string): { value: unknown; confidence?: number } {
  return HEALTHY[key] ?? { value: { result: 'ok', key }, confidence: 0.8 }
}

/** True when retrieval ran but handed the model nothing to work from. */
function hasEmptyContext(input: unknown): boolean {
  if (!input || typeof input !== 'object') return false
  const docs = (input as Record<string, unknown>).documents
  return Array.isArray(docs) && docs.length === 0
}

/**
 * The strict fallback model repairs the two corruptions that are genuinely
 * repairable, which is what makes configuring a fallback feel worthwhile
 * rather than arbitrary.
 */
function isRepairingModel(modelId: string): boolean {
  return modelId === 'mock-strict'
}

/** Runs one mock generation. Throws `ModelError` for transport level failures. */
export function generateMock(request: ModelRequest): ModelResponse {
  const { modelId, responseKey, corruption } = request

  if (corruption === 'modelTimeout') {
    throw new ModelError(
      `Model "${modelId}" did not respond before the configured timeout.`,
      'modelTimeout',
    )
  }

  // A strict fallback still times out if that is what was injected, but it
  // does clean up formatting and schema drift.
  const repairs = isRepairingModel(modelId)

  if (corruption === 'invalidJson' && !repairs) {
    const raw = INVALID_JSON[responseKey] ?? INVALID_JSON.default
    throw new ModelError(
      'Model returned text that is not valid JSON. Raw output: ' + raw.slice(0, 120) + '...',
      'invalidJson',
    )
  }

  if (corruption === 'missingField' && !repairs) {
    const value = MISSING_FIELD[responseKey] ?? { partial: true }
    return {
      value,
      raw: JSON.stringify(value, null, 2),
      modelId,
      mocked: true,
      confidence: 0.74,
    }
  }

  if (corruption === 'schemaViolation' && !repairs) {
    const value = SCHEMA_VIOLATION[responseKey] ?? { unexpected: true }
    return {
      value,
      raw: JSON.stringify(value, null, 2),
      modelId,
      mocked: true,
      confidence: 0.7,
    }
  }

  if (corruption === 'lowConfidence') {
    // A stronger model is more confident, but not magically certain.
    const entry = LOW_CONFIDENCE[responseKey] ?? LOW_CONFIDENCE.default
    if (repairs) {
      const healthy = healthyFor(responseKey)
      return {
        value: healthy.value,
        raw: JSON.stringify(healthy.value, null, 2),
        modelId,
        mocked: true,
        confidence: healthy.confidence ?? 0.8,
      }
    }
    return {
      value: entry.value,
      raw: JSON.stringify(entry.value, null, 2),
      modelId,
      mocked: true,
      confidence: entry.confidence,
    }
  }

  // A model cannot cite what it was never given. With an empty context it does
  // what real models do: it answers anyway, from memory, with nothing to point
  // at. Every field is individually well formed, which is exactly why only a
  // cross-field rule catches it.
  if (responseKey === 'groundedAnswer' && hasEmptyContext(request.input)) {
    const value = {
      answer: 'Refunds usually take about a week to reach your card, as far as I recall.',
      citations: [] as string[],
      answered: true,
    }
    return {
      value,
      raw: JSON.stringify(value, null, 2),
      modelId,
      mocked: true,
      confidence: 0.44,
    }
  }

  const healthy = healthyFor(responseKey)
  // The fast model shaves confidence slightly, which gives confidence checks
  // something meaningful to react to without needing an injected failure.
  const confidence =
    modelId === 'mock-fast' && healthy.confidence
      ? Math.round((healthy.confidence - 0.12) * 100) / 100
      : healthy.confidence

  return {
    value: healthy.value,
    raw: JSON.stringify(healthy.value, null, 2),
    modelId,
    mocked: true,
    confidence,
  }
}

/** Nominal latency per model, used to make the timeline feel real. */
export function mockLatency(modelId: string): number {
  switch (modelId) {
    case 'mock-fast':
      return 260
    case 'mock-strict':
      return 900
    default:
      return 520
  }
}
