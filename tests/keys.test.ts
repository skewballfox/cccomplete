import { describe, expect, test } from 'claude-code/testing'

import { formatCombo, formatPress, matches, parseCombo } from '../src/keys'
import type { KeyCombo } from '../src/keys'

const combo = (text: string): KeyCombo => {
  const parsed = parseCombo(text)
  if (!parsed.ok) throw new Error(`expected ${text} to parse, got ${parsed.error}`)
  return parsed.value
}

const errorOf = (text: string): string => {
  const parsed = parseCombo(text)
  return parsed.ok ? 'parsed' : parsed.error
}

describe('parseCombo', () => {
  test('parses named keys, modifiers, aliases and case', () => {
    expect(combo('tab')).toEqual({ key: 'tab', ctrl: false, shift: false, meta: false })
    expect(combo('Ctrl+Shift+Enter')).toEqual({ key: 'return', ctrl: true, shift: true, meta: false })
    expect(combo(' alt + n ')).toEqual({ key: 'n', ctrl: false, shift: false, meta: true })
  })

  test('names each way a combination can be wrong', () => {
    expect(errorOf('')).toBe('empty')
    expect(errorOf('ctrl+')).toBe('missing-key')
    expect(errorOf('n')).toBe('needs-modifier')
    expect(errorOf('shift+n')).toBe('needs-modifier')
    expect(errorOf('ctrl+ctrl+n')).toBe('repeated-modifier')
    expect(errorOf('hyper+n')).toBe('unknown-modifier')
    expect(errorOf('ctrl+f13')).toBe('unknown-key')
    expect(errorOf('tab+n')).toBe('extra-key')
  })
})

describe('matches', () => {
  test('requires the same key and exactly the same modifiers', () => {
    const ctrlN = combo('ctrl+n')
    expect(matches(ctrlN, { key: 'n', ctrl: true })).toBe(true)
    expect(matches(ctrlN, { key: 'N', ctrl: true })).toBe(true)
    expect(matches(ctrlN, { key: 'n', ctrl: true, shift: true })).toBe(false)
    expect(matches(ctrlN, { key: 'n' })).toBe(false)
    expect(matches(combo('tab'), { key: 'tab', shift: true })).toBe(false)
  })
})

describe('formatting', () => {
  test('writes a combination in the form the user configures it', () => {
    expect(formatCombo(combo('shift+ctrl+enter'))).toBe('ctrl+shift+return')
    expect(formatPress({ key: 'tab', shift: true })).toBe('shift+tab')
  })
})
