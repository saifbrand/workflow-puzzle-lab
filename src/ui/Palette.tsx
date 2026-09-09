/**
 * The block palette.
 *
 * Only the blocks a puzzle actually needs are enabled. Offering the full
 * library on every puzzle would turn a focused exercise into a search, and the
 * brief is explicit that a small set of well designed blocks beats a large
 * unrestricted one.
 */

import { BLOCK_LIBRARY, FAMILY_LABELS, PALETTE_ORDER } from '../engine/blocks'
import { useApp } from '../store'
import type { BlockFamily, BlockKind } from '../engine/types'

const FAMILY_ORDER: BlockFamily[] = ['core', 'reliability', 'human']

export function Palette() {
  const puzzle = useApp((s) => s.puzzle)
  const addBlock = useApp((s) => s.addBlock)
  const isRunning = useApp((s) => s.isRunning)
  const selectedStepId = useApp((s) => s.selectedStepId)

  const allowed = new Set<BlockKind>(puzzle.availableBlocks)

  return (
    <div className="pane__section">
      <div className="pane__title">
        <span>Add a block</span>
      </div>
      <p style={{ color: 'var(--ink-3)', fontSize: 11.5, marginBottom: 10 }}>
        {selectedStepId
          ? 'Inserted after the selected step.'
          : 'Inserted just before the output step.'}
      </p>

      {FAMILY_ORDER.map((family) => {
        const kinds = PALETTE_ORDER.filter(
          (kind) => BLOCK_LIBRARY[kind].family === family && allowed.has(kind),
        )
        if (kinds.length === 0) return null

        return (
          <div className="palette-group" key={family}>
            <div className="palette-group__label">{FAMILY_LABELS[family]}</div>
            {kinds.map((kind) => {
              const def = BLOCK_LIBRARY[kind]
              return (
                <button
                  key={kind}
                  type="button"
                  className="palette-item"
                  style={{ ['--palette-accent' as string]: `var(--${def.accent})` }}
                  onClick={() => addBlock(kind)}
                  disabled={isRunning}
                  title={def.summary}
                >
                  <span className="palette-item__glyph" aria-hidden>
                    {def.glyph}
                  </span>
                  <span className="palette-item__text">
                    <span className="palette-item__label">{def.label}</span>
                    <span className="palette-item__summary">{def.summary}</span>
                  </span>
                </button>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
