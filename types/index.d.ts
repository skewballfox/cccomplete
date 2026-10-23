// The value types that cross a module boundary, and the `$.state` contract.
// Audience: contributors to cccomplete. See docs/ARCHITECTURE.md for the design.
//
// Branded types cannot be built by assignment. Each has one constructor
// that checks its invariant: `toWord`, `tailPrefix` and `contextBefore`
// (with `pairsOf`, which follows the same rules) in src/words.ts.
// The brand exists only in the type. At run time a Word is a plain string.

/** A string that carries a name in its type, so two different kinds of string never mix. */
export type Brand<Base extends string, Name extends string> = Base & { readonly __brand: Name }

/** A word the trie stores: 3 to 64 code units, at least one letter, case preserved. */
export type Word = Brand<string, 'Word'>

/** The non-empty run of word characters that ends the draft. Never longer than 64 code units. */
export type Prefix = Brand<string, 'Prefix'>

/**
 * The run of word characters directly before a word, with only spaces or tabs between: what predicts the word.
 * Empty for the first token of a shell command. Never longer than 64 code units.
 */
export type Context = Brand<string, 'Context'>

/** A position in the trie's insertion clock. Each insertion gets a larger one, so no two words rank equal. */
export type Tick = number & { readonly __brand: 'Tick' }

/** Suggestions a lookup may return, 1 to 9. */
export type SuggestionLimit = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

/** The fewest letters a match must add to the prefix, 1 to 3. */
export type Gain = 1 | 2 | 3

/** One suggestion: the whole word, and the text that completes the prefix typed so far. */
export type Completion = {
  readonly word: Word
  readonly suffix: string
}

/** Which index a view's matches came from. It decides how an accepted match ends. */
export type ViewLanguage = 'prose' | 'code' | 'shell' | 'command'

/**
 * What the prompt box and the bar show right now.
 *
 * Invariant: `draft` is exactly the box text, which is exactly what the user
 * typed, and the cursor sits at its end. The inline suggestion is never in
 * the draft: it is drawn after it as virtual text.
 */
export type CompletionView = {
  /** The box text when the matches were found. A view whose draft differs from the box is stale. */
  readonly draft: string
  /** The suggestions, best first. Never empty. */
  readonly matches: readonly Completion[]
  /** Which suggestion the inline text and the highlighted button show. */
  readonly index: number
  readonly language: ViewLanguage
}

declare module 'claude-code' {
  interface PluginState {
    cccomplete: { view: Shaped<CompletionView | null> }
  }
}
