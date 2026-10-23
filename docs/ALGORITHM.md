# The completion index: algorithm and rationale

**Who this is for:** contributors who need to change the index in `src/trie.ts`, and reviewers who need to judge whether it fits its job.

**What this document does not cover:** how the index connects to Claude Code (see [ARCHITECTURE.md](ARCHITECTURE.md)) and how to use the plugin (see [../README.md](../README.md)).

**Evidence dates:** Claude Code facts come from its type declarations, version 2.1.292, and its documentation, both read on 2026-10-15, and from the declarations for 2.1.309, read on 2026-10-22. Measurements come from `tests/latency.test.ts`, run on 2026-10-22 on Linux (Fedora, kernel 7.2).

## Summary

The index is a set of **radix tries with a precomputed list of the best completions at every node**. A lookup walks the typed prefix and reads one stored list per trie. It never walks a subtree. An insertion updates the lists along one path.

A prose lookup asks three tries, in a fixed order called *tiers*: the words seen after the same *context* (the word before the prefix), the words of recent turns, and every word. It takes their lists in that order and drops repeats. Code, shell commands and slash commands have tries of their own. See [Context and tiers](#context-and-tiers).

## The problem

The plugin must answer one question on every keystroke: *which stored words extend the word being typed, best first?*

| Constraint | Source | What it demands |
| --- | --- | --- |
| C1. The index updates after a chat turn, not while typing. | Project requirement | Insertion may cost more than lookup. Insertion happens in a batch, off the typing path. |
| C2. A lookup must finish in under 13 ms. | Project requirement | Lookup cost must not depend on how many words the prefix matches. |
| C3. The index holds a conversation's vocabulary: thousands to tens of thousands of distinct words. | Assumption. The test uses a 400,000-word conversation with 49,742 distinct words and 49,742 contexts. | A structure sized for millions of words is not needed. |
| C4. Words only arrive. Nothing is removed. | Design choice | The structure needs no deletion. A bounded or persistent store would need eviction, which the exactness argument below rules out in the live index. |
| C5. The code runs in the Claude Code mod environment. | Type declarations, 2.1.292 | Plain TypeScript only. The environment has no WebAssembly, no native modules and no `eval`. |

C5 matters because it removes the common escape route of writing the index in a compiled language. A probe mod run on 2026-10-15 confirmed that the `WebAssembly` global does not exist. A second probe under `claude plugin test` on 2026-10-22 (2.1.309) found the same, and the 2.1.309 declarations say the omission is deliberate.

## How it works

### Structure

Each node holds:

- `edge`: the characters on the edge from its parent. A radix trie stores a run of characters on one edge, not one character per node.
- `children`: the child nodes, found by the first character of their edge.
- `end`: the word that ends exactly at this node, if one does. It holds the word, its count and the tick of its latest occurrence.
- `top`: the best words in this node's subtree, best first, at most 10.

All `top` lists point to the same word objects. When a word's count changes, every list that holds it sees the change.

### Ranking

A word ranks higher when its count is higher. Among words with equal counts, the word seen more recently ranks higher. Each insertion takes a new, larger tick, so two words never tie. The order is total and deterministic.

### Insertion

To insert a word, the trie:

1. Walks from the root, following the edge that shares the next character.
2. Splits an edge in two when the word shares only the start of it. The new middle node copies the lower node's `top` list, because both cover the same words.
3. Adds a leaf for any remaining characters.
4. Adds one to the word's count and sets its tick.
5. Updates the `top` list of every node on the path, the root included. If the word is in the list, it moves up past lower-ranked words. If it is not, and the list is full, it replaces the last word only when it outranks that word.

### Lookup

To look up a prefix, the trie walks the prefix from the root. If the prefix ends in the middle of an edge, the walk stops at the node below that edge, because every word under that node starts with the prefix. The trie then reads that node's `top` list, drops the prefix itself if it is a stored word, and returns the first `limit` words. With no prefix, the walk stops at once and reads the root's list: the best words of the whole trie.

### Why the lists are exact

Step 5 keeps each `top` list equal to the true best 10 of its subtree. The argument:

- A word's rank only rises. Its count never falls and its tick only grows.
- Because every rank only rises, the lowest rank in a full list never falls.
- A word outside a full list can therefore enter only by outranking the list's last word. Step 5 tests exactly that.
- A list that is not full holds every word of its subtree, because step 5 adds each new word to it.

`tests/trie.test.ts` checks the result against a plain sort-everything implementation on 6,000 random insertions and 400 random queries.

## Context and tiers

### What a context is

The *context* of a word is the run of characters directly before it, when only spaces or tabs come between them (at most 8). A context never crosses punctuation or a line break: in `run. tests`, `tests` has no context. A context need not be a word the index completes. `to` is too short to complete, but it still predicts `be`.

In a shell command (a draft that starts with `!`), the first token of each command has a context of its own, `COMMAND_START`. A command starts at the beginning of the line and after `|`, `;`, `&` or `(`. So `!` alone predicts the commands you run most, and `!git ` predicts what follows `git`.

### Structure

A *vocabulary* is one trie of every word, plus a map from each context to a trie of the words seen after it. Every insertion goes into the all-words trie and into its context's trie. The prose and shell indexes are vocabularies.

| Index | Learns from | Serves |
| --- | --- | --- |
| Prose | Prompts and answers, and the dictionary | Prose drafts |
| Recent | The prose of the last 8 to 15 turns | Prose drafts, second tier |
| Code | Code spans and fences in prompts and answers; paths, code and file contents from the Read, Edit, Write, NotebookEdit, Glob and Grep tools | Drafts whose end is inside a code span or fence |
| Shell | `!` prompts and the commands Claude ran with Bash | Drafts that start with `!` |
| Commands | `$.command.list()`, ranked by how often you ran each command | The name on a `/` line |

The draft decides which index serves it (`targetOf` in `src/draft.ts`). It reads only the end of the draft: the prefix (at most 64 code units), the gap and the context before it (at most 8 + 64), and the last 4,096 code units to see whether the end is inside code. A fence opened earlier than that is not seen.

### Tiers and why the merge stays exact

A prose lookup for a prefix with a context takes, in order:

1. the context trie's list for the prefix,
2. the recent trie's list,
3. the all-words trie's list.

`mergeTiers` concatenates them, skips a word it already took, and stops at the limit `L`. The result is the true best `L` under this order: tier first, then rank inside the tier.

- Each list is exact for its trie, by the argument above.
- Tier 1 gives `a` words. Tier 2's list holds its best `L` words, and at most `a` of them repeat tier 1's. So tier 2 still has at least `L − a` new words, which is all the merge needs from it. The same holds for tier 3 with `a + b` repeats.
- Each list is asked for `L` words. The trie keeps 10 per node, and `L` is at most 9, so the prefix itself, when stored, never pushes a needed word out.

`tests/lexicon.test.ts` checks the merge against a plain rank-everything implementation on 300 random sets of tiers.

The tiers are ordered, never blended. A blended score, such as a weighted sum of the context count and the overall count, would change in every context list that holds a word whenever that word's overall count changed. An insertion would then touch every context, and the lists would no longer be exact.

### The recent tier

Ranks only rise, so a trie cannot forget. The recent tier forgets by replacement. The lexicon keeps the prose of the last 8 turns. Every 8 turns it builds a fresh trie from them. Between rebuilds, each new turn goes into the current trie. The tier therefore covers between 8 and 15 turns. A fresh trie starts from nothing, so ranks inside it still only rise, and its lists are exact.

### Next-word prediction

When the draft ends in spaces after a word, and `predict_next` is on, the lookup asks the context trie for its best words with no prefix. The root of every trie keeps a list for this. Accepting a match looks up the result again, so the next word shows at once.

## Cost

Let `L` be a word's length, `P` the prefix length, `K` the list size (10) and `D` the number of nodes on the insertion path (at most `L`).

| Operation | Cost | Notes |
| --- | --- | --- |
| Read the draft | `O(P + 72 + 4096)` | The prefix, the gap and context, and the code window. Independent of the draft's length. |
| Lookup | `O(P + 3K)` plus one map lookup of the context | Three lists and a merge of at most 27 entries. Independent of the vocabulary size. |
| Insert one word | `O(L + D·K)`, twice | Once in the all-words trie, once in its context's trie. Runs after a chat turn. |
| Rebuild the recent tier | Learning 8 turns again | Every 8 turns, after a chat turn. |
| Memory | `O(total edge characters + nodes·K)` per trie | One small trie per distinct context. |

### Measured

These numbers come from `claude plugin test .` on 2026-10-22, on Linux. They cover the steps the plugin runs itself on a keystroke: reading the draft, the lookups and the merge. They exclude the host's own edit and the round trips to the host's state store, which the plugin cannot change. The earlier measurements, from 2026-10-15 on macOS, were about five times lower for the old single-list lookup; the two machines differ, so compare only numbers from one run.

| Measurement | Result | Target |
| --- | --- | --- |
| One keystroke, 400,000-word conversation (49,742 words, 49,742 contexts, 20,000 samples): mean | 0.016 ms | |
| p99 | 0.038 ms | under 13 ms |
| Slowest sample | 5.9 ms | under 13 ms |
| Next-word prediction after a space: mean / p99 | 0.006 ms / 0.017 ms | under 13 ms |
| A one-letter prefix against a seven-letter prefix | 0.005 ms and 0.004 ms | equal cost |
| A 200,006-character draft full of code spans | 0.24 ms | under 13 ms |
| Learning a 32,000-character turn (6,400 words) | 21 ms | no target; runs after the turn |
| Parsing and seeding a 47,000-word dictionary | 317 ms | no target; runs once at session start |

On the same machine, the old single-list lookup measured a mean of 0.005 ms and a p99 of 0.019 ms. The tiers cost about three times as much and stay more than 300 times under the target at p99. The slowest sample is a pause outside the lookup, most likely garbage collection: it appears once in 20,000 samples and varies between runs.

## Why this is the best fit

Each constraint maps to a property of the design:

- **C1 and C2 together** are what make precomputed lists worthwhile, and what keep the tiers ordered rather than blended. The design moves cost from lookup to insertion. Insertion runs once per chat turn, where 2 to 3 ms goes unnoticed. Lookup runs on every keystroke, where it must stay small.
- **C2** holds with a margin of more than three orders of magnitude, which leaves room for the host's own work inside the 13 ms.
- **C3** means memory is not the limiting resource. The cost of `K` entries per node is acceptable at this size.
- **C4** means the lists never need rebuilding after a removal.
- **C5** is met by plain TypeScript with no dependencies.

### Alternatives considered

| Alternative | Why it was not chosen |
| --- | --- |
| Plain character trie, then collect and sort the subtree | Lookup cost grows with the number of matching words. A one- or two-letter prefix matches the most words, which is the case that happens first on every word. |
| Radix trie without the lists | Same lookup cost as above. The lists are the part that removes it. |
| Ternary search tree | Compact, but a top-N query still has to visit the subtree. |
| Sorted array with binary search | Finding the range of matching words is fast. Ranking inside the range needs a scan or a range-maximum structure. Each insertion shifts the array. |
| Hash map from every prefix to its best list | Lookup is `O(1)`, but memory grows with every character of every word times `K`. A radix trie shares those characters. |
| Minimal automaton or finite-state transducer | Very compact, but it is built once and not updated. Rebuilding after every turn is possible. It adds a build step and still needs weights. The vocabulary here does not need the compactness. |
| Native or WebAssembly index | Not available in the mod environment (constraint C5). |
| A blended score of context and overall counts | Breaks exactness, or makes each insertion touch every context. See [Tiers and why the merge stays exact](#tiers-and-why-the-merge-stays-exact). |
| Decay of old counts | Ranks would fall, which breaks exactness. The recent tier gives most of the effect by replacement. |

### When to revisit

Revisit the choice if either assumption changes:

- **The vocabulary reaches millions of words.** The lists then cost real memory. A transducer rebuilt after each turn, or an external process reached through `$.process`, becomes worth its complexity. A process adds a round trip to every keystroke. The `prompt.edit` hook has a 50 ms limit, so measure first.
- **Ranking needs to forget faster.** The ranks here only rise. The recent tier forgets by replacement every 8 turns. A true decay would break the exactness argument above, and the lists would need rebuilding on decay.

## Seeding from a dictionary

At session start the plugin inserts the words of a dictionary file, last line first, each once. The first line gets the newest tick, so earlier lines rank higher among equal counts. The file format and its source are in [DICTIONARY.md](DICTIONARY.md).

This uses only `insert`, so the exactness argument holds without change. Each seed word has a count of one. The plugin inserts seed words before the transcript, so every word from the conversation has a newer tick. A word from the conversation therefore outranks every seed word it ties on count with, and any word with a higher count outranks it by count.

## Known behaviours

- **Case matters.** The trie stores words as written. This keeps identifiers such as `PromptEdit` intact. A smart-case lookup that matches case-insensitively when the prefix is all lowercase is possible, but the inline suggestion would then have to replace the typed prefix and not only append text.
- **UTF-16 code units.** The trie splits on code units, not code points. Letters outside the basic multilingual plane are not word characters, so they never enter the trie.
- **Capacity.** The lists hold 10 words. A lookup asks for at most 9, because the prefix may itself be a stored word and takes one slot.
- **Code tokens.** A code token is a run of letters, digits and `_ . / - : @`, less a trailing `.` or `:`, with 3 to 64 characters and a letter. `src/trie.ts` and `--plugin-dir` are one token each.
- **Not persisted.** The tries live in memory and rebuild from the dictionary, the transcript (its tool calls included) and the command list at each session start. Only the command counts persist, in `$.store`.
- **Word rules.** A word has 3 to 64 code units and at least one letter. See `src/words.ts`.
