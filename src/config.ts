/**
 * Turns the host's untyped plugin options into one validated, fully typed `Config`.
 *
 * Audience: contributors to cccomplete. A bad option never stops the plugin:
 * the field falls back to its default and the problem is reported once.
 */

import type { SuggestionLimit } from '../types'
import { formatCombo, parseCombo, sameCombo } from './keys'
import type { KeyCombo, KeyParseError } from './keys'

export type Display = 'inline' | 'bar' | 'both'
export type Sources = 'prompts' | 'answers' | 'both'
export type PrefixLength = 1 | 2 | 3 | 4

export type Config = Readonly<{
  accept: KeyCombo
  next: KeyCombo
  previous: KeyCombo
  display: Display
  limit: SuggestionLimit
  minPrefix: PrefixLength
  trailingSpace: boolean
  sources: Sources
}>

/** The option names declared in `.claude-plugin/plugin.json`. */
export type OptionName =
  | 'accept_key'
  | 'next_key'
  | 'previous_key'
  | 'display'
  | 'limit'
  | 'min_prefix'
  | 'trailing_space'
  | 'sources'

export type ProblemReason = KeyParseError | 'not-an-option' | 'out-of-range' | 'wrong-type' | 'duplicate-binding'

export type ConfigProblem = Readonly<{ option: OptionName; reason: ProblemReason; value: string }>

/** The shape of the host's options object. */
export type RawOptions = Readonly<Record<string, string | number | boolean | readonly string[]>>

const key = (text: string): KeyCombo => {
  const parsed = parseCombo(text)
  if (!parsed.ok) throw new Error(`invalid built-in default key: ${text}`)
  return parsed.value
}

export const DEFAULTS: Config = {
  accept: key('tab'),
  next: key('ctrl+n'),
  previous: key('ctrl+p'),
  display: 'both',
  limit: 5,
  minPrefix: 2,
  trailingSpace: true,
  sources: 'both',
}

const LIMITS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const satisfies readonly SuggestionLimit[]
const PREFIX_LENGTHS = [1, 2, 3, 4] as const satisfies readonly PrefixLength[]
const DISPLAYS = ['inline', 'bar', 'both'] as const satisfies readonly Display[]
const SOURCES = ['prompts', 'answers', 'both'] as const satisfies readonly Sources[]

/** A field's value, or the reason it was refused. */
type Field<Value> = Readonly<{ value: Value; problem: ProblemReason | null }>

const pick = <Value>(value: Value, fallback: Value, problem: ProblemReason | null): Field<Value> =>
  problem === null ? { value, problem } : { value: fallback, problem }

const keyField = (raw: RawOptions[string] | undefined, fallback: KeyCombo): Field<KeyCombo> => {
  if (raw === undefined) return pick(fallback, fallback, null)
  if (typeof raw !== 'string') return pick(fallback, fallback, 'wrong-type')
  const parsed = parseCombo(raw)
  return parsed.ok ? pick(parsed.value, fallback, null) : pick(fallback, fallback, parsed.error)
}

const choiceField = <Choice extends string>(
  raw: RawOptions[string] | undefined,
  choices: readonly Choice[],
  fallback: Choice,
): Field<Choice> => {
  if (raw === undefined) return pick(fallback, fallback, null)
  if (typeof raw !== 'string') return pick(fallback, fallback, 'wrong-type')
  const choice = choices.find(candidate => candidate === raw)
  return choice === undefined ? pick(fallback, fallback, 'not-an-option') : pick(choice, fallback, null)
}

const numberField = <Choice extends number>(
  raw: RawOptions[string] | undefined,
  choices: readonly Choice[],
  fallback: Choice,
): Field<Choice> => {
  if (raw === undefined) return pick(fallback, fallback, null)
  if (typeof raw !== 'number') return pick(fallback, fallback, 'wrong-type')
  const choice = choices.find(candidate => candidate === raw)
  return choice === undefined ? pick(fallback, fallback, 'out-of-range') : pick(choice, fallback, null)
}

const booleanField = (raw: RawOptions[string] | undefined, fallback: boolean): Field<boolean> =>
  raw === undefined
    ? pick(fallback, fallback, null)
    : typeof raw === 'boolean'
      ? pick(raw, fallback, null)
      : pick(fallback, fallback, 'wrong-type')

export type ConfigResult = Readonly<{ config: Config; problems: readonly ConfigProblem[] }>

/**
 * Validates `options`.
 *
 * Returns the config in effect and the problems found. An invalid field
 * reverts to its default. A key bound twice keeps its value and is reported:
 * the earlier action wins, in the order accept, next, previous.
 */
export const parseConfig = (options: RawOptions): ConfigResult => {
  const accept = keyField(options['accept_key'], DEFAULTS.accept)
  const next = keyField(options['next_key'], DEFAULTS.next)
  const previous = keyField(options['previous_key'], DEFAULTS.previous)
  const display = choiceField(options['display'], DISPLAYS, DEFAULTS.display)
  const limit = numberField(options['limit'], LIMITS, DEFAULTS.limit)
  const minPrefix = numberField(options['min_prefix'], PREFIX_LENGTHS, DEFAULTS.minPrefix)
  const trailingSpace = booleanField(options['trailing_space'], DEFAULTS.trailingSpace)
  const sources = choiceField(options['sources'], SOURCES, DEFAULTS.sources)

  const invalid = (
    [
      ['accept_key', accept, options['accept_key']],
      ['next_key', next, options['next_key']],
      ['previous_key', previous, options['previous_key']],
      ['display', display, options['display']],
      ['limit', limit, options['limit']],
      ['min_prefix', minPrefix, options['min_prefix']],
      ['trailing_space', trailingSpace, options['trailing_space']],
      ['sources', sources, options['sources']],
    ] as const
  ).flatMap(([option, field, raw]): readonly ConfigProblem[] =>
    field.problem === null ? [] : [{ option, reason: field.problem, value: String(raw) }],
  )

  const clashes: readonly ConfigProblem[] = [
    ...(sameCombo(next.value, accept.value) ? [clash('next_key', next.value)] : []),
    ...(sameCombo(previous.value, accept.value) || sameCombo(previous.value, next.value)
      ? [clash('previous_key', previous.value)]
      : []),
  ]

  return {
    config: {
      accept: accept.value,
      next: next.value,
      previous: previous.value,
      display: display.value,
      limit: limit.value,
      minPrefix: minPrefix.value,
      trailingSpace: trailingSpace.value,
      sources: sources.value,
    },
    problems: [...invalid, ...clashes],
  }
}

const clash = (option: OptionName, combo: KeyCombo): ConfigProblem => ({
  option,
  reason: 'duplicate-binding',
  value: formatCombo(combo),
})

/** One plain sentence per problem, for a toast or the status command. */
export const describeProblem = (problem: ConfigProblem): string =>
  problem.reason === 'duplicate-binding'
    ? `${problem.option}: ${problem.value} is already bound to an earlier action, so this action cannot run.`
    : `${problem.option}: "${problem.value}" is not valid (${problem.reason}); using the default.`

/** Names the three bindings for the hint in the bar. */
export const describeKeys = (config: Config): string =>
  `${formatCombo(config.accept)} accepts, ${formatCombo(config.next)} and ${formatCombo(config.previous)} cycle`
