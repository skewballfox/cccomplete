/**
 * The index the user meets: every trie the plugin keeps, and the order in which a lookup consults them.
 *
 * Audience: contributors to cccomplete. The ranking argument is in docs/ALGORITHM.md.
 *
 * A lookup asks up to three tries for their best matches and takes them in
 * tier order: words seen after the same context first, then words from recent
 * turns, then every word. Each trie's list is exact (see trie.ts), and tier
 * order is fixed, so the merged list is exact too.
 */

import type { Completion, Context, SuggestionLimit, Word } from '../types'
import { seedTrie } from './dictionary'
import type { Target } from './draft'
import type { Feed } from './feeds'
import { CompletionTrie } from './trie'
import { markdownCodeOf, pairsOf, toWord } from './words'
import type { Charset, Pair } from './words'

/** How many turns the recent tier covers, at least. It covers up to twice as many before it is rebuilt. */
export const RECENT_TURNS = 8

/** Most uses of one command counted, so a stored count cannot make a rebuild slow. */
export const MAX_COMMAND_USES = 1000

/** The narrow view the editing code needs of the index, so tests can substitute a fake. */
export type Completer = {
  lookup(target: Target, limit: SuggestionLimit): readonly Completion[]
}

/** How many words each part of the index holds, for the status command. */
export type LexiconSize = Readonly<{
  words: number
  contexts: number
  recent: number
  code: number
  shell: number
  commands: number
}>

/** One language's words, and for each context the words seen after it. */
class Vocabulary {
  readonly words = new CompletionTrie()
  readonly #follows = new Map<Context, CompletionTrie>()

  get contexts(): number {
    return this.#follows.size
  }

  learn(pair: Pair): void {
    this.words.insert(pair.word)
    if (pair.context === null) return
    const known = this.#follows.get(pair.context)
    const trie = known ?? new CompletionTrie()
    if (known === undefined) this.#follows.set(pair.context, trie)
    trie.insert(pair.word)
  }

  after(context: Context | null): CompletionTrie | undefined {
    return context === null ? undefined : this.#follows.get(context)
  }
}

const NONE: readonly Completion[] = []

/**
 * Concatenates ranked lists in tier order, drops later copies of a word, and stops at `limit`.
 *
 * Exact when each list holds its tier's best `limit` matches: a copy removed
 * from a later tier is a word already taken, so the later tier still has
 * enough distinct words to fill the gap. A loop, because this is the
 * keystroke path and the lists hold at most 9 entries each.
 */
export const mergeTiers = (tiers: readonly (readonly Completion[])[], limit: SuggestionLimit): readonly Completion[] => {
  const merged: Completion[] = []
  for (const tier of tiers) {
    for (const match of tier) {
      if (merged.length === limit) return merged
      if (!merged.some(taken => taken.word === match.word)) merged.push(match)
    }
  }
  return merged
}

/**
 * Every index the plugin keeps: prose, recent prose, code, shell and slash commands.
 *
 * It changes only through `seed`, `learn` and `setCommands`, which the hooks
 * module calls at session start and after a turn, never on a keystroke.
 */
export class Lexicon implements Completer {
  readonly #prose = new Vocabulary()
  #recent = new CompletionTrie()
  #turns: readonly string[] = []
  #turnsSinceRebuild = 0
  readonly #code = new CompletionTrie()
  readonly #shell = new Vocabulary()
  #commands = new CompletionTrie()

  get size(): LexiconSize {
    return {
      words: this.#prose.words.size,
      contexts: this.#prose.contexts,
      recent: this.#recent.size,
      code: this.#code.size,
      shell: this.#shell.words.size,
      commands: this.#commands.size,
    }
  }

  /**
   * Adds dictionary words to the prose index so that earlier words rank higher, and returns how many it added.
   *
   * Each word enters once, last word first, so every word the user meets in the
   * conversation outranks it. Call it before `learn`.
   */
  seed(words: readonly Word[]): number {
    return seedTrie(this.#prose.words, words)
  }

  /** Learns one turn's feeds and returns how many word occurrences it recorded. */
  learn(turn: readonly Feed[]): number {
    const counts = turn.map(feed => this.#learnFeed(feed))
    const prose = turn.filter(feed => feed.kind === 'prose').map(feed => feed.text)
    this.#remember(prose.join('\n'))
    return counts.reduce((sum, count) => sum + count, 0)
  }

  /**
   * Replaces the slash-command index: `names` in the order the host lists them, ranked by `uses`.
   *
   * A command used more often ranks higher; among equal uses, the host's order wins.
   * A name that is not a word under the code rules is left out, because the
   * host's own menu serves it.
   */
  setCommands(names: readonly string[], uses: Readonly<Record<string, number>>): number {
    const trie = new CompletionTrie()
    const words = names.flatMap(name => {
      const word = toWord(name)
      return word === null ? [] : [word]
    })
    // Loops on purpose: the host's last command enters first, so the first ranks highest among equal uses.
    for (let at = words.length - 1; at >= 0; at -= 1) {
      const word = words[at]
      if (word !== undefined) trie.insert(word)
    }
    for (const word of words) {
      const count = Math.min(uses[word] ?? 0, MAX_COMMAND_USES)
      for (let use = 0; use < count; use += 1) trie.insert(word)
    }
    this.#commands = trie
    return trie.size
  }

  /**
   * Returns up to `limit` matches for `target`, best first.
   *
   * Cost: at most three trie lookups and one merge of their short lists. It never walks a subtree.
   */
  lookup(target: Target, limit: SuggestionLimit): readonly Completion[] {
    switch (target.kind) {
      case 'command':
        return this.#commands.complete(target.prefix, limit)
      case 'code':
        return this.#code.complete(target.prefix, limit)
      case 'next':
        return this.#vocabulary(target.language).after(target.context)?.complete(null, limit) ?? NONE
      case 'word': {
        const vocabulary = this.#vocabulary(target.language)
        const after = vocabulary.after(target.context)?.complete(target.prefix, limit) ?? NONE
        const recent = target.language === 'prose' ? this.#recent.complete(target.prefix, limit) : NONE
        return mergeTiers([after, recent, vocabulary.words.complete(target.prefix, limit)], limit)
      }
    }
  }

  #vocabulary(language: 'prose' | 'shell'): Vocabulary {
    return language === 'prose' ? this.#prose : this.#shell
  }

  #learnFeed(feed: Feed): number {
    switch (feed.kind) {
      case 'prose':
        return this.#learnPairs(this.#prose, feed.text, 'prose', false) + this.#learnCode(markdownCodeOf(feed.text))
      case 'code':
        return this.#learnCode(this.#codeWords(feed.text))
      case 'shell':
        return this.#learnPairs(this.#shell, feed.text, 'code', true)
    }
  }

  *#codeWords(text: string): Generator<Word, void, undefined> {
    for (const pair of pairsOf(text, 'code', false)) yield pair.word
  }

  #learnPairs(vocabulary: Vocabulary, text: string, charset: Charset, commands: boolean): number {
    let recorded = 0
    for (const pair of pairsOf(text, charset, commands)) {
      vocabulary.learn(pair)
      recorded += 1
    }
    return recorded
  }

  #learnCode(words: Iterable<Word>): number {
    let recorded = 0
    for (const word of words) {
      this.#code.insert(word)
      recorded += 1
    }
    return recorded
  }

  /**
   * Adds a turn's prose to the recent tier.
   *
   * Every {@link RECENT_TURNS} turns the tier is rebuilt from the last
   * {@link RECENT_TURNS} turns, so it covers between 8 and 15 turns. A rebuild
   * starts a new trie, so ranks inside it still only rise.
   */
  #remember(text: string): void {
    this.#turns = [...this.#turns, text].slice(-RECENT_TURNS)
    this.#turnsSinceRebuild += 1
    if (this.#turnsSinceRebuild < RECENT_TURNS) {
      this.#recent.ingest(text)
      return
    }
    const rebuilt = new CompletionTrie()
    this.#turns.forEach(turn => rebuilt.ingest(turn))
    this.#recent = rebuilt
    this.#turnsSinceRebuild = 0
  }
}

/**
 * Reads the stored command counts, keeping only whole counts from 1 to {@link MAX_COMMAND_USES}.
 *
 * The value comes from `$.store`, which any version of the plugin may have
 * written, so anything else in it is dropped rather than trusted.
 */
export const parseCommandUses = (raw: unknown): Readonly<Record<string, number>> =>
  typeof raw !== 'object' || raw === null || Array.isArray(raw)
    ? {}
    : Object.fromEntries(
        Object.entries(raw).filter(
          ([, count]) => typeof count === 'number' && Number.isInteger(count) && count >= 1 && count <= MAX_COMMAND_USES,
        ),
      )

/** The counts with one more use of `name`, capped at {@link MAX_COMMAND_USES}. */
export const countUse = (uses: Readonly<Record<string, number>>, name: string): Readonly<Record<string, number>> => ({
  ...uses,
  [name]: Math.min((uses[name] ?? 0) + 1, MAX_COMMAND_USES),
})

/** One plain sentence for the status command. */
export const describeSize = (size: LexiconSize): string =>
  `words indexed: ${size.words} (${size.contexts} contexts, ${size.recent} recent); code: ${size.code}; shell: ${size.shell}; commands: ${size.commands}`
