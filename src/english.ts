/**
 * Reads the bundled English model: word counts and, for common contexts, the counts of the words that follow them.
 *
 * Audience: contributors to cccomplete. Not covered: how the counts are built
 * (see scripts/build-english.ts and docs/DICTIONARY.md) or used (see lexicon.ts).
 *
 * Format, one record per line, tab-separated; a line that starts with `#` is a comment:
 *
 *   w  word  count
 *   p  context  total  distinct  word count word count ...
 *
 * `total` and `distinct` describe every follower the source had, before pruning,
 * because the smoothing weight needs them. A malformed line is skipped.
 */

import type { Context, Word } from '../types'
import { toContext, toWord } from './words'

/** A word and how often it occurs. */
export type Counted = readonly [Word, number]

/** One context: how often it occurred, how many different words followed it, and the commonest of them. */
export type EnglishContext = Readonly<{ context: Context; total: number; distinct: number; followers: readonly Counted[] }>

/** The whole model as read from the file. */
export type EnglishData = Readonly<{ words: readonly Counted[]; contexts: readonly EnglishContext[] }>

const EMPTY: EnglishData = { words: [], contexts: [] }

/** A whole number of at least 1, or `null`. */
const toCount = (raw: string | undefined): number | null => {
  const count = Number(raw)
  return raw !== undefined && Number.isInteger(count) && count >= 1 ? count : null
}

const counted = (rawWord: string | undefined, rawCount: string | undefined): readonly Counted[] => {
  const word = rawWord === undefined ? null : toWord(rawWord)
  const count = toCount(rawCount)
  return word === null || count === null ? [] : [[word, count]]
}

/** The `word count word count ...` list of a context line. A pair that does not parse is dropped. */
const followersOf = (raw: string): readonly Counted[] => {
  const parts = raw.split(' ')
  return parts.flatMap((part, at) => (at % 2 === 0 ? counted(part, parts[at + 1]) : []))
}

const contextOf = (fields: readonly string[]): readonly EnglishContext[] => {
  const context = toContext(fields[1] ?? '')
  const total = toCount(fields[2])
  const distinct = toCount(fields[3])
  const followers = followersOf(fields[4] ?? '')
  return context === null || total === null || distinct === null || followers.length === 0
    ? []
    : [{ context, total, distinct, followers }]
}

/** Parses the bundled English model. Text that is not in the format gives an empty model. */
export const parseEnglish = (text: string): EnglishData => {
  const lines = text.split('\n').map(line => line.split('\t'))
  const words = lines.flatMap(fields => (fields[0] === 'w' ? counted(fields[1], fields[2]) : []))
  const contexts = lines.flatMap(fields => (fields[0] === 'p' ? contextOf(fields) : []))
  return words.length === 0 && contexts.length === 0 ? EMPTY : { words, contexts }
}
