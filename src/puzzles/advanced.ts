/**
 * Advanced puzzles.
 *
 * At this level the learner is asked to tell classes of failure apart. A fault
 * that is transient wants a retry; a provider that is down wants a fallback; an
 * output that is merely misshapen wants repairing rather than re-requesting.
 * Choosing the wrong tool for the fault is the mistake these puzzles surface.
 */

import type { Puzzle } from '../engine/types'

export const validateTheDataExtractor: Puzzle = {
  id: 'data-extractor',
  title: 'Validate the Data Extractor',
  difficulty: 'advanced',
  tagline: 'The data is all there. None of it is the right type.',
  challengeCall: 'Repair the output, do not re-ask',
  objective:
    'Pull invoice fields out of an unstructured email. The model finds every field correctly but returns the total as "$4,820.50", the currency as "US Dollars" and the date as prose. The validator is right to reject it. Asking the model again will not help, because it is not wrong, it is just badly shaped.',
  expectedResult:
    'An extractedInvoice object where total is a number, currency is a three letter code and dueDate is formatted as YYYY-MM-DD.',
  expectedSchemaId: 'extractedInvoice',
  availableBlocks: ['transform', 'validator', 'condition', 'humanReview', 'safeStop'],
  sampleInput: {
    from: 'billing@northwind.example',
    subject: 'Invoice INV-2026-0834',
    body: 'Hi, please find invoice INV-2026-0834 from Northwind Logistics for $4,820.50, due 30 September 2026. Let us know if you need a PO reference.',
  },
  startingWorkflow: {
    id: 'wf-data-extractor',
    name: 'Invoice extractor',
    steps: [
      {
        id: 'p6-input',
        title: 'Incoming email',
        config: { kind: 'input', label: 'Email' },
      },
      {
        id: 'p6-ai',
        title: 'Extract invoice fields',
        config: {
          kind: 'ai',
          modelId: 'mock-balanced',
          task: 'Pull out the invoice number, vendor, total, currency and due date',
          prompt: 'Extract the invoice fields from this email.\n\n{{input}}',
          responseKey: 'extractedInvoice',
        },
        reliability: { maxAttempts: 1, timeoutMs: 2000, onError: 'fail' },
      },
      {
        id: 'p6-validator',
        title: 'Check the shape',
        config: { kind: 'validator', schemaId: 'extractedInvoice' },
        reliability: { maxAttempts: 1, onError: 'fail' },
      },
      {
        id: 'p6-output',
        title: 'Structured invoice',
        config: { kind: 'output', label: 'Extracted invoice' },
      },
    ],
  },
  failureScenarios: [
    {
      id: 'p6-type-drift',
      kind: 'schemaViolation',
      label: 'The model returns human-shaped values',
      description:
        'total arrives as a currency string, currency as prose and the date in long form. Every value is correct and every type is wrong.',
      targetStepId: 'p6-ai',
      failOnAttempts: [],
      defaultEnabled: true,
    },
  ],
  completionCriteria: [
    { type: 'runSucceeds' },
    { type: 'finalOutputValid', schemaId: 'extractedInvoice' },
    { type: 'usedValidator', schemaId: 'extractedInvoice' },
    { type: 'noUnhandledErrors' },
  ],
  hints: [
    'Read the validator issues carefully. The values are right. Only the types are wrong, so this is a repair job, not a re-request.',
    'Insert a Transform block between the AI step and the validator, and choose "Coerce invoice types".',
    'Leave the validator in place afterwards. The transform fixes what it knows how to fix; the validator is what proves the fix actually worked, and it will catch the next drift the transform does not cover.',
  ],
}

export const activateTheFallback: Puzzle = {
  id: 'activate-fallback',
  title: 'Activate the Fallback',
  difficulty: 'advanced',
  tagline: 'Retrying a dead provider just fails more slowly.',
  challengeCall: 'Add a safe fallback',
  objective:
    'Moderate a piece of user content. The primary model is down, not slow, and it will not come back during this run. Piling on retries only makes the workflow take longer to fail. Give it somewhere else to go, and make sure a low confidence verdict never quietly becomes an allow.',
  expectedResult:
    'A moderationVerdict object produced by a working provider, where a verdict below the confidence threshold is escalated rather than acted on.',
  expectedSchemaId: 'moderationVerdict',
  availableBlocks: ['confidenceCheck', 'humanReview', 'validator', 'safeStop', 'condition', 'transform'],
  sampleInput: {
    contentId: 'post-99021',
    text: 'This clinic cured my neighbour in a week. Everyone should stop taking their prescriptions.',
    reportedBy: 3,
  },
  startingWorkflow: {
    id: 'wf-activate-fallback',
    name: 'Content moderation',
    steps: [
      {
        id: 'p7-input',
        title: 'Reported content',
        config: { kind: 'input', label: 'Content' },
      },
      {
        id: 'p7-ai',
        title: 'Moderate the content',
        config: {
          kind: 'ai',
          modelId: 'mock-balanced',
          task: 'Decide whether to allow, block or escalate',
          prompt:
            'Review this content and return a verdict of allow, block or escalate with a reason and a confidence score.\n\n{{input}}',
          responseKey: 'moderationVerdict',
          schemaId: 'moderationVerdict',
        },
        reliability: { maxAttempts: 3, timeoutMs: 2000, onError: 'fail' },
      },
      {
        id: 'p7-output',
        title: 'Verdict',
        config: { kind: 'output', label: 'Moderation verdict' },
      },
    ],
  },
  failureScenarios: [
    {
      id: 'p7-primary-down',
      kind: 'modelTimeout',
      label: 'The primary model is down',
      description:
        'Every attempt against the primary times out. The fallback provider is unaffected, because this is an outage of one provider and not of the internet.',
      targetStepId: 'p7-ai',
      failOnAttempts: [],
      exemptFallback: true,
      defaultEnabled: true,
    },
    {
      id: 'p7-unsure',
      kind: 'lowConfidence',
      label: 'The model is barely sure',
      description:
        'The verdict comes back as allow with a confidence of 0.31. Acting on this is how unsafe content gets published by an automated system.',
      targetStepId: 'p7-ai',
      failOnAttempts: [],
      defaultEnabled: false,
    },
  ],
  completionCriteria: [
    { type: 'runSucceeds' },
    { type: 'finalOutputValid', schemaId: 'moderationVerdict' },
    { type: 'usedFallback', stepId: 'p7-ai' },
    { type: 'noUnhandledErrors' },
  ],
  hints: [
    'Max attempts is already set to 3 and the run still fails. Read the trace: all three attempts failed the same way, at the same provider. More of the same will not help.',
    'Open the Moderate step and set the fallback model to Mock Strict. The trace will show three failures against the primary followed by one success against the fallback.',
    'Now switch on the second scenario as well. The workflow finishes, but the verdict is allow at 0.31 confidence. Add a Confidence Check set to route anything below 0.7 to a human, then add a Human Review step after it.',
  ],
}

export const resumeTheInterruptedMission: Puzzle = {
  id: 'interrupted-mission',
  title: 'Resume the Interrupted Mission',
  difficulty: 'advanced',
  tagline: 'Two different faults. Two different tools.',
  challengeCall: 'Recover from the last successful step',
  objective:
    'A long running job was interrupted. Read the checkpoint to find out where it got to, then write the final report. Two things are going wrong at once and they need different answers: the checkpoint store is flaky on its first attempts, and the model forgets to record which stage the job resumed from. Fixing one without the other still leaves you with a broken workflow.',
  expectedResult:
    'A missionState object naming the stage the job resumed from, with the completed stages preserved and a final report written.',
  expectedSchemaId: 'missionState',
  availableBlocks: ['transform', 'validator', 'condition', 'humanReview', 'safeStop'],
  sampleInput: {
    missionId: 'mission-7742',
    interruptedAt: '2026-09-01T04:12:00Z',
    requestedBy: 'ops-scheduler',
  },
  startingWorkflow: {
    id: 'wf-interrupted-mission',
    name: 'Mission recovery',
    steps: [
      {
        id: 'p8-input',
        title: 'Mission request',
        config: { kind: 'input', label: 'Mission' },
      },
      {
        id: 'p8-checkpoint',
        title: 'Read the checkpoint',
        config: {
          kind: 'tool',
          toolId: 'checkpoint-store',
          task: 'Find the last stage that completed successfully',
        },
        reliability: { maxAttempts: 1, timeoutMs: 2000, onError: 'fail' },
      },
      {
        id: 'p8-ai',
        title: 'Write the final report',
        config: {
          kind: 'ai',
          modelId: 'mock-balanced',
          task: 'Summarise the mission and record where it resumed from',
          prompt:
            'Write the final report for this mission. Record which stages completed and which stage it resumed from.\n\n{{input}}',
          responseKey: 'missionState',
        },
        reliability: { maxAttempts: 1, timeoutMs: 2000, onError: 'fail' },
      },
      {
        id: 'p8-validator',
        title: 'Check the mission state',
        config: { kind: 'validator', schemaId: 'missionState' },
        reliability: { maxAttempts: 1, onError: 'fail' },
      },
      {
        id: 'p8-output',
        title: 'Mission report',
        config: { kind: 'output', label: 'Mission state' },
      },
    ],
  },
  failureScenarios: [
    {
      id: 'p8-checkpoint-flaky',
      kind: 'toolError',
      label: 'The checkpoint store is flaky',
      description:
        'Returns HTTP 503 on the first two attempts, then recovers. A textbook transient fault.',
      targetStepId: 'p8-checkpoint',
      failOnAttempts: [1, 2],
      defaultEnabled: true,
    },
    {
      id: 'p8-lost-stage',
      kind: 'missingField',
      label: 'The model forgets where it resumed',
      description:
        'The report comes back without resumedFrom, so the job cannot prove where it restarted. Retrying will not fix a field the model never produces.',
      targetStepId: 'p8-ai',
      failOnAttempts: [],
      defaultEnabled: true,
    },
  ],
  completionCriteria: [
    { type: 'runSucceeds' },
    { type: 'finalOutputValid', schemaId: 'missionState' },
    { type: 'usedRetry', stepId: 'p8-checkpoint' },
    { type: 'usedValidator', schemaId: 'missionState' },
    { type: 'noUnhandledErrors' },
  ],
  hints: [
    'Solve one fault at a time. Run it once and fix whatever stops the run first, which is the checkpoint store.',
    'The checkpoint failure is transient: two failures then a success. Raise max attempts on Read the checkpoint to 3.',
    'The second fault is different in kind. The model never returns resumedFrom, so no number of attempts will produce it. Add a Transform block set to "Mark resumed" between the AI step and the validator, which derives the stage from the checkpoint data the workflow already has.',
  ],
}
