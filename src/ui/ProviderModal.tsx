/**
 * Optional live AI provider settings.
 *
 * Everything in this app works with this dialog left untouched. It exists so
 * that someone who wants to watch a real model run the same workflows can point
 * it at their own key, on a free tier, without the project ever shipping one.
 *
 * The key is kept in this browser's localStorage and is sent only to the
 * provider endpoint the user chose. It never reaches any server of ours,
 * because there is no server of ours.
 */

import { useState } from 'react'
import {
  DEFAULT_MODELS,
  saveLiveProvider,
  type LiveProviderConfig,
  type LiveProviderKind,
} from '../providers/liveModel'
import { useApp } from '../store'

export function ProviderModal() {
  const open = useApp((s) => s.providerModalOpen)
  const closeProviderModal = useApp((s) => s.closeProviderModal)
  const current = useApp((s) => s.liveProvider)
  const setLiveProvider = useApp((s) => s.setLiveProvider)

  const [kind, setKind] = useState<LiveProviderKind>(current?.kind ?? 'gemini')
  const [apiKey, setApiKey] = useState(current?.apiKey ?? '')
  const [model, setModel] = useState(current?.model ?? DEFAULT_MODELS.gemini)
  const [baseUrl, setBaseUrl] = useState(current?.baseUrl ?? 'https://api.openai.com/v1')

  if (!open) return null

  const apply = () => {
    if (!apiKey.trim()) {
      setLiveProvider(null)
      saveLiveProvider(null)
      closeProviderModal()
      return
    }
    const config: LiveProviderConfig = {
      kind,
      apiKey: apiKey.trim(),
      model: model.trim() || DEFAULT_MODELS[kind],
      baseUrl: kind === 'openai-compatible' ? baseUrl.trim() : undefined,
    }
    setLiveProvider(config)
    saveLiveProvider(config)
    closeProviderModal()
  }

  const disconnect = () => {
    setLiveProvider(null)
    saveLiveProvider(null)
    setApiKey('')
    closeProviderModal()
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="AI provider settings"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeProviderModal()
      }}
    >
      <div className="modal">
        <div className="modal__head">
          <div className="modal__glyph" aria-hidden>
            🔌
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="modal__title">AI provider</div>
            <div className="modal__sub">Entirely optional. Mock mode needs no key.</div>
          </div>
          <span className={current ? 'badge badge--ok' : 'badge badge--info'}>
            {current ? 'live' : 'mock'}
          </span>
        </div>

        <div className="modal__body">
          <p className="modal__prompt">
            Every seeded puzzle is designed, graded and tested against the built-in mock provider,
            and needs no account of any kind. Connecting a live model is a way to watch the same
            workflows run against something real.
          </p>

          <div className="objective__expected" style={{ marginTop: 0, marginBottom: 16 }}>
            Steps with a failure switched on always use the mock, even when a live provider is
            connected. A real model cannot be asked to time out on cue, and the puzzles have to
            stay reproducible.
          </div>

          <label className="field">
            <span className="field__label">Provider</span>
            <select
              className="select"
              value={kind}
              onChange={(e) => {
                const next = e.target.value as LiveProviderKind
                setKind(next)
                setModel(DEFAULT_MODELS[next])
              }}
            >
              <option value="gemini">Google Gemini (has a free tier)</option>
              <option value="openai-compatible">OpenAI-compatible endpoint</option>
            </select>
          </label>

          {kind === 'openai-compatible' && (
            <label className="field">
              <span className="field__label">Base URL</span>
              <input
                className="input"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1"
              />
              <span className="field__hint">
                Works with anything that speaks the chat completions API, including a local server
                such as Ollama or LM Studio.
              </span>
            </label>
          )}

          <label className="field">
            <span className="field__label">Model</span>
            <input
              className="input"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={DEFAULT_MODELS[kind]}
            />
          </label>

          <label className="field">
            <span className="field__label">API key</span>
            <input
              className="input"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Leave empty to stay in mock mode"
              autoComplete="off"
              spellCheck={false}
            />
            <span className="field__hint">
              Stored in this browser only and sent straight to the provider you chose. Clear it to
              go back to mock mode.
            </span>
          </label>
        </div>

        <div className="modal__foot">
          {current && (
            <button type="button" className="btn btn--danger" onClick={disconnect}>
              Disconnect
            </button>
          )}
          <div className="modal__foot-spacer" />
          <button type="button" className="btn" onClick={closeProviderModal}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={apply}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
