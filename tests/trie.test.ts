import { describe, expect, test } from 'claude-code/testing'

import type { SuggestionLimit, Word } from '../types'
import { CompletionTrie, TOP_CAPACITY } from '../src/trie'
import { prefix, seeded, vocabulary, word } from './support'

/** The specification, written the slow way: rank every stored word and keep the best. */
const reference = (
  history: readonly Word[],
  query: string,
  limit: SuggestionLimit,
): readonly string[] => {
  const stats = new Map<string, { count: number; seen: number }>()
  history.forEach((entry, tick) => {
    const known = stats.get(entry)
    stats.set(entry, { count: (known?.count ?? 0) + 1, seen: tick })
  })
  return [...stats]
    .filter(([entry]) => entry.startsWith(query) && entry.length > query.length)
    .sort(([, a], [, b]) => b.count - a.count || b.seen - a.seen)
    .slice(0, limit)
    .map(([entry]) => entry)
}

const trieOf = (...words: string[]): CompletionTrie => {
  const trie = new CompletionTrie()
  words.forEach(text => trie.insert(word(text)))
  return trie
}

const wordsAfter = (trie: CompletionTrie, query: string, limit: SuggestionLimit = 9): string[] =>
  trie.complete(prefix(query), limit).map(({ word: found }) => found)

describe('CompletionTrie', () => {
  test('returns the suffix that completes the prefix', () => {
    const [first] = trieOf('testing').complete(prefix('te'), 5)
    expect(first).toEqual({ word: 'testing', suffix: 'sting' })
  })

  test('ranks by count, then by recency', () => {
    const trie = trieOf('tester', 'testing', 'testing', 'tested')
    expect(wordsAfter(trie, 'te')).toEqual(['testing', 'tested', 'tester'])
  })

  test('answers a prefix that ends inside an edge', () => {
    const trie = trieOf('testing', 'tester', 'team')
    expect(wordsAfter(trie, 'tes')).toEqual(['tester', 'testing'])
    expect(wordsAfter(trie, 'testi')).toEqual(['testing'])
  })

  test('does not offer the prefix itself as a completion', () => {
    const trie = trieOf('test', 'test', 'testing')
    expect(wordsAfter(trie, 'test')).toEqual(['testing'])
  })

  test('splits an edge when a shorter word arrives later', () => {
    const trie = trieOf('testing', 'tes')
    expect(wordsAfter(trie, 'te')).toEqual(['tes', 'testing'])
    expect(trie.size).toBe(2)
  })

  test('returns nothing for a prefix that is not stored', () => {
    const trie = trieOf('testing')
    expect(wordsAfter(trie, 'x')).toEqual([])
    expect(wordsAfter(trie, 'tex')).toEqual([])
    expect(wordsAfter(trie, 'testingg')).toEqual([])
  })

  test('counts distinct words, not occurrences', () => {
    const trie = trieOf('alpha', 'alpha', 'beta')
    expect(trie.size).toBe(2)
  })

  test('lets a late word rise into a full list', () => {
    const crowd = Array.from({ length: TOP_CAPACITY + 2 }, (_, at) => `aaa${String.fromCharCode(98 + at)}`)
    const trie = trieOf(...crowd)
    const underdog = crowd[0] ?? ''
    expect(wordsAfter(trie, 'aaa')).not.toContain(underdog)
    trie.insert(word(underdog))
    trie.insert(word(underdog))
    expect(wordsAfter(trie, 'aaa')[0]).toBe(underdog)
  })

  test('ingest records every word occurrence and reports the count', () => {
    const trie = new CompletionTrie()
    expect(trie.ingest('the quick brown fox and the quick dog')).toBe(8)
    expect(wordsAfter(trie, 'qu')).toEqual(['quick'])
  })

  test('matches the reference ranking on a random history', () => {
    const random = seeded(20260101)
    const pool = vocabulary(random, 400)
    const history = Array.from({ length: 6000 }, () => pool[Math.floor(random() * random() * pool.length)] ?? word('fallback'))
    const trie = new CompletionTrie()
    history.forEach(entry => trie.insert(entry))

    const queries = [
      ...history.slice(0, 300).map(entry => entry.slice(0, 1 + Math.floor(random() * entry.length))),
      ...Array.from({ length: 100 }, () => `${'xyz'[Math.floor(random() * 3)]}${'te'[Math.floor(random() * 2)]}`),
    ]
    const limits: readonly SuggestionLimit[] = [1, 2, 3, 5, 9]
    for (const query of queries) {
      const limit = limits[Math.floor(random() * limits.length)] ?? 5
      expect(wordsAfter(trie, query, limit)).toEqual(reference(history, query, limit))
    }
  })
})
