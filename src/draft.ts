/**
 * Reads a draft and decides what to look up: which index, which prefix, which context.
 *
 * Audience: contributors to cccomplete. Not covered: the lookup itself (see lexicon.ts).
 *
 * Every function here reads a bounded part of the end of the draft, so a
 * keystroke costs the same in a short draft and in a 200,000-character paste.
 */

import type { Context, Prefix, ViewLanguage } from '../types'
import { contextBefore, endsInCode, tailPrefix } from './words'

/** Which index serves a draft: prose, code (inside backticks), shell (after `!`), or slash commands. */
export type Language = ViewLanguage

/**
 * One lookup.
 *
 * - `word`: complete `prefix`, preferring words seen after `context`.
 * - `next`: no word typed yet after a space; predict what follows `context`.
 * - `code`: complete a code token inside backticks.
 * - `command`: complete a slash command's name.
 */
export type Target =
  | Readonly<{ kind: 'word'; language: 'prose' | 'shell'; prefix: Prefix; context: Context | null }>
  | Readonly<{ kind: 'next'; language: 'prose' | 'shell'; context: Context }>
  | Readonly<{ kind: 'code'; prefix: Prefix }>
  | Readonly<{ kind: 'command'; prefix: Prefix }>

/** What `targetOf` needs from the configuration. */
export type TargetSettings = Readonly<{ minPrefix: number; predictNext: boolean }>

/** The language a target's matches belong to, which decides how an accepted match ends. */
export const languageOf = (target: Target): Language => {
  switch (target.kind) {
    case 'word':
    case 'next':
      return target.language
    case 'code':
    case 'command':
      return target.kind
  }
}

/**
 * Decides what to look up for a draft whose cursor is at its end, or returns `null` for nothing.
 *
 * - A draft that is `/` and a name completes the name from the slash commands.
 *   Once a space follows the name, the arguments are prose.
 * - A draft that starts with `!` is a shell command.
 * - The end of a draft inside a code span or fence completes code tokens.
 * - Otherwise the draft is prose.
 *
 * A prefix shorter than `minPrefix` gets nothing. A draft that ends in spaces
 * after a word predicts the next word when `predictNext` is on.
 */
export const targetOf = (text: string, settings: TargetSettings): Target | null => {
  if (text.startsWith('/')) {
    const name = tailPrefix(text, 'code')
    if (name !== null && name.length === text.length) {
      const prefix = tailPrefix(text.slice(1), 'code')
      return prefix !== null && prefix.length >= settings.minPrefix ? { kind: 'command', prefix } : null
    }
  }
  const shell = text.startsWith('!')
  if (!shell && endsInCode(text)) {
    const prefix = tailPrefix(text, 'code')
    return prefix !== null && prefix.length >= settings.minPrefix ? { kind: 'code', prefix } : null
  }
  const language = shell ? 'shell' : 'prose'
  const charset = shell ? 'code' : 'prose'
  const prefix = tailPrefix(text, charset)
  if (prefix !== null) {
    if (prefix.length < settings.minPrefix) return null
    const context = contextBefore(text, text.length - prefix.length, charset, shell)
    return { kind: 'word', language, prefix, context }
  }
  if (!settings.predictNext) return null
  const ends = text.endsWith(' ') || text.endsWith('\t') || (shell && text === '!')
  const context = ends ? contextBefore(text, text.length, charset, shell) : null
  return context === null ? null : { kind: 'next', language, context }
}
