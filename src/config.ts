/**
 * Turns the host's untyped plugin options into one validated, fully typed `Config`.
 *
 * Audience: contributors to cccomplete. A bad option never stops the plugin:
 * the field falls back to its default and the problem is reported once.
 */

import type { Gain, SuggestionLimit } from '../types'
import { formatCombo, parseCombo, sameCombo } from './keys'
import type { KeyCombo, KeyParseError } from './keys'

export type Display = 'inline' | 'bar' | 'both'
export type Sources = 'prompts' | 'answers' | 'both'
export type BarStyle = 'powerline' | 'buttons'
export type PrefixLength = 1 | 2 | 3 | 4

/** How the inline suggestion is painted: dim, or in one colour (a terminal's background colour hides it). */
export type GhostPaint = Readonly<{ kind: 'dim' }> | Readonly<{ kind: 'color'; color: string }>

/** Where the dictionary comes from: the file the plugin ships, no dictionary, or a file the user names. */
export type DictionarySource =
  | Readonly<{ kind: 'bundled' }>
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'file'; path: string }>

/** One or more key combinations. Never empty, so an accept key always exists. */
export type KeyList = readonly [KeyCombo, ...KeyCombo[]]

export type Config = Readonly<{
  accept: KeyList
  next: KeyCombo
  previous: KeyCombo
  display: Display
  barStyle: BarStyle
  ghostPaint: GhostPaint
  dictionary: DictionarySource
  limit: SuggestionLimit
  minPrefix: PrefixLength
  minGain: Gain
  trailingSpace: boolean
  predictNext: boolean
  typeahead: boolean
  trace: boolean
  english: boolean
  sources: Sources
}>

/** The option names declared in `.claude-plugin/plugin.json`. */
export type OptionName =
  | 'accept_key'
  | 'next_key'
  | 'previous_key'
  | 'display'
  | 'bar_style'
  | 'ghost_color'
  | 'dictionary'
  | 'limit'
  | 'min_prefix'
  | 'min_gain'
  | 'trailing_space'
  | 'predict_next'
  | 'typeahead'
  | 'trace'
  | 'english'
  | 'sources'

export type ProblemReason = KeyParseError | 'not-an-option' | 'out-of-range' | 'wrong-type' | 'duplicate-binding' | 'not-a-color'

export type ConfigProblem = Readonly<{ option: OptionName; reason: ProblemReason; value: string }>

/** The shape of the host's options object. */
export type RawOptions = Readonly<Record<string, string | number | boolean | readonly string[]>>

const key = (text: string): KeyCombo => {
  const parsed = parseCombo(text)
  if (!parsed.ok) throw new Error(`invalid built-in default key: ${text}`)
  return parsed.value
}

export const DEFAULTS: Config = {
  accept: [key('right'), key('ctrl+e')],
  next: key('ctrl+d'),
  previous: key('ctrl+a'),
  display: 'inline',
  barStyle: 'powerline',
  ghostPaint: { kind: 'dim' },
  dictionary: { kind: 'bundled' },
  limit: 5,
  minPrefix: 2,
  minGain: 2,
  trailingSpace: true,
  predictNext: true,
  typeahead: true,
  trace: false,
  english: true,
  sources: 'both',
}

const LIMITS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const satisfies readonly SuggestionLimit[]
const PREFIX_LENGTHS = [1, 2, 3, 4] as const satisfies readonly PrefixLength[]
const GAINS = [1, 2, 3] as const satisfies readonly Gain[]
const DISPLAYS = ['inline', 'bar', 'both'] as const satisfies readonly Display[]
const BAR_STYLES = ['powerline', 'buttons'] as const satisfies readonly BarStyle[]
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

/** Parses a comma-separated list of key combinations, such as `right, ctrl+e`. One bad entry refuses the whole list. */
const keyListField = (raw: RawOptions[string] | undefined, fallback: KeyList): Field<KeyList> => {
  if (raw === undefined) return pick(fallback, fallback, null)
  if (typeof raw !== 'string') return pick(fallback, fallback, 'wrong-type')
  // A comma that follows `+` is the key itself (`ctrl+,`); any other comma separates two combinations.
  const parsed = raw.split(/(?<!\+),/).map(parseCombo)
  const failure = parsed.find(result => !result.ok)
  if (failure !== undefined) return pick(fallback, fallback, failure.ok ? 'empty' : failure.error)
  const [head, ...tail] = parsed.flatMap(result => (result.ok ? [result.value] : []))
  return head === undefined ? pick(fallback, fallback, 'empty') : pick([head, ...tail], fallback, null)
}

/** Parses `bundled`, `none` or a file path. A path is not checked here: the hooks module reports one it cannot read. */
const dictionaryField = (raw: RawOptions[string] | undefined, fallback: DictionarySource): Field<DictionarySource> => {
  if (raw === undefined) return pick(fallback, fallback, null)
  if (typeof raw !== 'string') return pick(fallback, fallback, 'wrong-type')
  const text = raw.trim()
  if (text === '') return pick(fallback, fallback, 'empty')
  const word = text.toLowerCase()
  if (word === 'bundled' || word === 'none') return pick({ kind: word }, fallback, null)
  return pick({ kind: 'file', path: text }, fallback, null)
}

const COLOR = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|[a-z]+)$/i

/** Parses `dim`, a colour name such as `black`, or a hex colour such as `#1e1e1e`. */
const paintField = (raw: RawOptions[string] | undefined, fallback: GhostPaint): Field<GhostPaint> => {
  if (raw === undefined) return pick(fallback, fallback, null)
  if (typeof raw !== 'string') return pick(fallback, fallback, 'wrong-type')
  const text = raw.trim()
  if (text.toLowerCase() === 'dim') return pick({ kind: 'dim' }, fallback, null)
  return COLOR.test(text) ? pick({ kind: 'color', color: text }, fallback, null) : pick(fallback, fallback, 'not-a-color')
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
  const accept = keyListField(options['accept_key'], DEFAULTS.accept)
  const next = keyField(options['next_key'], DEFAULTS.next)
  const previous = keyField(options['previous_key'], DEFAULTS.previous)
  const display = choiceField(options['display'], DISPLAYS, DEFAULTS.display)
  const barStyle = choiceField(options['bar_style'], BAR_STYLES, DEFAULTS.barStyle)
  const ghostPaint = paintField(options['ghost_color'], DEFAULTS.ghostPaint)
  const dictionary = dictionaryField(options['dictionary'], DEFAULTS.dictionary)
  const limit = numberField(options['limit'], LIMITS, DEFAULTS.limit)
  const minPrefix = numberField(options['min_prefix'], PREFIX_LENGTHS, DEFAULTS.minPrefix)
  const minGain = numberField(options['min_gain'], GAINS, DEFAULTS.minGain)
  const trailingSpace = booleanField(options['trailing_space'], DEFAULTS.trailingSpace)
  const predictNext = booleanField(options['predict_next'], DEFAULTS.predictNext)
  const typeahead = booleanField(options['typeahead'], DEFAULTS.typeahead)
  const trace = booleanField(options['trace'], DEFAULTS.trace)
  const english = booleanField(options['english'], DEFAULTS.english)
  const sources = choiceField(options['sources'], SOURCES, DEFAULTS.sources)

  const invalid = (
    [
      ['accept_key', accept, options['accept_key']],
      ['next_key', next, options['next_key']],
      ['previous_key', previous, options['previous_key']],
      ['display', display, options['display']],
      ['bar_style', barStyle, options['bar_style']],
      ['ghost_color', ghostPaint, options['ghost_color']],
      ['dictionary', dictionary, options['dictionary']],
      ['limit', limit, options['limit']],
      ['min_prefix', minPrefix, options['min_prefix']],
      ['min_gain', minGain, options['min_gain']],
      ['trailing_space', trailingSpace, options['trailing_space']],
      ['predict_next', predictNext, options['predict_next']],
      ['typeahead', typeahead, options['typeahead']],
      ['trace', trace, options['trace']],
      ['english', english, options['english']],
      ['sources', sources, options['sources']],
    ] as const
  ).flatMap(([option, field, raw]): readonly ConfigProblem[] =>
    field.problem === null ? [] : [{ option, reason: field.problem, value: String(raw) }],
  )

  const clashes: readonly ConfigProblem[] = [
    ...(accept.value.some(combo => sameCombo(next.value, combo)) ? [clash('next_key', next.value)] : []),
    ...(accept.value.some(combo => sameCombo(previous.value, combo)) || sameCombo(previous.value, next.value)
      ? [clash('previous_key', previous.value)]
      : []),
  ]

  return {
    config: {
      accept: accept.value,
      next: next.value,
      previous: previous.value,
      display: display.value,
      barStyle: barStyle.value,
      ghostPaint: ghostPaint.value,
      dictionary: dictionary.value,
      limit: limit.value,
      minPrefix: minPrefix.value,
      minGain: minGain.value,
      trailingSpace: trailingSpace.value,
      predictNext: predictNext.value,
      typeahead: typeahead.value,
      trace: trace.value,
      english: english.value,
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
  `${config.accept.map(formatCombo).join(' or ')} accepts, ${formatCombo(config.next)} and ${formatCombo(config.previous)} cycle`
