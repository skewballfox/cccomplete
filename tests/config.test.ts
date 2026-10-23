import { describe, expect, test } from 'claude-code/testing'

import { DEFAULTS, parseConfig } from '../src/config'
import { formatCombo } from '../src/keys'

describe('parseConfig', () => {
  test('uses the defaults when nothing is set', () => {
    const { config, problems } = parseConfig({})
    expect(config).toEqual(DEFAULTS)
    expect(problems).toEqual([])
  })

  test('paints the inline suggestion dim by default, or in a colour', () => {
    expect(parseConfig({}).config.ghostPaint).toEqual({ kind: 'dim' })
    expect(parseConfig({ ghost_color: ' #1e1e1e ' }).config.ghostPaint).toEqual({ kind: 'color', color: '#1e1e1e' })
    expect(parseConfig({ ghost_color: 'Black' }).config.ghostPaint).toEqual({ kind: 'color', color: 'Black' })
    expect(parseConfig({ ghost_color: 'DIM' }).config.ghostPaint).toEqual({ kind: 'dim' })
  })

  test('reads the dictionary source: bundled, none, or a file path', () => {
    expect(parseConfig({}).config.dictionary).toEqual({ kind: 'bundled' })
    expect(parseConfig({ dictionary: ' NONE ' }).config.dictionary).toEqual({ kind: 'none' })
    expect(parseConfig({ dictionary: 'Bundled' }).config.dictionary).toEqual({ kind: 'bundled' })
    expect(parseConfig({ dictionary: ' /usr/share/dict/words ' }).config.dictionary).toEqual({
      kind: 'file',
      path: '/usr/share/dict/words',
    })
  })

  test('refuses an empty or non-text dictionary option', () => {
    const empty = parseConfig({ dictionary: '  ' })
    expect(empty.config.dictionary).toEqual({ kind: 'bundled' })
    expect(empty.problems.map(({ option, reason }) => [option, reason])).toEqual([['dictionary', 'empty']])
    expect(parseConfig({ dictionary: 3 }).problems.map(({ reason }) => reason)).toEqual(['wrong-type'])
  })

  test('reads predict_next, and refuses a value that is not true or false', () => {
    expect(parseConfig({ predict_next: false }).config.predictNext).toBe(false)
    const wrong = parseConfig({ predict_next: 'no' })
    expect(wrong.config.predictNext).toBe(true)
    expect(wrong.problems.map(({ option, reason }) => [option, reason])).toEqual([['predict_next', 'wrong-type']])
  })

  test('reads typeahead, and refuses a value that is not true or false', () => {
    expect(parseConfig({ typeahead: false }).config.typeahead).toBe(false)
    const wrong = parseConfig({ typeahead: 1 })
    expect(wrong.config.typeahead).toBe(true)
    expect(wrong.problems.map(({ option, reason }) => [option, reason])).toEqual([['typeahead', 'wrong-type']])
  })

  test('reads trace, off by default, and refuses a value that is not true or false', () => {
    expect(parseConfig({}).config.trace).toBe(false)
    expect(parseConfig({ trace: true }).config.trace).toBe(true)
    expect(parseConfig({ trace: 'on' }).problems.map(({ option, reason }) => [option, reason])).toEqual([['trace', 'wrong-type']])
  })

  test('reads english, on by default, and refuses a value that is not true or false', () => {
    expect(parseConfig({}).config.english).toBe(true)
    expect(parseConfig({ english: false }).config.english).toBe(false)
    expect(parseConfig({ english: 'no' }).problems.map(({ option, reason }) => [option, reason])).toEqual([['english', 'wrong-type']])
  })

  test('reads min_gain from 1 to 3, defaulting to 2, and refuses a value outside the range', () => {
    expect(parseConfig({}).config.minGain).toBe(2)
    expect(parseConfig({ min_gain: 3 }).config.minGain).toBe(3)
    expect(parseConfig({ min_gain: 4 }).problems.map(({ option, reason }) => [option, reason])).toEqual([['min_gain', 'out-of-range']])
    expect(parseConfig({ min_gain: '2' }).problems.map(({ option, reason }) => [option, reason])).toEqual([['min_gain', 'wrong-type']])
  })

  test('refuses a colour that is not a name or a hex value', () => {
    const { config, problems } = parseConfig({ ghost_color: 'rgb(1,2,3)' })
    expect(config.ghostPaint).toEqual({ kind: 'dim' })
    expect(problems.map(({ option, reason }) => [option, reason])).toEqual([['ghost_color', 'not-a-color']])
  })

  test('reads every valid option', () => {
    const { config, problems } = parseConfig({
      accept_key: 'ctrl+y',
      next_key: 'meta+j',
      previous_key: 'meta+k',
      display: 'bar',
      bar_style: 'buttons',
      limit: 7,
      min_prefix: 3,
      trailing_space: false,
      sources: 'prompts',
    })
    expect(problems).toEqual([])
    expect(config.accept.map(formatCombo)).toEqual(['ctrl+y'])
    expect(formatCombo(config.next)).toBe('meta+j')
    expect(formatCombo(config.previous)).toBe('meta+k')
    expect(config).toMatchObject({ display: 'bar', barStyle: 'buttons', limit: 7, minPrefix: 3, trailingSpace: false, sources: 'prompts' })
  })

  test('falls back to the default and reports each invalid option', () => {
    const { config, problems } = parseConfig({
      accept_key: 'n',
      display: 'floating',
      limit: 10,
      min_prefix: 0,
      trailing_space: 'yes',
      sources: 3,
    })
    expect(config).toEqual(DEFAULTS)
    expect(problems.map(({ option, reason }) => [option, reason])).toEqual([
      ['accept_key', 'needs-modifier'],
      ['display', 'not-an-option'],
      ['limit', 'out-of-range'],
      ['min_prefix', 'out-of-range'],
      ['trailing_space', 'wrong-type'],
      ['sources', 'wrong-type'],
    ])
  })

  test('reads a comma-separated list of accept keys', () => {
    const { config, problems } = parseConfig({ accept_key: ' right ,ctrl+y,tab' })
    expect(problems).toEqual([])
    expect(config.accept.map(formatCombo)).toEqual(['right', 'ctrl+y', 'tab'])
  })

  test('splits the accept list on commas but keeps a comma that is itself the key', () => {
    const { config, problems } = parseConfig({ accept_key: 'right, ctrl+,' })
    expect(problems).toEqual([])
    expect(config.accept.map(formatCombo)).toEqual(['right', 'ctrl+,'])
  })

  test('refuses the whole accept list when one entry is invalid', () => {
    const { config, problems } = parseConfig({ accept_key: 'right, n' })
    expect(config.accept).toEqual(DEFAULTS.accept)
    expect(problems.map(({ option, reason }) => [option, reason])).toEqual([['accept_key', 'needs-modifier']])
  })

  test('reports a next key that clashes with any accept key', () => {
    const { problems } = parseConfig({ accept_key: 'right, ctrl+j', next_key: 'ctrl+j' })
    expect(problems.map(({ option, reason }) => [option, reason])).toEqual([['next_key', 'duplicate-binding']])
  })

  test('keeps a key bound twice and reports the later action', () => {
    const { config, problems } = parseConfig({ accept_key: 'ctrl+n', next_key: 'ctrl+n', previous_key: 'ctrl+n' })
    expect([...config.accept, config.next, config.previous].map(formatCombo)).toEqual(['ctrl+n', 'ctrl+n', 'ctrl+n'])
    expect(problems.map(({ option, reason }) => [option, reason])).toEqual([
      ['next_key', 'duplicate-binding'],
      ['previous_key', 'duplicate-binding'],
    ])
  })
})
