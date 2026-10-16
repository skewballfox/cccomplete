import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { CompletionView, Word } from '../types'

const view: CompletionView = {
  draft: 'testing',
  prefixLength: 2,
  ghostLength: 5,
  index: 1,
  matches: [
    { word: 'testing' as Word, suffix: 'sting' },
    { word: 'tester' as Word, suffix: 'ster' },
    { word: 'tests' as Word, suffix: 'sts' },
  ],
}

const band = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 6,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 6 },
  view: {},
} as const

/** Answers, beneath the plugin, a read of the view value with `view`. The kit has no `$.state`, so the test stands in for the host. */
const holdView = (on: On, current: CompletionView | null = view): unknown[] => {
  const written: unknown[] = []
  on('state.get', { plugin: 'cccomplete', key: 'view' }, () => ({ value: { value: current, version: 1 } }))
  on('state.set', (_$, e) => {
    written.push(e.value)
    return { value: { isSet: true, version: 2 } }
  })
  return written
}

const mountBar = ($: Engine) =>
  $.ui.mount({ plugin: 'cccomplete', surface: 'terminal', component: 'AbovePrompt', props: band })

test('the bar draws one button per match', async ($, on) => {
  holdView(on)
  const ui = await mountBar($)
  const buttons = await ui.findAll({ type: 'Button' })
  expect(buttons.map(button => button.text)).toEqual(['testing', 'tester', 'tests'])
})

test('with no matches the bar keeps its row and shows the key hint', async ($, on) => {
  holdView(on, null)
  const ui = await mountBar($)
  expect(await ui.findAll({ type: 'Button' })).toEqual([])
  expect((await ui.find({ type: 'Text', text: /tab accepts/ }))?.text).toContain('tab accepts')
})

test('pressing a button fills the prompt with that word and a space', async ($, on: On) => {
  const filled: string[] = []
  const written = holdView(on)
  on('prompt.fill', (_$, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  const ui = await mountBar($)
  await ui.press({ key: 'match-2' })
  expect(filled).toEqual(['tests '])
  expect(written.at(-1)).toBeNull()
})

test('submitting removes the inline suggestion before the model sees the prompt', async ($, on: On) => {
  const seen: string[] = []
  holdView(on)
  on('prompt.submit', (_$, e) => {
    seen.push(e.text)
    return { text: e.text }
  })
  await $.prompt.submit({ text: 'testing', wait: false, origin: { kind: 'composer' } })
  expect(seen).toEqual(['te'])
})
