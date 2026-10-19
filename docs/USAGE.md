# Using cccomplete

**Who this is for:** people who use cccomplete every day, check that it works, or need to fix a problem.

**What this document does not cover:** installing the plugin (see [../README.md](../README.md)), changing options and keys (see [CONFIGURATION.md](CONFIGURATION.md)), and how the index works (see [ALGORITHM.md](ALGORITHM.md)).

## Terms

| Term | Meaning |
| --- | --- |
| Draft | The text in the prompt box. |
| Prefix | The word you are typing, up to the cursor. |
| Match | A stored word that starts with the prefix and is longer than it. |
| Inline suggestion | The dim text after the cursor that completes the best match. |
| Bar | The row above the prompt that lists matches. |
| Index | The store of words that cccomplete has learned. |
| Dictionary | A list of common words that seeds the index at session start. |

## Use it

1. Type at least two letters of a word. A suggestion appears.
2. Press an accept key (default `right` or `ctrl+e`) to take the highlighted match.
3. Press the next key (default `ctrl+d`) or the previous key (default `ctrl+a`) to change the suggestion.
4. Keep typing to narrow the matches. Or press a button in the bar, when `bar_style` is `buttons`.

Accepting a suggestion adds a space after the word. You can turn that off with `trailing_space`.

Suggestions appear only when the cursor is at the end of the draft. They complete the last word only.

## Check that it works

1. Press the key you want to test in the prompt box, for example `ctrl+e`.
2. Run `/cccomplete`.
3. Read the line `recent keys that are not letters or digits`. It lists the last six named keys, keys held with `ctrl` or `meta`, and punctuation keys, oldest first.

The line `last key the prompt hook received` is always a letter after you type `/cccomplete`, because typing the command is itself a key press. Use the `recent keys` line to test a key. The line `recent edits that are not plain typing` shows what the host sent for each such key: the key, the text it inserted and the span it replaced. A key that makes an edit but shows no key there reached the plugin without its key name.

`/cccomplete` also shows the number of words in the index, the dictionary in effect and how many words it gave, the keys and options in effect, the time spent on the last keystroke and the longest time since the plugin loaded. The target is under 13 ms.

## Troubleshoot

| Problem | Likely cause | What to do |
| --- | --- | --- |
| No suggestion appears. | The cursor is not at the end of the draft, the prefix is shorter than `min_prefix`, or the index has no match. | Move the cursor to the end. Type more letters. Run `/cccomplete` and check the word count. |
| A key does nothing. | Your terminal or Claude Code uses that key and never passes it to the plugin. | Read [Choose keys that reach the plugin](CONFIGURATION.md#choose-keys-that-reach-the-plugin). Then press the key, run `/cccomplete`, and read the `recent keys` line. If it does not show your key, choose another combination. If it shows a bare character, such as `.` for `ctrl+.`, your terminal does not report that combination. |
| The accept key does nothing with `display` set to `bar`. | The keys need the inline suggestion. | Set `display` to `both`. To hide the text, set `ghost_color`. See [Hide the inline suggestion](CONFIGURATION.md#hide-the-inline-suggestion). |
| The inline suggestion shows faintly, or only in a selection. | `ghost_color` is close to your background but not equal, or a selection inverts the colours. | Copy the exact background hex. |
| `/cccomplete` shows `dictionary: bundled, 0 words`. | The plugin could not read its bundled file. | Run `claude --debug` and read the lines that start with `cccomplete`. Set `dictionary` to the absolute path of `data/dictionary.txt` as a workaround. |
| The bar is missing. | `display` is `inline`, or a survey holds the band. | Set `display` to `both` or `bar`. Answer or dismiss the survey. |
| A word you expect is missing. | It has fewer than three characters, no letter, or more than 64 characters. Or the case differs. | Type the word with the same case as before. |
| Dim text stays in the draft. | A rare mismatch between the draft and the plugin's record. | Delete it, or set `display` to `bar`. |
| A warning names `cccomplete` in the transcript. | A hook failed or the module did not load. | Run `claude --debug` and read the lines that start with `cccomplete`. |

## Limits

- **Last word only.** The cursor must be at the end of the draft.
- **Case matters.** `Prompt` and `prompt` are two words. A prefix completes only to a word that starts with the same letters in the same case.
- **Words only.** A word has 3 to 64 characters and at least one letter. It may contain `'`, `’` and `-` between letters or digits.
- **Ranking.** A word you used more often ranks higher. Among words used equally often, the one used more recently ranks higher. There is no decay over time.
- **The index lives in memory.** It does not persist between sessions. It rebuilds from the dictionary and the transcript. cccomplete stores none of your words on disk.
- **The dictionary ranks last.** A word from your conversation always ranks above a dictionary word. The bundled dictionary holds word stems only, such as `configure` and not `configuring`.
- **The inline suggestion is real text.** It sits in the prompt box, painted dim. cccomplete removes it before the host edits the draft and before a prompt is submitted.

## How fast it is

After each chat turn, cccomplete adds your prompt and Claude's answer to the index. While you type, it looks up the prefix and reads a stored list of the best matches. The lookup does not search the index, so its cost stays small however many words you have used. On a test index of 52,203 words, one keystroke took 0.001 ms on average. The slowest sample took 0.16 ms. Measured on 2026-10-15. [ALGORITHM.md](ALGORITHM.md) explains the method and why it fits.
