import { describe, expect, test } from 'claude-code/testing'

import type { CompletionView } from '../types'
import { accept, actionFor, attach, clip, cycle, fittingMatches, typeaheadRows } from '../src/completion'
import type { PromptText } from '../src/completion'
import { DEFAULTS } from '../src/config'
import type { Config } from '../src/config'
import { Lexicon } from '../src/lexicon'
import { seeded } from './support'

const trained = (): Lexicon => {
  const lexicon = new Lexicon()
  lexicon.learn([
    { kind: 'prose', text: 'testing testing testing tester tested tests. run tests' },
    { kind: 'prose', text: 'see `src/trie.ts` and `src/tree.ts`' },
  ])
  return lexicon
}

/** Inline by default, because most of these tests exercise the inline suggestion. */
const config = (change: Partial<Config> = {}): Config => ({ ...DEFAULTS, display: 'inline', ...change })

const typed = (text: string): PromptText => ({ text, cursor: text.length })

const viewOf = (text: string, change: Partial<Config> = {}): CompletionView => {
  const { view } = attach(typed(text), trained(), config(change))
  if (view === null) throw new Error(`expected a suggestion for ${text}`)
  return view
}

describe('attach', () => {
  test('draws the best match as dim virtual text after the draft, and leaves the draft alone', () => {
    const { box, view } = attach(typed('te'), trained(), config())
    expect(box).toEqual({ text: 'te', cursor: 2, decorations: [{ start: 2, end: 2, virtualText: 'sting', dimColor: true }] })
    expect(view?.matches.map(match => match.word)).toEqual(['testing', 'tests', 'tested', 'tester'])
    expect(view).toMatchObject({ draft: 'te', index: 0, language: 'prose' })
  })

  test('paints the inline text in the configured colour', () => {
    const ghostPaint = { kind: 'color', color: '#1e1e1e' } as const
    const { box } = attach(typed('te'), trained(), config({ ghostPaint }))
    expect(box.decorations).toEqual([{ start: 2, end: 2, virtualText: 'sting', color: '#1e1e1e' }])
  })

  test('draws no inline text in bar mode, but still finds matches for the bar', () => {
    const { box, view } = attach(typed('te'), trained(), config({ display: 'bar' }))
    expect(box).toEqual({ text: 'te', cursor: 2, decorations: [] })
    expect(view?.matches).toHaveLength(4)
  })

  test('stays quiet below the minimum length, after punctuation, or with no match', () => {
    expect(attach(typed('t'), trained(), config()).view).toBeNull()
    expect(attach(typed('te. '), trained(), config()).view).toBeNull()
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

  test('predicts the next word after a space, unless turned off', () => {
    expect(viewOf('run ').matches.map(match => match.word)).toEqual(['tests'])
    expect(attach(typed('run '), trained(), config({ predictNext: false })).view).toBeNull()
  })

  test('completes code tokens inside backticks', () => {
    const view = viewOf('open `src/tr')
    expect(view.matches.map(match => match.word)).toEqual(['src/tree.ts', 'src/trie.ts'])
    expect(view.language).toBe('code')
  })
})

describe('actionFor', () => {
  test('maps the configured keys, and only while suggestions show', () => {
    const view = viewOf('te')
    const box = typed('te')
    expect(actionFor({ key: 'right' }, view, box, config())).toBe('accept')
    expect(actionFor({ key: 'e', ctrl: true }, view, box, config())).toBe('accept')
    expect(actionFor({ key: 'd', ctrl: true }, view, box, config())).toBe('next')
    expect(actionFor({ key: 'a', ctrl: true }, view, box, config())).toBe('previous')
    expect(actionFor({ key: 'x' }, view, box, config())).toBeNull()
    expect(actionFor({ key: 'right' }, null, box, config())).toBeNull()
    expect(actionFor(undefined, view, box, config())).toBeNull()
  })

  test('ignores a stale view: another draft, or the cursor moved off the end', () => {
    const view = viewOf('te')
    expect(actionFor({ key: 'right' }, view, typed('tea'), config())).toBeNull()
    expect(actionFor({ key: 'right' }, view, { text: 'te', cursor: 1 }, config())).toBeNull()
  })
})

describe('cycle', () => {
  test('moves the inline text through the matches and wraps at both ends', () => {
    const first = viewOf('te')
    const second = cycle(first, 1, config())
    expect(second.box).toEqual({ text: 'te', cursor: 2, decorations: [{ start: 2, end: 2, virtualText: 'sts', dimColor: true }] })
    const back = cycle(first, -1, config())
    expect(back.view?.index).toBe(3)
    expect(back.box.decorations[0]?.virtualText).toBe('ster')
  })
})

describe('accept', () => {
  test('writes the chosen word and a space, then predicts what follows it', () => {
    const outcome = accept(viewOf('ru'), 0, trained(), config())
    expect(outcome.box.text).toBe('run ')
    expect(outcome.box.cursor).toBe(4)
    expect(outcome.view?.matches.map(match => match.word)).toEqual(['tests'])
  })

  test('omits the space when configured, inside code, and ignores an index outside the matches', () => {
    expect(accept(viewOf('te'), 0, trained(), config({ trailingSpace: false })).box.text).toBe('testing')
    expect(accept(viewOf('`src/tr'), 1, trained(), config()).box.text).toBe('`src/trie.ts')
    expect(accept(viewOf('te'), 99, trained(), config()).box).toEqual({ text: 'te', cursor: 2, decorations: [] })
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
  test('the box always holds exactly what was typed, and the inline text sits only at its end', () => {
    const random = seeded(7)
    const lexicon = trained()
    const settings = config()
    let box: PromptText = typed('')
    let view: CompletionView | null = null
    let model = ''

    for (let step = 0; step < 2000; step += 1) {
      const roll = random()
      const action = actionFor(roll < 0.1 ? { key: 'right' } : undefined, view, box, settings)
      if (action === 'accept' && view !== null) {
        const outcome = accept(view, view.index, lexicon, settings)
        model = outcome.box.text
        view = outcome.view
        box = { text: outcome.box.text, cursor: outcome.box.cursor }
      } else {
        // The host's part of an edit: delete one character or type one at the cursor.
        model =
          roll < 0.25 ? model.slice(0, -1) : model + (['t', 'e', 's', 'i', 'n', 'g', ' ', '`', '.'][Math.floor(random() * 9)] ?? 't')
        const outcome = attach(typed(model), lexicon, settings)
        view = outcome.view
        box = { text: outcome.box.text, cursor: outcome.box.cursor }
        outcome.box.decorations.forEach(decoration => {
          expect(decoration.start).toBe(model.length)
          expect(decoration.virtualText.length).toBeGreaterThan(0)
        })
      }
      expect(box.text).toBe(model)
      expect(box.cursor).toBe(model.length)
      if (view !== null) expect(view.draft).toBe(model)
    }
  })
})

describe('typeaheadRows', () => {
  const rows = (text: string, change: Partial<Config> = {}): readonly string[] =>
    typeaheadRows({ text, cursor: text.length, token: text.split(/\s/).at(-1) ?? '' }, trained(), config(change)).map(row => row.text)

  test('offers each match as a row that rewrites the whole token', () => {
    expect(rows('say te', { limit: 2 })).toEqual(['testing', 'tests'])
    expect(rows('open `src/tr')).toEqual(['`src/tree.ts', '`src/trie.ts'])
  })

  test('offers nothing for slash commands, after a space, off the end, or when turned off', () => {
    expect(rows('/te')).toEqual([])
    expect(rows('run ')).toEqual([])
    expect(rows('te', { typeahead: false })).toEqual([])
    expect(typeaheadRows({ text: 'te more', cursor: 2, token: 'te' }, trained(), config())).toEqual([])
  })
})
