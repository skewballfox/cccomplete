# Architecture

**Who this is for:** contributors who change cccomplete.

**What this document does not cover:** the index algorithm (see [ALGORITHM.md](ALGORITHM.md)) and end-user instructions (see [../README.md](../README.md)).

**Evidence dates:** facts about Claude Code come from its type declarations, version 2.1.292, and its documentation, both read on 2026-10-15. They may change in later releases.

## Design rule

All logic lives in `src/` as pure functions. Each function takes plain data and returns plain data. `hooks/register.tsx` only connects those functions to Claude Code. This split has two reasons:

- Claude Code's validator allows calls on `$` (the host interface) only in the hooks module. Code in `src/` cannot call the host, so it can be tested alone.
- The test kit cannot raise the `prompt.edit` event. The pure pipeline is therefore tested directly, and the hooks module stays too thin to hide a bug.

## Files

| File | Responsibility |
| --- | --- |
| `types/index.d.ts` | Shared value types and the `$.state` contract. |
| `src/words.ts` | Defines a word. Splits text into words. Finds the word at the end of a draft. |
| `src/trie.ts` | The index. See ALGORITHM.md. |
| `src/keys.ts` | Parses key combinations and matches them against key presses. |
| `src/config.ts` | Turns the host's untyped options into one typed `Config`. |
| `src/completion.ts` | The editing pipeline: detach, attach, cycle, accept. |
| `hooks/register.tsx` | The hooks. |
| `tests/` | Unit, model-based, latency and hook tests. `support.ts` holds shared helpers. |

## Types

Types carry the rules, so a function's signature states what it accepts and returns.

- `Word` and `Prefix` are branded strings. Only `toWord` and `tailPrefix` build them.
- `SuggestionLimit` is the union `1 | … | 9`. `PrefixLength` is `1 | … | 4`. `Display` and `Sources` are literal unions. `parseConfig` is the only place that turns untyped input into them.
- `KeyCombo` holds a `KeyName`, a union of the supported keys, and three booleans.
- `Completer` is the one method of the trie that the pipeline needs. Tests can pass a fake.

## The inline suggestion

The inline suggestion is real text in the prompt box, painted dim with a decoration. This is the only way a mod can put text after the cursor. It creates one rule that every function keeps:

> `view.draft.slice(0, prefixLength)` is what the user typed. `view.draft.slice(prefixLength)` is the suggestion. The cursor sits at `prefixLength`.

The rule holds because suggestions appear only when the cursor is at the end of the draft.

## One keystroke

`prompt.edit` fires with the draft before the edit (which includes any suggestion) and the splice the editor made.

```text
host event ─▶ read view ─▶ configured key? ─yes─▶ accept / cycle ─▶ box ─▶ host
                              │ no
                              ▼
                  detach(edit, view)       remove the suggestion, clamp the splice
                              ▼
                  next(edit)               the host applies the edit to the typed text
                              ▼
                  attach(result, trie)     find the word, look it up, add the suggestion
                              ▼
                  write view ─▶ box + dim decoration ─▶ host
```

Letting the host apply the edit keeps its own behaviour intact: paste, word deletion, kill and the rest. The plugin never re-implements editing.

The plugin writes the `view` value only when it changes, so an idle prompt causes no redraws. The bar reads `view`, so each write redraws it.

## When the index learns

The index never changes while the user types.

- **`session.start`** seeds the trie from the transcript. This also runs after every reload.
- **`prompt.submit`** removes any leftover suggestion from the text, then queues the prompt.
- **`turn.complete`** folds the queued prompts and Claude's answer into the trie. Subagent turns are skipped.

The `sources` option chooses which of the two feeds the trie.

## State

| Where | What | Why there |
| --- | --- | --- |
| `$.state` → `cccomplete.view` | The current `CompletionView`, or `null`. | The bar redraws when it changes. A reload keeps it. |
| Module variables | The trie, the queued prompts, the last key, the timings. | They are large or private. A reload resets them, and `session.start` rebuilds the trie. |

## Failure behaviour

- An invalid option falls back to its default and is reported.
- `prompt.submit` has a catch handler that passes the prompt on unchanged. A bug in the plugin cannot block a prompt.
- If the draft no longer matches the stored view (the box was cleared or refilled by something else), the plugin treats the view as stale, ignores the old suggestion, and builds a new view from the next edit. A `prompt.fill` hook clears the view when something else rewrites the box.

## Limits of the tests

The test kit cannot raise `prompt.edit` or deliver real keys. The pure pipeline is covered by a model-based test (`tests/completion.test.ts`, "the whole pipeline"): it applies 2,000 random typing and deleting steps through `detach`, a stand-in for the host's edit and `attach`, and checks after each step that the typed text and the cursor are exact.

What remains unverified until a live session runs:

- whether the host reports a key such as `tab` through `prompt.edit` at all;
- whether `$.prompt.fill` in `replace` mode leaves the cursor at the end of the draft, which the bar's buttons assume.

`/cccomplete` reports the last key the hook received, so the first can be checked in seconds.
