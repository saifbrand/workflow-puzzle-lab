/**
 * Schema registry and validation.
 *
 * Every schema is a Zod object so the same definition can both validate a
 * payload and describe itself to the learner in the inspector. Validation
 * failures are flattened into plain sentences, because the audience is
 * someone learning workflow design, not someone reading a stack trace.
 */

import { z } from 'zod'
import type { ValidationResult } from './types'

export interface SchemaDefinition {
  id: string
  label: string
  /** Plain language summary shown in the validator inspector. */
  description: string
  /** Field-by-field description, rendered as a small table. */
  fields: { name: string; type: string; note: string }[]
  schema: z.ZodTypeAny
}

const actionItem = z.object({
  task: z.string().min(1, 'task must not be empty'),
  owner: z.string().min(1, 'owner must not be empty'),
})

const meetingSummary = z.object({
  summary: z.string().min(10, 'summary must be at least 10 characters'),
  decisions: z.array(z.string().min(1)).min(1, 'at least one decision is required'),
  actionItems: z.array(actionItem).min(1, 'at least one action item is required'),
})

/**
 * A grounded answer must either cite something or admit it did not answer.
 *
 * The cross-field rule is the whole point of the schema. Each field on its own
 * can look perfectly healthy while the object as a whole describes an assistant
 * that answered confidently with no evidence behind it, which is the exact
 * failure the knowledge assistant puzzle is about.
 */
const groundedAnswer = z
  .object({
    answer: z.string().min(1, 'answer must not be empty'),
    citations: z.array(z.string().min(1)),
    answered: z.boolean(),
  })
  .refine((v) => !v.answered || v.citations.length > 0, {
    message:
      'an answered response must cite at least one document, otherwise set answered to false',
    path: ['citations'],
  })

const ticketRouting = z.object({
  category: z.enum(['billing', 'technical', 'account', 'shipping'], {
    errorMap: () => ({ message: 'category must be one of billing, technical, account, shipping' }),
  }),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  confidence: z.number().min(0, 'confidence must be between 0 and 1').max(1, 'confidence must be between 0 and 1'),
  queue: z.string().min(1, 'queue must not be empty'),
})

const researchBrief = z.object({
  topic: z.string().min(1),
  findings: z.array(z.string().min(1)).min(1, 'at least one finding is required'),
  sourcesUsed: z.array(z.string().min(1)).min(1, 'at least one source must be recorded'),
  partial: z.boolean(),
})

const outboundMessage = z.object({
  to: z.string().min(1, 'recipient is required'),
  subject: z.string().min(1, 'subject is required'),
  body: z.string().min(20, 'body must be at least 20 characters'),
  approvedBy: z.string().min(1, 'approvedBy must record who approved the message'),
})

const extractedInvoice = z.object({
  invoiceNumber: z.string().min(1, 'invoiceNumber is required'),
  vendor: z.string().min(1, 'vendor is required'),
  total: z.number().nonnegative('total must be a non-negative number'),
  currency: z.string().length(3, 'currency must be a three letter code'),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dueDate must look like YYYY-MM-DD'),
})

const moderationVerdict = z.object({
  verdict: z.enum(['allow', 'block', 'escalate']),
  reason: z.string().min(1, 'reason is required'),
  confidence: z.number().min(0).max(1),
})

const missionState = z.object({
  missionId: z.string().min(1),
  completedStages: z.array(z.string().min(1)).min(1, 'at least one completed stage is required'),
  resumedFrom: z.string().min(1, 'resumedFrom must name the last successful stage'),
  finalReport: z.string().min(10, 'finalReport must be at least 10 characters'),
})

export const SCHEMAS: Record<string, SchemaDefinition> = {
  meetingSummary: {
    id: 'meetingSummary',
    label: 'Meeting summary',
    description: 'A summary plus the decisions taken and the action items, each with a named owner.',
    fields: [
      { name: 'summary', type: 'string', note: 'at least 10 characters' },
      { name: 'decisions', type: 'string[]', note: 'at least one entry' },
      { name: 'actionItems', type: '{ task, owner }[]', note: 'every item needs a named owner' },
    ],
    schema: meetingSummary,
  },
  groundedAnswer: {
    id: 'groundedAnswer',
    label: 'Grounded answer',
    description: 'An answer that must carry its citations, or explicitly declare that it could not answer.',
    fields: [
      { name: 'answer', type: 'string', note: 'the response text' },
      { name: 'citations', type: 'string[]', note: 'document ids the answer rests on' },
      { name: 'answered', type: 'boolean', note: 'false when the assistant declined' },
    ],
    schema: groundedAnswer,
  },
  ticketRouting: {
    id: 'ticketRouting',
    label: 'Ticket routing',
    description: 'A routing decision with a known category, a priority, a queue and a confidence score.',
    fields: [
      { name: 'category', type: 'enum', note: 'billing | technical | account | shipping' },
      { name: 'priority', type: 'enum', note: 'low | medium | high | urgent' },
      { name: 'confidence', type: 'number', note: 'between 0 and 1' },
      { name: 'queue', type: 'string', note: 'destination queue name' },
    ],
    schema: ticketRouting,
  },
  researchBrief: {
    id: 'researchBrief',
    label: 'Research brief',
    description: 'Findings gathered from multiple sources, with an honest flag when a source was lost.',
    fields: [
      { name: 'topic', type: 'string', note: 'what was researched' },
      { name: 'findings', type: 'string[]', note: 'at least one finding' },
      { name: 'sourcesUsed', type: 'string[]', note: 'which sources actually answered' },
      { name: 'partial', type: 'boolean', note: 'true when a source timed out' },
    ],
    schema: researchBrief,
  },
  outboundMessage: {
    id: 'outboundMessage',
    label: 'Outbound message',
    description: 'An external message that may not be sent without a recorded approver.',
    fields: [
      { name: 'to', type: 'string', note: 'recipient' },
      { name: 'subject', type: 'string', note: 'subject line' },
      { name: 'body', type: 'string', note: 'at least 20 characters' },
      { name: 'approvedBy', type: 'string', note: 'who approved it, never blank' },
    ],
    schema: outboundMessage,
  },
  extractedInvoice: {
    id: 'extractedInvoice',
    label: 'Extracted invoice',
    description: 'Structured invoice fields pulled out of unstructured text.',
    fields: [
      { name: 'invoiceNumber', type: 'string', note: 'required' },
      { name: 'vendor', type: 'string', note: 'required' },
      { name: 'total', type: 'number', note: 'must be a real number, not a string' },
      { name: 'currency', type: 'string', note: 'three letter code' },
      { name: 'dueDate', type: 'string', note: 'YYYY-MM-DD' },
    ],
    schema: extractedInvoice,
  },
  moderationVerdict: {
    id: 'moderationVerdict',
    label: 'Moderation verdict',
    description: 'A allow, block or escalate decision with a stated reason.',
    fields: [
      { name: 'verdict', type: 'enum', note: 'allow | block | escalate' },
      { name: 'reason', type: 'string', note: 'required' },
      { name: 'confidence', type: 'number', note: 'between 0 and 1' },
    ],
    schema: moderationVerdict,
  },
  missionState: {
    id: 'missionState',
    label: 'Mission state',
    description: 'A resumable job that records which stages already finished.',
    fields: [
      { name: 'missionId', type: 'string', note: 'required' },
      { name: 'completedStages', type: 'string[]', note: 'at least one' },
      { name: 'resumedFrom', type: 'string', note: 'last known good stage' },
      { name: 'finalReport', type: 'string', note: 'at least 10 characters' },
    ],
    schema: missionState,
  },
}

/** Turns a Zod error into short sentences a learner can act on. */
function explain(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length ? issue.path.join('.') : 'root'
    return `${path}: ${issue.message}`
  })
}

/** Validates a payload against a registered schema. Never throws. */
export function validateAgainst(schemaId: string, value: unknown): ValidationResult {
  const def = SCHEMAS[schemaId]
  if (!def) {
    return { schemaId, valid: false, issues: [`Unknown schema "${schemaId}"`] }
  }
  const parsed = def.schema.safeParse(value)
  if (parsed.success) {
    return { schemaId, valid: true, issues: [] }
  }
  return { schemaId, valid: false, issues: explain(parsed.error) }
}

export function listSchemas(): SchemaDefinition[] {
  return Object.values(SCHEMAS)
}
