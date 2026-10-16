# cccomplete

cccomplete is a Claude Code plugin that completes the word you are typing. It learns its words from your conversation with Claude.

## Who this is for

This document is for people who use Claude Code in a terminal or in the desktop Code tab, and who want completion for the words they and Claude use often. It also helps people who want to install, configure or change the plugin.

## What this document does not cover

- How the word index works. See [docs/ALGORITHM.md](docs/ALGORITHM.md).
- How the code is organised. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- The rules for changing the code. See [CLAUDE.md](CLAUDE.md).

## Purpose

Long chats repeat the same words: file names, function names, project terms. Typing them in full is slow. cccomplete offers the rest of the word as you type.

It does this in two places:

- **Inline suggestion.** Dim text after your cursor shows the best match.
- **Bar.** A row of buttons above the prompt shows up to nine matches. The active match is highlighted.

## Terms

| Term | Meaning |
| --- | --- |
| Draft | The text in the prompt box. |
| Prefix | The word you are typing, up to the cursor. |
| Match | A stored word that starts with the prefix and is longer than it. |
| Inline suggestion | The dim text after the cursor that completes the best match. |
| Bar | The row above the prompt that lists matches. |
| Index | The store of words that cccomplete has learned. |

## What you need

- Claude Code 2.1.287 or later. cccomplete was written and tested against 2.1.292.
- A terminal session or the desktop Code tab.
- Mods turned on. They are on by default. Your organisation can turn them off.

## Install

Choose one way.

**For one session.** Start Claude Code with the plugin folder:

```bash
claude --plugin-dir ~/Workspace/cccomplete
```

**For every session.** Add the folder as a marketplace, then install the plugin:

```bash
claude plugin marketplace add ~/Workspace/cccomplete
claude plugin install cccomplete@cccomplete
```

**From a GitHub repository.** After you publish this folder, others install it inside Claude Code:

```text
/plugin install cccomplete --marketplace <owner>/<repo>
```

If you install from the shell while a session is open, run `/reload-plugins` in that session.

To confirm the plugin loaded, run `/plugin`. A line under the tabs reads `1 mod active · cccomplete`.

## Use it

1. Type at least two letters of a word. A suggestion appears.
2. Press the accept key (default `tab`) to take the inline suggestion.
3. Press the next key (default `ctrl+n`) or the previous key (default `ctrl+p`) to change the suggestion.
4. Keep typing to narrow the matches. Or press a button in the bar.

Accepting a suggestion adds a space after the word. You can turn that off.

Suggestions appear only when the cursor is at the end of the draft. They complete the last word only.

The bar always takes one row, so the prompt does not move as you type. When there are no matches, the row shows the key hints. Set `display` to `inline` to remove the bar.

## Configure

Open `/config` and find the cccomplete rows. A change reloads the plugin, which rebuilds its index from the transcript.

| Option | Default | What it accepts |
| --- | --- | --- |
| `accept_key` | `tab` | A key combination such as `tab`, `ctrl+y` or `meta+enter`. |
| `next_key` | `ctrl+n` | A key combination. |
| `previous_key` | `ctrl+p` | A key combination. |
| `display` | `both` | `both`, `inline` or `bar`. |
| `limit` | `5` | A whole number from 1 to 9. It sets how many matches the bar offers. |
| `min_prefix` | `2` | A whole number from 1 to 4. It sets how many letters you type before suggestions appear. |
| `trailing_space` | `true` | `true` or `false`. |
| `sources` | `both` | `prompts`, `answers` or `both`. It sets which text the index learns from. |

### Key combinations

A key combination is one or more modifiers, then a key, joined by `+`. Case does not matter.

- Modifiers: `ctrl`, `shift` and `meta` (also written `alt` or `option`).
- Named keys: `tab`, `return` (also `enter`), `escape` (also `esc`), the four arrow keys, `home`, `end`, `pageup`, `pagedown`, `backspace` and `delete`.
- Letters and digits need `ctrl` or `meta`, because a bare letter is typing.

If you bind one key to two actions, the earlier action wins, in the order accept, next, previous. cccomplete reports the clash.

An invalid option falls back to its default. cccomplete shows a toast when a session starts and lists the problem in `/cccomplete`.

## Check that it works

1. Press a key in the prompt box.
2. Run `/cccomplete`.
3. Read the line `last key the prompt hook received`.

`/cccomplete` also shows the number of words in the index, the keys and options in effect, the time spent on the last keystroke and the longest time since the plugin loaded. The target is under 13 ms.

## Troubleshoot

| Problem | Likely cause | What to do |
| --- | --- | --- |
| No suggestion appears. | The cursor is not at the end of the draft, the prefix is shorter than `min_prefix`, or the index has no match. | Move the cursor to the end. Type more letters. Run `/cccomplete` and check the word count. |
| A key does nothing. | Your terminal or Claude Code uses that key and never passes it to the plugin. | Press the key, run `/cccomplete`, and read the last key line. If it does not show your key, choose another combination. |
| The bar is missing. | `display` is `inline`, or a survey holds the band. | Set `display` to `both` or `bar`. Answer or dismiss the survey. |
| A word you expect is missing. | It has fewer than three characters, no letter, or more than 64 characters. Or the case differs. | Type the word with the same case as before. |
| Dim text stays in the draft. | A rare mismatch between the draft and the plugin's record. | Delete it, or set `display` to `bar`. |
| A warning names `cccomplete` in the transcript. | A hook failed or the module did not load. | Run `claude --debug` and read the lines that start with `cccomplete`. |

## Limits

- **Last word only.** The cursor must be at the end of the draft.
- **Case matters.** `Prompt` and `prompt` are two words. A prefix completes only to a word that starts with the same letters in the same case.
- **Words only.** A word has 3 to 64 characters and at least one letter. It may contain `'`, `’` and `-` between letters or digits.
- **Ranking.** A word you used more often ranks higher. Among words used equally often, the one used more recently ranks higher. There is no decay over time.
- **The index lives in memory.** It does not persist between sessions. It rebuilds from the transcript.
- **The inline suggestion is real text.** It sits in the prompt box, painted dim. cccomplete removes it before the host edits the draft and before a prompt is submitted.

## How it works

After each chat turn, cccomplete adds your prompt and Claude's answer to the index. While you type, it looks up the prefix and reads a stored list of the best matches. The lookup does not search the index, so its cost stays small however many words you have used. On a test index of 52,203 words, one keystroke took 0.001 ms on average. The slowest sample took 0.16 ms. Measured on 2026-10-15.

[docs/ALGORITHM.md](docs/ALGORITHM.md) explains the method and why it fits.

## Status

This is version 0.1.0. The automated tests cover the index, the key and option parsing, the editing pipeline, the bar and the learning step. The test kit cannot raise the `prompt.edit` event or deliver real key presses. Those two paths have not been run in a live session. Run `/cccomplete` after your first few keystrokes to confirm that they work.

The install commands above have not been run end to end.

## Develop

```bash
claude plugin test .          # runs the tests and prints the latency measurements
claude plugin validate .      # checks the manifest and the hooks module
tsc -p .                      # type-checks; load the plugin once first
```

`tsc` needs the type declarations that Claude Code writes when it loads the plugin. Run `claude --plugin-dir .` once, then run `tsc -p .`.

`claude plugin validate .` warns that `CLAUDE.md` is not loaded as plugin context. This is expected.

Read [CLAUDE.md](CLAUDE.md) before you change the code.

## Licence

No licence has been chosen yet. Ask the author before you reuse the code.
