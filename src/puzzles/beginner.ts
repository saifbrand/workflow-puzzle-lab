/**
 * Beginner puzzles.
 *
 * The goal at this level is to make one idea land: a workflow that finishes is
 * not the same as a workflow that worked. Both puzzles here start from a chain
 * that reports success while producing something nobody should act on.
 */

import type { Puzzle } from '../engine/types'

export const fixTheMeetingSummarizer: Puzzle = {
  id: 'meeting-summarizer',
  title: 'Fix the Meeting Summarizer',
  difficulty: 'beginner',
  tagline: 'It finishes every time. That is the problem.',
  challengeCall: 'Repair the broken workflow',
  objective:
    'Turn raw meeting notes into a summary, a list of decisions and a list of action items. Every action item must carry a named owner. Right now the workflow reports success even when the model returns action items nobody owns, because nothing is checking its output.',
  expectedResult:
    'A meetingSummary object where every entry in actionItems has a non-empty owner.',
  expectedSchemaId: 'meetingSummary',
  availableBlocks: ['validator', 'transform', 'humanReview', 'safeStop', 'condition'],
  sampleInput: {
    notes: [
      'Priya: we should ship the billing rewrite, but only behind a feature flag.',
      'Marcus: agreed. The mobile refresh can wait until Q3.',
      'Priya: I will wire the flag into the checkout path this week.',
      'Marcus: I will draft the Q3 mobile plan.',
    ].join('\n'),
    meetingId: 'mtg-2026-0901',
  },
  startingWorkflow: {
    id: 'wf-meeting-summarizer',
    name: 'Meeting summarizer',
    steps: [
      {
        id: 'p1-input',
        title: 'Meeting notes',
        config: { kind: 'input', label: 'Raw meeting notes' },
      },
      {
        id: 'p1-ai',
        title: 'Summarise the meeting',
        config: {
          kind: 'ai',
          modelId: 'mock-balanced',
          task: 'Extract a summary, decisions and owned action items',
          prompt:
            'Read these meeting notes and return a summary, the decisions taken, and the action items with an owner for each.\n\n{{input}}',
          responseKey: 'meetingSummary',
        },
        reliability: { maxAttempts: 1, timeoutMs: 2000, onError: 'fail' },
      },
      {
        id: 'p1-output',
        title: 'Summary',
        config: { kind: 'output', label: 'Meeting summary' },
      },
    ],
  },
  failureScenarios: [
    {
      id: 'p1-missing-owner',
      kind: 'missingField',
      label: 'The model drops the owners',
      description:
        'The model returns action items with an empty owner field. Nothing crashes, which is exactly why this is dangerous.',
      targetStepId: 'p1-ai',
      failOnAttempts: [],
      defaultEnabled: true,
    },
  ],
  completionCriteria: [
    { type: 'runSucceeds' },
    { type: 'finalOutputValid', schemaId: 'meetingSummary' },
    { type: 'usedValidator', schemaId: 'meetingSummary' },
    { type: 'noUnhandledErrors' },
  ],
  hints: [
    'Run it once as it is. The workflow says it succeeded. Now read the final output and ask whether you would act on it.',
    'Add a Validator block before the output and point it at the meetingSummary schema. The run will now fail, which is progress: the corruption is finally visible.',
    'A validator finds the problem but does not fix it. Add a Transform block before the validator and choose "Assign unowned tasks", so an item nobody owns is labelled instead of pretending to have an owner.',
  ],
}

export const groundTheKnowledgeAssistant: Puzzle = {
  id: 'knowledge-assistant',
  title: 'Ground the Knowledge Assistant',
  difficulty: 'beginner',
  tagline: 'When the shelf is empty, say so.',
  challengeCall: 'Refuse instead of guessing',
  objective:
    'Answer a customer question using the knowledge base. When retrieval comes back empty the assistant must decline honestly rather than answering from memory. At the moment an empty shelf still produces a confident answer with citations that were never retrieved.',
  expectedResult:
    'A groundedAnswer object. When evidence exists the answer cites it; when retrieval is empty, answered is false and citations is an empty list.',
  expectedSchemaId: 'groundedAnswer',
  availableBlocks: ['condition', 'transform', 'safeStop', 'validator', 'humanReview'],
  sampleInput: {
    question: 'How long does a refund take to reach my card?',
    customerId: 'CU-40921',
  },
  startingWorkflow: {
    id: 'wf-knowledge-assistant',
    name: 'Knowledge assistant',
    steps: [
      {
        id: 'p2-input',
        title: 'Customer question',
        config: { kind: 'input', label: 'Question' },
      },
      {
        id: 'p2-retrieval',
        title: 'Search the knowledge base',
        config: { kind: 'retrieval', toolId: 'kb-search', task: 'Find supporting policy documents' },
        reliability: { maxAttempts: 1, timeoutMs: 2000, onError: 'fail' },
      },
      {
        id: 'p2-ai',
        title: 'Answer the question',
        config: {
          kind: 'ai',
          modelId: 'mock-balanced',
          task: 'Answer using only the retrieved documents',
          prompt:
            'Answer the question using only the documents provided. Cite the document ids you used.\n\n{{input}}',
          responseKey: 'groundedAnswer',
        },
        reliability: { maxAttempts: 1, timeoutMs: 2000, onError: 'fail' },
      },
      {
        id: 'p2-output',
        title: 'Answer',
        config: { kind: 'output', label: 'Grounded answer' },
      },
    ],
  },
  failureScenarios: [
    {
      id: 'p2-empty-kb',
      kind: 'emptyRetrieval',
      label: 'The knowledge base returns nothing',
      description:
        'Retrieval succeeds but finds zero documents. An empty result is a valid response, not an error, so nothing stops the workflow.',
      targetStepId: 'p2-retrieval',
      failOnAttempts: [],
      defaultEnabled: true,
    },
  ],
  completionCriteria: [
    { type: 'runSucceeds' },
    { type: 'finalOutputValid', schemaId: 'groundedAnswer' },
    { type: 'noUnhandledErrors' },
  ],
  hints: [
    'Turn the failure on and run it. Look at the citations in the final answer, then look at what retrieval actually returned.',
    'Add a Condition block straight after retrieval. Set the path to "documents" and the operator to "is not empty".',
    'A false condition skips the next step, so with skip set to 1 the model never runs on an empty shelf. Follow it with a Transform block set to "Ground or decline" to produce an honest refusal.',
  ],
}
