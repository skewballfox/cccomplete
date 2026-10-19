# cccomplete

A Claude Code mod that completes the word at the end of the prompt from a trie of the conversation. It shows an inline suggestion and a bar of matches. This file lists the constraints every change must keep. The reasoning behind them is in `docs/ALGORITHM.md` and `docs/ARCHITECTURE.md`.

All rules are mandatory. Where a rule rests on a fact about Claude Code, the fact comes from its type declarations for version 2.1.292 and its documentation, read on 2026-10-15. Check the generated declarations in `.claude-plugin/types/` before relying on a fact that may have moved.

## Runtime

- The hooks module runs in an environment of its own. It has no DOM, Node, `require`, `eval`, `new Function`, timers or WebAssembly. Write plain TypeScript with no dependencies.
- Every file is an ES module named `.ts` or `.tsx`. A file imports only plugin files by relative path, plus `claude-code` for types. A dynamic `import()` does not load.
- Calls on `$` appear only in `hooks/register.tsx`. Write each call in full (`$.state.get`). Do not alias `$`, destructure it, or pass it to a function that is not declared at the top level of the same file. Write each event name as a string literal. Do not declare a second `on` inside `register`. Do not declare `h` or `Fragment`.
- `types/index.d.ts` holds types only. It cannot contain `declare const`, imports or code. It declares every `$.state` value the module touches.
- Values in `$.state` must survive `JSON.stringify` and `JSON.parse`.
- `src/` stays pure. It does not call the host and does not import `claude-code` at run time. All logic lives in `src/`. The hooks module only connects.

## Latency

- The keystroke path is `detach`, the host's edit, then `attach`. Its target is under 13 ms. The host's own limit for a `prompt.edit` hook is 50 ms.
- A lookup reads one stored list. It never walks a subtree, never scans the whole draft and never sorts.
- The index changes only in `turn.complete` and `session.start`. It never changes on a keystroke.
- A change to `src/trie.ts`, `src/words.ts` or `src/completion.ts` must keep `tests/latency.test.ts` passing. Report the new numbers in `docs/ALGORITHM.md` when they move.

## Types

- Use `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. `tsc -p .` must report nothing.
- Make invalid states unrepresentable. Model closed sets as literal unions, never as free strings or numbers. Use branded types for validated values. Parse once at the boundary, then pass the parsed type.
- Do not use `any`, non-null assertions (`!`) or type casts. The only casts allowed are the single constructors of a branded type (`toWord`, `tailPrefix`, the tick in `CompletionTrie.insert`).
- Give every function an explicit input and output type. Keep types narrow: prefer `1 | 2 | 3` to `number`.
- Prefer iterator chains (`map`, `filter`, `flatMap`) to loops. Use a loop where the code is a hot path or a state machine, and say so in a comment.

## Behaviour

- The inline suggestion is real text in the prompt box. Keep this invariant in every function: `draft.slice(0, prefixLength)` is what the user typed, the rest is the suggestion, and the cursor sits at `prefixLength`.
- Suggest only when the cursor is at the end of the draft.
- Remove the suggestion before the host edits the draft and before a prompt is submitted. A bug in the plugin must never block a prompt: keep the catch handler on `prompt.submit`.
- Every key binding is configurable. Do not hard-code a key outside the defaults in `src/config.ts`. A new option needs an entry in `userConfig`, a field in `parseConfig` with a default and a problem report, a row in the README table and a test.
- An invalid option falls back to its default and is reported. It never stops the plugin.
- The trie is case-sensitive and ranks by count, then by recency. The rank only rises. A change that lets a rank fall breaks the exactness argument in `docs/ALGORITHM.md`.
- The bar takes one row whenever `display` is not `inline`, so the prompt does not move as the user types. Keep a row of constant height.

## Tests

- Run `claude plugin test .`, `claude plugin validate .` and `tsc -p .` before you finish. All three must pass.
- Cover all new code. Test this plugin's behaviour: edge cases, error paths and invariants. Do not test Claude Code, the standard library or the test kit.
- Do not test what the types already guarantee.
- The test kit cannot raise `prompt.edit` or deliver real keys. Cover that path through the pure functions and the model-based test in `tests/completion.test.ts`. Say in the README Status section what a live session has not yet confirmed.
- Keep random tests seeded so a failure replays.

## Documentation

- Follow ISO/IEC/IEEE 24495-1 (plain language) in every document and doc comment. Conform to the reader's needs, make information findable, and make it understandable.
- Open each document with its audience and what it does not cover.
- Write short sentences in active voice and present tense. Use one term for one thing: *draft*, *prefix*, *match*, *inline suggestion*, *bar*, *index* (the trie, as the user meets it).
- Name the source and the date of every external fact.
- Document purpose and constraints, not what the code plainly does. Start each exported item with a one-sentence summary.
- Update `docs/ALGORITHM.md` when the trie, its ranking or its measurements change. Update the README option table when an option changes.


## Known warnings

`claude plugin validate .` warns that a `CLAUDE.md` at a plugin root is not loaded as plugin context. This is expected. The file guides work on this repository and is not part of the plugin.
