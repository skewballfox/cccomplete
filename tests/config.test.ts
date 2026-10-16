import { describe, expect, test } from 'claude-code/testing'

import { DEFAULTS, parseConfig } from '../src/config'
import { formatCombo } from '../src/keys'

describe('parseConfig', () => {
  test('uses the defaults when nothing is set', () => {
    const { config, problems } = parseConfig({})
    expect(config).toEqual(DEFAULTS)
    expect(problems).toEqual([])
  })

  test('reads every valid option', () => {
    const { config, problems } = parseConfig({
      accept_key: 'ctrl+y',
      next_key: 'meta+j',
      previous_key: 'meta+k',
      display: 'bar',
      limit: 7,
      min_prefix: 3,
      trailing_space: false,
      sources: 'prompts',
    })
    expect(problems).toEqual([])
    expect(formatCombo(config.accept)).toBe('ctrl+y')
    expect(formatCombo(config.next)).toBe('meta+j')
    expect(formatCombo(config.previous)).toBe('meta+k')
    expect(config).toMatchObject({ display: 'bar', limit: 7, minPrefix: 3, trailingSpace: false, sources: 'prompts' })
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

  test('keeps a key bound twice and reports the later action', () => {
    const { config, problems } = parseConfig({ accept_key: 'ctrl+n', previous_key: 'ctrl+n' })
    expect([config.accept, config.next, config.previous].map(formatCombo)).toEqual(['ctrl+n', 'ctrl+n', 'ctrl+n'])
    expect(problems.map(({ option, reason }) => [option, reason])).toEqual([
      ['next_key', 'duplicate-binding'],
      ['previous_key', 'duplicate-binding'],
    ])
  })
})
