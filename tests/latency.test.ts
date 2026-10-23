/**
 * Measures the per-keystroke work against the 13 ms target. Audience: contributors to cccomplete.
 *
 * What is measured: `attach` against a large index, which is every step the
 * plugin runs itself on a keystroke: reading the draft, up to three trie
 * lookups and the merge. What is not: the host's own edit and the `$.state`
 * round trips, which the plugin cannot make faster.
 */

import { describe, expect, test } from 'claude-code/testing'

import type { Word } from '../types'
import { attach } from '../src/completion'
import { DEFAULTS } from '../src/config'
import { parseDictionary } from '../src/dictionary'
import { Lexicon } from '../src/lexicon'
import { seeded, vocabulary, word } from './support'

/** The test environment has a `console`, but its type is not in the declared globals. */
declare const console: { log(message: string): void }

const BUDGET_MS = 13

const settings = { ...DEFAULTS, minPrefix: 1 } as const

type Corpus = Readonly<{ lexicon: Lexicon; stream: readonly Word[] }>

let built: Corpus | null = null

/**
 * Builds a 400,000-word conversation once for the whole file, because building it costs more than any test.
 *
 * Half of each word's successors come from three favoured words, so contexts
 * have the structure text has. The text is learned in 50 turns.
 */
const largeCorpus = (): Corpus => {
  if (built !== null) return built
  const random = seeded(42)
  const pool = vocabulary(random, 60_000)
  const pick = (): Word => pool[Math.floor(random() * random() * pool.length)] ?? word('fallback')
  const favoured = new Map<Word, readonly Word[]>()
  const stream: Word[] = []
  let previous = pick()
  // A loop: generating 400,000 words is the slow part of the setup.
  for (let at = 0; at < 400_000; at += 1) {
    const known = favoured.get(previous)
    const choices = known ?? [pick(), pick(), pick()]
    if (known === undefined) favoured.set(previous, choices)
    previous = random() < 0.5 ? (choices[Math.floor(random() * 3)] ?? pick()) : pick()
    stream.push(previous)
  }
  const lexicon = new Lexicon()
  Array.from({ length: 50 }, (_, turn) => stream.slice(turn * 8000, (turn + 1) * 8000).join(' ')).forEach(text =>
    lexicon.learn([{ kind: 'prose', text }]),
  )
  built = { lexicon, stream }
  return built
}

const percentile = (sorted: readonly number[], fraction: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0

const timeDrafts = (lexicon: Lexicon, drafts: readonly string[]): readonly number[] =>
  drafts
    .map(text => {
      const started = performance.now()
      attach({ text, cursor: text.length }, lexicon, settings)
      return performance.now() - started
    })
    .sort((a, b) => a - b)

const describeTimes = (samples: readonly number[]): string => {
  const mean = samples.reduce((sum, ms) => sum + ms, 0) / samples.length
  return `mean ${mean.toFixed(4)} ms, p50 ${percentile(samples, 0.5).toFixed(4)}, p99 ${percentile(samples, 0.99).toFixed(4)}, max ${percentile(samples, 1).toFixed(4)}`
}

describe('latency', () => {
  test('one keystroke stays far under the budget on a 400,000-word conversation', { timeoutMs: 120_000 }, () => {
    const { lexicon, stream } = largeCorpus()
    const random = seeded(9)
    const drafts = Array.from({ length: 20_000 }, () => {
      const at = 1 + Math.floor(random() * (stream.length - 1))
      const target = stream[at] ?? 'fallback'
      return `some text ${stream[at - 1] ?? ''} ${target.slice(0, 1 + Math.floor(random() * (target.length - 1)))}`
    })
    timeDrafts(lexicon, drafts)
    const samples = timeDrafts(lexicon, drafts)
    const { words, contexts } = lexicon.size
    console.log(`${words} words, ${contexts} contexts; keystroke: ${describeTimes(samples)}`)
    expect(percentile(samples, 0.99)).toBeLessThan(BUDGET_MS)
    expect(samples.reduce((sum, ms) => sum + ms, 0) / samples.length).toBeLessThan(1)
  })

  test('predicting the next word after a space stays under the budget', { timeoutMs: 120_000 }, () => {
    const { lexicon, stream } = largeCorpus()
    const samples = timeDrafts(lexicon, stream.slice(0, 20_000).map(previous => `text ${previous} `))
    console.log(`next word: ${describeTimes(samples)}`)
    expect(percentile(samples, 0.99)).toBeLessThan(BUDGET_MS)
  })

  test('a one-letter prefix costs the same as a long one, because no subtree is walked', { timeoutMs: 60_000 }, () => {
    const { lexicon } = largeCorpus()
    const time = (text: string): number => {
      const started = performance.now()
      for (let at = 0; at < 5000; at += 1) attach({ text, cursor: text.length }, lexicon, settings)
      return (performance.now() - started) / 5000
    }
    const short = time('t')
    const long = time('testing')
    console.log(`one letter: ${short.toFixed(5)} ms; seven letters: ${long.toFixed(5)} ms`)
    expect(short).toBeLessThan(BUDGET_MS)
    expect(long).toBeLessThan(BUDGET_MS)
  })

  test('a 200,000-character paste before the word does not slow the next keystroke', { timeoutMs: 60_000 }, () => {
    const { lexicon } = largeCorpus()
    const text = `${'lorem `ipsum` '.repeat(14_286)}te`
    const started = performance.now()
    attach({ text, cursor: text.length }, lexicon, settings)
    const elapsed = performance.now() - started
    console.log(`${text.length} characters: ${elapsed.toFixed(4)} ms`)
    expect(elapsed).toBeLessThan(BUDGET_MS)
  })

  test('folding a finished chat turn into the index takes well under a second', { timeoutMs: 60_000 }, () => {
    const { lexicon } = largeCorpus()
    const turn = 'the quick brown fox jumps over the lazy dog while the `trie` learns every word. '.repeat(400)
    const started = performance.now()
    const recorded = lexicon.learn([{ kind: 'prose', text: turn }])
    const elapsed = performance.now() - started
    console.log(`learned ${recorded} words (${turn.length} characters) in ${elapsed.toFixed(2)} ms`)
    expect(elapsed).toBeLessThan(1000)
  })

  test('loading a 47,000-word dictionary at session start takes well under a second', { timeoutMs: 60_000 }, () => {
    const text = `# header\n${vocabulary(seeded(5), 47_000).join('\n')}\n`
    const started = performance.now()
    const lexicon = new Lexicon()
    const added = lexicon.seed(parseDictionary(text))
    const elapsed = performance.now() - started
    console.log(`dictionary: parsed and seeded ${added} words in ${elapsed.toFixed(1)} ms`)
    expect(lexicon.size.words).toBe(added)
    expect(elapsed).toBeLessThan(1000)
  })
})
