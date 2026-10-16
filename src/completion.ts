/**
 * The pure editing pipeline: every step from "the user pressed a key" to "the box and the bar show this".
 *
 * Audience: contributors to cccomplete. Nothing here touches the host: each
 * function takes plain data and returns plain data, so each is testable alone
 * and the whole pipeline is measurable (tests/latency.test.ts).
 *
 * The pipeline, for one edit:
 *
 *   EditShape ──detach──▶ EditShape (no ghost) ──host applies the edit──▶ PromptText
 *       PromptText ──attach──▶ Outcome { box, view }
 *
 * The inline suggestion ("ghost") is real text in the prompt box, painted dim.
 * `detach` removes it before the host sees the edit, and `attach` writes it
 * back after, so the host edits the text the user typed and nothing else.
 */

import type { Completion, CompletionView } from '../types'
import type { Config } from './config'
import { matches as keyMatches } from './keys'
import type { KeyPress } from './keys'
import type { Completer } from './trie'
import { tailPrefix } from './words'

/** The prompt box as the host reports it. `cursor` counts UTF-16 code units. */
export type PromptText = Readonly<{ text: string; cursor: number }>

/** One edit as the host reports it: the draft before, and the splice. */
export type EditShape = Readonly<{
  text: string
  cursor: number
  start: number
  end: number
  inputText: string
  key?: KeyPress
}>

/** A dim run over the inline suggestion, in the host's decoration shape. */
export type GhostStyle = Readonly<{ start: number; end: number; dimColor: true }>

export type PromptBoxOut = Readonly<{
  text: string
  cursor: number
  decorations: readonly GhostStyle[]
}>

/** What to show after an edit: the box for the host, and the view for the bar. `view` is `null` when nothing is suggested. */
export type Outcome = Readonly<{ box: PromptBoxOut; view: CompletionView | null }>

/** What a configured key does while suggestions are showing. */
export type Action = 'accept' | 'next' | 'previous'

/** The inline suggestion text of a view. */
export const ghostOf = (view: CompletionView): string => view.draft.slice(view.prefixLength)

/** The text with no suggestion, and the cursor where it was (the end, unless told otherwise). */
const plain = (text: string, cursor: number = text.length): Outcome => ({
  box: { text, cursor, decorations: [] },
  view: null,
})

/**
 * Removes the inline suggestion from an edit, so the host applies the edit to what the user typed.
 *
 * Returns `edit` unchanged when `view` is `null` or describes a different draft.
 * Positions inside the suggestion clamp to its start, so a forward delete cannot eat it.
 */
export const detach = (edit: EditShape, view: CompletionView | null): EditShape => {
  if (view === null || view.ghostLength === 0 || edit.text !== view.draft) return edit
  const limit = view.prefixLength
  return {
    ...edit,
    text: edit.text.slice(0, limit),
    cursor: Math.min(edit.cursor, limit),
    start: Math.min(edit.start, limit),
    end: Math.min(edit.end, limit),
  }
}

/** Which action `key` triggers, or `null` when no suggestion is showing or the key is not bound. */
export const actionFor = (
  key: KeyPress | undefined,
  view: CompletionView | null,
  config: Config,
): Action | null => {
  if (key === undefined || view === null) return null
  if (keyMatches(config.accept, key)) return 'accept'
  if (keyMatches(config.next, key)) return 'next'
  if (keyMatches(config.previous, key)) return 'previous'
  return null
}

const viewOf = (
  typed: string,
  matches: readonly Completion[],
  index: number,
  config: Config,
): CompletionView => {
  const ghost = config.display === 'bar' ? '' : (matches[index]?.suffix ?? '')
  return {
    draft: typed + ghost,
    prefixLength: typed.length,
    ghostLength: ghost.length,
    matches,
    index,
  }
}

const boxOf = (view: CompletionView): PromptBoxOut => ({
  text: view.draft,
  cursor: view.prefixLength,
  decorations:
    view.ghostLength === 0 ? [] : [{ start: view.prefixLength, end: view.draft.length, dimColor: true }],
})

/**
 * Looks up completions for the word at the end of `clean` and builds the box and view that show them.
 *
 * Suggests only when the cursor is at the end of the draft and the word is at
 * least `config.minPrefix` long. Otherwise returns the text with no suggestion.
 */
export const attach = (clean: PromptText, completer: Completer, config: Config): Outcome => {
  if (clean.cursor !== clean.text.length) return plain(clean.text, clean.cursor)
  const prefix = tailPrefix(clean.text)
  if (prefix === null || prefix.length < config.minPrefix) return plain(clean.text)
  const matches = completer.complete(prefix, config.limit)
  if (matches.length === 0) return plain(clean.text)
  const view = viewOf(clean.text, matches, 0, config)
  return { box: boxOf(view), view }
}

/** Moves the highlighted suggestion by `step`, wrapping at both ends, and rewrites the inline text. */
export const cycle = (view: CompletionView, step: 1 | -1, config: Config): Outcome => {
  const count = view.matches.length
  const moved = viewOf(
    view.draft.slice(0, view.prefixLength),
    view.matches,
    (view.index + step + count) % count,
    config,
  )
  return { box: boxOf(moved), view: moved }
}

/**
 * Accepts the suggestion at `index`: the typed text, the completion, and a space if configured.
 *
 * Returns no view, so no new suggestion appears until the next edit. An
 * `index` outside the matches leaves the typed text as it is.
 */
export const accept = (view: CompletionView, index: number, config: Config): Outcome => {
  const typed = view.draft.slice(0, view.prefixLength)
  const match = view.matches[index]
  return match === undefined ? plain(typed) : plain(typed + match.suffix + (config.trailingSpace ? ' ' : ''))
}

/** Removes a leftover inline suggestion from submitted text, so it never reaches the model. */
export const withoutGhost = (text: string, view: CompletionView | null): string =>
  view !== null && view.ghostLength > 0 && text.length > view.ghostLength && text.endsWith(ghostOf(view))
    ? text.slice(0, text.length - view.ghostLength)
    : text

/**
 * Chooses how many suggestions fit in `columns`, counting each button as its word plus four cells of chrome.
 * Always keeps at least one, so a narrow terminal still shows the best match.
 */
export const fittingMatches = (matches: readonly Completion[], columns: number): readonly Completion[] => {
  let used = 0
  const fitting = matches.filter(match => {
    used += match.word.length + 5
    return used <= columns
  })
  return fitting.length > 0 ? fitting : matches.slice(0, 1)
}

/** Shortens `text` to at most `columns` cells, ending in an ellipsis when it cuts. Keeps a row to one line. */
export const clip = (text: string, columns: number): string =>
  text.length <= columns ? text : `${text.slice(0, Math.max(0, columns - 1))}…`
