/**
 * Optional live model provider.
 *
 * The app is fully playable with no key at all; this exists so the same
 * workflow can be pointed at a real model when someone wants to see one.
 *
 * Two rules keep it from undermining the product:
 *
 *   1. No key ships with this repository and none is ever required. The mock
 *      provider is the default and every seeded puzzle is graded against it.
 *
 *   2. A step with a failure injected into it always uses the mock, never the
 *      live provider. You cannot ask a real model to time out on cue, and a
 *      puzzle that behaved differently run to run would stop being a puzzle.
 *      Live calls therefore only replace the healthy path.
 *
 * Any error at all, including a bad key, a network failure or an unparseable
 * response, falls back to the mock for that call and says so in the trace.
 */

import type { ModelRequest, ModelResponse } from './mockModel'

export type LiveProviderKind = 'gemini' | 'openai-compatible'

export interface LiveProviderConfig {
  kind: LiveProviderKind
  apiKey: string
  /** Model id, e.g. `gemini-2.0-flash` or `gpt-4o-mini`. */
  model: string
  /** Only used by the OpenAI-compatible kind. */
  baseUrl?: string
}

const STORAGE_KEY = 'awpb.liveProvider'

export function loadLiveProvider(): LiveProviderConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as LiveProviderConfig
    return parsed.apiKey ? parsed : null
  } catch {
    return null
  }
}

export function saveLiveProvider(config: LiveProviderConfig | null): void {
  try {
    if (config) localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Private browsing modes can refuse storage. Losing the setting on reload
    // is an acceptable outcome for an optional convenience.
  }
}

export const DEFAULT_MODELS: Record<LiveProviderKind, string> = {
  gemini: 'gemini-2.0-flash',
  'openai-compatible': 'gpt-4o-mini',
}

/** Pulls the first JSON object out of a model response, fences and all. */
function extractJson(text: string): unknown {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1] : trimmed

  try {
    return JSON.parse(candidate)
  } catch {
    // Fall back to the outermost braces, which handles a chatty preamble.
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start !== -1 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1))
    }
    throw new Error('The model did not return parseable JSON.')
  }
}

async function callGemini(
  config: LiveProviderConfig,
  prompt: string,
  signal: AbortSignal,
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    config.model,
  )}:generateContent`

  const response = await fetch(url, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': config.apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
    }),
  })

  if (!response.ok) {
    throw new Error(`Gemini returned HTTP ${response.status}.`)
  }

  const body = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }
  const text = body.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Gemini returned an empty response.')
  return text
}

async function callOpenAiCompatible(
  config: LiveProviderConfig,
  prompt: string,
  signal: AbortSignal,
): Promise<string> {
  const base = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')

  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are a workflow step inside an automated pipeline. Reply with a single JSON object and nothing else.',
        },
        { role: 'user', content: prompt },
      ],
    }),
  })

  if (!response.ok) {
    throw new Error(`Provider returned HTTP ${response.status}.`)
  }

  const body = (await response.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const text = body.choices?.[0]?.message?.content
  if (!text) throw new Error('The provider returned an empty response.')
  return text
}

/**
 * Runs one live generation.
 *
 * Throws on any failure so the caller can fall back to the mock. A 12 second
 * ceiling stops a hanging provider from freezing a run.
 */
export async function generateLive(
  config: LiveProviderConfig,
  request: ModelRequest,
): Promise<ModelResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)

  try {
    const text =
      config.kind === 'gemini'
        ? await callGemini(config, request.prompt, controller.signal)
        : await callOpenAiCompatible(config, request.prompt, controller.signal)

    const value = extractJson(text)
    return {
      value,
      raw: text,
      modelId: `${config.kind}:${config.model}`,
      mocked: false,
      confidence:
        typeof (value as Record<string, unknown>)?.confidence === 'number'
          ? ((value as Record<string, unknown>).confidence as number)
          : undefined,
    }
  } finally {
    clearTimeout(timer)
  }
}
