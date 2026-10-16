// The value types that cross a module boundary, and the `$.state` contract.
// Audience: contributors to cccomplete. See docs/ARCHITECTURE.md for the design.
//
// Branded types cannot be built by assignment. Each has one constructor
// that checks its invariant: `toWord` and `tailPrefix` in src/words.ts.
// The brand exists only in the type. At run time a Word is a plain string.

/** A string that carries a name in its type, so two different kinds of string never mix. */
export type Brand<Base extends string, Name extends string> = Base & { readonly __brand: Name }

/** A word the trie stores: 3 to 64 code units, at least one letter, case preserved. */
export type Word = Brand<string, 'Word'>

/** The non-empty run of word characters that ends the draft. Never longer than 64 code units. */
export type Prefix = Brand<string, 'Prefix'>

/** A position in the trie's insertion clock. Each insertion gets a larger one, so no two words rank equal. */
export type Tick = number & { readonly __brand: 'Tick' }

/** Suggestions a lookup may return, 1 to 9. */
export type SuggestionLimit = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

/** One suggestion: the whole word, and the text that completes the prefix typed so far. */
export type Completion = {
  readonly word: Word
  readonly suffix: string
}

/**
 * What the prompt box and the bar show right now.
 *
 * Invariant: `draft.slice(0, prefixLength)` is what the user typed,
 * `draft.slice(prefixLength)` is the inline suggestion (`ghostLength` code units),
 * and the cursor sits at `prefixLength`.
 */
export type CompletionView = {
  /** The whole box text, typed text plus inline suggestion. */
  readonly draft: string
  /** Where the typed text ends and the inline suggestion begins. */
  readonly prefixLength: number
  /** Length of the inline suggestion. Zero when the display is `bar`. */
  readonly ghostLength: number
  /** The suggestions, best first. Never empty. */
  readonly matches: readonly Completion[]
  /** Which suggestion the inline text and the highlighted button show. */
  readonly index: number
}

declare module 'claude-code' {
  interface PluginState {
    cccomplete: { view: CompletionView | null }
  }
}
