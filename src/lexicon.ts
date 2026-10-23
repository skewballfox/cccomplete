/**
 * The index the user meets: every trie the plugin keeps, and the model that ranks prose and shell words.
 *
 * Audience: contributors to cccomplete. The model and its bound are argued in docs/ALGORITHM.md.
 *
 * Prose and shell words rank by an estimate of how likely each word is after
 * the one or two runs before it: a Witten–Bell interpolated trigram over the
 * conversation, whose lowest level, for prose, is the bundled English model.
 * A keystroke scores only the words in a few stored top lists, never the whole
 * vocabulary, and reports how many of its results provably equal a full scan.
 */

import type { Completion, Context, Gain, Prefix, SuggestionLimit, Word } from '../types'
import { seedTrie } from './dictionary'
import type { Target } from './draft'
import type { EnglishData } from './english'
import type { Feed } from './feeds'
import { CompletionTrie } from './trie'
import type { Ranked } from './trie'
import { markdownCodeOf, pairsOf, toWord } from './words'
import type { Charset, Pair } from './words'

/** Most uses of one command counted, so a stored count cannot make a rebuild slow. */
export const MAX_COMMAND_USES = 1000

/**
 * How many conversation words weigh as much as the English model.
 *
 * With `n` words learned, the conversation's own word frequencies get the
 * weight `n / (n + CONVERSATION_WEIGHT)` and the English model the rest. 500
 * scored best of 100, 500 and 3,000 in a replay of 15 sessions (2026-10-22).
 */
export const CONVERSATION_WEIGHT = 500

/** How many words each stored list gives the scorer: the most a lookup can ask for. */
const LIST: SuggestionLimit = 9

/** The narrow view the editing code needs of the index, so tests can substitute a fake. */
export type Completer = {
  rank(target: Target, limit: SuggestionLimit, minGain: Gain): Ranking
}

/**
 * A ranked answer: the matches, best first, and how many of the first ones are certified.
 *
 * A certified match scores above every word the stored lists left out, so the
 * first `certified` matches equal what scoring every stored word would give.
 */
export type Ranking = Readonly<{ matches: readonly Completion[]; certified: number }>

/** How many words each part of the index holds, for the status command. */
export type LexiconSize = Readonly<{
  words: number
  contexts: number
  english: number
  englishContexts: number
  code: number
  shell: number
  commands: number
}>

/** A context table: for each context, the words seen after it. */
type Follows = Map<Context, CompletionTrie>

/** One language learned from the conversation: every word, and the words after each one-run and two-run context. */
class Vocabulary {
  readonly words = new CompletionTrie()
  readonly near: Follows = new Map()
  readonly far: Follows = new Map()

  learn(pair: Pair): void {
    this.words.insert(pair.word)
    if (pair.context !== null) followers(this.near, pair.context).insert(pair.word)
    if (pair.context2 !== null) followers(this.far, pair.context2).insert(pair.word)
  }
}

/** The trie of words after `context`, made empty the first time. */
const followers = (table: Follows, context: Context): CompletionTrie => {
  const known = table.get(context)
  if (known !== undefined) return known
  const made = new CompletionTrie()
  table.set(context, made)
  return made
}

/** One English context: its followers, and its true total and distinct count before the file was pruned. */
type BackgroundContext = Readonly<{ trie: CompletionTrie; total: number; distinct: number }>

/** The English model and the dictionary words: the prose model's lowest level. */
class Background {
  readonly words = new CompletionTrie()
  readonly near = new Map<Context, BackgroundContext>()
}

/** The counts one word has in each table a score reads. A table that is absent counts zero. */
type Counts = Readonly<{ word: number; near: number; far: number; english: number; englishNear: number }>

/** The tables a score reads for one lookup, found once per keystroke. */
type Tables = Readonly<{
  vocabulary: Vocabulary
  near: CompletionTrie | undefined
  far: CompletionTrie | undefined
  english: Background | null
  englishNear: BackgroundContext | undefined
}>

/** Witten–Bell interpolation: trust a context in proportion to how often it occurred against how many different words followed it. */
const interpolate = (count: number, total: number, distinct: number, lower: number): number => {
  if (total === 0) return lower
  const weight = total / (total + distinct)
  return (weight * count) / total + (1 - weight) * lower
}

/**
 * Scores one word from its counts: the estimated probability that it comes next.
 *
 * Every weight is fixed for one lookup and none is negative, so the score
 * rises with each count. The bound in `rank` depends on that.
 */
const score = (tables: Tables, counts: Counts): number => {
  const learned = tables.vocabulary.words.total
  const own = learned === 0 ? 0 : counts.word / learned
  // An empty English model (turned off, or its file missing) gives the conversation the whole weight.
  const english = tables.english === null || tables.english.words.total === 0 ? null : tables.english
  const background =
    english === null
      ? 0
      : interpolate(
          counts.englishNear,
          tables.englishNear?.total ?? 0,
          tables.englishNear?.distinct ?? 0,
          counts.english / english.words.total,
        )
  const ownWeight = english === null ? 1 : learned / (learned + CONVERSATION_WEIGHT)
  const unigram = ownWeight * own + (1 - ownWeight) * background
  const bigram = interpolate(counts.near, tables.near?.total ?? 0, tables.near?.size ?? 0, unigram)
  return interpolate(counts.far, tables.far?.total ?? 0, tables.far?.size ?? 0, bigram)
}

const countIn = (trie: CompletionTrie | undefined, word: Word): number => trie?.entry(word)?.count ?? 0

/** The largest count a word outside `list` can have in its trie: the last count when the list is full, else zero. */
const ceiling = (list: readonly Ranked[]): number => (list.length === LIST ? (list[LIST - 1]?.count ?? 0) : 0)

/** One candidate with what orders it: its score, then the recency of its last use, then its English count. */
type Scored = Readonly<{ word: Word; score: number; seen: number; english: number }>

/** Orders candidates best first: by score, then recency, then English count. The word itself breaks the last tie, so the order is total. */
const byRank = (a: Scored, b: Scored): number =>
  b.score - a.score || b.seen - a.seen || b.english - a.english || (a.word < b.word ? -1 : a.word > b.word ? 1 : 0)

/**
 * Ranks the words of a few stored lists by `score`, and certifies the leading ones.
 *
 * Each list is a trie's best words for the prefix, by that trie's count. A
 * word in none of the lists has, in each trie, a count at most the list's
 * ceiling, so its score is at most the score of those ceilings. Each result
 * that scores above that bound is certified.
 *
 * A match must add at least `minGain` letters. The filter drops candidates
 * after the lists are read, so the bound still sees every word a list left out.
 *
 * Cost: at most five lists of nine words, five count lookups per word, and a
 * sort of at most 45 entries. It never walks a subtree.
 */
const rank = (tables: Tables, prefix: Prefix | null, limit: SuggestionLimit, minGain: Gain): Ranking => {
  const sources = [
    tables.far,
    tables.near,
    tables.vocabulary.words,
    tables.englishNear?.trie,
    tables.english?.words,
  ]
  const lists = sources.map(trie => trie?.ranked(prefix, LIST) ?? [])
  const [farList = [], nearList = [], wordList = [], englishNearList = [], englishList = []] = lists
  const bound = score(tables, {
    word: ceiling(wordList),
    near: ceiling(nearList),
    far: ceiling(farList),
    english: ceiling(englishList),
    englishNear: ceiling(englishNearList),
  })
  const typed = prefix?.length ?? 0
  const candidates = [...new Set(lists.flatMap(list => list.map(entry => entry.word)))].filter(
    candidate => candidate.length - typed >= minGain,
  )
  const scored = candidates
    .map((word): Scored => {
      const english = countIn(tables.english?.words, word)
      const counts = {
        word: countIn(tables.vocabulary.words, word),
        near: countIn(tables.near, word),
        far: countIn(tables.far, word),
        english,
        englishNear: countIn(tables.englishNear?.trie, word),
      }
      return { word, score: score(tables, counts), seen: tables.vocabulary.words.entry(word)?.seen ?? 0, english }
    })
    .sort(byRank)
    .slice(0, limit)
  const uncertified = scored.findIndex(entry => entry.score <= bound)
  return {
    matches: scored.map(entry => ({ word: entry.word, suffix: entry.word.slice(typed) })),
    certified: uncertified === -1 ? scored.length : uncertified,
  }
}

const NONE: Ranking = { matches: [], certified: 0 }

/**
 * Every index the plugin keeps: prose, the English model, code, shell and slash commands.
 *
 * It changes only through `seed`, `seedEnglish`, `learn` and `setCommands`,
 * which the hooks module calls at session start and after a turn, never on a keystroke.
 */
export class Lexicon implements Completer {
  readonly #prose = new Vocabulary()
  readonly #english = new Background()
  readonly #code = new CompletionTrie()
  readonly #shell = new Vocabulary()
  #commands = new CompletionTrie()

  get size(): LexiconSize {
    return {
      words: this.#prose.words.size,
      contexts: this.#prose.near.size + this.#prose.far.size,
      english: this.#english.words.size,
      englishContexts: this.#english.near.size,
      code: this.#code.size,
      shell: this.#shell.words.size,
      commands: this.#commands.size,
    }
  }

  /**
   * Adds dictionary words to the English model's words, each once, so that earlier words rank higher, and returns how many it added.
   *
   * Call it before `seedEnglish`, so a word the English counts also hold ranks by those counts.
   */
  seed(words: readonly Word[]): number {
    return seedTrie(this.#english.words, words)
  }

  /** Adds the bundled English counts to the English model and returns how many words it holds after. */
  seedEnglish(data: EnglishData): number {
    data.words.forEach(([word, count]) => this.#english.words.insert(word, count))
    data.contexts.forEach(({ context, total, distinct, followers: counted }) => {
      const trie = new CompletionTrie()
      counted.forEach(([word, count]) => trie.insert(word, count))
      this.#english.near.set(context, { trie, total, distinct })
    })
    return this.#english.words.size
  }

  /** Learns one turn's feeds and returns how many word occurrences it recorded. */
  learn(turn: readonly Feed[]): number {
    return turn.map(feed => this.#learnFeed(feed)).reduce((sum, count) => sum + count, 0)
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
    // A loop on purpose: the host's last command enters first, so the first ranks highest among equal uses.
    for (let at = words.length - 1; at >= 0; at -= 1) {
      const word = words[at]
      if (word !== undefined) trie.insert(word, 1 + Math.min(uses[word] ?? 0, MAX_COMMAND_USES))
    }
    this.#commands = trie
    return trie.size
  }

  /** Returns up to `limit` matches for `target`, best first, each adding at least `minGain` letters. */
  lookup(target: Target, limit: SuggestionLimit, minGain: Gain = 1): readonly Completion[] {
    return this.rank(target, limit, minGain).matches
  }

  /**
   * Returns up to `limit` matches for `target`, best first, each adding at least `minGain` letters, with how many are certified.
   *
   * Code and command lookups read one exact list, so all their matches are
   * certified. The gain filter can leave such a list with fewer than `limit`
   * matches, because it reads only the stored best words.
   */
  rank(target: Target, limit: SuggestionLimit, minGain: Gain): Ranking {
    switch (target.kind) {
      case 'command':
        return exact(gained(this.#commands.complete(target.prefix, LIST), minGain).slice(0, limit))
      case 'code':
        return exact(gained(this.#code.complete(target.prefix, LIST), minGain).slice(0, limit))
      case 'next': {
        // A guess after every space would be noise: predict only after a word with known followers.
        const tables = this.#tables(target.language, target.context, target.context2)
        return tables.near === undefined && tables.englishNear === undefined ? NONE : rank(tables, null, limit, minGain)
      }
      case 'word': {
        const ranking = rank(this.#tables(target.language, target.context, target.context2), target.prefix, limit, minGain)
        return ranking.matches.length === 0 ? NONE : ranking
      }
    }
  }

  #tables(language: 'prose' | 'shell', context: Context | null, context2: Context | null): Tables {
    const vocabulary = language === 'prose' ? this.#prose : this.#shell
    const english = language === 'prose' ? this.#english : null
    return {
      vocabulary,
      near: context === null ? undefined : vocabulary.near.get(context),
      far: context2 === null ? undefined : vocabulary.far.get(context2),
      english,
      englishNear: context === null || english === null ? undefined : english.near.get(context),
    }
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
}

const exact = (matches: readonly Completion[]): Ranking => ({ matches, certified: matches.length })

/** The matches that add at least `minGain` letters. */
const gained = (matches: readonly Completion[], minGain: Gain): readonly Completion[] =>
  matches.filter(match => match.suffix.length >= minGain)

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
  `words indexed: ${size.words} (${size.contexts} contexts); English: ${size.english} words, ${size.englishContexts} contexts; code: ${size.code}; shell: ${size.shell}; commands: ${size.commands}`
