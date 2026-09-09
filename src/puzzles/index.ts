/**
 * The seeded puzzle set.
 *
 * Eight puzzles across three difficulty levels. Six of the eight require the
 * learner to handle or recover from a failure, and between them they cover
 * seven of the nine failure kinds the simulator supports.
 *
 * Every puzzle is committed data. Nothing here is generated at runtime, so a
 * reviewer opening the app for the first time sees exactly what the test suite
 * asserts against.
 */

import type { Difficulty, Puzzle } from '../engine/types'
import { fixTheMeetingSummarizer, groundTheKnowledgeAssistant } from './beginner'
import {
  approveBeforeSending,
  repairTheTicketRouter,
  surviveTheResearchTimeout,
} from './intermediate'
import {
  activateTheFallback,
  resumeTheInterruptedMission,
  validateTheDataExtractor,
} from './advanced'

export const PUZZLES: Puzzle[] = [
  fixTheMeetingSummarizer,
  groundTheKnowledgeAssistant,
  repairTheTicketRouter,
  surviveTheResearchTimeout,
  approveBeforeSending,
  validateTheDataExtractor,
  activateTheFallback,
  resumeTheInterruptedMission,
]

export const PUZZLE_BY_ID: Record<string, Puzzle> = Object.fromEntries(
  PUZZLES.map((p) => [p.id, p]),
)

export const DIFFICULTY_ORDER: Difficulty[] = ['beginner', 'intermediate', 'advanced']

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
}

export function puzzlesByDifficulty(level: Difficulty): Puzzle[] {
  return PUZZLES.filter((p) => p.difficulty === level)
}

/** Failure scenario ids that a puzzle switches on the moment it is loaded. */
export function defaultEnabledFailures(puzzle: Puzzle): string[] {
  return puzzle.failureScenarios.filter((s) => s.defaultEnabled).map((s) => s.id)
}

/** Deep clone, so editing a workflow never mutates the seeded definition. */
export function cloneWorkflow<T>(value: T): T {
  return structuredClone(value)
}
