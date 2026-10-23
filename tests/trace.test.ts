import { describe, expect, test } from 'claude-code/testing'

import { appendBounded, describeError, describeFailure, traceEdit } from '../src/trace'
import { word } from './support'

describe('appendBounded', () => {
  test('adds at the end and keeps only the newest lines', () => {
    expect(appendBounded(['a', 'b'], 'c', 2)).toEqual(['b', 'c'])
    expect(appendBounded([], 'a', 3)).toEqual(['a'])
  })
})

describe('describeFailure and describeError', () => {
  test('name the hook or step and say why', () => {
    expect(describeFailure('prompt.edit', { kind: 'throw', message: 'boom', budget: 50 })).toBe('prompt.edit: throw: boom')
    expect(describeFailure('prompt.edit', { kind: 'timeout', budget: 50 })).toBe('prompt.edit: timeout')
    expect(describeError('session.start store', new Error('denied'))).toBe('session.start store: denied')
    expect(describeError('session.start store', 'odd')).toBe('session.start store: odd')
  })
})

describe('traceEdit', () => {
  test('names the key, the action, the language and the match count, and no draft text', () => {
    const view = { draft: 'secret te', matches: [{ word: word('testing'), suffix: 'sting' }], index: 0, language: 'prose' } as const
    const outcome = { box: { text: 'secret te', cursor: 9, decorations: [] }, view }
    expect(traceEdit({ key: 'tab' }, 'accept', outcome, 0.0123)).toBe('prompt.edit tab → accept: prose, 1 matches (0.012 ms)')
    expect(traceEdit(undefined, 'edit', { ...outcome, view: null }, 0)).toBe('prompt.edit no key → edit: no matches (0.000 ms)')
    expect(traceEdit({ key: 'tab' }, 'accept', outcome, 0)).not.toContain('secret')
  })
})
