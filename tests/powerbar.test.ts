import { describe, expect, test } from 'claude-code/testing'

import type { Completion, Word } from '../types'
import { ARROW, powerbar } from '../src/powerbar'

const match = (word: string): Completion => ({ word: word as Word, suffix: word.slice(2) })
const matches = [match('testing'), match('tester'), match('tests')]
const width = (text: string): number => text.length

describe('powerbar', () => {
  test('shows the hint alone in one segment when there are no matches', () => {
    const runs = powerbar([], 0, 'right accepts', 40)
    expect(runs.map(run => run.text)).toEqual([' right accepts ', ARROW])
  })

  test('clips the hint to the row', () => {
    const runs = powerbar([], 0, 'right accepts, ctrl+d and ctrl+a cycle', 12)
    expect(runs.reduce((used, run) => used + width(run.text), 0)).toBeLessThanOrEqual(12)
  })

  test('colours only the active segment, and joins each segment to the next one', () => {
    const runs = powerbar(matches, 1, 'hint', 80)
    const bodies = runs.filter(run => run.text !== ARROW && run.text.startsWith(' ') && !run.dim)
    expect(bodies.map(run => run.text)).toEqual([' testing ', ' tester ', ' tests '])
    expect(new Set(bodies.map(run => run.background)).size).toBe(2)
    const arrows = runs.filter(run => run.text === ARROW)
    expect(arrows.map(run => run.color)).toEqual(bodies.map(run => run.background))
    expect(arrows.map(run => run.background)).toEqual([bodies[1]?.background, bodies[2]?.background, null])
  })

  test('fits the row and keeps the best match in a narrow one', () => {
    const wide = powerbar(matches, 0, 'hint', 80).reduce((used, run) => used + width(run.text), 0)
    expect(wide).toBeLessThanOrEqual(80)
    const narrow = powerbar(matches, 0, 'hint', 3)
    expect(narrow.map(run => run.text)).toEqual([' testing ', ARROW])
  })

  test('drops the hint when it does not fit', () => {
    const runs = powerbar([match('testing')], 0, 'a long hint indeed', 14)
    expect(runs.some(run => run.dim)).toBe(false)
  })
})
