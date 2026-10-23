# Configuration

**Who this is for:** people who use cccomplete and want to change its options, its keys or its look.

**What this document does not cover:** how to install the plugin (see [../README.md](../README.md)), how to check that it works and what to do when it does not (see [USAGE.md](USAGE.md)), and the dictionary file format (see [DICTIONARY.md](DICTIONARY.md)).

**Evidence dates:** the key results come from live testing on 2026-10-19. See [What was tried](#what-was-tried).

## Change an option

Open `/config` in Claude Code and find the cccomplete rows. You can also run `/plugin configure cccomplete@cccomplete`, or set a value from a shell:

```bash
echo '{"ghost_color":"#1e1e1e"}' | claude plugin configure cccomplete@cccomplete --values-stdin
```

A changed option needs a restart of Claude Code. A reload with `/reload-plugins` re-reads the code but not the options.

An invalid option falls back to its default. cccomplete shows a toast when a session starts and lists the problem in `/cccomplete`.

## Options

| Option | Default | What it accepts |
| --- | --- | --- |
| `accept_key` | `right, ctrl+e` | One or more key combinations, separated by commas. Any of them accepts the suggestion. |
| `next_key` | `ctrl+d` | A key combination. It moves to the next suggestion. |
| `previous_key` | `ctrl+a` | A key combination. It moves to the previous suggestion. |
| `display` | `inline` | `inline`, `both` or `bar`. See [Display](#display). |
| `ghost_color` | `dim` | `dim`, a colour name or a hex colour such as `#1e1e1e`. See [Hide the inline suggestion](#hide-the-inline-suggestion). |
| `bar_style` | `powerline` | `powerline` or `buttons`. See [Bar style](#bar-style). |
| `dictionary` | `bundled` | `bundled`, `none` or the path of a dictionary file. See [DICTIONARY.md](DICTIONARY.md). |
| `limit` | `5` | A whole number from 1 to 9. It sets how many matches the bar offers. |
| `min_prefix` | `2` | A whole number from 1 to 4. It sets how many letters you type before suggestions appear. |
| `min_gain` | `2` | A whole number from 1 to 3. A match must add at least this many letters, so a suggestion always saves more than the key that takes it. At `2`, typing `th` offers `that` and `they` but not `the`. Next-word prediction is not affected. |
| `trailing_space` | `true` | `true` or `false`. It adds a space after an accepted word, except inside code. |
| `predict_next` | `true` | `true` or `false`. After a space, it suggests the word you most often used after the one before it. |
| `typeahead` | `true` | `true` or `false`. It also lists matches in Claude Code's own typeahead menu, where `tab` takes one. |
| `english` | `true` | `true` or `false`. It ranks words with the bundled English word and word-pair counts until your conversation has enough of its own. See [DICTIONARY.md](DICTIONARY.md). |
| `trace` | `false` | `true` or `false`. It keeps the last 20 hook events and lists them in `/cccomplete`. See [Trace a problem](USAGE.md#trace-a-problem). |
| `sources` | `both` | `prompts`, `answers` or `both`. It sets which text the index learns from. |

## Display

`display` sets where suggestions appear.

- `inline` shows the inline suggestion only. This is the default since version 0.2.0, because the typeahead menu already lists the matches.
- `both` shows the inline suggestion in the prompt and the bar above it. Turn `typeahead` off with it, or the matches show twice.
- `bar` shows the bar only.

With `bar`, the accept key did nothing in testing of version 0.1.0, because the cursor sat at the end of the draft and the key moved nothing. Since version 0.2.0 the inline suggestion is also drawn after the end of the draft, so every display may behave this way. See [Choose keys that reach the plugin](#choose-keys-that-reach-the-plugin). `tab` in the typeahead works in every display.

## Bar style

`bar_style` sets how the bar draws matches.

- `powerline` draws one coloured segment per match, joined by arrows. The active match is orange. It needs a [Nerd Font](https://www.nerdfonts.com/) in your terminal. The colours are fixed and do not follow your theme. The segments cannot be clicked.
- `buttons` draws `[ word ]` buttons that respond to clicks. It needs no special font.

The bar always takes one row, so the prompt does not move as you type. With no matches, the row shows the key hints.

## Hide the inline suggestion

By default the inline suggestion is painted dim, so you can see it. To hide it, paint it in your terminal's background colour. The suggestion is drawn whatever its colour, so the keys still take it. The bar still shows what you are accepting.

1. Find your terminal's background colour as a hex value, such as `#1e1e1e`. Take it from your terminal's colour settings. cccomplete cannot read it for you: Claude Code gives a plugin no terminal or theme colour, and the plugin cannot query the terminal.
2. Set `ghost_color` to that value.
3. Restart Claude Code.

`ghost_color` takes `dim` (the default), a colour name such as `black`, or a hex colour with three or six digits. Anything else falls back to `dim` and is reported.

Know the limits:

- **One colour per machine.** The setting does not follow your terminal theme. If you use several terminals or themes, set `ghost_color` on each machine, or leave it at `dim`.
- **A near match shows.** A colour that is close to the background but not equal leaves a faint ghost. Copy the exact value.
- **The cursor and a selection show it.** Both invert the colours, so a selected range reveals the hidden text.
- **To undo it,** set `ghost_color` back to `dim`.

## Key combinations

A key combination is one or more modifiers, then a key, joined by `+`. Case does not matter.

- Modifiers: `ctrl`, `shift` and `meta` (also written `alt` or `option`).
- Named keys: `tab`, `return` (also `enter`), `escape` (also `esc`), the four arrow keys, `home`, `end`, `pageup`, `pagedown`, `backspace` and `delete`.
- Punctuation keys: `.` `,` `;` `/` `\` `'` `[` `]` `-` `=` and the backtick. `+` is not available, because it separates the parts.
- Letters, digits and punctuation keys need `ctrl` or `meta`, because a bare one is typing.

If you bind one key to two actions, the earlier action wins, in the order accept, next, previous. cccomplete reports the clash.

## Choose keys that reach the plugin

Most people try `tab` first. It does not work. Claude Code, not the plugin, decides which key presses the plugin hears about, and many keys never arrive. Read this section before you change a key.

**What the plugin hears.** The plugin hears a key only when the key edits the draft or moves the cursor. A key that does nothing to the draft, or that Claude Code binds to one of its own actions, never reaches the plugin. This is how the results below fit together. It is a working explanation from live testing, not a documented rule.

**Two more conditions.** The accept, next and previous keys work only while a suggestion is showing. And since version 0.2.0 the cursor sits at the end of the draft, so a key such as `right` moves nothing. If Claude Code does not report a key that changes nothing, that key no longer works. This is not yet tested. See [Display](#display).

### What was tried

The author tried these keys in a live terminal session on 2026-10-19. The session was built from Claude Code 2.1.292. The installed CLI now reports 2.1.303, and the keys have not been tested again on it. The terminal was VS Code's integrated terminal on macOS.

| Key | Result | Why, as far as known |
| --- | --- | --- |
| `tab` | Does not work as a cccomplete key | Claude Code binds it to its own typeahead. Since version 0.2.0, cccomplete adds its matches to that typeahead, so `tab` takes them there. Not yet tested live. |
| `shift+tab` | Not tried | Claude Code binds it to cycle the permission mode. Do not use it. |
| `ctrl+n`, `ctrl+p` | Do not work | Claude Code binds them to its own lists and history. |
| `ctrl+j` | Does not work; inserts a newline | Claude Code binds it to a new line. |
| `ctrl+.`, `ctrl+,` | Do not work | Most terminals send the bare character, not a ctrl combination. A terminal that uses the kitty keyboard protocol may report them apart. |
| `right` | Worked in 0.1.0 | It moved the cursor across the inline suggestion, which was then text in the draft. Not tested since the suggestion became virtual text in 0.2.0. |
| `ctrl+a`, `ctrl+d` | Worked in 0.1.0 (used for previous and next) | Both are free in the default key bindings. `ctrl+a` still moves the cursor. `ctrl+d` deleted the suggestion's text in 0.1.0 and now deletes nothing, so it is not tested in 0.2.0. |
| `ctrl+e` | Not confirmed | It is a cursor move, so it should work. No one has confirmed it in a live session. |

On macOS, the system may also take `ctrl` with the left and right arrows for Mission Control. That was not tested.

### Pick and test a key

1. Open your key bindings file (`~/.claude/keybindings.json`). Skip any key it binds in the `Chat` context.
2. Pick a key that moves the cursor or edits the draft, such as an arrow key, or `ctrl` with a letter that readline uses for editing.
3. Set the option and restart Claude Code. Type a prefix until a suggestion shows, and press the key.
4. Run `/cccomplete`. See [Check that it works](USAGE.md#check-that-it-works). If the key is not in the `recent keys` line, it never arrived. Choose another.

A key that arrives but shows `no key` in the `recent edits` line reached the plugin without its name, so the plugin cannot match it.
