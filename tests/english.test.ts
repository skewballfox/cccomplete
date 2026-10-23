import { describe, expect, test } from 'claude-code/testing'

import { parseEnglish } from '../src/english'

describe('parseEnglish', () => {
  test('reads word lines and context lines, and skips comments', () => {
    const text = '# header\nw\tthe\t50\nw\tbed\t20\np\tto\t40\t4\tbee 30 bed 2\n'
    expect(parseEnglish(text)).toEqual({
      words: [
        ['the', 50],
        ['bed', 20],
      ],
      contexts: [{ context: 'to', total: 40, distinct: 4, followers: [['bee', 30], ['bed', 2]] }],
    })
  })

  test('skips a word that is not a word, and a count that is not a whole number of at least one', () => {
    const text = 'w\tab\t5\nw\t2026\t5\nw\tgood\t0\nw\tfine\t1.5\nw\tkept\t3\nw\tnone\n'
    expect(parseEnglish(text).words).toEqual([['kept', 3]])
  })

  test('skips a context line with a bad context, total or distinct count, and drops bad followers', () => {
    const text = [
      'p\tnot a context\t4\t2\tbed 1',
      'p\tto\tmany\t2\tbed 1',
      'p\tto\t4\t-1\tbed 1',
      'p\tto\t4\t2\tab 3',
      'p\tgo\t9\t3\tbed 2 ab 1 home x home 4',
    ].join('\n')
    expect(parseEnglish(text).contexts).toEqual([{ context: 'go', total: 9, distinct: 3, followers: [['bed', 2], ['home', 4]] }])
  })

  test('gives an empty model for text in another format', () => {
    expect(parseEnglish('')).toEqual({ words: [], contexts: [] })
    expect(parseEnglish('hello world\n1 2 3')).toEqual({ words: [], contexts: [] })
  })
})
