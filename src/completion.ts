/**
 * The pure editing pipeline: every step from "the user pressed a key" to "the box and the bar show this".
 *
 * Audience: contributors to cccomplete. Nothing here touches the host: each
 * function takes plain data and returns plain data, so each is testable alone
 * and the whole pipeline is measurable (tests/latency.test.ts).
 *
 * The pipeline, for one edit:
 *
 *   host applies the edit ──▶ PromptText ──attach──▶ Outcome { box, view }
 *
 * The inline suggestion is virtual text: a decoration the host draws after the
 * cursor, never part of the draft. The host edits and submits exactly what the
 * user typed, so a suggestion can never reach the model or a slash command.
 */

import type { Completion, CompletionView } from '../types'
import type { Config } from './config'
import { languageOf, targetOf } from './draft'
import { matches as keyMatches } from './keys'
import type { KeyPress } from './keys'
import type { Completer } from './lexicon'

/** The prompt box as the host reports it. `cursor` counts UTF-16 code units. */
export type PromptText = Readonly<{ text: string; cursor: number }>

/** The inline suggestion, in the host's decoration shape: virtual text at the end of the draft, dim or in one colour. */
export type GhostStyle = Readonly<{ start: number; end: number; virtualText: string }> &
  (Readonly<{ dimColor: true }> | Readonly<{ color: string }>)

export type PromptBoxOut = Readonly<{
  text: string
  cursor: number
  decorations: readonly GhostStyle[]
}>

/**
 * What to show after an edit: the box for the host, and the view for the bar. `view` is `null` when nothing is suggested.
 *
 * `certified` counts the leading matches the index proved best (see `Ranking`), for the trace.
 */
export type Outcome = Readonly<{ box: PromptBoxOut; view: CompletionView | null; certified: number }>

/** What a configured key does while suggestions are showing. */
export type Action = 'accept' | 'next' | 'previous'

/** The text with no suggestion, and the cursor where it was (the end, unless told otherwise). */
const plain = (text: string, cursor: number = text.length): Outcome => ({
  box: { text, cursor, decorations: [] },
  view: null,
  certified: 0,
})

/**
 * Which action `key` triggers, or `null` when no suggestion is showing or the key is not bound.
 *
 * A view counts as showing only while the box still holds its draft with the
 * cursor at the end, so a stale view never takes a key.
 */
export const actionFor = (
  key: KeyPress | undefined,
  view: CompletionView | null,
  box: PromptText,
  config: Config,
): Action | null => {
  if (key === undefined || view === null || box.text !== view.draft || box.cursor !== box.text.length) return null
  if (config.accept.some(combo => keyMatches(combo, key))) return 'accept'
  if (keyMatches(config.next, key)) return 'next'
  if (keyMatches(config.previous, key)) return 'previous'
  return null
}

const viewOf = (draft: string, matches: readonly Completion[], index: number, language: CompletionView['language']): CompletionView => ({
  draft,
  matches,
  index,
  language,
})

const boxOf = (view: CompletionView, config: Config): PromptBoxOut => {
  const suffix = view.matches[view.index]?.suffix ?? ''
  const at = view.draft.length
  const shown = config.display !== 'bar' && suffix !== ''
  const paint = config.ghostPaint
  return {
    text: view.draft,
    cursor: at,
    decorations: !shown
      ? []
      : [
          paint.kind === 'dim'
            ? { start: at, end: at, virtualText: suffix, dimColor: true }
            : { start: at, end: at, virtualText: suffix, color: paint.color },
        ],
  }
}

/**
 * Looks up completions for the end of `box` and builds the box and view that show them.
 *
 * Suggests only when the cursor is at the end of the draft. `targetOf` decides
 * which index to ask; see draft.ts. Otherwise returns the text with no suggestion.
 */
export const attach = (box: PromptText, completer: Completer, config: Config): Outcome => {
  if (box.cursor !== box.text.length) return plain(box.text, box.cursor)
  const target = targetOf(box.text, config)
  if (target === null) return plain(box.text)
  const { matches, certified } = completer.rank(target, config.limit, config.minGain)
  if (matches.length === 0) return plain(box.text)
  const view = viewOf(box.text, matches, 0, languageOf(target))
  return { box: boxOf(view, config), view, certified }
}

/** Moves the highlighted suggestion by `step`, wrapping at both ends, and redraws the inline text. */
export const cycle = (view: CompletionView, step: 1 | -1, config: Config): Outcome => {
  const count = view.matches.length
  const moved = viewOf(view.draft, view.matches, (view.index + step + count) % count, view.language)
  return { box: boxOf(moved, config), view: moved, certified: 0 }
}

/**
 * Accepts the suggestion at `index`: the draft, the completion, and a space if configured.
 *
 * Inside code no space follows, because a closing backtick or a `.` usually
 * does. The result is looked up again, so the next word is predicted at once
 * when `predictNext` is on. An `index` outside the matches leaves the draft as it is.
 */
export const accept = (view: CompletionView, index: number, completer: Completer, config: Config): Outcome => {
  const match = view.matches[index]
  if (match === undefined) return plain(view.draft)
  const space = config.trailingSpace && view.language !== 'code' ? ' ' : ''
  const text = view.draft + match.suffix + space
  return attach({ text, cursor: text.length }, completer, config)
}

/** The host's prompt box at a typeahead request: the draft, the cursor, and the run of non-space characters that ends at the cursor. */
export type TypeaheadInput = Readonly<{ text: string; cursor: number; token: string }>

/** One row for the host's typeahead: what taking it writes over the token, and what the row shows. */
export type TypeaheadRow = Readonly<{ text: string; label: string; description: string }>

/**
 * Returns the matches as rows of the host's own typeahead, where tab takes one.
 *
 * Taking a row writes its `text` over the token, so each row keeps the part
 * of the token before the prefix (a backtick, a bracket) and adds the
 * completion. Slash commands get no rows: the host lists them itself. Like
 * the inline suggestion, rows appear only when the cursor is at the end of the draft.
 */
export const typeaheadRows = (input: TypeaheadInput, completer: Completer, config: Config): readonly TypeaheadRow[] => {
  if (!config.typeahead || input.cursor !== input.text.length) return []
  const target = targetOf(input.text, config)
  if (target === null || target.kind === 'command' || target.kind === 'next') return []
  return completer
    .rank(target, config.limit, config.minGain)
    .matches.map(match => ({ text: input.token + match.suffix, label: match.word, description: 'cccomplete' }))
}

/**
 * Chooses how many suggestions fit in `columns`, counting each match as its word plus `overhead` cells of chrome (five for a button, three for a powerline segment).
 * Always keeps at least one, so a narrow terminal still shows the best match.
 */
export const fittingMatches = (
  matches: readonly Completion[],
  columns: number,
  overhead: number = 5,
): readonly Completion[] => {
  let used = 0
  const fitting = matches.filter(match => {
    used += match.word.length + overhead
    return used <= columns
  })
  return fitting.length > 0 ? fitting : matches.slice(0, 1)
}

/** Shortens `text` to at most `columns` cells, ending in an ellipsis when it cuts. Keeps a row to one line. */
export const clip = (text: string, columns: number): string =>
  text.length <= columns ? text : `${text.slice(0, Math.max(0, columns - 1))}…`
