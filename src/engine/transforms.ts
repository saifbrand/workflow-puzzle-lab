/**
 * Pure, deterministic transforms.
 *
 * These exist to make a teaching point: a great deal of what people reach for
 * a model to do can be done by a function that cannot fail, cannot drift and
 * costs nothing. Every transform here is total, meaning it returns a value for
 * any input rather than throwing.
 */

export interface TransformDefinition {
  id: string
  label: string
  summary: string
  apply: (input: unknown) => unknown
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {}
}

/** Pulls `documents` out of a retrieval payload, tolerating any shape. */
function documentsOf(input: unknown): { id?: string; excerpt?: string }[] {
  const rec = asRecord(input)
  const docs = rec.documents
  return Array.isArray(docs) ? (docs as { id?: string; excerpt?: string }[]) : []
}

export const TRANSFORMS: TransformDefinition[] = [
  {
    id: 'passthrough',
    label: 'Pass through',
    summary: 'Hands the payload on untouched. Useful as a placeholder.',
    apply: (input) => input,
  },
  {
    id: 'coerceInvoiceTypes',
    label: 'Coerce invoice types',
    summary:
      'Repairs the classic drift where a total arrives as "$4,820.50" and a date as prose.',
    apply: (input) => {
      const rec = { ...asRecord(input) }
      if (typeof rec.total === 'string') {
        const numeric = Number(rec.total.replace(/[^0-9.\-]/g, ''))
        if (Number.isFinite(numeric)) rec.total = numeric
      }
      if (typeof rec.currency === 'string' && rec.currency.length !== 3) {
        const map: Record<string, string> = {
          'us dollars': 'USD',
          dollars: 'USD',
          usd: 'USD',
          euros: 'EUR',
          eur: 'EUR',
          pounds: 'GBP',
        }
        rec.currency = map[rec.currency.toLowerCase()] ?? rec.currency.slice(0, 3).toUpperCase()
      }
      if (typeof rec.dueDate === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(rec.dueDate)) {
        const parsed = Date.parse(rec.dueDate)
        if (Number.isFinite(parsed)) {
          rec.dueDate = new Date(parsed).toISOString().slice(0, 10)
        }
      }
      return rec
    },
  },
  {
    id: 'assignUnownedTasks',
    label: 'Assign unowned tasks',
    summary:
      'Gives every action item without an owner an explicit "unassigned" marker so the gap is visible instead of silent.',
    apply: (input) => {
      const rec = { ...asRecord(input) }
      if (Array.isArray(rec.actionItems)) {
        rec.actionItems = (rec.actionItems as Record<string, unknown>[]).map((item) => ({
          ...item,
          owner:
            typeof item.owner === 'string' && item.owner.trim().length > 0
              ? item.owner
              : 'unassigned',
        }))
      }
      return rec
    },
  },
  {
    id: 'groundOrDecline',
    label: 'Ground or decline',
    summary:
      'Turns an unsupported answer into an honest refusal when no citations survived retrieval.',
    apply: (input) => {
      const rec = { ...asRecord(input) }
      const citations = Array.isArray(rec.citations) ? rec.citations : []
      if (citations.length === 0) {
        return {
          answer:
            'I could not find supporting material for that question, so I am not going to guess.',
          citations: [],
          answered: false,
        }
      }
      return { ...rec, citations, answered: true }
    },
  },
  {
    id: 'collectCitations',
    label: 'Collect citations',
    summary: 'Flattens retrieved documents into the citation list the answer schema expects.',
    apply: (input) => {
      const docs = documentsOf(input)
      return {
        ...asRecord(input),
        citations: docs.map((d) => d.id).filter((id): id is string => typeof id === 'string'),
        evidenceCount: docs.length,
      }
    },
  },
  {
    id: 'mergeSources',
    label: 'Merge sources',
    summary: 'Combines documents from several retrieval steps and records which ones answered.',
    apply: (input) => {
      const rec = asRecord(input)
      const docs = documentsOf(input)
      const previous = Array.isArray(rec.sourcesUsed) ? (rec.sourcesUsed as string[]) : []
      const ids = docs.map((d) => d.id).filter((id): id is string => typeof id === 'string')
      return {
        ...rec,
        sourcesUsed: Array.from(new Set([...previous, ...ids])),
        partial: docs.length === 0 ? true : Boolean(rec.partial),
      }
    },
  },
  {
    id: 'stampApproval',
    label: 'Stamp approval',
    summary:
      'Writes the reviewer into the payload so the approval is recorded on the message itself.',
    apply: (input) => {
      const rec = { ...asRecord(input) }
      if (!rec.approvedBy || rec.approvedBy === '') {
        rec.approvedBy = 'pending'
      }
      return rec
    },
  },
  {
    id: 'markResumed',
    label: 'Mark resumed',
    summary: 'Records which stage the mission restarted from after an interruption.',
    apply: (input) => {
      const rec = { ...asRecord(input) }
      const stages = Array.isArray(rec.completedStages) ? (rec.completedStages as string[]) : []
      return {
        ...rec,
        resumedFrom: (rec.lastGoodStage as string) ?? stages[stages.length - 1] ?? 'collect',
        completedStages: stages.length ? stages : ['collect'],
      }
    },
  },
]

export const TRANSFORM_BY_ID: Record<string, TransformDefinition> = Object.fromEntries(
  TRANSFORMS.map((t) => [t.id, t]),
)

export function applyTransform(id: string, input: unknown): unknown {
  const def = TRANSFORM_BY_ID[id]
  return def ? def.apply(input) : input
}
