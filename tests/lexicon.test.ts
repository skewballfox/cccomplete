import { describe, expect, test } from 'claude-code/testing'

import type { Completion, SuggestionLimit } from '../types'
import { targetOf } from '../src/draft'
import { countUse, describeSize, Lexicon, MAX_COMMAND_USES, mergeTiers, parseCommandUses, RECENT_TURNS } from '../src/lexicon'
import { seeded, word } from './support'

const settings = { minPrefix: 1, predictNext: true } as const

const wordsFor = (lexicon: Lexicon, draft: string, limit: SuggestionLimit = 9): readonly string[] => {
  const target = targetOf(draft, settings)
  return target === null ? [] : lexicon.lookup(target, limit).map(match => match.word)
}

const LIMITS: readonly SuggestionLimit[] = [1, 2, 3, 4, 5, 6, 7, 8, 9]

const prose = (text: string): { kind: 'prose'; text: string } => ({ kind: 'prose', text })

describe('Lexicon', () => {
  test('ranks words seen after the same word first, then the rest by count', () => {
    const lexicon = new Lexicon()
    lexicon.learn([prose('testing testing testing testing. run tests')])
    expect(wordsFor(lexicon, 'te')).toEqual(['testing', 'tests'])
    expect(wordsFor(lexicon, 'run te')).toEqual(['tests', 'testing'])
  })

  test('does not learn a pair across punctuation or a line break', () => {
    const lexicon = new Lexicon()
    lexicon.learn([prose('run. tests\nrun\ntests')])
    expect(wordsFor(lexicon, 'run ')).toEqual([])
  })

  test('learns short words as context even though they are too short to complete', () => {
    const lexicon = new Lexicon()
    lexicon.learn([prose('to be or not to be')])
    expect(wordsFor(lexicon, 'to ')).toEqual([])
    lexicon.learn([prose('go to bed, go to sleep')])
    expect(wordsFor(lexicon, 'to ')).toEqual(['sleep', 'bed'])
  })

  test('ranks a word from recent turns above an older word with a higher count', () => {
    const lexicon = new Lexicon()
    lexicon.learn([prose('tango tango tango tango')])
    // The rebuild after turn 2 × RECENT_TURNS covers only the turns after the first.
    Array.from({ length: 2 * RECENT_TURNS - 1 }, () => lexicon.learn([prose('filler')]))
    lexicon.learn([prose('tapir')])
    expect(wordsFor(lexicon, 'ta')).toEqual(['tapir', 'tango'])
  })

  test('forgets a turn from the recent tier once the tier is rebuilt without it', () => {
    const lexicon = new Lexicon()
    lexicon.learn([prose('tapir')])
    lexicon.learn([prose('tango tango')])
    expect(wordsFor(lexicon, 'ta')).toEqual(['tango', 'tapir'])
    Array.from({ length: 2 * RECENT_TURNS }, () => lexicon.learn([prose('filler')]))
    expect(lexicon.size.recent).toBe(1)
    expect(wordsFor(lexicon, 'ta')).toEqual(['tango', 'tapir'])
  })

  test('feeds code spans of prose to the code index only, and every token of code', () => {
    const lexicon = new Lexicon()
    lexicon.learn([prose('open `src/trie.ts` now'), { kind: 'code', text: 'export const tailPrefix = 1' }])
    expect(wordsFor(lexicon, '`src')).toEqual(['src/trie.ts'])
    expect(wordsFor(lexicon, '`tail')).toEqual(['tailPrefix'])
    expect(wordsFor(lexicon, 'tail')).toEqual([])
    expect(wordsFor(lexicon, 'tri')).toEqual(['trie'])
  })

  test('learns shell commands with the command start and the previous token as context', () => {
    const lexicon = new Lexicon()
    lexicon.learn([
      { kind: 'shell', text: 'git commit -m x && git commit --amend && git status' },
      { kind: 'shell', text: 'cat config.ts | grep commit' },
    ])
    expect(wordsFor(lexicon, '!')).toEqual(['git', 'grep', 'cat'])
    expect(wordsFor(lexicon, '!git ')).toEqual(['commit', 'status'])
    expect(wordsFor(lexicon, '!git co')).toEqual(['commit', 'config.ts'])
    expect(wordsFor(lexicon, '!c')).toEqual(['cat', 'commit', 'config.ts'])
  })

  test('ranks slash commands by use, then in the order the host lists them', () => {
    const lexicon = new Lexicon()
    expect(lexicon.setCommands(['clear', 'clean-up', 'compact', 'x'], { compact: 2 })).toBe(3)
    expect(wordsFor(lexicon, '/c')).toEqual(['compact', 'clear', 'clean-up'])
    expect(wordsFor(lexicon, '/clear')).toEqual([])
    lexicon.setCommands(['clear'], {})
    expect(wordsFor(lexicon, '/co')).toEqual([])
  })

  test('counts every part in its size', () => {
    const lexicon = new Lexicon()
    expect(lexicon.seed([word('alpha'), word('beta')])).toBe(2)
    lexicon.learn([prose('run tests'), { kind: 'shell', text: 'git status' }])
    expect(describeSize(lexicon.size)).toBe('words indexed: 4 (1 contexts, 2 recent); code: 0; shell: 2; commands: 0')
  })
})

describe('mergeTiers', () => {
  const match = (text: string): Completion => ({ word: word(text), suffix: text.slice(1) })

  test('keeps tier order, drops later copies, and stops at the limit', () => {
    const tiers = [[match('bbb')], [match('aaa'), match('bbb')], [match('ccc'), match('ddd')]]
    expect(mergeTiers(tiers, 3).map(found => found.word)).toEqual(['bbb', 'aaa', 'ccc'])
    expect(mergeTiers([], 3)).toEqual([])
  })

  test('equals ranking every word by tier, then by rank, on random lists', () => {
    const random = seeded(11)
    const pool = ['ant', 'bee', 'cat', 'dog', 'eel', 'fox', 'gnu', 'hen', 'ibis', 'jay', 'kiwi', 'lynx']
    for (let round = 0; round < 300; round += 1) {
      const limit = LIMITS[Math.floor(random() * LIMITS.length)] ?? 9
      // Each tier ranks a random subset of the pool; the merge sees only its best `limit`.
      const full = Array.from({ length: 3 }, () => pool.filter(() => random() < 0.5).sort(() => random() - 0.5))
      const expected = [...new Set(full.flat())].slice(0, limit)
      const merged = mergeTiers(
        full.map(tier => tier.slice(0, limit).map(match)),
        limit,
      )
      expect(merged.map(found => found.word)).toEqual(expected)
    }
  })
})

describe('command uses', () => {
  test('parses only whole counts in range, from an object', () => {
    expect(parseCommandUses({ clear: 3, bad: -1, half: 1.5, big: MAX_COMMAND_USES + 1, text: '2' })).toEqual({ clear: 3 })
    expect(parseCommandUses(null)).toEqual({})
    expect(parseCommandUses([1, 2])).toEqual({})
    expect(parseCommandUses('x')).toEqual({})
  })

  test('counts a use and caps the count', () => {
    expect(countUse({}, 'clear')).toEqual({ clear: 1 })
    expect(countUse({ clear: MAX_COMMAND_USES }, 'clear')).toEqual({ clear: MAX_COMMAND_USES })
  })
})
