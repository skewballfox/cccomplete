import { describe, expect, test } from 'claude-code/testing'

import { describeEdit, formatCombo, formatPress, isNotable, matches, parseCombo, recordEdit, remember } from '../src/keys'
import type { KeyCombo, KeyPress } from '../src/keys'

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

  test('parses punctuation keys, which need ctrl or meta', () => {
    expect(combo('ctrl+.')).toEqual({ key: '.', ctrl: true, shift: false, meta: false })
    expect(combo('meta+,')).toEqual({ key: ',', ctrl: false, shift: false, meta: true })
    expect(combo('ctrl+\\')).toEqual({ key: '\\', ctrl: true, shift: false, meta: false })
    expect(errorOf('.')).toBe('needs-modifier')
    expect(errorOf('ctrl+>')).toBe('unknown-key')
    expect(errorOf('ctrl++')).toBe('missing-key')
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

describe('isNotable and remember', () => {
  test('treats typing as ordinary and everything else as notable', () => {
    const typing: readonly KeyPress[] = [{ key: 'c' }, { key: 'C', shift: true }, { key: '7' }, { key: ' ' }]
    const notable: readonly KeyPress[] = [
      { key: 'tab' },
      { key: 'right' },
      { key: 'e', ctrl: true },
      { key: 'b', meta: true },
      { key: '.' },
    ]
    expect(typing.map(isNotable)).toEqual([false, false, false, false])
    expect(notable.map(isNotable)).toEqual([true, true, true, true, true])
  })

  test('keeps notable keys, in order, and ignores typing between them', () => {
    const typed: readonly KeyPress[] = '/cccomplete'.split('').map(key => ({ key }))
    const presses: readonly KeyPress[] = [{ key: 'e', ctrl: true }, ...typed, { key: 'right' }]
    const history = presses.reduce<readonly KeyPress[]>(
      (kept, press) => remember(kept, press, 6),
      [],
    )
    expect(history.map(formatPress)).toEqual(['ctrl+e', '/', 'right'])
  })

  test('keeps only the newest keys up to the limit', () => {
    const presses: readonly KeyPress[] = ['up', 'down', 'left', 'right'].map(key => ({ key }))
    const history = presses.reduce<readonly KeyPress[]>((kept, press) => remember(kept, press, 2), [])
    expect(history.map(formatPress)).toEqual(['left', 'right'])
  })
})

describe('describeEdit and recordEdit', () => {
  test('writes the key, the inserted text and the span', () => {
    expect(describeEdit({ key: { key: 'j', ctrl: true }, inputText: '\n', start: 5, end: 5 })).toBe('ctrl+j: "\\n" @5..5')
    expect(describeEdit({ key: null, inputText: 'pasted', start: 0, end: 2 })).toBe('no key: "pasted" @0..2')
  })

  test('skips plain typing and keeps pastes, named keys and modified keys', () => {
    const edits = [
      { key: { key: 'a' }, inputText: 'a', start: 0, end: 0 },
      { key: null, inputText: 'paste', start: 1, end: 1 },
      { key: { key: 'backspace' }, inputText: '', start: 0, end: 1 },
      { key: { key: 'd', ctrl: true }, inputText: '', start: 0, end: 1 },
    ] as const
    const history = edits.reduce<readonly string[]>((kept, edit) => recordEdit(kept, edit, 6), [])
    expect(history).toEqual(['no key: "paste" @1..1', 'backspace: "" @0..1', 'ctrl+d: "" @0..1'])
  })

  test('keeps only the newest edits up to the limit', () => {
    const edit = (start: number) => ({ key: null, inputText: 'x', start, end: start }) as const
    const history = [1, 2, 3].reduce<readonly string[]>((kept, start) => recordEdit(kept, edit(start), 2), [])
    expect(history).toEqual(['no key: "x" @2..2', 'no key: "x" @3..3'])
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
