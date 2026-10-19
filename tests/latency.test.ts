/**
 * Measures the per-keystroke work against the 13 ms target. Audience: contributors to cccomplete.
 *
 * What is measured: `detach` + `attach` against a large trie, which is every
 * step the plugin runs itself. What is not: the host's own edit and the
 * `$.state` round trips, which the plugin cannot make faster.
 */

import { describe, expect, test } from 'claude-code/testing'

import { attach, detach } from '../src/completion'
import type { EditShape } from '../src/completion'
import { DEFAULTS } from '../src/config'
import { parseDictionary, seedTrie } from '../src/dictionary'
import { CompletionTrie } from '../src/trie'
import { seeded, vocabulary, word } from './support'

/** The test environment has a `console`, but its type is not in the declared globals. */
declare const console: { log(message: string): void }

const BUDGET_MS = 13

const settings = { ...DEFAULTS, minPrefix: 1 } as const

type Corpus = Readonly<{ trie: CompletionTrie; pool: readonly string[] }>

let built: Corpus | null = null

/** Builds the 60,000-word trie once for the whole file, because building it costs more than any test. */
const largeTrie = (): Corpus => {
  if (built !== null) return built
  const random = seeded(42)
  const pool = vocabulary(random, 60_000)
  const trie = new CompletionTrie()
  for (let at = 0; at < 400_000; at += 1) {
    trie.insert(pool[Math.floor(random() * random() * pool.length)] ?? word('fallback'))
  }
  built = { trie, pool }
  return built
}

const percentile = (sorted: readonly number[], fraction: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0

describe('latency', () => {
  test('one keystroke stays far under the budget on a 60,000-word trie', { timeoutMs: 60_000 }, () => {
    const { trie, pool } = largeTrie()
    const random = seeded(9)
    const samples: number[] = []
    for (let at = 0; at < 20_000; at += 1) {
      const source = pool[Math.floor(random() * pool.length)] ?? 'fallback'
      const typed = source.slice(0, 1 + Math.floor(random() * (source.length - 1)))
      const edit: EditShape = { text: typed, cursor: typed.length, start: typed.length, end: typed.length, inputText: '' }
      const started = performance.now()
      const clean = detach(edit, null)
      attach({ text: clean.text, cursor: clean.cursor }, trie, settings)
      samples.push(performance.now() - started)
    }
    samples.sort((a, b) => a - b)
    const mean = samples.reduce((sum, ms) => sum + ms, 0) / samples.length
    console.log(
      `${trie.size} words; keystroke: mean ${mean.toFixed(4)} ms, p50 ${percentile(samples, 0.5).toFixed(4)}, p99 ${percentile(samples, 0.99).toFixed(4)}, max ${percentile(samples, 1).toFixed(4)}`,
    )
    expect(percentile(samples, 0.99)).toBeLessThan(BUDGET_MS)
    expect(mean).toBeLessThan(1)
  })

  test('a one-letter prefix costs the same as a long one, because no subtree is walked', { timeoutMs: 60_000 }, () => {
    const { trie } = largeTrie()
    const time = (text: string): number => {
      const started = performance.now()
      for (let at = 0; at < 5000; at += 1) attach({ text, cursor: text.length }, trie, settings)
      return (performance.now() - started) / 5000
    }
    const short = time('t')
    const long = time('testing')
    console.log(`one letter: ${short.toFixed(5)} ms; seven letters: ${long.toFixed(5)} ms`)
    expect(short).toBeLessThan(BUDGET_MS)
    expect(long).toBeLessThan(BUDGET_MS)
  })

  test('a 200,000-character paste before the word does not slow the next keystroke', { timeoutMs: 60_000 }, () => {
    const { trie } = largeTrie()
    const text = `${'lorem ipsum '.repeat(16_667)}te`
    const started = performance.now()
    const clean = detach({ text, cursor: text.length, start: text.length, end: text.length, inputText: '' }, null)
    attach({ text: clean.text, cursor: clean.cursor }, trie, settings)
    const elapsed = performance.now() - started
    console.log(`${text.length} characters: ${elapsed.toFixed(4)} ms`)
    expect(elapsed).toBeLessThan(BUDGET_MS)
  })

  test('folding a finished chat turn into the trie takes well under a second', { timeoutMs: 60_000 }, () => {
    const { trie } = largeTrie()
    const turn = 'the quick brown fox jumps over the lazy dog while the trie learns every word. '.repeat(400)
    const started = performance.now()
    const recorded = trie.ingest(turn)
    const elapsed = performance.now() - started
    console.log(`ingested ${recorded} words (${turn.length} characters) in ${elapsed.toFixed(2)} ms`)
    expect(elapsed).toBeLessThan(1000)
  })
  test('loading a 47,000-word dictionary at session start takes well under a second', { timeoutMs: 60_000 }, () => {
    const text = `# header\n${vocabulary(seeded(5), 47_000).join('\n')}\n`
    const started = performance.now()
    const trie = new CompletionTrie()
    const added = seedTrie(trie, parseDictionary(text))
    const elapsed = performance.now() - started
    console.log(`dictionary: parsed and seeded ${added} words in ${elapsed.toFixed(1)} ms`)
    expect(trie.size).toBe(added)
    expect(elapsed).toBeLessThan(1000)
  })
})
