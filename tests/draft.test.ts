import { describe, expect, test } from 'claude-code/testing'

import { languageOf, targetOf } from '../src/draft'

const settings = { minPrefix: 2, predictNext: true } as const

describe('targetOf', () => {
  test('completes prose with the word before as context', () => {
    expect(targetOf('run te', settings)).toEqual({ kind: 'word', language: 'prose', prefix: 'te', context: 'run', context2: null })
    expect(targetOf('we run te', settings)).toMatchObject({ context: 'run', context2: 'we run' })
    expect(targetOf('te', settings)).toEqual({ kind: 'word', language: 'prose', prefix: 'te', context: null, context2: null })
  })

  test('drops the context across punctuation or a line break', () => {
    expect(targetOf('run. te', settings)).toMatchObject({ kind: 'word', context: null })
    expect(targetOf('run\nte', settings)).toMatchObject({ kind: 'word', context: null })
  })

  test('predicts the next word after spaces, not after punctuation, and not when turned off', () => {
    expect(targetOf('run ', settings)).toEqual({ kind: 'next', language: 'prose', context: 'run', context2: null })
    expect(targetOf('we, run ', settings)).toMatchObject({ context: 'run', context2: null })
    expect(targetOf('run. ', settings)).toBeNull()
    expect(targetOf(' ', settings)).toBeNull()
    expect(targetOf('run ', { ...settings, predictNext: false })).toBeNull()
  })

  test('honours the minimum prefix length everywhere but prediction', () => {
    expect(targetOf('run t', settings)).toBeNull()
    expect(targetOf('/c', { ...settings, minPrefix: 3 })).toBeNull()
    expect(targetOf('`a', settings)).toBeNull()
  })

  test('completes a slash command name, and treats its arguments as prose', () => {
    expect(targetOf('/clea', settings)).toEqual({ kind: 'command', prefix: 'clea' })
    expect(targetOf('/plugin:sk', settings)).toEqual({ kind: 'command', prefix: 'plugin:sk' })
    expect(targetOf('/', settings)).toBeNull()
    expect(targetOf('/review the te', settings)).toMatchObject({ kind: 'word', language: 'prose', prefix: 'te' })
  })

  test('completes shell tokens after a leading !, with command starts as context', () => {
    expect(targetOf('!gi', settings)).toEqual({ kind: 'word', language: 'shell', prefix: 'gi', context: '', context2: null })
    expect(targetOf('!git co', settings)).toEqual({ kind: 'word', language: 'shell', prefix: 'co', context: 'git', context2: ' git' })
    expect(targetOf('!ls | gr', settings)).toMatchObject({ context: '' })
    expect(targetOf('!cat ./sr', settings)).toMatchObject({ prefix: './sr', context: 'cat' })
    expect(targetOf('!git ', settings)).toEqual({ kind: 'next', language: 'shell', context: 'git', context2: ' git' })
    expect(targetOf('!', settings)).toEqual({ kind: 'next', language: 'shell', context: '', context2: null })
  })

  test('completes code tokens inside backticks, and prose once the span closes', () => {
    expect(targetOf('see `src/tr', settings)).toEqual({ kind: 'code', prefix: 'src/tr' })
    expect(targetOf('```ts\nconst fo', settings)).toEqual({ kind: 'code', prefix: 'fo' })
    expect(targetOf('see `x` te', settings)).toMatchObject({ kind: 'word', language: 'prose' })
  })
})

describe('languageOf', () => {
  test('names the index each kind of target uses', () => {
    const language = (text: string): string | null => {
      const target = targetOf(text, settings)
      return target === null ? null : languageOf(target)
    }
    expect(['/clea', '`ab', '!git ', 'run te'].map(language)).toEqual(['command', 'code', 'shell', 'prose'])
  })
})
