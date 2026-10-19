import { describe, expect, test } from 'claude-code/testing'

import type { Prefix } from '../types'
import { describeDictionary, parseDictionary, seedTrie } from '../src/dictionary'
import { CompletionTrie } from '../src/trie'

const prefix = (text: string): Prefix => text as Prefix
const best = (trie: CompletionTrie, text: string): readonly string[] =>
  trie.complete(prefix(text), 9).map(match => match.word)

describe('parseDictionary', () => {
  test('keeps file order and drops comments, blanks, duplicates and a Hunspell count line', () => {
    const text = '# header\n\n3\ntesting\r\n  tester  \n# more\ntesting\ntests\n'
    expect(parseDictionary(text)).toEqual(['testing', 'tester', 'tests'])
  })

  test('keeps the first token and drops affix flags', () => {
    expect(parseDictionary('tester/MS\nlatte\tn\ncan’t/x\n')).toEqual(['tester', 'latte', 'can’t'])
  })

  test('drops what the index would not store as one word', () => {
    expect(parseDictionary('ab\n2026\nhello.world\n-dash\nx'.concat('y'.repeat(70), '\nfine-word\n'))).toEqual(['fine-word'])
  })

  test('reads an empty file as no words', () => {
    expect(parseDictionary('')).toEqual([])
  })
})

describe('seedTrie', () => {
  test('ranks earlier lines higher', () => {
    const trie = new CompletionTrie()
    seedTrie(trie, parseDictionary('test\ntext\ntent\n'))
    expect(best(trie, 'te')).toEqual(['test', 'text', 'tent'])
  })

  test('ranks a word the user has used above every seed word', () => {
    const trie = new CompletionTrie()
    seedTrie(trie, parseDictionary('test\ntext\ntent\n'))
    trie.ingest('tent')
    expect(best(trie, 'te')).toEqual(['tent', 'test', 'text'])
  })

  test('ranks a word the user used once above a seed word even when the seed has the same count', () => {
    const trie = new CompletionTrie()
    seedTrie(trie, parseDictionary('test\n'))
    trie.ingest('texture')
    expect(best(trie, 'te')).toEqual(['texture', 'test'])
  })

  test('counts the words it added', () => {
    expect(seedTrie(new CompletionTrie(), parseDictionary('one\ntwo\nthree\n'))).toBe(3)
  })
})

describe('describeDictionary', () => {
  test('names the source in effect', () => {
    expect(describeDictionary({ kind: 'none' }, 0)).toBe('dictionary: none')
    expect(describeDictionary({ kind: 'bundled' }, 12)).toBe('dictionary: bundled, 12 words')
    expect(describeDictionary({ kind: 'file', path: '/a/b.txt' }, 5)).toBe('dictionary: /a/b.txt, 5 words')
  })
})
