import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { CompletionView } from '../types'
import { word } from './support'

const view: CompletionView = {
  draft: 'te',
  index: 1,
  language: 'prose',
  matches: [
    { word: word('testing'), suffix: 'sting' },
    { word: word('tester'), suffix: 'ster' },
    { word: word('tests'), suffix: 'sts' },
  ],
}

/** The tag the hooks module stores the view under. */
const SHAPE = 'virtual-1'

const band = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 6,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 6 },
  view: {},
} as const

/**
 * Answers, beneath the plugin, a read of the view value with `stored`. The kit has no `$.state`, so the test stands in for the host.
 * A view is stored with its shape tag; pass a bare value to stand for what an older version stored.
 */
const holdView = (on: On, stored: unknown = { shape: SHAPE, value: view }): unknown[] => {
  const written: unknown[] = []
  on('state.get', { plugin: 'cccomplete', key: 'view' }, () => ({ value: { value: stored, version: 1 } }))
  on('state.set', (_$, e) => {
    written.push(e.value)
    return { value: { isSet: true, version: 2 } }
  })
  return written
}

const mountBar = ($: Engine) =>
  $.ui.mount({ plugin: 'cccomplete', surface: 'terminal', component: 'AbovePrompt', props: band })

test('the buttons style draws one button per match', { options: { display: 'both', bar_style: 'buttons' } }, async ($, on) => {
  holdView(on)
  const ui = await mountBar($)
  const buttons = await ui.findAll({ type: 'Button' })
  expect(buttons.map(button => button.text)).toEqual(['testing', 'tester', 'tests'])
})

test('with no matches the buttons bar keeps its row and shows the key hint', { options: { display: 'both', bar_style: 'buttons' } }, async ($, on) => {
  holdView(on, { shape: SHAPE, value: null })
  const ui = await mountBar($)
  expect(await ui.findAll({ type: 'Button' })).toEqual([])
  expect((await ui.find({ type: 'Text', text: /right or ctrl\+e accepts/ }))?.text).toContain('right or ctrl+e accepts')
})

test('a view stored by the version that kept the suggestion in the draft reads as no view', { options: { display: 'both', bar_style: 'buttons' } }, async ($, on) => {
  holdView(on, { draft: 'testing', prefixLength: 2, ghostLength: 5, index: 0, matches: view.matches })
  const ui = await mountBar($)
  expect(await ui.findAll({ type: 'Button' })).toEqual([])
})

test('pressing a button fills the prompt with that word and a space', { options: { display: 'both', bar_style: 'buttons' } }, async ($, on: On) => {
  const filled: string[] = []
  const written = holdView(on)
  on('prompt.fill', (_$, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  const ui = await mountBar($)
  await ui.press({ key: 'match-2' })
  expect(filled).toEqual(['tests '])
  expect(written.at(-1)).toEqual({ shape: SHAPE, value: null })
})

test('submitting passes the prompt on exactly as typed and forgets the suggestions', async ($, on: On) => {
  const seen: string[] = []
  const written = holdView(on)
  on('prompt.submit', (_$, e) => {
    seen.push(e.text)
    return { text: e.text }
  })
  await $.prompt.submit({ text: 'te', wait: false, origin: { kind: 'composer' } })
  expect(seen).toEqual(['te'])
  expect(written).toEqual([{ shape: SHAPE, value: null }])
})

test('the powerline bar draws a segment and an arrow per match, and marks the active one', { options: { display: 'both' } }, async ($, on) => {
  holdView(on)
  const ui = await mountBar($)
  const words = await ui.findAll({ type: 'Text', text: /^ (testing|tester|tests) $/ })
  expect(words.map(run => run.text)).toEqual([' testing ', ' tester ', ' tests '])
  expect(await ui.findAll({ type: 'Text', text: '\u{E0B0}' })).toHaveLength(3)
})

test('with no matches the powerline bar keeps its row and shows the key hint', { options: { display: 'both' } }, async ($, on) => {
  holdView(on, { shape: SHAPE, value: null })
  const ui = await mountBar($)
  expect(await ui.findAll({ type: 'Button' })).toEqual([])
  expect((await ui.find({ type: 'Text', text: /right or ctrl\+e accepts/ }))?.text).toContain('right or ctrl+e accepts')
})
