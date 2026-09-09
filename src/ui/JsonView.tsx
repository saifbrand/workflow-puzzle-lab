/**
 * A small syntax highlighted JSON viewer.
 *
 * The trace shows a payload at almost every step, and unhighlighted JSON in a
 * dark panel is genuinely hard to scan. This tokenises without a dependency
 * and without `dangerouslySetInnerHTML`.
 */

import { Fragment, type ReactNode } from 'react'

interface Props {
  value: unknown
  /** Collapse to a single line preview when the payload is large. */
  compact?: boolean
  className?: string
}

const TOKEN = /("(?:\\.|[^"\\])*")\s*:|("(?:\\.|[^"\\])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\b(null)\b/g

function highlight(source: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let match: RegExpExecArray | null
  let key = 0

  TOKEN.lastIndex = 0
  while ((match = TOKEN.exec(source)) !== null) {
    if (match.index > last) {
      out.push(<Fragment key={key++}>{source.slice(last, match.index)}</Fragment>)
    }

    const [full, propKey, str, num, bool, nul] = match
    if (propKey !== undefined) {
      out.push(
        <Fragment key={key++}>
          <span className="json-key">{propKey}</span>
          {full.slice(propKey.length)}
        </Fragment>,
      )
    } else if (str !== undefined) {
      out.push(
        <span className="json-string" key={key++}>
          {str}
        </span>,
      )
    } else if (num !== undefined) {
      out.push(
        <span className="json-number" key={key++}>
          {num}
        </span>,
      )
    } else if (bool !== undefined) {
      out.push(
        <span className="json-boolean" key={key++}>
          {bool}
        </span>,
      )
    } else if (nul !== undefined) {
      out.push(
        <span className="json-null" key={key++}>
          {nul}
        </span>,
      )
    }

    last = match.index + full.length
  }

  if (last < source.length) {
    out.push(<Fragment key={key++}>{source.slice(last)}</Fragment>)
  }
  return out
}

function stringify(value: unknown, compact: boolean): string {
  if (value === undefined) return 'undefined'
  try {
    const text = JSON.stringify(value, null, compact ? 0 : 2)
    if (text === undefined) return String(value)
    // Long payloads are truncated rather than allowed to bury the panel.
    return text.length > 4000 ? `${text.slice(0, 4000)}\n… truncated` : text
  } catch {
    return String(value)
  }
}

export function JsonView({ value, compact = false, className }: Props) {
  const text = stringify(value, compact)
  return (
    <pre className={`code${compact ? ' code--sm' : ''}${className ? ` ${className}` : ''}`}>
      {highlight(text)}
    </pre>
  )
}
