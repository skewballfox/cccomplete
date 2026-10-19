/**
 * Lays out the bar as powerline segments: coloured runs of text joined by Nerd Font arrows.
 *
 * Audience: contributors to cccomplete. Not covered: drawing. The hooks module turns each run into a `Text`.
 * Source of the glyph: the Powerline private-use block, U+E0B0, shipped in every Nerd Font (nerdfonts.com, read 2026-10-19).
 */

import type { Completion } from '../types'
import { fittingMatches } from './completion'

/** The solid right-pointing arrow that joins two segments. */
export const ARROW = '\u{E0B0}'

/** Columns one segment uses beyond its word: a space on each side and the arrow. */
export const SEGMENT_OVERHEAD = 3

/** One run of text with its colours. `background` is null for the terminal's own. */
export type Run = Readonly<{
  text: string
  color: string
  background: string | null
  dim: boolean
}>

const ACTIVE = { color: '#1e1e1e', background: '#d97757' } as const
const IDLE = { color: '#d0d0d0', background: '#3a3a4a' } as const

const segment = (text: string, style: Readonly<{ color: string; background: string }>, next: string | null): readonly Run[] => [
  { text: ` ${text} `, color: style.color, background: style.background, dim: false },
  { text: ARROW, color: style.background, background: next, dim: false },
]

/**
 * Returns the runs of one bar row, at most `columns` cells wide.
 *
 * With no matches the row is the hint in one idle segment, so the bar keeps its height.
 * With matches it is one segment per match that fits, the active one coloured, then the hint if room remains.
 */
export const powerbar = (
  matches: readonly Completion[],
  index: number,
  hint: string,
  columns: number,
): readonly Run[] => {
  if (matches.length === 0) {
    const room = Math.max(0, columns - 3)
    const text = hint.length <= room ? hint : `${hint.slice(0, Math.max(0, room - 1))}…`
    return segment(text, IDLE, null)
  }

  const shown = fittingMatches(matches, columns, SEGMENT_OVERHEAD)
  const styleOf = (position: number): typeof ACTIVE | typeof IDLE => (position === index ? ACTIVE : IDLE)
  const runs = shown.flatMap((match, position) =>
    segment(match.word, styleOf(position), position + 1 < shown.length ? styleOf(position + 1).background : null),
  )
  const room = columns - shown.reduce((used, match) => used + match.word.length + SEGMENT_OVERHEAD, 0)
  return room >= hint.length + 1 ? [...runs, { text: ` ${hint}`, color: IDLE.color, background: null, dim: true }] : runs
}
