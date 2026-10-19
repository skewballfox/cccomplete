/**
 * Reads a dictionary file into words and seeds the index with them.
 *
 * Audience: contributors to cccomplete, and users who bring their own dictionary.
 * Not covered: finding or reading the file (the hooks module does that) and the
 * file's provenance (see docs/DICTIONARY.md).
 *
 * Format: plain UTF-8 text, one word per line, best word first. A line that starts
 * with `#` is a comment. A line keeps only its first token, which ends at a space,
 * a tab or a `/`, so a Hunspell `.dic` file loads as it is.
 */

import type { Word } from '../types'
import type { DictionarySource } from './config'
import type { CompletionTrie } from './trie'
import { wordsOf } from './words'

/** The first token of a line, or `null` for a blank line or a comment. */
const tokenOf = (line: string): string | null => {
  const text = line.trim()
  return text === '' || text.startsWith('#') ? null : (text.split(/[\s/]/, 1)[0] ?? null)
}

/** The token as one word, or none when it is not exactly one word under the rules in `words.ts`. */
const wordOf = (token: string): readonly Word[] => {
  const found = [...wordsOf(token)]
  return found.length === 1 && found[0] === token ? found : []
}

/**
 * Returns the words of `text` in file order, each once.
 *
 * Skips comments, blank lines, a Hunspell count line, and any token that is not a
 * word the index would store (too short, too long, no letter, or not one word).
 */
export const parseDictionary = (text: string): readonly Word[] => [
  ...new Set(
    text
      .split('\n')
      .map(tokenOf)
      .flatMap(token => (token === null ? [] : wordOf(token))),
  ),
]

/**
 * Adds `words` to `trie` so that earlier words rank higher, and returns how many it added.
 *
 * Each word enters once, so it has a count of one and ranks below any word the user has used
 * more often, or as often and more recently. The file's last word enters first.
 */
export const seedTrie = (trie: CompletionTrie, words: readonly Word[]): number => {
  // A loop on purpose: this runs once per session over tens of thousands of words, in reverse.
  for (let at = words.length - 1; at >= 0; at -= 1) {
    const word = words[at]
    if (word !== undefined) trie.insert(word)
  }
  return words.length
}

/** One plain sentence for the status command: which dictionary is in effect and how many words it gave. */
export const describeDictionary = (source: DictionarySource, words: number): string => {
  switch (source.kind) {
    case 'none':
      return 'dictionary: none'
    case 'bundled':
      return `dictionary: bundled, ${words} words`
    case 'file':
      return `dictionary: ${source.path}, ${words} words`
  }
}

/** One plain sentence for a toast when the named dictionary file cannot be read. */
export const describeUnreadable = (path: string): string =>
  `dictionary: cannot read "${path}"; using the bundled dictionary.`
