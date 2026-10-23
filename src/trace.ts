/**
 * Diagnostics: the hook failures the plugin always keeps, and the trace it keeps when the `trace` option is on.
 *
 * Audience: contributors to cccomplete, and users who report a problem. Not
 * covered: how `/cccomplete` lays them out (see hooks/register.tsx).
 *
 * Both are short lists in memory. They hold no draft text, only key names,
 * kinds of lookup, counts and times, so a trace can be pasted into a bug report.
 */

import type { HookFailure } from 'claude-code'

import type { Outcome } from './completion'
import { formatPress } from './keys'
import type { KeyPress } from './keys'

/** Most failures kept. The oldest goes first. */
export const MAX_FAILURES = 5

/** Most trace lines kept. The oldest goes first. */
export const MAX_TRACE = 20

/** `list` with `line` added at the end, keeping the newest `limit` lines. */
export const appendBounded = (list: readonly string[], line: string, limit: number): readonly string[] =>
  [...list, line].slice(-limit)

/** One line for a hook that threw or ran out of time, as the host reports it to a catch handler. */
export const describeFailure = (hook: string, failure: HookFailure): string =>
  `${hook}: ${failure.kind}${failure.message === undefined ? '' : `: ${failure.message}`}`

/** One line for a step that failed inside a hook that went on, such as one host call at session start. */
export const describeError = (step: string, error: unknown): string =>
  `${step}: ${error instanceof Error ? error.message : String(error)}`

/**
 * One trace line for a keystroke: the key, what happened, how many matches and the time.
 *
 * `action` is the bound action the key ran, or `edit` when the host applied the key.
 */
export const traceEdit = (
  key: KeyPress | undefined,
  action: 'accept' | 'next' | 'previous' | 'edit',
  outcome: Outcome,
  ms: number,
): string => {
  const shown = outcome.view === null ? 'no matches' : `${outcome.view.language}, ${outcome.view.matches.length} matches`
  return `prompt.edit ${key === undefined ? 'no key' : formatPress(key)} → ${action}: ${shown} (${ms.toFixed(3)} ms)`
}
