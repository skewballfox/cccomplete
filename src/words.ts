/**
 * Splits text into words, and finds the word being typed at the end of a draft.
 *
 * Audience: contributors to cccomplete. Not covered: ranking, storage (see trie.ts).
 *
 * Both entry points share one definition of a word, so a word that is indexed
 * is also a word that can be typed as a prefix: a run of letters, digits and
 * underscores, joined by single `'`, `’` or `-` characters.
 */

import type { Prefix, Word } from '../types'

/** Shortest word the trie stores. A completion must add at least one letter to a prefix of one. */
export const MIN_WORD_LENGTH = 3

/** Longest word or prefix handled. Longer runs are hashes, URLs and encoded blobs, not words. */
export const MAX_WORD_LENGTH = 64

const LETTER = /\p{L}/u
const NON_ASCII_UNIT = /[\p{L}\p{N}_]/u

/** `ASCII_UNIT[code]` is true for `[A-Za-z0-9_]`. A table beats a regex on the hot path. */
const ASCII_UNIT: readonly boolean[] = Array.from({ length: 128 }, (_, code) =>
  /[A-Za-z0-9_]/.test(String.fromCharCode(code)),
)

const isWordUnit = (text: string, at: number): boolean => {
  const code = text.charCodeAt(at)
  return code < 128 ? ASCII_UNIT[code] === true : NON_ASCII_UNIT.test(text.charAt(at))
}

/** Apostrophe, right single quote, hyphen: allowed inside a word, never at its start. */
const isConnector = (code: number): boolean => code === 0x27 || code === 0x2019 || code === 0x2d

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

/**
 * Yields every word in `text`, in order, one per occurrence.
 *
 * Cost: one pass over `text`, O(text.length), with no intermediate array.
 * A single-pass state machine is clearer here than a regex iterator, because
 * the connector rule needs one character of lookahead.
 */
export function* wordsOf(text: string): Generator<Word, void, undefined> {
  const end = text.length
  let start = -1
  let stop = -1
  for (let at = 0; at < end; at += 1) {
    if (isWordUnit(text, at)) {
      if (start === -1) start = at
      stop = at + 1
      continue
    }
    const joins = isConnector(text.charCodeAt(at)) && at + 1 < end && isWordUnit(text, at + 1)
    if (start !== -1 && !joins) {
      const word = toWord(text.slice(start, stop))
      if (word !== null) yield word
      start = -1
    }
  }
  if (start !== -1) {
    const word = toWord(text.slice(start, stop))
    if (word !== null) yield word
  }
}

/**
 * Returns the word being typed: the run of word characters that ends `text`.
 *
 * A trailing connector stays in the run, so `well-` completes to `well-known`.
 * Returns `null` when `text` does not end in a word character or a connector
 * that follows one, and when the run is longer than {@link MAX_WORD_LENGTH}.
 *
 * Cost: O(min(run length, MAX_WORD_LENGTH)). It never scans the whole draft,
 * so a large paste does not slow the keystroke that follows it.
 */
export const tailPrefix = (text: string): Prefix | null => {
  const end = text.length
  let start = end
  while (start > 0 && end - start <= MAX_WORD_LENGTH) {
    const before = start - 1
    const joins =
      isWordUnit(text, before) ||
      (isConnector(text.charCodeAt(before)) && before > 0 && isWordUnit(text, before - 1))
    if (!joins) break
    start = before
  }
  const length = end - start
  return length === 0 || length > MAX_WORD_LENGTH ? null : (text.slice(start) as Prefix)
}
