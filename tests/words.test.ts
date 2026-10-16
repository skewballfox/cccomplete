import { describe, expect, test } from 'claude-code/testing'

import { MAX_WORD_LENGTH, tailPrefix, toWord, wordsOf } from '../src/words'

const wordsIn = (text: string): string[] => [...wordsOf(text)]

describe('wordsOf', () => {
  test('keeps connectors inside a word and drops short and numeric runs', () => {
    expect(wordsIn("Don't use well-known paths, v2 and 2026.")).toEqual([
      "Don't",
      'use',
      'well-known',
      'paths',
      'and',
    ])
  })

  test('drops a trailing connector and ignores a leading one', () => {
    expect(wordsIn('end- of -foo')).toEqual(['end', 'foo'])
    expect(wordsIn('a--b cde')).toEqual(['cde'])
  })

  test('splits on path and punctuation characters', () => {
    expect(wordsIn('src/foo/bar.ts')).toEqual(['src', 'foo', 'bar'])
  })

  test('reads non-ASCII letters', () => {
    expect(wordsIn('naïve café')).toEqual(['naïve', 'café'])
  })

  test('skips runs longer than the limit', () => {
    expect(wordsIn(`${'x'.repeat(MAX_WORD_LENGTH + 1)} ok1`)).toEqual(['ok1'])
    expect(wordsIn('x'.repeat(MAX_WORD_LENGTH))).toHaveLength(1)
  })

  test('yields one word per occurrence, in order', () => {
    expect(wordsIn('cat dog cat')).toEqual(['cat', 'dog', 'cat'])
  })
})

describe('toWord', () => {
  test('requires a letter and the length bounds', () => {
    expect(toWord('ab')).toBeNull()
    expect(toWord('123')).toBeNull()
    expect(toWord('a12')).toBe('a12')
  })
})

describe('tailPrefix', () => {
  test('returns the run that ends the text', () => {
    expect(tailPrefix('hello wor')).toBe('wor')
    expect(tailPrefix('path/to/fil')).toBe('fil')
  })

  test('returns null when the text ends outside a word', () => {
    expect(tailPrefix('hello ')).toBeNull()
    expect(tailPrefix('')).toBeNull()
    expect(tailPrefix('wow 🙂')).toBeNull()
    expect(tailPrefix('a--')).toBeNull()
    expect(tailPrefix('-')).toBeNull()
  })

  test('keeps a trailing connector that follows a word character', () => {
    expect(tailPrefix('say well-')).toBe('well-')
  })

  test('refuses a run longer than the limit and accepts one at the limit', () => {
    expect(tailPrefix(`a ${'x'.repeat(MAX_WORD_LENGTH)}`)).toHaveLength(MAX_WORD_LENGTH)
    expect(tailPrefix(`a ${'x'.repeat(MAX_WORD_LENGTH + 1)}`)).toBeNull()
  })
})
