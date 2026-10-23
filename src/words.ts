/**
 * Splits text into words and tokens, and reads the word being typed and the word before it.
 *
 * Audience: contributors to cccomplete. Not covered: ranking, storage (see trie.ts),
 * and which index a draft consults (see draft.ts).
 *
 * Two character sets share one scanner, so a word that is indexed is also a
 * word that can be typed as a prefix:
 *
 * - `prose`: runs of letters, digits and underscores, joined by single `'`,
 *   `’` or `-` characters.
 * - `code`: runs of letters, digits, `_`, `.`, `/`, `-`, `:` and `@`, so
 *   `src/trie.ts`, `--plugin-dir` and `@types/node` are each one token. A
 *   token drops a trailing `.` or `:`, which ends a sentence more often than a name.
 */

import type { Context, Prefix, Word } from '../types'

/** Shortest word the trie stores. A completion must add at least one letter to a prefix of one. */
export const MIN_WORD_LENGTH = 3

/** Longest word, prefix or context handled. Longer runs are hashes, URLs and encoded blobs, not words. */
export const MAX_WORD_LENGTH = 64

/** Most spaces or tabs allowed between a context and the word after it. */
export const MAX_GAP = 8

/** Which characters make a run. */
export type Charset = 'prose' | 'code'

/** The context of the first token of a shell command: nothing before it but the start of the line or a pipe. */
export const COMMAND_START = '' as Context

/** One word as indexed, and the run directly before it when only spaces or tabs separate them. */
export type Pair = Readonly<{ word: Word; context: Context | null }>

const LETTER = /\p{L}/u
const NON_ASCII_UNIT = /[\p{L}\p{N}_]/u

/** `ASCII_UNIT[code]` is true for `[A-Za-z0-9_]`. A table beats a regex on the hot path. */
const ASCII_UNIT: readonly boolean[] = Array.from({ length: 128 }, (_, code) =>
  /[A-Za-z0-9_]/.test(String.fromCharCode(code)),
)

/** `CODE_EXTRA[code]` is true for the punctuation a code token may hold. */
const CODE_EXTRA: readonly boolean[] = Array.from({ length: 128 }, (_, code) => './-:@'.includes(String.fromCharCode(code)))

const isWordUnit = (text: string, at: number): boolean => {
  const code = text.charCodeAt(at)
  return code < 128 ? ASCII_UNIT[code] === true : NON_ASCII_UNIT.test(text.charAt(at))
}

const isCodeUnit = (text: string, at: number): boolean =>
  isWordUnit(text, at) || CODE_EXTRA[text.charCodeAt(at)] === true

/** Apostrophe, right single quote, hyphen: allowed inside a prose word, never at its start. */
const isConnector = (code: number): boolean => code === 0x27 || code === 0x2019 || code === 0x2d

const isGapUnit = (code: number): boolean => code === 0x20 || code === 0x09

/** Characters after which a shell token starts a new command: newline, `|`, `;`, `&`, `(`. */
const isCommandBreak = (code: number): boolean =>
  code === 0x0a || code === 0x7c || code === 0x3b || code === 0x26 || code === 0x28

/**
 * Validates raw text as a word.
 *
 * Returns `null` when the text is too short, too long, or has no letter
 * (so `2026` and `0xff_00` are not words but `v2` is).
 */
export const toWord = (raw: string): Word | null =>
  raw.length >= MIN_WORD_LENGTH && raw.length <= MAX_WORD_LENGTH && LETTER.test(raw)
    ? (raw as Word)
    : null

/** A code token as a word: the run less a trailing `.` or `:`, then the word rules. */
const codeWord = (run: string): Word | null => toWord(run.replace(/[.:]+$/, ''))

/** Where the run of `charset` that ends at `end` begins. Returns `end` when no run ends there. */
const runStart = (text: string, end: number, charset: Charset): number => {
  let start = end
  // A loop on purpose: this is the keystroke path, and it stops at the first character outside the run.
  while (start > 0 && end - start <= MAX_WORD_LENGTH) {
    const before = start - 1
    const joins =
      charset === 'code'
        ? isCodeUnit(text, before)
        : isWordUnit(text, before) || (isConnector(text.charCodeAt(before)) && before > 0 && isWordUnit(text, before - 1))
    if (!joins) break
    start = before
  }
  return start
}

/**
 * Returns the run of `charset` that ends `text`: the word being typed.
 *
 * In prose a trailing connector stays in the run, so `well-` completes to `well-known`.
 * Returns `null` when `text` does not end in a run, and when the run is longer
 * than {@link MAX_WORD_LENGTH}.
 *
 * Cost: O(min(run length, MAX_WORD_LENGTH)). It never scans the whole draft,
 * so a large paste does not slow the keystroke that follows it.
 */
export const tailPrefix = (text: string, charset: Charset = 'prose'): Prefix | null => {
  const start = runStart(text, text.length, charset)
  const length = text.length - start
  return length === 0 || length > MAX_WORD_LENGTH ? null : (text.slice(start) as Prefix)
}

/**
 * Returns the context of the word that starts at `end`: the run before it, when only spaces or tabs come between.
 *
 * With `commands`, a word with nothing before it on its line but a shell
 * break (`|`, `;`, `&`, `(`) or a leading `!` has the context {@link COMMAND_START}.
 * Returns `null` for a word after punctuation, after more than {@link MAX_GAP}
 * spaces, or at the start of prose.
 *
 * Cost: O(MAX_GAP + MAX_WORD_LENGTH), whatever the draft's length.
 */
export const contextBefore = (text: string, end: number, charset: Charset, commands: boolean): Context | null => {
  let gapStart = end
  // A loop on purpose: the keystroke path, bounded by MAX_GAP.
  while (gapStart > 0 && end - gapStart < MAX_GAP && isGapUnit(text.charCodeAt(gapStart - 1))) gapStart -= 1
  if (commands) {
    if (gapStart === 0 || (gapStart === 1 && text.charCodeAt(0) === 0x21)) return COMMAND_START
    if (isCommandBreak(text.charCodeAt(gapStart - 1))) return COMMAND_START
  }
  if (gapStart === end || gapStart === 0) return null
  const start = runStart(text, gapStart, charset)
  const length = gapStart - start
  return length === 0 || length > MAX_WORD_LENGTH ? null : (text.slice(start, gapStart) as Context)
}

/**
 * Yields every word of `charset` in `text`, in order, one per occurrence, each with its context.
 *
 * The context follows the rules of {@link contextBefore}, so what is indexed
 * matches what a draft looks up. A context need not be a word: `to` in
 * `to be` is too short to complete, but still predicts `be`.
 *
 * Cost: one pass over `text`. A state machine, not a regex iterator, because
 * the prose connector rule needs one character of lookahead.
 */
export function* pairsOf(text: string, charset: Charset, commands: boolean): Generator<Pair, void, undefined> {
  const end = text.length
  const unit = charset === 'code' ? isCodeUnit : isWordUnit
  let start = -1
  let previous: Context | null = null
  // Whether everything since the last run (or the start of the line) is spaces and tabs.
  let clean = true
  let lineStart = true
  const finish = (stop: number): Pair | null => {
    const run = text.slice(start, stop)
    const context: Context | null = commands && lineStart ? COMMAND_START : clean ? previous : null
    previous = run.length > MAX_WORD_LENGTH ? null : (run as Context)
    clean = true
    lineStart = false
    start = -1
    const word = charset === 'code' ? codeWord(run) : toWord(run)
    return word === null ? null : { word, context }
  }
  for (let at = 0; at < end; at += 1) {
    if (unit(text, at)) {
      if (start === -1) start = at
      continue
    }
    if (start !== -1) {
      const joins = charset === 'prose' && isConnector(text.charCodeAt(at)) && at + 1 < end && isWordUnit(text, at + 1)
      if (joins) continue
      const pair = finish(at)
      if (pair !== null) yield pair
    }
    const code = text.charCodeAt(at)
    if (commands && (isCommandBreak(code) || (at === 0 && code === 0x21))) {
      lineStart = true
    } else if (!isGapUnit(code)) {
      clean = false
      lineStart = false
      previous = null
    }
  }
  if (start !== -1) {
    const pair = finish(end)
    if (pair !== null) yield pair
  }
}

/** Yields every prose word in `text`, in order, one per occurrence. */
export function* wordsOf(text: string): Generator<Word, void, undefined> {
  for (const pair of pairsOf(text, 'prose', false)) yield pair.word
}

/**
 * Yields every code token inside the inline code spans and fenced blocks of Markdown `text`.
 *
 * A fence is a line that starts with three backticks. An inline span opens
 * and closes at a backtick, and ends at the end of its line.
 */
export function* markdownCodeOf(text: string): Generator<Word, void, undefined> {
  for (const span of codeSpansOf(text)) {
    for (const pair of pairsOf(span, 'code', false)) yield pair.word
  }
}

/** The text of each code span and fenced block in `text`. A state machine, for the same reason as `pairsOf`. */
function* codeSpansOf(text: string): Generator<string, void, undefined> {
  let fence = -1
  let inline = -1
  let lineStart = 0
  for (let at = 0; at <= text.length; at += 1) {
    const atEnd = at === text.length
    const code = atEnd ? 0x0a : text.charCodeAt(at)
    if (at === lineStart && text.startsWith('```', at)) {
      if (fence === -1) {
        fence = text.indexOf('\n', at)
        if (fence === -1) return
        at = fence
        fence += 1
      } else {
        yield text.slice(fence, at)
        fence = -1
        const next = text.indexOf('\n', at)
        if (next === -1) return
        at = next
      }
      lineStart = at + 1
      continue
    }
    if (code === 0x0a) {
      if (atEnd && fence !== -1) yield text.slice(fence)
      inline = -1
      lineStart = at + 1
      continue
    }
    if (fence === -1 && code === 0x60) {
      if (inline === -1) {
        inline = at + 1
      } else {
        yield text.slice(inline, at)
        inline = -1
      }
    }
  }
}

/** How far back the code check reads. A fence opened earlier than this is not seen. */
export const CODE_WINDOW = 4096

/**
 * True when the end of `text` sits inside an inline code span or a fenced block.
 *
 * Reads at most the last {@link CODE_WINDOW} code units, so its cost does not
 * grow with the draft. A state machine, and the keystroke path.
 */
export const endsInCode = (text: string): boolean => {
  const from = Math.max(0, text.length - CODE_WINDOW)
  let fence = false
  let inline = false
  let lineStart = from === 0
  for (let at = from; at < text.length; at += 1) {
    const code = text.charCodeAt(at)
    if (lineStart && text.startsWith('```', at)) {
      fence = !fence
      inline = false
      const next = text.indexOf('\n', at)
      if (next === -1) return fence
      at = next
      continue
    }
    lineStart = code === 0x0a
    if (lineStart) inline = false
    else if (!fence && code === 0x60) inline = !inline
  }
  return fence || inline
}
