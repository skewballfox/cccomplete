/**
 * A radix trie that keeps the best completions at every node.
 *
 * Audience: contributors to cccomplete. The reasoning behind the choice of
 * algorithm, and the alternatives it beat, is in docs/ALGORITHM.md. This file
 * states what each function takes and returns, and its cost.
 *
 * Ranking: a word ranks higher with a higher count; among equal counts, the
 * word seen more recently ranks higher. Every occurrence gets a fresh,
 * strictly increasing tick, so no two words ever tie and the order is total.
 */

import type { Completion, Prefix, SuggestionLimit, Tick, Word } from '../types'
import { wordsOf } from './words'

/**
 * Completions kept at each node. One more than the largest {@link SuggestionLimit},
 * because the prefix may itself be a word and takes a slot that a lookup then drops.
 */
export const TOP_CAPACITY = 10

/** A stored word with its rank inputs. One object per word, shared by every `top` list that holds it. */
type Entry = {
  readonly word: Word
  count: number
  seen: Tick
}

type Node = {
  /** The characters on the edge from the parent. Empty only at the root. */
  edge: string
  /** `edge.charCodeAt(0)`, cached for the child search. */
  first: number
  children: Node[]
  /** The word that ends exactly at this node, if one does. */
  end: Entry | null
  /** The best words in this node's subtree, best first, at most {@link TOP_CAPACITY}. */
  top: Entry[]
}

const NO_COMPLETIONS: readonly Completion[] = []

/** A stored word with its count and the tick of its latest occurrence, as a lookup reads it. */
export type Ranked = Readonly<{ word: Word; count: number; seen: Tick }>

const NO_RANKED: readonly Ranked[] = []

const makeNode = (edge: string, children: Node[]): Node => ({
  edge,
  first: edge.length === 0 ? -1 : edge.charCodeAt(0),
  children,
  end: null,
  top: [],
})

/** True when `a` ranks above `b`. Ticks are unique, so equal ranks cannot occur between two words. */
const outranks = (a: Entry, b: Entry): boolean =>
  a.count > b.count || (a.count === b.count && a.seen > b.seen)

const findChild = (node: Node, code: number): Node | undefined => {
  for (const child of node.children) {
    if (child.first === code) return child
  }
  return undefined
}

/** Length of the common run of `edge` and `word` read from `from`. */
const commonLength = (edge: string, word: string, from: number): number => {
  const limit = Math.min(edge.length, word.length - from)
  let length = 0
  while (length < limit && edge.charCodeAt(length) === word.charCodeAt(from + length)) length += 1
  return length
}

/** True when the first `span` characters of `edge` equal `text` read from `from`. */
const regionMatches = (edge: string, text: string, from: number, span: number): boolean => {
  for (let at = 0; at < span; at += 1) {
    if (edge.charCodeAt(at) !== text.charCodeAt(from + at)) return false
  }
  return true
}

/**
 * Splits the edge into `child` at `at` characters, and returns the new middle node.
 * The middle node inherits the child's `top`, because both cover the same words.
 */
const split = (parent: Node, child: Node, at: number): Node => {
  const middle = makeNode(child.edge.slice(0, at), [child])
  middle.top = child.top.slice()
  child.edge = child.edge.slice(at)
  child.first = child.edge.charCodeAt(0)
  parent.children[parent.children.indexOf(child)] = middle
  return middle
}

/**
 * Puts `entry` in its place in `top` after its rank rose.
 *
 * Exact because ranks only rise: the lowest rank in a full list never falls,
 * so an entry outside the list can enter only by outranking its last member.
 */
const promote = (top: Entry[], entry: Entry): void => {
  let at = top.indexOf(entry)
  if (at === -1) {
    const last = top[TOP_CAPACITY - 1]
    if (top.length < TOP_CAPACITY) {
      top.push(entry)
      at = top.length - 1
    } else if (last !== undefined && outranks(entry, last)) {
      top[TOP_CAPACITY - 1] = entry
      at = TOP_CAPACITY - 1
    } else {
      return
    }
  }
  for (let above = top[at - 1]; above !== undefined && outranks(entry, above); above = top[at - 1]) {
    top[at - 1] = entry
    top[at] = above
    at -= 1
  }
}

export class CompletionTrie {
  readonly #root: Node = makeNode('', [])
  #clock = 0
  #size = 0
  #total = 0

  /** Number of distinct words stored. */
  get size(): number {
    return this.#size
  }

  /** Number of occurrences recorded: the sum of every word's count. */
  get total(): number {
    return this.#total
  }

  /**
   * Records `times` occurrences of `word` at once (one by default).
   *
   * Recording several at once ranks the word as that many single inserts in a
   * row would, so ranks still only rise. It is how counts from a file enter.
   *
   * Cost: O(word.length + depth × TOP_CAPACITY). It runs after a chat turn or at session start, never on a keystroke.
   */
  insert(word: Word, times: number = 1): void {
    this.#clock += 1
    this.#total += times
    const tick = this.#clock as Tick
    // The root is on every path: its list holds the best words of the whole trie, for a lookup with no prefix.
    const path: Node[] = [this.#root]
    let node = this.#root
    let at = 0
    while (at < word.length) {
      const found = findChild(node, word.charCodeAt(at))
      if (found === undefined) {
        const leaf = makeNode(word.slice(at), [])
        node.children.push(leaf)
        node = leaf
        at = word.length
      } else {
        const shared = commonLength(found.edge, word, at)
        node = shared < found.edge.length ? split(node, found, shared) : found
        at += shared
      }
      path.push(node)
    }
    if (node.end === null) {
      node.end = { word, count: 0, seen: tick }
      this.#size += 1
    }
    node.end.count += times
    node.end.seen = tick
    for (const visited of path) promote(visited.top, node.end)
  }

  /** Inserts every prose word in `text` and returns how many occurrences it recorded. */
  ingest(text: string): number {
    let recorded = 0
    for (const word of wordsOf(text)) {
      this.insert(word)
      recorded += 1
    }
    return recorded
  }

  /**
   * Returns up to `limit` words that start with `prefix` and are longer than it, best first.
   *
   * A `null` prefix asks for the best words of the whole trie, each suffix the
   * whole word: what predicts the next word after a space.
   *
   * Cost: O(prefix.length + limit). It reads one precomputed list and visits no subtree.
   */
  complete(prefix: Prefix | null, limit: SuggestionLimit): readonly Completion[] {
    const typed = prefix ?? ''
    const node = this.#descend(typed)
    if (node === null) return NO_COMPLETIONS
    return node.top
      .filter(entry => entry.word.length > typed.length)
      .slice(0, limit)
      .map(entry => ({ word: entry.word, suffix: entry.word.slice(typed.length) }))
  }

  /**
   * Returns up to `limit` words that start with `prefix` and are longer than it, best first, with their counts.
   *
   * The same list `complete` reads, for a caller that scores the words itself.
   * Cost: O(prefix.length + limit).
   */
  ranked(prefix: Prefix | null, limit: SuggestionLimit): readonly Ranked[] {
    const typed = prefix ?? ''
    const node = this.#descend(typed)
    if (node === null) return NO_RANKED
    return node.top.filter(entry => entry.word.length > typed.length).slice(0, limit)
  }

  /**
   * Returns one stored word's count and latest tick, or `null` when it is not stored.
   *
   * Cost: O(word.length).
   */
  entry(word: Word): Ranked | null {
    const node = this.#descend(word)
    return node !== null && node.end !== null && node.end.word === word ? node.end : null
  }

  /** The node whose subtree holds exactly the words that start with `prefix`, or `null`. */
  #descend(prefix: string): Node | null {
    let node = this.#root
    let at = 0
    while (at < prefix.length) {
      const child = findChild(node, prefix.charCodeAt(at))
      if (child === undefined) return null
      const span = Math.min(child.edge.length, prefix.length - at)
      if (!regionMatches(child.edge, prefix, at, span)) return null
      node = child
      at += span
    }
    return node
  }
}
