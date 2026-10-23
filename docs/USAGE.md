# Using cccomplete

**Who this is for:** people who use cccomplete every day, check that it works, or need to fix a problem.

**What this document does not cover:** installing the plugin (see [../README.md](../README.md)), changing options and keys (see [CONFIGURATION.md](CONFIGURATION.md)), and how the index works (see [ALGORITHM.md](ALGORITHM.md)).

## Terms

| Term | Meaning |
| --- | --- |
| Draft | The text in the prompt box. |
| Prefix | The word you are typing, up to the cursor. |
| Context | The word just before the prefix, with only spaces between. |
| Match | A stored word that starts with the prefix and is longer than it. |
| Inline suggestion | The dim text after the cursor that completes the best match. It is drawn, not typed: it is not part of the draft. |
| Bar | The row above the prompt that lists matches. |
| Typeahead | Claude Code's own menu under the prompt. cccomplete adds its matches there. |
| Index | The store of words that cccomplete has learned. |
| Dictionary | A list of common words that seeds the index at session start. |

## Use it

1. Type at least two letters of a word. A suggestion appears.
2. Press an accept key (default `right` or `ctrl+e`) to take the highlighted match.
3. Press the next key (default `ctrl+d`) or the previous key (default `ctrl+a`) to change the suggestion.
4. Keep typing to narrow the matches. Or press a button in the bar, when `bar_style` is `buttons`. Or press `tab` to take a match from the typeahead.

Accepting a suggestion adds a space after the word, except inside code. You can turn the space off with `trailing_space`. After the space, cccomplete predicts the next word, so pressing the accept key again takes it. You can turn prediction off with `predict_next`.

What you get depends on where you type:

| Where | What cccomplete offers |
| --- | --- |
| In prose | Words. Words you used after the context come first, then words from recent turns, then every word. |
| After a space | The word you most often used after the one before the space. |
| Inside backticks or a code fence | Code only: paths, names and identifiers from code in the chat and from files Claude read or wrote. |
| After a leading `!` | Shell commands and their arguments, from commands you and Claude ran. `!` alone offers your most-used commands. |
| After a leading `/` | Slash command and skill names only, most-used first. A name you typed in full gets no suggestion. |

Punctuation ends the context: after `run.` or a line break, the next word has none.

Suggestions appear only when the cursor is at the end of the draft. They complete the last word only.

## Check that it works

1. Press the key you want to test in the prompt box, for example `ctrl+e`.
2. Run `/cccomplete`.
3. Read the line `recent keys that are not letters or digits`. It lists the last six named keys, keys held with `ctrl` or `meta`, and punctuation keys, oldest first.

The line `last key the prompt hook received` is always a letter after you type `/cccomplete`, because typing the command is itself a key press. Use the `recent keys` line to test a key. The line `recent edits that are not plain typing` shows what the host sent for each such key: the key, the text it inserted and the span it replaced. A key that makes an edit but shows no key there reached the plugin without its key name.

`/cccomplete` also shows the number of words in each part of the index (prose, contexts, recent, code, shell and commands), the dictionary in effect and how many words it gave, the keys and options in effect, the time spent on the last keystroke and the longest time since the plugin loaded. The target is under 13 ms.

## Troubleshoot

| Problem | Likely cause | What to do |
| --- | --- | --- |
| No suggestion appears. | The cursor is not at the end of the draft, the prefix is shorter than `min_prefix`, or the index has no match. | Move the cursor to the end. Type more letters. Run `/cccomplete` and check the word count. |
| A key does nothing. | Your terminal or Claude Code uses that key and never passes it to the plugin. | Read [Choose keys that reach the plugin](CONFIGURATION.md#choose-keys-that-reach-the-plugin). Then press the key, run `/cccomplete`, and read the `recent keys` line. If it does not show your key, choose another combination. If it shows a bare character, such as `.` for `ctrl+.`, your terminal does not report that combination. |
| The accept key does nothing. | The key changes nothing at the end of the draft, and Claude Code may not report such a key. This is not yet confirmed for the new inline suggestion. | Press `tab` to take the match from the typeahead. Press the key, run `/cccomplete`, and read the `recent keys` line. If the key is missing, choose another. See [Choose keys that reach the plugin](CONFIGURATION.md#choose-keys-that-reach-the-plugin). |
| The inline suggestion shows faintly, or only in a selection. | `ghost_color` is close to your background but not equal, or a selection inverts the colours. | Copy the exact background hex. |
| `/cccomplete` shows `dictionary: bundled, 0 words`. | The plugin could not read its bundled file. | Run `claude --debug` and read the lines that start with `cccomplete`. Set `dictionary` to the absolute path of `data/dictionary.txt` as a workaround. |
| The bar is missing. | `display` is `inline`, the default, or a survey holds the band. | Set `display` to `both` or `bar`. Answer or dismiss the survey. |
| No suggestion appears at all, or `/cccomplete` shows `words indexed: 0`. | A hook failed. | Read the `failures` line of `/cccomplete`. Turn on `trace` and see [Trace a problem](#trace-a-problem). |
| A word you expect is missing. | It has fewer than three characters, no letter, or more than 64 characters. Or the case differs. | Type the word with the same case as before. |
| A warning names `cccomplete` in the transcript. | A hook failed or the module did not load. | Run `claude --debug` and read the lines that start with `cccomplete`. |

## Trace a problem

`/cccomplete` always shows a `failures` line: the last five hooks or start-up steps that failed, and why. A failed step at session start leaves the rest of the index built.

For more, set `trace` to `true` and restart Claude Code. `/cccomplete` then lists the last 20 events, oldest first:

- each session start step: the dictionary, the transcript and the command list, with counts;
- each keystroke: the key, whether it ran accept, next, previous or a plain edit, which index answered, how many matches, and the time;
- each typeahead request and each finished turn.

A trace holds no draft text, so you can paste it into a bug report. Turn `trace` off again when you are done; it costs a little time on every keystroke.

## Limits

- **Last word only.** The cursor must be at the end of the draft.
- **Case matters.** `Prompt` and `prompt` are two words. A prefix completes only to a word that starts with the same letters in the same case.
- **Words only.** A word has 3 to 64 characters and at least one letter. It may contain `'`, `’` and `-` between letters or digits. A code token may also contain `_ . / - : @`, so `src/trie.ts` is one token.
- **Code needs a nearby fence.** cccomplete reads the last 4,096 characters to see whether you are inside code. A fence opened earlier than that is not seen.
- **Ranking.** A word you used after the same context ranks first. Then words from the last 8 to 15 turns. Then every word. Inside each group, a word you used more often ranks higher, and among words used equally often, the more recent one.
- **The index lives in memory.** It does not persist between sessions. It rebuilds from the dictionary, the transcript and the tool calls in it. cccomplete stores none of your words on disk. It stores one thing: the names of the slash commands you run and how often, in Claude Code's plugin store.
- **The dictionary ranks last.** A word from your conversation always ranks above a dictionary word. The bundled dictionary holds word stems only, such as `configure` and not `configuring`.
- **The inline suggestion is not text in the prompt.** Claude Code draws it after the cursor. It never reaches Claude or a slash command unless you accept it. Claude Code does not draw it in an empty box, from a remote host, or in screen-reader mode; the bar and the typeahead still show the matches.

## How fast it is

After each chat turn, cccomplete adds your prompt, Claude's answer and the tools Claude used to the index. While you type, it reads the end of the draft and up to three stored lists of the best matches. It does not search the index, so its cost stays small however many words you have used. On a test conversation of 400,000 words, one keystroke took 0.016 ms on average and 0.038 ms at the 99th percentile. Measured on 2026-10-22 on Linux. [ALGORITHM.md](ALGORITHM.md) explains the method and why it fits.
