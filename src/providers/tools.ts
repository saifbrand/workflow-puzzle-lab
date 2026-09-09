/**
 * Simulated tool and retrieval layer.
 *
 * These stand in for the external services a real workflow would call. They
 * are deterministic and offline, and each one has a documented failure mode
 * so that the puzzles can teach a specific lesson rather than producing
 * random noise.
 */

import type { FailureKind } from '../engine/types'

export interface ToolDefinition {
  id: string
  label: string
  /** What the tool pretends to do. */
  summary: string
  /** How this tool fails in the real world. Shown in the inspector. */
  failureNote: string
  latencyMs: number
  /** Tools marked as a retrieval source return documents rather than records. */
  isRetrieval: boolean
}

export const TOOLS: ToolDefinition[] = [
  {
    id: 'crm-lookup',
    label: 'CRM Lookup',
    summary: 'Fetches the customer record attached to a ticket.',
    failureNote: 'Rate limited during business hours, so it times out under load.',
    latencyMs: 340,
    isRetrieval: false,
  },
  {
    id: 'kb-search',
    label: 'Knowledge Base Search',
    summary: 'Returns policy documents relevant to a question.',
    failureNote: 'Returns an empty result set when the question is out of scope.',
    latencyMs: 410,
    isRetrieval: true,
  },
  {
    id: 'web-research',
    label: 'Web Research',
    summary: 'Gathers public sources on a topic.',
    failureNote: 'Slowest source in the set and the first to time out.',
    latencyMs: 1200,
    isRetrieval: true,
  },
  {
    id: 'archive-search',
    label: 'Internal Archive',
    summary: 'Searches previously published internal briefings.',
    failureNote: 'Narrow coverage, but reliable. A good fallback for web research.',
    latencyMs: 380,
    isRetrieval: true,
  },
  {
    id: 'mail-send',
    label: 'Outbound Mail',
    summary: 'Sends an external message. Irreversible once it fires.',
    failureNote: 'Cannot be undone, which is why it belongs behind an approval gate.',
    latencyMs: 300,
    isRetrieval: false,
  },
  {
    id: 'checkpoint-store',
    label: 'Checkpoint Store',
    summary: 'Reads and writes the last known good stage of a long job.',
    failureNote: 'Occasionally loses the most recent write during an interruption.',
    latencyMs: 220,
    isRetrieval: false,
  },
]

export const TOOL_BY_ID: Record<string, ToolDefinition> = Object.fromEntries(
  TOOLS.map((t) => [t.id, t]),
)

export class ToolError extends Error {
  constructor(
    message: string,
    readonly kind: FailureKind,
  ) {
    super(message)
    this.name = 'ToolError'
  }
}

export interface ToolResult {
  value: unknown
  toolId: string
  mocked: true
}

/** Canned successful payloads, keyed by tool id. */
const TOOL_RESPONSES: Record<string, unknown> = {
  'crm-lookup': {
    customerId: 'CU-40921',
    name: 'Dana Whitfield',
    plan: 'Business',
    openInvoices: 2,
    lifetimeValue: 18400,
  },
  'kb-search': {
    documents: [
      {
        id: 'policy-refunds-v4#section-2',
        title: 'Refund policy, section 2',
        excerpt: 'Approved refunds return to the original payment method within five business days.',
      },
      {
        id: 'faq-payments#refund-window',
        title: 'Payments FAQ, refund window',
        excerpt: 'Customers may request a refund within 30 days of purchase.',
      },
    ],
  },
  'web-research': {
    documents: [
      {
        id: 'eur-lex-2023-1542',
        title: 'EU Batteries Regulation 2023/1542',
        excerpt: 'Sets collection targets rising to 73 percent by 2030.',
      },
      {
        id: 'eea-briefing-2024',
        title: 'EEA briefing on battery recovery',
        excerpt: 'Producers carry extended responsibility for end-of-life collection.',
      },
    ],
  },
  'archive-search': {
    documents: [
      {
        id: 'industry-review-2024',
        title: 'Internal industry review 2024',
        excerpt: 'Recycled content minimums begin to apply from 2031.',
      },
    ],
  },
  'mail-send': { delivered: true, messageId: 'msg-8831', irreversible: true },
  'checkpoint-store': {
    missionId: 'mission-7742',
    lastGoodStage: 'normalise',
    completedStages: ['collect', 'normalise'],
  },
}

/** Runs one simulated tool call. Throws `ToolError` for failures. */
export function callTool(
  toolId: string,
  corruption?: FailureKind,
): ToolResult {
  const tool = TOOL_BY_ID[toolId]
  if (!tool) {
    throw new ToolError(`Unknown tool "${toolId}".`, 'toolError')
  }

  if (corruption === 'toolTimeout') {
    throw new ToolError(
      `"${tool.label}" did not respond before the configured timeout.`,
      'toolTimeout',
    )
  }

  if (corruption === 'toolError') {
    throw new ToolError(`"${tool.label}" returned HTTP 503 Service Unavailable.`, 'toolError')
  }

  if (corruption === 'emptyRetrieval') {
    // An empty result is not an exception. It is a perfectly valid response
    // that happens to contain nothing, which is precisely why it is dangerous:
    // a workflow without a guard will hand it straight to the model.
    return { value: { documents: [] }, toolId, mocked: true }
  }

  return { value: TOOL_RESPONSES[toolId] ?? { ok: true }, toolId, mocked: true }
}

export function toolLatency(toolId: string): number {
  return TOOL_BY_ID[toolId]?.latencyMs ?? 300
}
