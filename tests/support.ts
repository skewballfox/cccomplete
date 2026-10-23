/**
 * Helpers shared by the tests. Audience: contributors to cccomplete.
 * Not a test file: the runner loads only files that end in `.test.ts`.
 */

import type { Prefix, Word } from '../types'
import { toWord } from '../src/words'

/** Builds a Word, and fails the test loudly if the text is not one. */
export const word = (text: string): Word => {
  const built = toWord(text)
  if (built === null) throw new Error(`not a word: ${text}`)
  return built
}

/** Builds a Prefix from text that the test knows is a valid run. */
export const prefix = (text: string): Prefix => text as Prefix

/** A small deterministic generator (mulberry32), so a failing random test replays exactly. */
export const seeded = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = Math.imul(state ^ (state >>> 15), state | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

const SYLLABLES = [
  'te', 'st', 'in', 'g', 'er', 're', 'pro', 'mpt', 'con', 'fig', 'ed', 'it',
  'ab', 'ra', 'ck', 'la', 'mo', 'ne', 'ul', 'ba', 'di', 'ox', 'ph', 'qu',
] as const

/**
 * Builds `size` distinct words that share many prefixes, which is what splits radix edges.
 * Four syllables give 24^4 combinations, so `size` must stay under about 300,000.
 */
export const vocabulary = (random: () => number, size: number): readonly Word[] => {
  const seen = new Set<string>()
  while (seen.size < size) {
    const parts = 2 + Math.floor(random() * 3)
    const text = Array.from({ length: parts }, () => SYLLABLES[Math.floor(random() * SYLLABLES.length)]).join('')
    if (text.length >= 3) seen.add(text)
  }
  return [...seen].map(word)
}

/**
 * Raises an event the test kit carries at run time but its types do not declare, such as `prompt.edit`.
 * The result is `unknown`, so a test checks its shape with `expect`.
 */
export const raise = async (noun: object, name: string, input: unknown): Promise<unknown> => {
  const call: unknown = Reflect.get(noun, name)
  if (typeof call !== 'function') throw new Error(`the test kit has no ${name}`)
  const result: unknown = await Reflect.apply(call, noun, [input])
  return result
}
