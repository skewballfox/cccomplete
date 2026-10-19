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
| `display` | `both` | `both`, `inline` or `bar`. See [Display](#display). |
| `ghost_color` | `dim` | `dim`, a colour name or a hex colour such as `#1e1e1e`. See [Hide the inline suggestion](#hide-the-inline-suggestion). |
| `bar_style` | `powerline` | `powerline` or `buttons`. See [Bar style](#bar-style). |
| `dictionary` | `bundled` | `bundled`, `none` or the path of a dictionary file. See [DICTIONARY.md](DICTIONARY.md). |
| `limit` | `5` | A whole number from 1 to 9. It sets how many matches the bar offers. |
| `min_prefix` | `2` | A whole number from 1 to 4. It sets how many letters you type before suggestions appear. |
| `trailing_space` | `true` | `true` or `false`. It adds a space after an accepted word. |
| `sources` | `both` | `prompts`, `answers` or `both`. It sets which text the index learns from. |

## Display

`display` sets where suggestions appear.

- `both` shows the inline suggestion in the prompt and the bar above it. This is the default.
- `inline` shows the inline suggestion only.
- `bar` shows the bar only.

The accept, next and previous keys need the inline suggestion. A key that moves the cursor needs text to move across. With `bar` there is no inline text, and the accept key did nothing in testing. Use `bar` only with `bar_style` set to `buttons`, and click the buttons.

To hide the inline text and keep the keys, leave `display` at `both` and set `ghost_color`.

## Bar style

`bar_style` sets how the bar draws matches.

- `powerline` draws one coloured segment per match, joined by arrows. The active match is orange. It needs a [Nerd Font](https://www.nerdfonts.com/) in your terminal. The colours are fixed and do not follow your theme. The segments cannot be clicked.
- `buttons` draws `[ word ]` buttons that respond to clicks. It needs no special font.

The bar always takes one row, so the prompt does not move as you type. With no matches, the row shows the key hints.

## Hide the inline suggestion

By default the inline suggestion is painted dim, so you can see it. To hide it and keep the accept keys working, paint it in your terminal's background colour. The text is still in the prompt, so the accept keys still take it. The bar still shows what you are accepting.

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

**Two more conditions.** The accept, next and previous keys work only while a suggestion is showing. They also depend on the inline suggestion. See [Display](#display).

### What was tried

The author tried these keys in a live terminal session on 2026-10-19. The session was built from Claude Code 2.1.292. The installed CLI now reports 2.1.303, and the keys have not been tested again on it. The terminal was VS Code's integrated terminal on macOS.

| Key | Result | Why, as far as known |
| --- | --- | --- |
| `tab` | Does not work | Claude Code binds it to its own autocomplete. |
| `shift+tab` | Not tried | Claude Code binds it to cycle the permission mode. Do not use it. |
| `ctrl+n`, `ctrl+p` | Do not work | Claude Code binds them to its own lists and history. |
| `ctrl+j` | Does not work; inserts a newline | Claude Code binds it to a new line. |
| `ctrl+.`, `ctrl+,` | Do not work | Most terminals send the bare character, not a ctrl combination. A terminal that uses the kitty keyboard protocol may report them apart. |
| `right` | Works | It moves the cursor across the inline suggestion. |
| `ctrl+a`, `ctrl+d` | Work (used for previous and next) | Both are free in the default key bindings. |
| `ctrl+e` | Not confirmed | It is a cursor move, so it should work. No one has confirmed it in a live session. |

On macOS, the system may also take `ctrl` with the left and right arrows for Mission Control. That was not tested.

### Pick and test a key

1. Open your key bindings file (`~/.claude/keybindings.json`). Skip any key it binds in the `Chat` context.
2. Pick a key that moves the cursor or edits the draft, such as an arrow key, or `ctrl` with a letter that readline uses for editing.
3. Set the option and restart Claude Code. Type a prefix until a suggestion shows, and press the key.
4. Run `/cccomplete`. See [Check that it works](USAGE.md#check-that-it-works). If the key is not in the `recent keys` line, it never arrived. Choose another.

A key that arrives but shows `no key` in the `recent edits` line reached the plugin without its name, so the plugin cannot match it.
