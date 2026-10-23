# Architecture

**Who this is for:** contributors who change cccomplete.

**What this document does not cover:** the index algorithm (see [ALGORITHM.md](ALGORITHM.md)) and end-user instructions (see [../README.md](../README.md)).

**Evidence dates:** facts about Claude Code come from its type declarations, version 2.1.292, and its documentation, both read on 2026-10-15, and from the declarations for 2.1.309, read on 2026-10-22: the `virtualText` decoration, `prompt.autocomplete`, `prompt.change`, `$.command.list`, `$.store` and `Shaped` state. They may change in later releases.

## Design rule

All logic lives in `src/` as pure functions. Each function takes plain data and returns plain data. `hooks/register.tsx` only connects those functions to Claude Code. This split has two reasons:

- Claude Code's validator allows calls on `$` (the host interface) only in the hooks module. Code in `src/` cannot call the host, so it can be tested alone.
- The pure pipeline can be measured and tested in a model-based test without a host, and the hooks module stays too thin to hide a bug.

## Files

| File | Responsibility |
| --- | --- |
| `types/index.d.ts` | Shared value types and the `$.state` contract. |
| `src/words.ts` | Defines a prose word and a code token. Splits text into words with their contexts. Reads the prefix, the context and whether the end of a draft is inside code. |
| `src/trie.ts` | One trie. See ALGORITHM.md. |
| `src/lexicon.ts` | Every trie the plugin keeps, the Witten–Bell score, the bounded scoring and its certificate. The command counts. |
| `src/english.ts` | Reads the bundled English model, `data/english.tsv`. |
| `src/draft.ts` | Decides, from the end of a draft, which index to ask and for what. |
| `src/feeds.ts` | Decides which text feeds which index: prompts, answers, tool calls and the transcript. |
| `src/keys.ts` | Parses key combinations and matches them against key presses. |
| `src/config.ts` | Turns the host's untyped options into one typed `Config`. |
| `src/completion.ts` | The editing pipeline: attach, cycle, accept, and the typeahead rows. |
| `src/trace.ts` | The failures always kept and the optional trace, both without draft text. |
| `scripts/build-english.ts` | Builds `data/english.tsv` from Tatoeba sentences, on a developer's machine. Not part of the plugin. |
| `data/` | The dictionary (`dictionary.txt`, SCOWL) and the English model (`english.tsv`, Tatoeba CC0). See DICTIONARY.md. |
| `hooks/register.tsx` | The hooks. |
| `tests/` | Unit, model-based, latency and hook tests. `support.ts` holds shared helpers. |

## Types

Types carry the rules, so a function's signature states what it accepts and returns.

- `Word`, `Prefix` and `Context` are branded strings. Only `toWord`, `tailPrefix`, `contextBefore` and `pairsOf` build them.
- `Target` in `src/draft.ts` is a union with one member per kind of lookup: `word`, `next`, `code` and `command`. A `next` target always has a context; a `code` or `command` target never has one. `word` and `next` also carry the two-word context.
- `Completer.rank` returns a `Ranking`: the matches and how many of them are certified.
- `SuggestionLimit` is the union `1 | … | 9`. `PrefixLength` is `1 | … | 4`. `Display`, `Sources` and `ViewLanguage` are literal unions. `parseConfig` is the only place that turns untyped options into them, and `parseCommandUses` the only place that reads the store.
- `Completer` is the one method of the index that the pipeline needs. Tests can pass a fake.

## The inline suggestion

The inline suggestion is virtual text: a decoration with `virtualText` at the end of the draft. The host draws it after the cursor. It is never in the draft, so the host edits and submits exactly what the user typed. This removes a class of bug the earlier design had: a slash command is resolved from the box text before `prompt.submit` runs, and a rewrite of a command's text is not applied, so a suggestion in the draft could become part of the command (`/clear` ran as `/clearing`).

One rule follows, and every function keeps it:

> `view.draft` is exactly the box text, which is exactly what the user typed. The cursor sits at its end.

A view whose draft differs from the box, or whose cursor moved, is stale. It takes no key.

The host does not draw virtual text in an empty box, from a remote host, or in screen-reader mode (2.1.309 declarations). The bar and the typeahead still show the matches there.

## One keystroke

`prompt.edit` fires with the draft before the edit and the splice the editor made.

```text
host event ─▶ read view ─▶ bound key, view not stale? ─yes─▶ accept / cycle ─▶ box ─▶ host
                              │ no
                              ▼
                  next(e)                  the host applies the edit to the draft
                              ▼
                  attach(result, index)    targetOf → lookup → view and virtual text
                              ▼
                  write view ─▶ box + virtual text ─▶ host
```

Letting the host apply the edit keeps its own behaviour intact: paste, word deletion, kill and the rest. The plugin never re-implements editing.

`accept` writes the match and a space, then runs `attach` again, so the next word is predicted at once.

The plugin writes the `view` value only when it changes, so an idle prompt causes no redraws. The bar reads `view`, so each write redraws it.

## The typeahead

`prompt.autocomplete` asks for rows for the token at the cursor: the run of non-space characters before it. The plugin adds its matches after the host's own rows. Taking a row writes its text over the token, so each row is the token plus the completion. Tab takes a row through the host's own key handling. This path needs no key to reach the plugin. Slash commands get no rows, because the host lists them itself.

## When the index learns

The index never changes while the user types.

- **`session.start`** builds a fresh index: the dictionary first (`$.fs.read`), then the English model (`data/english.tsv`, unless `english` is off), then the transcript grouped into turns, tool calls included (`transcriptTurns`), then the command list with the stored counts. A fresh index each time means a `/clear` or a reload never counts the dictionary twice. If the named dictionary cannot be read, it shows a toast and loads the bundled one.
- **`tool.call`** queues what a finished tool call in the main conversation teaches (`toolFeeds`).
- **`prompt.submit`** queues the prompt, or a slash command's arguments.
- **`command.run`** counts a command the user ran and writes the counts to `$.store`. The command index uses the new count after the next turn.
- **`turn.complete`** folds the queued text and Claude's answer into the index as one turn, and reloads the command list. Subagent turns are skipped.

The `sources` option chooses which feeds the index: the user's prompts, Claude's answers and tool calls, or both.

## State

| Where | What | Why there |
| --- | --- | --- |
| `$.state` → `cccomplete.view` | The current `CompletionView`, or `null`, under the shape tag `virtual-1`. | The bar redraws when it changes. A reload keeps it. The tag makes a view stored by the earlier design, which kept the suggestion in the draft, read as `null`. |
| `$.store` → `command-uses` | How often the user ran each slash command, at most 1,000 each. | It outlives the session, so command ranking learns across sessions. |
| Module variables | The index, the queued feeds, the last key, the timings, the last five failures and, with `trace` on, the last 20 trace lines (`src/trace.ts`). | They are large or private. A reload resets them, and `session.start` rebuilds the index. |

## Failure behaviour

- An invalid option falls back to its default and is reported.
- `prompt.submit`, `tool.call`, `command.run` and `prompt.autocomplete` have catch handlers that pass the event on unchanged. A bug in the plugin cannot block a prompt, change a tool's result, stop a command or hide the host's typeahead.
- A stale view takes no key, and `prompt.fill` and `prompt.change` (a recalled history entry, a cleared box) clear it.
- A stored command count that is not a whole number from 1 to 1,000 is dropped when read.
- Every hook has a catch handler that records why it failed (`describeFailure`) and passes the event on. `session.start` also catches each host call on its own, so a failed transcript read still leaves the dictionary and the command list in the index. `/cccomplete` lists the failures.
- The transcript is parsed at the boundary: a stored field of the wrong shape teaches nothing instead of failing the whole start.

## Limits of the tests

The test kit carries `prompt.edit` and `prompt.autocomplete` at run time, but its types do not declare them. `raise` in `tests/support.ts` calls them, and `tests/register.test.ts` stands in for the editor and the state store beneath the plugin. The pure pipeline is also covered by a model-based test (`tests/completion.test.ts`, "the whole pipeline"): it applies 2,000 random typing, deleting and accepting steps and checks after each that the box holds exactly what was typed.

What remains unverified until a live session runs:

- whether the host draws `virtualText` as expected after the cursor;
- whether the host raises `prompt.edit` for a key that changes nothing. With virtual text the cursor already sits at the end of the draft, so `right` and `ctrl+e` move nothing, and `ctrl+d` deletes nothing. The earlier design worked because those keys crossed or deleted real text. The default keys may need to change;
- whether the plugin's typeahead rows appear, and whether Tab takes one;
- whether a draft in bash mode still starts with `!` in the text the plugin sees, or the host strips it into a mode;
- whether `$.prompt.fill` in `replace` mode leaves the cursor at the end of the draft, which the bar's buttons assume.

`/cccomplete` reports the last key the hook received and the recent keys that are not letters or digits, so the second point can be checked in seconds.
