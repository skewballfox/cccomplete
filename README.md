# cccomplete

cccomplete is a Claude Code plugin that completes the word you are typing. It learns its words from your conversation with Claude, and starts with a bundled list of common words.

## Who this is for

This document is for people who use Claude Code in a terminal or in the desktop Code tab, and who want completion for the words they and Claude use often. It also helps people who want to install, configure or change the plugin.

## What this document does not cover

- Every option, the keys that work, and how to hide the inline suggestion. See [docs/CONFIGURATION.md](docs/CONFIGURATION.md).
- Checking that it works, troubleshooting and limits. See [docs/USAGE.md](docs/USAGE.md).
- The dictionary file format, its source and how to rebuild it. See [docs/DICTIONARY.md](docs/DICTIONARY.md).
- How the word index works. See [docs/ALGORITHM.md](docs/ALGORITHM.md).
- How the code is organised. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- The rules for changing the code. See [CLAUDE.md](CLAUDE.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## Purpose

Long chats repeat the same words: file names, function names, project terms. Typing them in full is slow. cccomplete offers the rest of the word as you type.

It does this in two places:

- **Inline suggestion.** Dim text after your cursor shows the best match.
- **Bar.** A row above the prompt shows up to nine matches as powerline segments. The segments need a [Nerd Font](https://www.nerdfonts.com/) in your terminal.

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

Type at least two letters of a word. A suggestion appears. Press `right` or `ctrl+e` to accept it, and `ctrl+d` or `ctrl+a` to change it. `tab` does not work: Claude Code uses it for its own autocomplete. See [docs/USAGE.md](docs/USAGE.md).

## Configure

Open `/config` and find the cccomplete rows. A changed option needs a restart of Claude Code. [docs/CONFIGURATION.md](docs/CONFIGURATION.md) explains each option.

| Option | Default | What it accepts |
| --- | --- | --- |
| `accept_key` | `right, ctrl+e` | One or more key combinations, separated by commas. |
| `next_key` | `ctrl+d` | A key combination. |
| `previous_key` | `ctrl+a` | A key combination. |
| `display` | `both` | `both`, `inline` or `bar`. |
| `ghost_color` | `dim` | `dim`, a colour name or a hex colour such as `#1e1e1e`. |
| `bar_style` | `powerline` | `powerline` or `buttons`. |
| `dictionary` | `bundled` | `bundled`, `none` or the path of a dictionary file. |
| `limit` | `5` | A whole number from 1 to 9. |
| `min_prefix` | `2` | A whole number from 1 to 4. |
| `trailing_space` | `true` | `true` or `false`. |
| `sources` | `both` | `prompts`, `answers` or `both`. |

Many keys never reach the plugin. Read [Choose keys that reach the plugin](docs/CONFIGURATION.md#choose-keys-that-reach-the-plugin) before you change one.

## Status

This is version 0.1.0. The automated tests cover the index, the key and option parsing, the editing pipeline, the bar and the learning step. The test kit cannot raise the `prompt.edit` event or deliver real key presses, so a live session has confirmed only some of the behaviour.

Confirmed in a live session: `right`, `ctrl+a` and `ctrl+d` as keys, and loading the bundled dictionary. Not confirmed: `ctrl+e`, the powerline bar's look in a live terminal, and the install commands from a clean machine.

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
