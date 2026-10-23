import { describe, expect, test } from 'claude-code/testing'

import { CODE_WINDOW, contextBefore, endsInCode, markdownCodeOf, MAX_GAP, MAX_WORD_LENGTH, pairsOf, tailPrefix, toWord, wordsOf } from '../src/words'

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

describe('tailPrefix in code', () => {
  test('keeps paths, flags and scoped names in one run', () => {
    expect(tailPrefix('open src/tri', 'code')).toBe('src/tri')
    expect(tailPrefix('run --plugin-d', 'code')).toBe('--plugin-d')
    expect(tailPrefix('add @types/no', 'code')).toBe('@types/no')
    expect(tailPrefix('call(fo', 'code')).toBe('fo')
  })
})

const pairs = (text: string, charset: 'prose' | 'code' = 'prose', commands = false): string[] =>
  [...pairsOf(text, charset, commands)].map(pair => `${pair.context ?? '·'}>${pair.word}`)

describe('pairsOf', () => {
  test('pairs each word with the run before it, across spaces only', () => {
    expect(pairs('the quick fox')).toEqual(['·>the', 'the>quick', 'quick>fox'])
    expect(pairs('go to bed')).toEqual(['to>bed'])
  })

  test('breaks the context at punctuation and line breaks', () => {
    expect(pairs('one, two. three\nfour')).toEqual(['·>one', '·>two', '·>three', '·>four'])
  })

  test('breaks the context after a run too long to be one', () => {
    expect(pairs(`${'x'.repeat(MAX_WORD_LENGTH + 1)} next`)).toEqual(['·>next'])
  })

  test('marks the first token of each shell command', () => {
    expect(pairs('git add . && git commit | tee log', 'code', true)).toEqual([
      '>git',
      'git>add',
      '>git',
      'git>commit',
      '>tee',
      'tee>log',
    ])
    expect(pairs('!npm test', 'code', true)).toEqual(['>npm', 'npm>test'])
  })

  test('drops a trailing dot or colon from a code token but keeps it in the context', () => {
    expect(pairs('see src/a.ts. then', 'code')).toEqual(['·>see', 'see>src/a.ts', 'src/a.ts.>then'])
  })
})

describe('contextBefore', () => {
  test('returns the run before the gap, within the gap limit', () => {
    expect(contextBefore('run te', 4, 'prose', false)).toBe('run')
    expect(contextBefore(`run${' '.repeat(MAX_GAP)}te`, 3 + MAX_GAP, 'prose', false)).toBe('run')
    expect(contextBefore(`run${' '.repeat(MAX_GAP + 1)}te`, 4 + MAX_GAP, 'prose', false)).toBeNull()
  })

  test('returns null at the start of prose, after punctuation, or with no gap', () => {
    expect(contextBefore('te', 0, 'prose', false)).toBeNull()
    expect(contextBefore('run, te', 5, 'prose', false)).toBeNull()
    expect(contextBefore('(te', 1, 'prose', false)).toBeNull()
  })

  test('returns the command start in shell positions', () => {
    expect(contextBefore('!', 1, 'code', true)).toBe('')
    expect(contextBefore('ls | ', 5, 'code', true)).toBe('')
    expect(contextBefore('ls ', 3, 'code', true)).toBe('ls')
  })
})

describe('markdownCodeOf', () => {
  test('yields tokens inside inline spans and fences only', () => {
    expect([...markdownCodeOf('use `src/a.ts` and\n```ts\nconst tailPrefix\n```\nplain words')]).toEqual([
      'src/a.ts',
      'const',
      'tailPrefix',
    ])
  })

  test('ends an inline span at the line end, and keeps an unclosed fence to the end', () => {
    expect([...markdownCodeOf('an `open span\nnot code`')]).toEqual([])
    expect([...markdownCodeOf('```\nopen fence')]).toEqual(['open', 'fence'])
    expect([...markdownCodeOf('```')]).toEqual([])
  })
})

describe('endsInCode', () => {
  test('sees an open inline span or fence at the end of the draft', () => {
    expect(endsInCode('see `src')).toBe(true)
    expect(endsInCode('see `src` and')).toBe(false)
    expect(endsInCode('```ts\nconst')).toBe(true)
    expect(endsInCode('```ts\nconst\n```\nprose')).toBe(false)
    expect(endsInCode('a `b\nc')).toBe(false)
    expect(endsInCode('```')).toBe(true)
  })

  test('reads only the last window of the draft', () => {
    expect(endsInCode(`\`${'x'.repeat(CODE_WINDOW)}`)).toBe(false)
    expect(endsInCode(`${'x '.repeat(CODE_WINDOW)}\`y`)).toBe(true)
  })
})
