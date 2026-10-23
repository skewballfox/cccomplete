# cccomplete

A Claude Code mod that completes the word at the end of the prompt from tries of the conversation: prose, code, shell commands and slash commands. It shows an inline suggestion, a bar of matches and rows in the host's typeahead. This file lists the constraints every change must keep. The reasoning behind them is in `docs/ALGORITHM.md` and `docs/ARCHITECTURE.md`.

All rules are mandatory. Where a rule rests on a fact about Claude Code, the fact comes from its type declarations for version 2.1.292 and its documentation, read on 2026-10-15, or, for virtual text, `prompt.autocomplete`, `$.command.list` and `$.store`, from the declarations for 2.1.309, read on 2026-10-22. Check the generated declarations in `.claude-plugin/types/` before relying on a fact that may have moved.

## Runtime

- The hooks module runs in an environment of its own. It has no DOM, Node, `require`, `eval`, `new Function`, timers or WebAssembly. Write plain TypeScript with no dependencies.
- Every file is an ES module named `.ts` or `.tsx`. A file imports only plugin files by relative path, plus `claude-code` for types. A dynamic `import()` does not load.
- Calls on `$` appear only in `hooks/register.tsx`. Write each call in full (`$.state.get`). Do not alias `$`, destructure it, or pass it to a function that is not declared at the top level of the same file. Write each event name as a string literal. Do not declare a second `on` inside `register`. Do not declare `h` or `Fragment`.
- `types/index.d.ts` holds types only. It cannot contain `declare const`, imports or code. It declares every `$.state` value the module touches.
- Values in `$.state` must survive `JSON.stringify` and `JSON.parse`.
- `src/` stays pure. It does not call the host and does not import `claude-code` at run time. All logic lives in `src/`. The hooks module only connects.
- `scripts/` holds build tools that run under Node on a developer's machine, never in the plugin. They may import `node:` modules and plugin files by their `.ts` path. Nothing in the plugin imports them.

## Latency

- The keystroke path is the host's edit, then `attach` (or `accept` or `cycle` for a bound key). Its target is under 13 ms. The host's own limit for a `prompt.edit` hook is 50 ms.
- A lookup reads at most five stored lists of nine words (two-word context, context, all words, English context, English words), scores their union and sorts at most 45 entries. It never walks a subtree and never scores the whole vocabulary. It reads only a bounded window at the end of the draft (`MAX_WORD_LENGTH`, `MAX_GAP`, `CODE_WINDOW` in `src/words.ts`), never the whole draft.
- The index changes only in `turn.complete` and `session.start`, where the English model also loads. It never changes on a keystroke. Other hooks may queue text for it (`pending`) or count command uses.
- A change to `src/trie.ts`, `src/words.ts`, `src/draft.ts`, `src/lexicon.ts` or `src/completion.ts` must keep `tests/latency.test.ts` passing. Report the new numbers in `docs/ALGORITHM.md` when they move.

## Types

- Use `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. `tsc -p .` must report nothing.
- Make invalid states unrepresentable. Model closed sets as literal unions, never as free strings or numbers. Use branded types for validated values. Parse once at the boundary, then pass the parsed type.
- Do not use `any`, non-null assertions (`!`) or type casts. The only casts allowed are the single constructors of a branded type (`toWord`, `toContext`, `tailPrefix`, the contexts built in `src/words.ts` by `contextSpan`, `joinContexts` and `pairsOf`, `COMMAND_START`, the tick in `CompletionTrie.insert`). To call an event the test kit carries but does not declare, use `raise` in `tests/support.ts`.
- Give every function an explicit input and output type. Keep types narrow: prefer `1 | 2 | 3` to `number`.
- Prefer iterator chains (`map`, `filter`, `flatMap`) to loops. Use a loop where the code is a hot path or a state machine, and say so in a comment.

## Behaviour

- The inline suggestion is virtual text: a `virtualText` decoration at the end of the draft, never part of it. Keep this invariant in every function: `view.draft` is exactly the box text, which is exactly what the user typed, and the cursor sits at its end. A view whose draft differs from the box is stale and takes no key.
- Suggest only when the cursor is at the end of the draft, in the inline suggestion, the bar and the typeahead alike.
- A bug in the plugin must never block a prompt, change a tool's result or hide the host's typeahead: keep the catch handler on every hook. Each records the failure for `/cccomplete` and passes the event on.
- Context never crosses punctuation or a line break. In shell drafts (a leading `!`), the first token of a command has the context `COMMAND_START`.
- Inside a code span or fence, suggest only code tokens. On a `/` line, the command name completes only from the host's command list.
- Every key binding is configurable. Do not hard-code a key outside the defaults in `src/config.ts`. A new option needs an entry in `userConfig`, a field in `parseConfig` with a default and a problem report, a row in the README table and a test.
- An invalid option falls back to its default and is reported. It never stops the plugin.
- The trie is case-sensitive and ranks by count, then by recency. The rank only rises. A change that lets a rank fall breaks the exactness argument in `docs/ALGORITHM.md`.
- Prose and shell words rank by the Witten–Bell score in `src/lexicon.ts`, computed at lookup time. Never store a blended score in a trie: it would need every context list to change when one word's count changes.
- Keep the score rising in every count, with weights fixed per lookup and never negative. The certificate in `rank` depends on it. A change to the score changes the reference in `tests/lexicon.test.ts` too.
- Do not predict the next word after a word with no known followers.
- The bar takes one row whenever `display` is not `inline`, so the prompt does not move as the user types. Keep a row of constant height.

## Tests

- Run `claude plugin test .`, `claude plugin validate .` and `tsc -p .` before you finish. All three must pass.
- Cover all new code. Test this plugin's behaviour: edge cases, error paths and invariants. Do not test Claude Code, the standard library or the test kit.
- Do not test what the types already guarantee.
- The test kit carries `prompt.edit` and `prompt.autocomplete` at run time, but its types do not declare them. Raise them with `raise` and stand in for the editor beneath, as `tests/register.test.ts` does. The kit cannot deliver real keys or show whether the host raises an edit for a key that changes nothing. Cover the rest through the pure functions and the model-based test in `tests/completion.test.ts`. Say in the README Status section what a live session has not yet confirmed.
- Keep random tests seeded so a failure replays.

## Documentation

- Follow ISO/IEC/IEEE 24495-1 (plain language) in every document and doc comment. Conform to the reader's needs, make information findable, and make it understandable.
- Open each document with its audience and what it does not cover.
- Write short sentences in active voice and present tense. Use one term for one thing: *draft*, *prefix*, *context* (the word before the prefix), *two-word context*, *match*, *inline suggestion*, *bar*, *typeahead* (the host's own menu), *index* (the tries, as the user meets them), *English model* (the bundled counts).
- Name the source and the date of every external fact.
- Document purpose and constraints, not what the code plainly does. Start each exported item with a one-sentence summary.
- Update `docs/ALGORITHM.md` when the trie, the model, its ranking or its measurements change. Update the README option table when an option changes. Update `docs/DICTIONARY.md` when a bundled data file or its build changes.
- A bundled data file names its source, licence and date in its header and in `docs/DICTIONARY.md`, and has a rebuild script or command.


## Known warnings

`claude plugin validate .` warns that a `CLAUDE.md` at a plugin root is not loaded as plugin context. This is expected. The file guides work on this repository and is not part of the plugin.
