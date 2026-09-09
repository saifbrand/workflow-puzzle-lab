/**
 * Intermediate puzzles.
 *
 * These introduce the three levers that do most of the work in a real system:
 * making a step police its own output, giving it somewhere to fall back to,
 * and putting a person in front of anything irreversible.
 */

import type { Puzzle } from '../engine/types'

export const repairTheTicketRouter: Puzzle = {
  id: 'ticket-router',
  title: 'Repair the Ticket Router',
  difficulty: 'intermediate',
  tagline: 'The model invented a category that does not exist.',
  challengeCall: 'Stop invalid data',
  objective:
    'Classify a support ticket and route it to a queue. The model has started returning a category outside the allowed set and a confidence above 1.0. Nothing downstream notices, so tickets are being routed into a queue that does not exist.',
  expectedResult:
    'A ticketRouting object whose category is one of billing, technical, account or shipping, with confidence between 0 and 1.',
  expectedSchemaId: 'ticketRouting',
  availableBlocks: ['validator', 'condition', 'transform', 'humanReview', 'safeStop', 'confidenceCheck'],
  sampleInput: {
    ticketId: 'TCK-55120',
    subject: 'Charged twice for the same invoice',
    body: 'I was billed on the 3rd and again on the 4th for invoice INV-2026-0834. Please refund the duplicate.',
  },
  startingWorkflow: {
    id: 'wf-ticket-router',
    name: 'Ticket router',
    steps: [
      {
        id: 'p3-input',
        title: 'Incoming ticket',
        config: { kind: 'input', label: 'Support ticket' },
      },
      {
        id: 'p3-ai',
        title: 'Classify and route',
        config: {
          kind: 'ai',
          modelId: 'mock-balanced',
          task: 'Pick a category, a priority and a destination queue',
          prompt:
            'Classify this ticket. Return category, priority, confidence and queue.\n\n{{input}}',
          responseKey: 'ticketRouting',
        },
        reliability: { maxAttempts: 1, timeoutMs: 2000, onError: 'fail' },
      },
      {
        id: 'p3-output',
        title: 'Routing decision',
        config: { kind: 'output', label: 'Routing decision' },
      },
    ],
  },
  failureScenarios: [
    {
      id: 'p3-invented-category',
      kind: 'schemaViolation',
      label: 'The model invents a category',
      description:
        'Returns category "refunds", priority "severe" and confidence 1.4. Every one of those is outside the allowed set, and none of them throws.',
      targetStepId: 'p3-ai',
      failOnAttempts: [],
      defaultEnabled: true,
    },
  ],
  completionCriteria: [
    { type: 'runSucceeds' },
    { type: 'finalOutputValid', schemaId: 'ticketRouting' },
    { type: 'usedFallback', stepId: 'p3-ai' },
    { type: 'noUnhandledErrors' },
  ],
  hints: [
    'Open the AI step and set "Enforce output schema" to ticketRouting. The step will now check its own answer on every attempt instead of trusting it.',
    'Run it again. The step fails, because this model gets it wrong every single time. Raising max attempts will not help when the fault is not transient.',
    'Set the fallback model on the AI step to Mock Strict. When the primary is exhausted the workflow switches to a model that returns schema-clean output, and the run recovers.',
  ],
}

export const surviveTheResearchTimeout: Puzzle = {
  id: 'research-timeout',
  title: 'Survive the Research Timeout',
  difficulty: 'intermediate',
  tagline: 'The slowest source is the one that disappears.',
  challengeCall: 'Survive the timeout',
  objective:
    'Gather findings on a topic from an external research source, then write them up. The research source is the slowest thing in the chain and it has started timing out on its first two attempts. Right now a single timeout ends the whole run.',
  expectedResult:
    'A researchBrief object with at least one finding and a record of which sources actually answered.',
  expectedSchemaId: 'researchBrief',
  availableBlocks: ['retrieval', 'transform', 'validator', 'safeStop', 'condition'],
  sampleInput: {
    topic: 'Battery recycling regulation in the EU',
    depth: 'summary',
  },
  startingWorkflow: {
    id: 'wf-research-timeout',
    name: 'Research brief',
    steps: [
      {
        id: 'p4-input',
        title: 'Research topic',
        config: { kind: 'input', label: 'Topic' },
      },
      {
        id: 'p4-research',
        title: 'Gather sources',
        config: { kind: 'retrieval', toolId: 'web-research', task: 'Collect public sources' },
        reliability: { maxAttempts: 1, timeoutMs: 2000, onError: 'fail' },
      },
      {
        id: 'p4-ai',
        title: 'Write the brief',
        config: {
          kind: 'ai',
          modelId: 'mock-balanced',
          task: 'Summarise the findings and record the sources used',
          prompt: 'Write a short research brief from these sources.\n\n{{input}}',
          responseKey: 'researchBrief',
        },
        reliability: { maxAttempts: 1, timeoutMs: 2000, onError: 'fail' },
      },
      {
        id: 'p4-output',
        title: 'Research brief',
        config: { kind: 'output', label: 'Research brief' },
      },
    ],
  },
  failureScenarios: [
    {
      id: 'p4-source-timeout',
      kind: 'toolTimeout',
      label: 'The research source times out twice',
      description:
        'The first two attempts time out, the third succeeds. A transient fault: the kind that a single retry would have absorbed.',
      targetStepId: 'p4-research',
      failOnAttempts: [1, 2],
      defaultEnabled: true,
    },
  ],
  completionCriteria: [
    { type: 'runSucceeds' },
    { type: 'failureRecovered', failureId: 'p4-source-timeout' },
    { type: 'finalOutputValid', schemaId: 'researchBrief' },
    { type: 'noUnhandledErrors' },
  ],
  hints: [
    'This fault is transient: it fails twice and then works. That is the signature of a problem retries are made for.',
    'Open the Gather sources step and raise max attempts to 3. The trace will show two failed attempts followed by a success.',
    'There is a second way through. Set the fallback source to Internal Archive, and the workflow switches to a narrower but reliable source instead of waiting. Either design solves the puzzle; compare what the trace looks like for each.',
  ],
}

export const approveBeforeSending: Puzzle = {
  id: 'approve-before-sending',
  title: 'Approve Before Sending',
  difficulty: 'intermediate',
  tagline: 'The approval happens after the email has already gone out.',
  challengeCall: 'Ask a human before continuing',
  objective:
    'Draft an external message to a customer and send it, but only after a person has approved it. The review step exists, and it runs, and it records a decision. It is also in the wrong place: it sits after the send, so approving or rejecting changes nothing that has not already happened.',
  expectedResult:
    'An outboundMessage object with a non-empty approvedBy, where the send step ran only after the approval.',
  expectedSchemaId: 'outboundMessage',
  availableBlocks: ['humanReview', 'validator', 'condition', 'safeStop', 'transform'],
  sampleInput: {
    customer: 'Dana Whitfield',
    email: 'dana@northwind.example',
    intent: 'Send the renewal quote and offer a call',
  },
  startingWorkflow: {
    id: 'wf-approve-before-sending',
    name: 'Outbound message',
    steps: [
      {
        id: 'p5-input',
        title: 'Message brief',
        config: { kind: 'input', label: 'Brief' },
      },
      {
        id: 'p5-ai',
        title: 'Draft the message',
        config: {
          kind: 'ai',
          modelId: 'mock-balanced',
          task: 'Draft a short, warm message to the customer',
          prompt: 'Draft a short external message for this brief.\n\n{{input}}',
          responseKey: 'outboundMessage',
        },
        reliability: { maxAttempts: 1, timeoutMs: 2000, onError: 'fail' },
      },
      {
        id: 'p5-send',
        title: 'Send the email',
        config: { kind: 'tool', toolId: 'mail-send', task: 'Deliver the message. Irreversible.' },
        reliability: { maxAttempts: 1, timeoutMs: 2000, onError: 'fail' },
      },
      {
        id: 'p5-human',
        title: 'Human approval',
        config: {
          kind: 'humanReview',
          prompt:
            'Approve this message before it goes to the customer. You may edit it, or reject it to stop the workflow.',
          allowEdit: true,
        },
      },
      {
        id: 'p5-output',
        title: 'Sent message',
        config: { kind: 'output', label: 'Outbound message' },
      },
    ],
  },
  failureScenarios: [
    {
      id: 'p5-rejected',
      kind: 'rejectedByHuman',
      label: 'The reviewer rejects the draft',
      description:
        'Pre-selects Reject in the review dialog. With the steps in the wrong order the email is already gone, so watch what rejecting actually prevents.',
      targetStepId: 'p5-human',
      failOnAttempts: [],
      defaultEnabled: false,
    },
  ],
  completionCriteria: [
    { type: 'runSucceeds' },
    { type: 'finalOutputValid', schemaId: 'outboundMessage' },
    { type: 'usedHumanReview' },
    {
      type: 'stepPrecedes',
      earlier: 'p5-human',
      later: 'p5-send',
      describeAs: 'The approval runs before the email is sent, not after it.',
    },
    { type: 'noUnhandledErrors' },
  ],
  hints: [
    'Run it once and read the trace from the top. Note the order the steps actually executed in.',
    'Use the up arrow on the Human approval node to move it above Send the email. An approval gate only means something when it sits in front of the irreversible action.',
    'Now switch on the rejection scenario and run it again. With the order fixed, rejecting stops the workflow before the send, and the reliability report counts that as a strength rather than a failure.',
  ],
}
