# The dictionary: format, source and rebuild

**Who this is for:** people who want to replace the bundled dictionary with their own, and contributors who need to rebuild or check the bundled file.

**What this document does not cover:** how the index ranks words (see [ALGORITHM.md](ALGORITHM.md)) and how to install the plugin (see [../README.md](../README.md)).

**Evidence dates:** facts about the source come from the SCOWL/ESDB repository and its release page on GitHub, read on 2026-10-19.

## Purpose

A dictionary gives the index words before you have typed any. Without one, suggestions start empty and fill as the conversation grows. With one, a new session suggests common words from the first keystroke.

A dictionary word ranks below every word you use. See [Ranking](#ranking).

## Choose a dictionary

Set the `dictionary` option to one of three values.

| Value | Effect |
| --- | --- |
| `bundled` | Loads `data/dictionary.txt`, the file that ships with the plugin. This is the default. |
| `none` | Loads no dictionary. The index learns only from the conversation. |
| A file path | Loads that file instead. Use an absolute path. A relative path starts at the project directory. `~` is not expanded. |

If the named file cannot be read, cccomplete shows a toast and loads the bundled dictionary. `/cccomplete` names the dictionary in effect and how many words it gave.

A changed option needs a restart of Claude Code.

## File format

A dictionary file is plain UTF-8 text.

- **One word per line, best first.** The first line ranks highest. The order is the only ranking information the file carries.
- **A line that starts with `#` is a comment.** A blank line is ignored.
- **A line keeps its first token only.** The token ends at a space, a tab or a `/`. Text after it is ignored.
- **A token must be one word the index would store.** It has 3 to 64 characters and at least one letter. It may hold letters, digits and underscores, joined by single `'`, `’` or `-` characters. Any other token is skipped without a message. The rules are in `src/words.ts`.
- **Case matters.** `Prompt` and `prompt` are two words, and a prefix completes only to a word that starts with the same letters in the same case.
- **A repeated word counts once**, at its first line.

The first-token rule means a Hunspell `.dic` file loads as it is. The count on its first line and the affix flags after each `/` are skipped. A `.dic` file lists word stems, so it holds `configure` but not `configuring`. A one-word-per-line file such as `/usr/share/dict/words` also loads.

A file may be up to 4 MiB, which is the limit of `$.fs.read`. That is about 400,000 words of average length.

### Example

```text
# my team's words
kubernetes
postgres
observability
```

## Ranking

cccomplete adds each dictionary word to the index once, so each has a count of one. It adds them last line first. The first line therefore has the newest position and ranks highest among words with equal counts.

The index ranks by count, then by recency. So:

- A word you have used once ranks above any dictionary word, because it is newer.
- A word you use more often ranks above words you use less often, and above every dictionary word.
- Among dictionary words, an earlier line ranks higher.

Dictionary words never rank above a word from your conversation. They fill the lists only where your conversation has no match.

## The bundled dictionary

| Item | Value |
| --- | --- |
| Source | The `en_US` Hunspell dictionary from SCOWL/ESDB (the English Speller Database), by Kevin Atkinson |
| Home | <https://wordlist.aspell.net> and <https://github.com/en-wl/wordlist> |
| Release | `rel-2026.02.25`, published 2026-02-25 |
| File used | `hunspell-en_US-2026.02.25.zip`, member `en_US.dic` |
| SHA-256 of the zip | `ac8e73310e951d88c52c2cf2ba54ceaca34f8486a81630ac8a75dc5f931179f9` |
| Size level | SCOWL size 60, the level the release notes give for the default dictionaries |
| Licence | MIT-like, and separate from the plugin's own `MIT OR Apache-2.0` licence. The notice is in `data/LICENSE-SCOWL.txt` and must travel with any copy of the word list. |

SCOWL is an actively maintained project. The repository showed activity on 2026-07-07. Spell checkers use its dictionaries. This document does not claim a formal audit.

### What the build changes

The bundled file is the `.dic` stems with these changes:

1. The first line (the entry count) and all affix flags are removed.
2. Entries that carry the `!` flag are dropped. SCOWL uses it as `NOSUGGEST` for taboo words. The release notes say the flagging is a best effort and not a guarantee.
3. Words under 3 characters are dropped.
4. Duplicates are removed.
5. The list is sorted by length, then alphabetically, so shorter words rank higher.

SCOWL gives no word frequencies, so length stands in for commonness. If you have a frequency-ordered list, use it with the `dictionary` option. It will rank better.

The file holds stems only. It does not hold inflections such as `configuring`. You still get them once you have used them.

### Rebuild the bundled file

Run these in an empty scratch directory, not in the repository. Treat the download as untrusted data.

```bash
curl -sLO https://github.com/en-wl/wordlist/releases/download/rel-2026.02.25/hunspell-en_US-2026.02.25.zip
shasum -a 256 hunspell-en_US-2026.02.25.zip   # must match the table above
unzip -q hunspell-en_US-2026.02.25.zip

tail -n +2 en_US.dic | awk -F/ '$2 !~ /!/ {print $1}' | LC_ALL=C awk 'length($0) >= 3' \
  | LC_ALL=C sort -u | LC_ALL=C awk '{print length($0) "\t" $0}' \
  | LC_ALL=C sort -n -s -k1,1 | cut -f2- > words.txt
```

Then write the six-line `#` header from the top of `data/dictionary.txt` above `words.txt`, and save the result as `data/dictionary.txt`. To use a newer release, change the tag, the file name and the hash in the commands and in the table, and read the release notes for changes to the flags.

### Check the bundled file

The test kit cannot read files, so no automated test covers the file itself. Run these in the repository root. Each count must match the comment.

```bash
grep -c '^#' data/dictionary.txt                                                            # 6
grep -v '^#' data/dictionary.txt | awk 'length($0) < 3' | wc -l                             # 0
grep -v '^#' data/dictionary.txt | awk '{ if (length($0) < p) bad++; p = length($0) } END { print bad + 0 }'   # 0
grep -v '^#' data/dictionary.txt | sort | uniq -d | wc -l                                   # 0
grep -v '^#' data/dictionary.txt | grep -c '[/ 	]'                                          # 0
```

`tests/dictionary.test.ts` covers the reader and the ranking. `tests/register.test.ts` covers the loading, the fallback and the toast.

## Limits

- **A fresh session spends time loading.** Reading and indexing 46,990 words took 57 ms in `tests/latency.test.ts`, on 2026-10-19. It happens once, at session start, and never on a keystroke.
- **The dictionary lives in memory.** It is loaded again each session.
- **Whether the bundled path resolves in a live session is not yet confirmed.** The plugin reads `data/dictionary.txt` under the plugin's root directory. The test kit resolves that path, but no live session has confirmed it. If `/cccomplete` shows `dictionary: bundled, 0 words`, the file did not load.
