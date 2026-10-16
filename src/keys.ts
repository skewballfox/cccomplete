/**
 * Parses the key combinations a user configures, and matches them against key presses.
 *
 * Audience: contributors to cccomplete. Not covered: which combinations the
 * terminal delivers to the plugin at all (run `/cccomplete` to see the last key it received).
 */

const NAMED_KEYS = [
  'tab', 'return', 'escape', 'up', 'down', 'left', 'right',
  'home', 'end', 'pageup', 'pagedown', 'backspace', 'delete',
] as const
const LETTERS = [
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
  'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
] as const
const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

export type NamedKey = (typeof NAMED_KEYS)[number]
export type PrintableKey = (typeof LETTERS)[number] | (typeof DIGITS)[number]
export type KeyName = NamedKey | PrintableKey

/** A key plus the modifiers that must be held with it, and no others. */
export type KeyCombo = Readonly<{
  key: KeyName
  ctrl: boolean
  shift: boolean
  meta: boolean
}>

/** The key event the host reports with an edit. Modifiers are present only when held. */
export type KeyPress = Readonly<{
  key: string
  ctrl?: true
  shift?: true
  meta?: true
}>

export type KeyParseError =
  | 'empty'
  | 'missing-key'
  | 'extra-key'
  | 'unknown-key'
  | 'unknown-modifier'
  | 'repeated-modifier'
  | 'needs-modifier'

export type Parsed<Value, Failure> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{ ok: false; error: Failure }>

type Modifier = 'ctrl' | 'shift' | 'meta'

const NAMED = new Set<string>(NAMED_KEYS)
const PRINTABLE = new Set<string>([...LETTERS, ...DIGITS])

const KEY_ALIASES: Readonly<Record<string, NamedKey>> = { enter: 'return', esc: 'escape' }
const MODIFIER_ALIASES: Readonly<Record<string, Modifier>> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  shift: 'shift',
  meta: 'meta',
  alt: 'meta',
  option: 'meta',
}

const isKeyName = (text: string): text is KeyName => NAMED.has(text) || PRINTABLE.has(text)

const fail = (error: KeyParseError): Parsed<KeyCombo, KeyParseError> => ({ ok: false, error })

/**
 * Parses text such as `tab`, `ctrl+n` or `ctrl+shift+enter`.
 *
 * Rules: case does not matter; `+` separates parts; the last part is the key.
 * A letter or digit needs `ctrl` or `meta`, because bare printable keys are typing.
 */
export const parseCombo = (text: string): Parsed<KeyCombo, KeyParseError> => {
  const parts = text.trim().toLowerCase().split('+').map(part => part.trim())
  if (text.trim() === '') return fail('empty')
  const keyText = parts.at(-1) ?? ''
  if (keyText === '') return fail('missing-key')

  const held = new Set<Modifier>()
  for (const part of parts.slice(0, -1)) {
    const modifier = MODIFIER_ALIASES[part]
    if (modifier === undefined) return fail(isKeyName(KEY_ALIASES[part] ?? part) ? 'extra-key' : 'unknown-modifier')
    if (held.has(modifier)) return fail('repeated-modifier')
    held.add(modifier)
  }

  const key = KEY_ALIASES[keyText] ?? keyText
  if (!isKeyName(key)) return fail('unknown-key')
  const combo: KeyCombo = { key, ctrl: held.has('ctrl'), shift: held.has('shift'), meta: held.has('meta') }
  if (PRINTABLE.has(key) && !combo.ctrl && !combo.meta) return fail('needs-modifier')
  return { ok: true, value: combo }
}

/** True when `press` is exactly `combo`: the same key and the same modifiers. */
export const matches = (combo: KeyCombo, press: KeyPress): boolean =>
  press.key.toLowerCase() === combo.key &&
  (press.ctrl === true) === combo.ctrl &&
  (press.shift === true) === combo.shift &&
  (press.meta === true) === combo.meta

export const sameCombo = (a: KeyCombo, b: KeyCombo): boolean =>
  a.key === b.key && a.ctrl === b.ctrl && a.shift === b.shift && a.meta === b.meta

/** Renders a combo the way a user writes it: `ctrl+shift+n`. */
export const formatCombo = (combo: KeyCombo): string =>
  [combo.ctrl ? 'ctrl' : '', combo.shift ? 'shift' : '', combo.meta ? 'meta' : '', combo.key]
    .filter(part => part !== '')
    .join('+')

/** Renders a key press the same way, for the status command. */
export const formatPress = (press: KeyPress): string =>
  [press.ctrl === true ? 'ctrl' : '', press.shift === true ? 'shift' : '', press.meta === true ? 'meta' : '', press.key]
    .filter(part => part !== '')
    .join('+')
