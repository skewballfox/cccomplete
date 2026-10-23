/**
 * Builds `data/english.tsv`, the bundled English word and word-pair counts, from Tatoeba sentences.
 *
 * Audience: contributors who rebuild the bundled English model. Not covered:
 * how the plugin ranks with it (see docs/ALGORITHM.md) or where the source
 * comes from (see docs/DICTIONARY.md).
 *
 * It runs on the developer's machine, never in the plugin:
 * `node scripts/build-english.ts <sentences.tsv> <export date> [out]`, the date as on the download (`2026-10-17`).
 * Node 23.6 or later runs the TypeScript directly. It imports the plugin's own
 * tokenizer, so the counts follow the same word and context rules as the index.
 */

import { readFileSync, writeFileSync } from 'node:fs'

import { pairsOf } from '../src/words.ts'

/** Words seen fewer times are left out: most are names and typos. */
const MIN_WORD_COUNT = 2

/** How many contexts keep their followers, commonest first. */
const MAX_CONTEXTS = 3000

/** How many followers each context keeps, commonest first. */
const MAX_FOLLOWERS = 60

/** Followers seen fewer times after a context are left out. */
const MIN_PAIR_COUNT = 2

const [input, exportDate, output = 'data/english.tsv'] = process.argv.slice(2)
if (input === undefined || exportDate === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(exportDate)) {
  throw new Error('usage: node scripts/build-english.ts <eng_sentences_CC0.tsv> <export date, YYYY-MM-DD> [out]')
}

const words = new Map<string, number>()
const follows = new Map<string, Map<string, number>>()
let sentences = 0

// Each line of a Tatoeba export is: id, language, sentence text, and in newer exports a date.
for (const line of readFileSync(input, 'utf8').split('\n')) {
  const text = line.split('\t')[2]
  if (text === undefined || text === '') continue
  sentences += 1
  for (const { word, context } of pairsOf(text, 'prose', false)) {
    words.set(word, (words.get(word) ?? 0) + 1)
    if (context === null) continue
    const after = follows.get(context) ?? new Map<string, number>()
    follows.set(context, after.set(word, (after.get(word) ?? 0) + 1))
  }
}

const byCount = <Key>(a: [Key, number], b: [Key, number]): number => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))
const sum = (counts: Map<string, number>): number => [...counts.values()].reduce((total, count) => total + count, 0)

const keptWords = [...words].filter(([, count]) => count >= MIN_WORD_COUNT).sort(byCount)
const kept = new Set(keptWords.map(([word]) => word))
const contexts = [...follows]
  .map(([context, after]): [string, Map<string, number>, number] => [context, after, sum(after)])
  .sort((a, b) => b[2] - a[2] || a[0].localeCompare(b[0]))
  .slice(0, MAX_CONTEXTS)

// A context keeps its true total and distinct count, which the smoothing weight needs, even after its followers are pruned.
const pairLines = contexts.flatMap(([context, after, total]) => {
  const top = [...after].filter(([word, count]) => count >= MIN_PAIR_COUNT && kept.has(word)).sort(byCount).slice(0, MAX_FOLLOWERS)
  return top.length === 0 ? [] : [`p\t${context}\t${total}\t${after.size}\t${top.flat().join(' ')}`]
})

const header = [
  '# cccomplete bundled English model',
  `# Source: Tatoeba English sentences, CC0 subset (eng_sentences_CC0.tsv), export of ${exportDate}, https://tatoeba.org`,
  '# Licence: CC0 1.0 Universal (public domain dedication). See docs/DICTIONARY.md.',
  `# Built by scripts/build-english.ts from ${sentences} sentences: words seen at least ${MIN_WORD_COUNT} times; the ${MAX_CONTEXTS} commonest contexts, each with up to ${MAX_FOLLOWERS} followers seen at least ${MIN_PAIR_COUNT} times.`,
  '# Format: w<TAB>word<TAB>count, commonest first; then p<TAB>context<TAB>total<TAB>distinct<TAB>word count word count ...',
]
writeFileSync(output, [...header, ...keptWords.map(([word, count]) => `w\t${word}\t${count}`), ...pairLines, ''].join('\n'))
console.log(`${sentences} sentences: ${keptWords.length} words, ${pairLines.length} contexts, ${contexts.length} considered`)
