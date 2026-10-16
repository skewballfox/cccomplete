import { describe, expect, test } from 'claude-code/testing'

import type { CompletionView } from '../types'
import { accept, actionFor, attach, clip, cycle, detach, fittingMatches, ghostOf, withoutGhost } from '../src/completion'
import type { EditShape, PromptText } from '../src/completion'
import { DEFAULTS } from '../src/config'
import type { Config } from '../src/config'
import { CompletionTrie } from '../src/trie'
import { seeded } from './support'

const trained = (): CompletionTrie => {
  const trie = new CompletionTrie()
  trie.ingest('testing testing testing tester tested tests')
  return trie
}

const config = (change: Partial<Config> = {}): Config => ({ ...DEFAULTS, ...change })

const typed = (text: string): PromptText => ({ text, cursor: text.length })

const viewOf = (text: string, change: Partial<Config> = {}): CompletionView => {
  const { view } = attach(typed(text), trained(), config(change))
  if (view === null) throw new Error(`expected a suggestion for ${text}`)
  return view
}

/** The host's part of an edit: apply the splice to the draft. */
const applyEdit = (edit: EditShape): PromptText => ({
  text: edit.text.slice(0, edit.start) + edit.inputText + edit.text.slice(edit.end),
  cursor: edit.start + edit.inputText.length,
})

describe('attach', () => {
  test('shows the best match inline, dim, with the cursor before it', () => {
    const { box, view } = attach(typed('te'), trained(), config())
    expect(box).toEqual({ text: 'testing', cursor: 2, decorations: [{ start: 2, end: 7, dimColor: true }] })
    expect(view?.matches.map(match => match.word)).toEqual(['testing', 'tests', 'tested', 'tester'])
    expect(view).toMatchObject({ draft: 'testing', prefixLength: 2, ghostLength: 5, index: 0 })
  })

  test('adds no inline text in bar mode', () => {
    const { box, view } = attach(typed('te'), trained(), config({ display: 'bar' }))
    expect(box).toEqual({ text: 'te', cursor: 2, decorations: [] })
    expect(view?.ghostLength).toBe(0)
  })

  test('stays quiet below the minimum length, off a word, or with no match', () => {
    expect(attach(typed('t'), trained(), config()).view).toBeNull()
    expect(attach(typed('te '), trained(), config()).view).toBeNull()
    expect(attach(typed('zz'), trained(), config()).view).toBeNull()
    expect(attach(typed('t'), trained(), config({ minPrefix: 1 })).view).not.toBeNull()
  })

  test('does not suggest when the cursor is not at the end, and keeps the cursor', () => {
    const { box, view } = attach({ text: 'te more', cursor: 2 }, trained(), config())
    expect(view).toBeNull()
    expect(box).toEqual({ text: 'te more', cursor: 2, decorations: [] })
  })

  test('limits the number of matches', () => {
    expect(viewOf('te', { limit: 2 }).matches).toHaveLength(2)
  })
})

describe('detach', () => {
  test('removes the inline text and clamps positions into the typed text', () => {
    const view = viewOf('te')
    const edit: EditShape = { text: view.draft, cursor: 2, start: 2, end: 4, inputText: '' }
    expect(detach(edit, view)).toEqual({ text: 'te', cursor: 2, start: 2, end: 2, inputText: '' })
  })

  test('returns the same edit when no view applies or the draft changed', () => {
    const edit: EditShape = { text: 'te', cursor: 2, start: 2, end: 2, inputText: 'x' }
    expect(detach(edit, null)).toBe(edit)
    expect(detach(edit, viewOf('te'))).toBe(edit)
    const barView = viewOf('te', { display: 'bar' })
    expect(detach({ ...edit, text: barView.draft }, barView)).toEqual({ ...edit, text: barView.draft })
  })
})

describe('actionFor', () => {
  test('maps the configured keys, and only while suggestions show', () => {
    const view = viewOf('te')
    expect(actionFor({ key: 'tab' }, view, config())).toBe('accept')
    expect(actionFor({ key: 'n', ctrl: true }, view, config())).toBe('next')
    expect(actionFor({ key: 'p', ctrl: true }, view, config())).toBe('previous')
    expect(actionFor({ key: 'x' }, view, config())).toBeNull()
    expect(actionFor({ key: 'tab' }, null, config())).toBeNull()
    expect(actionFor(undefined, view, config())).toBeNull()
  })
})

describe('cycle', () => {
  test('moves the inline text through the matches and wraps at both ends', () => {
    const first = viewOf('te')
    const second = cycle(first, 1, config())
    expect(ghostOf(second.view ?? first)).toBe('sts')
    expect(second.box.text).toBe('tests')
    const back = cycle(first, -1, config())
    expect(back.view?.index).toBe(3)
    expect(back.box.text).toBe('tester')
    expect(back.box.cursor).toBe(2)
  })
})

describe('accept', () => {
  test('writes the chosen word and a space, and shows no new suggestion', () => {
    const outcome = accept(viewOf('te'), 1, config())
    expect(outcome.box).toEqual({ text: 'tests ', cursor: 6, decorations: [] })
    expect(outcome.view).toBeNull()
  })

  test('omits the space when configured, and ignores an index outside the matches', () => {
    expect(accept(viewOf('te'), 0, config({ trailingSpace: false })).box.text).toBe('testing')
    expect(accept(viewOf('te'), 99, config()).box.text).toBe('te')
  })
})

describe('withoutGhost', () => {
  test('strips the inline text from submitted text, and nothing else', () => {
    const view = viewOf('te')
    expect(withoutGhost('testing', view)).toBe('te')
    expect(withoutGhost('say testing', view)).toBe('say te')
    expect(withoutGhost('te', view)).toBe('te')
    expect(withoutGhost('testing', null)).toBe('testing')
    expect(withoutGhost('te', viewOf('te', { display: 'bar' }))).toBe('te')
  })
})

describe('fittingMatches', () => {
  test('keeps the matches that fit and always keeps the best one', () => {
    const { matches } = viewOf('te')
    expect(fittingMatches(matches, 80)).toHaveLength(4)
    expect(fittingMatches(matches, 22).map(match => match.word)).toEqual(['testing', 'tests'])
    expect(fittingMatches(matches, 3).map(match => match.word)).toEqual(['testing'])
  })
})

describe('clip', () => {
  test('leaves short text and cuts long text to the width with an ellipsis', () => {
    expect(clip('abc', 3)).toBe('abc')
    expect(clip('abcd', 3)).toBe('ab…')
    expect(clip('abcd', 0)).toBe('…')
  })
})

describe('the whole pipeline', () => {
  test('keeps the typed text intact through random typing and deleting', () => {
    const random = seeded(7)
    const trie = trained()
    const settings = config()
    let box: PromptText = typed('')
    let view: CompletionView | null = null
    let model = ''

    for (let step = 0; step < 2000; step += 1) {
      const roll = random()
      const cursor = box.cursor
      const edit: EditShape =
        roll < 0.2 && model.length > 0
          ? { text: box.text, cursor, start: cursor - 1, end: cursor, inputText: '' }
          : { text: box.text, cursor, start: cursor, end: cursor, inputText: roll < 0.3 ? ' ' : (['t', 'e', 's', 'i', 'n', 'g', 'x'][Math.floor(random() * 7)] ?? 't') }
      model = edit.inputText === '' ? model.slice(0, -1) : model + edit.inputText

      const outcome = attach(applyEdit(detach(edit, view)), trie, settings)
      view = outcome.view
      box = { text: outcome.box.text, cursor: outcome.box.cursor }

      const typedLength = view === null ? box.text.length : view.prefixLength
      expect(box.text.slice(0, typedLength)).toBe(model)
      expect(box.cursor).toBe(typedLength)
      if (view !== null) expect(view.draft).toBe(box.text)
    }
  })
})
