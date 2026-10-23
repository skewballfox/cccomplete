# The dictionary: format, source and rebuild

**Who this is for:** people who want to replace the bundled dictionary with their own, and contributors who need to rebuild or check the bundled dictionary or the bundled English model.

**What this document does not cover:** how the index ranks words (see [ALGORITHM.md](ALGORITHM.md)) and how to install the plugin (see [../README.md](../README.md)).

**Evidence dates:** facts about the dictionary's source come from the SCOWL/ESDB repository and its release page on GitHub, read on 2026-10-19. Facts about the English model's source come from the Tatoeba downloads page and its export files, read on 2026-10-22.

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

The dictionary and the English model form the lowest level of the ranking model (see [ALGORITHM.md](ALGORITHM.md)). cccomplete adds each dictionary word to the English index once, last line first, so among dictionary words an earlier line ranks higher. Then it adds the English model's counts, so a word the model holds ranks by how common it is in everyday English.

The conversation takes over as it grows. With `N` words learned, the conversation's own frequencies get the weight `N / (N + 500)` and the English level the rest. So:

- In a new session, a common English word can rank above a word you have used once.
- After a few hundred words, the words you use dominate, and a word you use often ranks above every dictionary word.
- A word that often followed the word before the cursor ranks high at any time, in your conversation or in everyday English.

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

## The bundled English model

The English model holds word counts and, for common words, the counts of the words that follow them. It lets cccomplete rank by everyday grammar before your conversation has much of its own: after `to`, `be` and `get` rank high; after `I`, `don't` and `think` do. The `english` option turns it off.

| Item | Value |
| --- | --- |
| Source | Tatoeba, a collection of example sentences written by volunteers |
| Home | <https://tatoeba.org> |
| File used | `eng_sentences_CC0.tsv.bz2`, the English sentences offered under CC0, from <https://downloads.tatoeba.org/exports/per_language/eng/> |
| Export | Weekly export, last modified 2026-10-17 |
| SHA-256 of the download | `a144a0c52f8be13bee7cc30eb109eb5836803f22128a8ef8376c1ca5c6c5cf8a` |
| Sentences | 41,513 |
| Licence | CC0 1.0 Universal, a public domain dedication. The downloads page (read 2026-10-22) says "A part of our sentences are also available under CC0 1.0". No notice has to travel with the file. |

Why this subset: Tatoeba's full English export (2,039,120 sentences) is under CC BY 2.0 FR, which needs attribution. In a replay of 15 local sessions, the CC0 subset gave the same gain as the full set (word completion top-5: 64.0% with either). See [ALGORITHM.md](ALGORITHM.md#what-the-model-is-worth).

### The file

`data/english.tsv` is plain UTF-8 text, about 495 KB. A line that starts with `#` is a comment. Each other line is one tab-separated record:

```text
w  word  count
p  context  total  distinct  word count word count ...
```

- A `w` line gives a word and how often it occurred. Lines run commonest first.
- A `p` line gives a context, how many words followed it, how many different words followed it, and its commonest followers with their counts. `total` and `distinct` are taken before pruning, because the smoothing weight needs the true values.
- Words and contexts follow the plugin's own rules in `src/words.ts`. A line that does not parse is skipped.

### What the build changes

`scripts/build-english.ts` reads the sentences with the plugin's own tokenizer and keeps:

1. words seen at least twice (22,151 words);
2. the 3,000 commonest contexts, each with up to 60 followers seen at least twice after it (2,861 contexts keep at least one).

### Rebuild the English model

Download into an empty scratch directory, not into the repository, and treat the download as untrusted data. Node 23.6 or later runs the script directly.

```bash
curl -sLO https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences_CC0.tsv.bz2
sha256sum eng_sentences_CC0.tsv.bz2      # a new weekly export has a new hash: record it in the table above
bunzip2 -k eng_sentences_CC0.tsv.bz2
node <repository>/scripts/build-english.ts eng_sentences_CC0.tsv <export date> <repository>/data/english.tsv
```

Give the export date as `YYYY-MM-DD`, from the file's last-modified date on the downloads server. Then update the table above: the export date, the hash, the sentence count, and the counts the script prints. Rerun `claude plugin test .`.

### Check the English model

Run these in the repository root:

```bash
grep -c '^w	' data/english.tsv    # the word count the script printed
grep -c '^p	' data/english.tsv    # the context count the script printed
wc -c < data/english.tsv           # under 4 MiB, the limit of $.fs.read
```

`tests/english.test.ts` covers the reader. `tests/lexicon.test.ts` covers the ranking with English counts.

## Limits

- **A fresh session spends time loading.** In `tests/latency.test.ts` on 2026-10-22, reading and indexing 47,000 dictionary words took 145 ms, and an English model of the bundled size 212 ms. It happens once, at session start, and never on a keystroke. [Issue #1](https://github.com/skewballfox/cccomplete/issues/1) proposes loading most of it in the background.
- **The dictionary and the English model live in memory.** They are loaded again each session.
- **The English model is small and general.** Its sentences are short, everyday English. It knows grammar, not your project's terms; those come from the conversation.
- **Whether the bundled path resolves in a live session is not yet confirmed.** The plugin reads `data/dictionary.txt` under the plugin's root directory. The test kit resolves that path, but no live session has confirmed it. If `/cccomplete` shows `dictionary: bundled, 0 words`, the file did not load.
