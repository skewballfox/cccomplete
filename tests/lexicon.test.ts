import { describe, expect, test } from 'claude-code/testing'

import type { Gain, SuggestionLimit } from '../types'
import { targetOf } from '../src/draft'
import type { Counted, EnglishData } from '../src/english'
import { CONVERSATION_WEIGHT, countUse, describeSize, Lexicon, MAX_COMMAND_USES, parseCommandUses } from '../src/lexicon'
import { pairsOf, toContext } from '../src/words'
import { seeded, word } from './support'

const settings = { minPrefix: 1, predictNext: true } as const

const LIMITS: readonly SuggestionLimit[] = [1, 2, 3, 4, 5, 6, 7, 8, 9]

const GAINS: readonly Gain[] = [1, 2, 3]

const wordsFor = (lexicon: Lexicon, draft: string, limit: SuggestionLimit = 9): readonly string[] => {
  const target = targetOf(draft, settings)
  return target === null ? [] : lexicon.rank(target, limit, 1).matches.map(match => match.word)
}

const prose = (text: string): { kind: 'prose'; text: string } => ({ kind: 'prose', text })

const context = (text: string): NonNullable<ReturnType<typeof toContext>> => {
  const made = toContext(text)
  if (made === null) throw new Error(`not a context: ${text}`)
  return made
}

const english: EnglishData = {
  words: [
    [word('the'), 50],
    [word('bed'), 20],
    [word('beee'), 1],
    [word('bee'), 2],
  ],
  contexts: [{ context: context('to'), total: 40, distinct: 4, followers: [[word('bee'), 30], [word('bed'), 2]] }],
}

describe('Lexicon', () => {
  test('ranks a word that always followed its context above a word that is more common overall', () => {
    const lexicon = new Lexicon()
    lexicon.learn([prose('testing testing testing testing. run tests')])
    expect(wordsFor(lexicon, 'te')).toEqual(['testing', 'tests'])
    expect(wordsFor(lexicon, 'run te')).toEqual(['tests', 'testing'])
  })

  test('trusts a context less when many different words followed it once each', () => {
    const lexicon = new Lexicon()
    const scattered = Array.from({ length: 20 }, (_, at) => `the w${String.fromCharCode(97 + at)}x.`).join(' ')
    lexicon.learn([prose(`${scattered} the tea. tensor tensor tensor tensor tensor tensor`)])
    expect(wordsFor(lexicon, 'the te')).toEqual(['tensor', 'tea'])
  })

  test('prefers the word that followed the same two words', () => {
    const lexicon = new Lexicon()
    lexicon.learn([prose('want to bend. want to bend. want to bend. go to bed.')])
    expect(wordsFor(lexicon, 'want to be')).toEqual(['bend', 'bed'])
    expect(wordsFor(lexicon, 'go to be')).toEqual(['bed', 'bend'])
  })

  test('does not learn a pair across punctuation or a line break, and predicts nothing after a word with no known followers', () => {
    const lexicon = new Lexicon()
    lexicon.learn([prose('run. tests\nrun\ntests')])
    expect(wordsFor(lexicon, 'run ')).toEqual([])
    lexicon.learn([prose('run tests')])
    expect(wordsFor(lexicon, 'run ')).toEqual(['tests', 'run'])
  })

  test('learns short words as context even though they are too short to complete', () => {
    const lexicon = new Lexicon()
    lexicon.learn([prose('go to bed, go to sleep. not now')])
    expect(wordsFor(lexicon, 'to ').slice(0, 2)).toEqual(['sleep', 'bed'])
  })

  test('ranks by the English pairs before the conversation has words of its own, then by the conversation', () => {
    const lexicon = new Lexicon()
    lexicon.seedEnglish(english)
    expect(wordsFor(lexicon, 'to be')).toEqual(['bee', 'bed', 'beee'])
    expect(wordsFor(lexicon, 'the be')).toEqual(['bed', 'bee', 'beee'])
    lexicon.learn([prose(Array.from({ length: CONVERSATION_WEIGHT }, () => 'to bed').join(' '))])
    expect(wordsFor(lexicon, 'to be')[0]).toBe('bed')
  })

  test('feeds code spans of prose to the code index only, and every token of code', () => {
    const lexicon = new Lexicon()
    lexicon.learn([prose('open `src/trie.ts` now'), { kind: 'code', text: 'export const tailPrefix = 1' }])
    expect(wordsFor(lexicon, '`src')).toEqual(['src/trie.ts'])
    expect(wordsFor(lexicon, '`tail')).toEqual(['tailPrefix'])
    expect(wordsFor(lexicon, 'tail')).toEqual([])
    expect(wordsFor(lexicon, 'tri')).toEqual(['trie'])
  })

  test('learns shell commands with the command start and the tokens before as context', () => {
    const lexicon = new Lexicon()
    lexicon.learn([
      { kind: 'shell', text: 'git commit -m x && git commit --amend && git status' },
      { kind: 'shell', text: 'cat config.ts | grep commit' },
    ])
    expect(wordsFor(lexicon, '!').slice(0, 3)).toEqual(['git', 'grep', 'cat'])
    expect(wordsFor(lexicon, '!git ').slice(0, 2)).toEqual(['commit', 'status'])
    expect(wordsFor(lexicon, '!git co')).toEqual(['commit', 'config.ts'])
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
    expect(lexicon.seedEnglish(english)).toBe(6)
    lexicon.learn([prose('run tests now'), { kind: 'shell', text: 'git status' }])
    expect(describeSize(lexicon.size)).toBe(
      'words indexed: 3 (3 contexts); English: 6 words, 1 contexts; code: 0; shell: 2; commands: 0',
    )
  })

  test('drops a match that adds fewer letters than the minimum gain, in every index, but never a predicted word', () => {
    const lexicon = new Lexicon()
    lexicon.learn([prose('the the the then them theory. see `src` and `srcs` and `srcmap`'), { kind: 'shell', text: 'git gitk' }])
    lexicon.setCommands(['clear', 'clears', 'clearing'], {})
    const words = (draft: string, minGain: Gain): readonly string[] => {
      const target = targetOf(draft, settings)
      return target === null ? [] : lexicon.rank(target, 9, minGain).matches.map(match => match.word)
    }
    expect(words('th', 1)).toContain('the')
    expect(words('th', 2)).not.toContain('the')
    expect(words('th', 2)).toContain('then')
    expect(words('th', 3)).toEqual(['theory'])
    expect(words('`sr', 2)).toEqual(['srcmap', 'srcs'])
    expect(words('!gi', 2)).toEqual(['gitk'])
    expect(words('/clea', 2)).toEqual(['clears', 'clearing'])
    expect(words('/clea', 3)).toEqual(['clearing'])
    lexicon.learn([prose('see the. see the')])
    expect(words('see ', 3)[0]).toBe('the')
  })

  test('certifies every code and command match, and no match of an empty lookup', () => {
    const lexicon = new Lexicon()
    lexicon.learn([prose('see `alpha` and `alps`')])
    const code = targetOf('`al', settings)
    expect(code === null ? null : lexicon.rank(code, 5, 1)).toEqual({
      matches: [
        { word: 'alps', suffix: 'ps' },
        { word: 'alpha', suffix: 'pha' },
      ],
      certified: 2,
    })
    const none = targetOf('zz', settings)
    expect(none === null ? null : lexicon.rank(none, 5, 1)).toEqual({ matches: [], certified: 0 })
  })
})

/**
 * The model written the slow way: count everything in plain maps, score every word, sort.
 * It shares no code with the lexicon but the tokenizer, so a certified result that differs from it is a bug.
 */
class Reference {
  readonly words = new Map<string, number>()
  readonly seen = new Map<string, number>()
  readonly near = new Map<string, Map<string, number>>()
  readonly far = new Map<string, Map<string, number>>()
  readonly english = new Map<string, number>()
  readonly englishNear = new Map<string, Readonly<{ total: number; distinct: number; counts: Map<string, number> }>>()
  learned = 0
  tick = 0

  learn(text: string): void {
    for (const pair of pairsOf(text, 'prose', false)) {
      this.tick += 1
      this.learned += 1
      this.words.set(pair.word, (this.words.get(pair.word) ?? 0) + 1)
      this.seen.set(pair.word, this.tick)
      if (pair.context !== null) bump(this.near, pair.context, pair.word)
      if (pair.context2 !== null) bump(this.far, pair.context2, pair.word)
    }
  }

  seedEnglish(data: EnglishData): void {
    data.words.forEach(([found, count]) => this.english.set(found, (this.english.get(found) ?? 0) + count))
    data.contexts.forEach(entry =>
      this.englishNear.set(entry.context, { total: entry.total, distinct: entry.distinct, counts: new Map(entry.followers) }),
    )
  }

  rank(prefix: string, near: string | null, far: string | null, limit: number, minGain: number): readonly string[] {
    const englishTotal = [...this.english.values()].reduce((sum, count) => sum + count, 0)
    const interpolate = (count: number, total: number, distinct: number, lower: number): number =>
      total === 0 ? lower : (total / (total + distinct)) * (count / total) + (distinct / (total + distinct)) * lower
    const table = (map: Map<string, Map<string, number>>, key: string | null): Map<string, number> | undefined =>
      key === null ? undefined : map.get(key)
    const sum = (counts: Map<string, number> | undefined): number => [...(counts?.values() ?? [])].reduce((a, b) => a + b, 0)
    const nearTable = table(this.near, near)
    const farTable = table(this.far, far)
    const englishNear = near === null ? undefined : this.englishNear.get(near)
    const score = (candidate: string): number => {
      const own = this.learned === 0 ? 0 : (this.words.get(candidate) ?? 0) / this.learned
      const background =
        englishTotal === 0
          ? 0
          : interpolate(
              englishNear?.counts.get(candidate) ?? 0,
              englishNear?.total ?? 0,
              englishNear?.distinct ?? 0,
              (this.english.get(candidate) ?? 0) / englishTotal,
            )
      const weight = this.learned / (this.learned + CONVERSATION_WEIGHT)
      const unigram = weight * own + (1 - weight) * background
      const bigram = interpolate(nearTable?.get(candidate) ?? 0, sum(nearTable), nearTable?.size ?? 0, unigram)
      return interpolate(farTable?.get(candidate) ?? 0, sum(farTable), farTable?.size ?? 0, bigram)
    }
    return [...new Set([...this.words.keys(), ...this.english.keys()])]
      .filter(candidate => candidate.startsWith(prefix) && candidate.length - prefix.length >= minGain)
      .map(candidate => ({ candidate, score: score(candidate), seen: this.seen.get(candidate) ?? 0, english: this.english.get(candidate) ?? 0 }))
      .sort((a, b) => b.score - a.score || b.seen - a.seen || b.english - a.english || (a.candidate < b.candidate ? -1 : 1))
      .slice(0, limit)
      .map(entry => entry.candidate)
  }
}

const bump = (table: Map<string, Map<string, number>>, key: string, found: string): void => {
  const counts = table.get(key) ?? new Map<string, number>()
  table.set(key, counts.set(found, (counts.get(found) ?? 0) + 1))
}

describe('the model, against scoring every word', () => {
  test('every certified match equals the slow ranking, and most matches are certified', { timeoutMs: 60_000 }, () => {
    const random = seeded(23)
    const pool = ['the', 'then', 'they', 'them', 'there', 'test', 'tests', 'testing', 'tea', 'team', 'to', 'top', 'toy', 'tone', 'tonal', 'ten', 'tent']
    const pick = (): string => pool[Math.floor(random() * random() * pool.length)] ?? 'the'
    const lexicon = new Lexicon()
    const reference = new Reference()
    const englishData: EnglishData = {
      words: pool.flatMap((text): readonly Counted[] => {
        const entry: Counted = [word(text.padEnd(3, 'x')), 1 + Math.floor(random() * 50)]
        return random() < 0.7 ? [entry] : []
      }),
      contexts: [{ context: context('the'), total: 90, distinct: 12, followers: [[word('team'), 20], [word('test'), 7]] }],
    }
    lexicon.seedEnglish(englishData)
    reference.seedEnglish(englishData)
    let certified = 0
    let shown = 0
    for (let turn = 0; turn < 40; turn += 1) {
      const text = Array.from({ length: 30 }, () => (random() < 0.1 ? `${pick()}.` : pick())).join(' ')
      lexicon.learn([prose(text)])
      reference.learn(text)
      for (let query = 0; query < 25; query += 1) {
        const draft = `${pick()} ${pick()} ${random() < 0.2 ? '' : pick().slice(0, 1 + Math.floor(random() * 2))}`
        const target = targetOf(draft, settings)
        if (target === null || (target.kind !== 'word' && target.kind !== 'next')) continue
        const limit = LIMITS[Math.floor(random() * 5)] ?? 5
        const minGain = GAINS[Math.floor(random() * GAINS.length)] ?? 1
        const ranking = lexicon.rank(target, limit, minGain)
        const expected = reference.rank(target.kind === 'word' ? target.prefix : '', target.context, target.context2, limit, minGain)
        const got = ranking.matches.map(match => match.word)
        expect(got.slice(0, ranking.certified)).toEqual(expected.slice(0, ranking.certified))
        certified += ranking.certified
        shown += got.length
      }
    }
    expect(certified / shown).toBeGreaterThan(0.5)
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
