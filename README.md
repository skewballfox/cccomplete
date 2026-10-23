# cccomplete

cccomplete is a Claude Code plugin that completes the word you are typing. It learns its words from your conversation with Claude, from the files and commands Claude works with, and starts with a bundled list of common words.

## Who this is for

This document is for people who use Claude Code in a terminal or in the desktop Code tab, and who want completion for the words they and Claude use often. It also helps people who want to install, configure or change the plugin.

## What this document does not cover

- Every option, the keys that work, and how to hide the inline suggestion. See [docs/CONFIGURATION.md](docs/CONFIGURATION.md).
- Checking that it works, troubleshooting and limits. See [docs/USAGE.md](docs/USAGE.md).
- The dictionary and the English model: their sources, formats and how to rebuild them. See [docs/DICTIONARY.md](docs/DICTIONARY.md).
- How the word index works. See [docs/ALGORITHM.md](docs/ALGORITHM.md).
- How the code is organised. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- The rules for changing the code. See [CLAUDE.md](CLAUDE.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## Purpose

Long chats repeat the same words: file names, function names, project terms. Typing them in full is slow. cccomplete offers the rest of the word as you type.

It does this in up to three places:

- **Inline suggestion.** Dim text after your cursor shows the best match. It is never part of your prompt until you accept it.
- **Bar.** Off by default, because the typeahead lists the same matches. With `display` set to `both` or `bar`, a row above the prompt shows up to nine matches as powerline segments. The segments need a [Nerd Font](https://www.nerdfonts.com/) in your terminal.
- **Typeahead.** The matches also join Claude Code's own typeahead menu, where `tab` takes one.

It reads what you are typing:

- **Prose.** It ranks words by how likely each is after the one or two words before the cursor, from your conversation and, until that has enough of its own, from everyday English. After a space, it predicts the next word.
- **Code.** Inside backticks or a code fence, it offers only code: paths, names and identifiers from code in the chat and from the files Claude read or wrote.
- **Shell.** After a leading `!`, it offers commands and arguments from the shell commands you and Claude ran.
- **Slash commands.** After `/`, it completes only real command and skill names, the ones you use most first.

## What you need

- Claude Code 2.1.309 or later. Earlier versions may lack the virtual text the inline suggestion uses.
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

Type at least two letters of a word. A dim suggestion appears after the cursor, and the matches join Claude Code's typeahead menu under the prompt. Press `up` and `down` to choose a match, and `tab` to take it. The menu shows five rows at a time and scrolls to the rest, so set `limit` to 9 to scroll through more matches. See [docs/USAGE.md](docs/USAGE.md).

The `accept_key`, `next_key` and `previous_key` options act only on keys that reach the plugin. In version 0.2.0, `right`, `left` and `tab` do not reach it: see the Status section below.

## Configure

Open `/config` and find the cccomplete rows. A changed option needs a restart of Claude Code. [docs/CONFIGURATION.md](docs/CONFIGURATION.md) explains each option.

| Option | Default | What it accepts |
| --- | --- | --- |
| `accept_key` | `right, ctrl+e` | One or more key combinations, separated by commas. |
| `next_key` | `ctrl+d` | A key combination. |
| `previous_key` | `ctrl+a` | A key combination. |
| `display` | `inline` | `inline`, `both` or `bar`. |
| `ghost_color` | `dim` | `dim`, a colour name or a hex colour such as `#1e1e1e`. |
| `bar_style` | `powerline` | `powerline` or `buttons`. |
| `dictionary` | `bundled` | `bundled`, `none` or the path of a dictionary file. |
| `limit` | `5` | A whole number from 1 to 9. |
| `min_prefix` | `2` | A whole number from 1 to 4. |
| `min_gain` | `2` | A whole number from 1 to 3. |
| `trailing_space` | `true` | `true` or `false`. |
| `predict_next` | `true` | `true` or `false`. |
| `typeahead` | `true` | `true` or `false`. |
| `trace` | `false` | `true` or `false`. |
| `english` | `true` | `true` or `false`. |
| `sources` | `both` | `prompts`, `answers` or `both`. |

Many keys never reach the plugin. Read [Choose keys that reach the plugin](docs/CONFIGURATION.md#choose-keys-that-reach-the-plugin) before you change one.

## Status

This is version 0.3.0. The automated tests cover the index and its ranking model, the draft reading, the feeds, the key and option parsing, the editing pipeline, the typeahead rows, the bar, and the keystroke and typeahead hooks with a stand-in for the editor. The test kit cannot deliver real key presses, so the key results below come from a live session.

Confirmed in a live terminal session on 2026-10-22, Claude Code 2.1.309, with `trace` on:

- The index builds at session start from the dictionary, the transcript, its tool calls and the command list. `/cccomplete` showed 47,432 words, 694 contexts, 1,463 code tokens, 1,747 shell tokens and 132 commands, and no failures.
- Typed characters, `space`, `backspace` and `/` reach the plugin. The slowest keystroke took 0.376 ms.
- Prose completion, next-word prediction after a space, and slash command names (`/cc` offers `cccomplete`) all answer.
- The matches appear in the typeahead menu, and `tab` takes one. With `typeahead` off, `tab` takes nothing.
- The menu shows five rows and scrolls to the rest with `down`. Claude Code has no setting for the menu's height: its 2.1.309 settings schema has none, and the plugin API does not draw the menu.
- `left`, `right` and `tab` never reach the plugin's own key path, so they cannot cycle or accept the inline suggestion. Claude Code keeps `tab`, `up` and `down` for its menu.

Not yet confirmed:

- The ranking model and the English model of 0.3.0, in a live session. The tests and an offline replay of 15 sessions cover them: see [docs/ALGORITHM.md](docs/ALGORITHM.md#what-the-model-is-worth).

- `ctrl+a` as a key in 0.2.0. It still moves the cursor, so it may reach the plugin. It worked in 0.1.0.
- Code completion inside backticks, and shell completion after `!`: whether a draft in bash mode still holds the `!` in the text the plugin sees.
- From 0.1.0: the powerline bar's look in a live terminal, and the install commands from a clean machine.

## Develop

```bash
claude plugin test .          # runs the tests and prints the latency measurements
claude plugin validate .      # checks the manifest and the hooks module
tsc -p .                      # type-checks; load the plugin once first
```

`tsc` needs the type declarations that Claude Code writes when it loads the plugin. Run `claude --plugin-dir .` once, then run `tsc -p .`.

`claude plugin validate .` warns that `CLAUDE.md` is not loaded as plugin context. This is expected.

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [CLAUDE.md](CLAUDE.md) before you change the code.

## Licence

MIT or Apache-2.0, at your option. The terms, and the separate terms of the bundled word list, are in [CONTRIBUTING.md](CONTRIBUTING.md).
