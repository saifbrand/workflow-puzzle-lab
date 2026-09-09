/**
 * Application shell.
 *
 * Three columns: what to do on the left, the workflow in the middle, what
 * happened on the right. The right column switches itself to the trace when a
 * run starts and to the report when it finishes, so the panel a learner needs
 * is already in front of them without a click.
 */

import { useEffect, useState } from 'react'
import { WorkflowCanvas } from './ui/WorkflowCanvas'
import { PuzzlePicker } from './ui/PuzzlePicker'
import { ObjectivePanel } from './ui/ObjectivePanel'
import { Palette } from './ui/Palette'
import { FailurePanel } from './ui/FailurePanel'
import { Inspector } from './ui/Inspector'
import { TracePanel } from './ui/TracePanel'
import { ReliabilityPanel } from './ui/ReliabilityPanel'
import { HumanReviewModal } from './ui/HumanReviewModal'
import { ProviderModal } from './ui/ProviderModal'
import { useApp } from './store'
import { setSoundEnabled, unlockAudio } from './audio/sfx'

type Tab = 'inspector' | 'trace' | 'report'

export default function App() {
  const puzzle = useApp((s) => s.puzzle)
  const isRunning = useApp((s) => s.isRunning)
  const run = useApp((s) => s.run)
  const report = useApp((s) => s.report)
  const soundOn = useApp((s) => s.soundOn)
  const selectedStepId = useApp((s) => s.selectedStepId)
  const start = useApp((s) => s.start)
  const liveProvider = useApp((s) => s.liveProvider)
  const openProviderModal = useApp((s) => s.openProviderModal)
  const resetWorkflow = useApp((s) => s.resetWorkflow)
  const toggleSound = useApp((s) => s.toggleSound)

  const [tab, setTab] = useState<Tab>('inspector')

  // Browsers will not start audio until the page has been interacted with.
  useEffect(() => {
    const unlock = () => unlockAudio()
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  useEffect(() => {
    setSoundEnabled(soundOn)
  }, [soundOn])

  // Follow the run: trace while it is in flight, report once it lands.
  useEffect(() => {
    if (isRunning) setTab('trace')
  }, [isRunning])

  useEffect(() => {
    if (report) setTab('report')
  }, [report])

  // Opening a block for configuration should show the inspector.
  useEffect(() => {
    if (selectedStepId) setTab('inspector')
  }, [selectedStepId])

  return (
    <div className="app">
      <header className="header">
        <div className="header__brand">
          <span className="header__mark" aria-hidden>
            🧩
          </span>
          <span>AI Workflow Puzzle Builder</span>
        </div>

        <div className="header__spacer" />

        <div className="header__puzzle">
          <span className={`badge badge--${puzzle.difficulty}`}>{puzzle.difficulty}</span>
          <span className="header__puzzle-name">{puzzle.title}</span>
        </div>

        <div className="header__spacer" />

        <button
          type="button"
          className={`btn btn--sm ${liveProvider ? 'badge--ok' : ''}`}
          onClick={openProviderModal}
          title={
            liveProvider
              ? `Live provider connected: ${liveProvider.model}. Click to change or disconnect.`
              : 'No API key needed. Every model and tool here is a deterministic local mock. Click to optionally connect your own model.'
          }
        >
          {liveProvider ? `● live: ${liveProvider.model}` : '● mock AI mode'}
        </button>

        <button
          type="button"
          className="btn btn--icon btn--ghost"
          onClick={toggleSound}
          title={soundOn ? 'Mute sound effects' : 'Unmute sound effects'}
          aria-label={soundOn ? 'Mute sound effects' : 'Unmute sound effects'}
          aria-pressed={soundOn}
        >
          {soundOn ? '🔊' : '🔇'}
        </button>

        <button type="button" className="btn" onClick={resetWorkflow} disabled={isRunning}>
          Reset puzzle
        </button>

        <button
          type="button"
          className="btn btn--run"
          onClick={() => void start()}
          disabled={isRunning}
        >
          {isRunning ? (
            <>
              <span className="spinner" /> Running
            </>
          ) : (
            <>▶ Run workflow</>
          )}
        </button>
      </header>

      <div className="app__body">
        <aside className="pane pane--left">
          <PuzzlePicker />
          <ObjectivePanel />
          <Palette />
          <FailurePanel />
        </aside>

        <main style={{ minHeight: 0, minWidth: 0 }}>
          <WorkflowCanvas />
        </main>

        <aside className="pane pane--right">
          <div className="tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'inspector'}
              className={`tab${tab === 'inspector' ? ' tab--active' : ''}`}
              onClick={() => setTab('inspector')}
            >
              Inspector
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'trace'}
              className={`tab${tab === 'trace' ? ' tab--active' : ''}`}
              onClick={() => setTab('trace')}
            >
              Trace
              {run && run.entries.length > 0 && <span className="tab__dot" />}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'report'}
              className={`tab${tab === 'report' ? ' tab--active' : ''}`}
              onClick={() => setTab('report')}
            >
              Report
              {report?.puzzleSolved && <span className="tab__dot" />}
            </button>
          </div>

          {tab === 'inspector' && <Inspector />}
          {tab === 'trace' && <TracePanel />}
          {tab === 'report' && <ReliabilityPanel />}
        </aside>
      </div>

      <HumanReviewModal />
      <ProviderModal />
    </div>
  )
}
